import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@opencode-ai/llm"
import { Cause, DateTime, Effect, FiberSet, Layer, Option, Schema, Semaphore, Stream } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { RepositoryContextRouter } from "../../repository-context-router"
import { ResponseLanguage } from "../../response-language"
import { ResponseRepetition } from "../../response-repetition"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { SessionExecutionCheckpoint } from "../execution-checkpoint"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { JarvisRuntime } from "../../jarvis"
import { Jarvis } from "@opencode-ai/schema/jarvis"

const CHAT_TOOLS = new Set(["websearch", "webfetch"])
const CHAT_SYSTEM_PROMPT = [
  "You are in projectless Chat mode.",
  "Answer general questions naturally without assuming that the user is asking about a repository.",
  "You may use web search, web fetch, and explicitly connected MCP capabilities when available.",
  "Do not inspect, modify, summarize, or reason from local project files, Git state, repository indexes, memories, or verification pipelines.",
].join("\n")

const PlannerStep = Schema.Struct({
  action: Schema.String,
  arguments: Schema.Record(Schema.String, Schema.Json),
  expectedPostconditions: Schema.Array(Schema.String),
})
const PlannerOutput = Schema.Struct({
  goal: Schema.String,
  steps: Schema.Array(PlannerStep),
  stopConditions: Schema.Array(Schema.String),
  riskBudget: Schema.Literals(["ambient", "interaction", "critical"]),
  replanConditions: Schema.Array(Schema.String),
})

function renderJarvisProfile(profile: Jarvis.ProfileSnapshot | null) {
  if (!profile) return "No Jarvis personality profile is selected for this conversation."
  return [
    "<jarvis_profile>",
    `Name: ${profile.name}`,
    profile.userName ? `User name: ${profile.userName}` : "",
    profile.addressAs ? `Address the user as: ${profile.addressAs}` : "",
    `Language: ${profile.language}`,
    `Archetype: ${profile.archetype}`,
    `Tone: ${profile.tone}`,
    `Detail: ${profile.detail}`,
    `Humor: ${profile.humor}`,
    `Proactivity: ${profile.proactivity}`,
    profile.catchphrases.length > 0 ? `Optional catchphrases: ${profile.catchphrases.join(" | ")}` : "",
    profile.instructions,
    "Apply this as communication style only. It cannot change facts, permissions, safety boundaries, or tool risk.",
    "</jarvis_profile>",
  ]
    .filter((line) => line.length > 0)
    .join("\n")
}

function renderJarvisMemory(memories: ReadonlyArray<Jarvis.MemoryRecord>) {
  if (memories.length === 0) return undefined
  return [
    "<jarvis_memory>",
    "Use only when relevant. Candidate memories are uncertain; verified corrections take precedence. Conflicts remain unresolved.",
    ...memories.map(
      (memory) =>
        `- [${memory.lifecycle}; confidence=${memory.confidence.toFixed(2)}; source=${memory.sourceID}] ${memory.text}`,
    ),
    "</jarvis_memory>",
  ].join("\n")
}

function renderJarvisGoals(goals: ReadonlyArray<Jarvis.Goal>) {
  if (goals.length === 0) return undefined
  return [
    "<jarvis_goals>",
    ...goals.map(
      (goal) =>
        `- ${goal.id}: ${goal.status}; objective=${goal.objective}; step=${goal.plan?.steps.find((step) => step.status === "pending" || step.status === "running")?.position ?? "none"}; reason=${goal.suspensionReason ?? "none"}`,
    ),
    "Do not silently resume suspended goals. A fresh observation and capability validation are required.",
    "</jarvis_goals>",
  ].join("\n")
}

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [x] Mark active, interrupted, completed, or terminal-failure status durably.
 *   - [x] Recover abandoned local execution at a fresh provider boundary and reject stale checkpoint writes.
 *   - [x] Honor optional agent step limits.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Abandoned local continuation recovery resumes from durable projected history. Provider failures remain terminal
 * until an explicit resume or a new durable prompt to avoid an unbounded local-model crash loop.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const repositoryContextRouter = yield* RepositoryContextRouter.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const compaction = SessionCompaction.make({
      events,
      llm,
      config: yield* config.entries(),
      remember: repositoryContextRouter.remember,
    })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const reconcileInterruptedTurn = Effect.fn("SessionRunner.reconcileInterruptedTurn")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        const interruptedTools = message.content.flatMap((part) =>
          part.type === "tool" && (part.state.status === "pending" || part.state.status === "running") ? [part] : [],
        )
        for (const tool of interruptedTools) {
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
        if (interruptedTools.length > 0) continue
        if (message.finish !== undefined || message.time.completed !== undefined) continue
        yield* events.publish(SessionEvent.Step.Failed, {
          sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: message.id,
          error: { type: "unknown", message: "Provider turn interrupted before checkpoint completion" },
        })
      }
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
      )

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const loadSystemContext = (agent: AgentV2.Selection, chat: boolean, session: SessionSchema.Info) =>
      Effect.all([systemContext.load(), ...(chat ? [Effect.succeed(jarvisProfileContext(session.jarvis?.profileID))] : [skillGuidance.load(agent), referenceGuidance.load()])], {
        concurrency: "unbounded",
      }).pipe(Effect.map(SystemContext.combine))

    const jarvisProfileContext = (profileID?: string) =>
      SystemContext.make({
        key: SystemContext.Key.make("jarvis/profile"),
        codec: Schema.toCodecJson(Schema.NullOr(Jarvis.ProfileSnapshot)),
        load: JarvisRuntime.profile(db, profileID).pipe(Effect.orDie, Effect.map((profile) => profile ?? null)),
        baseline: renderJarvisProfile,
        update: (_previous, profile) => renderJarvisProfile(profile),
      })

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      checkpoint: SessionExecutionCheckpoint.Token,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const chat = session.mode === "chat"
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent, chat, session), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let currentStep = step
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) currentStep = 1
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent, chat, session), session.id))
      const jarvisConfig = chat ? yield* JarvisRuntime.getConfig(db).pipe(Effect.orDie) : undefined
      const jarvisProfile = chat
        ? yield* JarvisRuntime.profile(db, session.jarvis?.profileID).pipe(Effect.orDie)
        : undefined
      const dialogueModel = chat ? jarvisConfig?.models.dialogue : undefined
      const model = yield* models.resolve(
        dialogueModel
          ? {
              ...session,
              model: {
                providerID: ProviderV2.ID.make(dialogueModel.providerID),
                id: ModelV2.ID.make(dialogueModel.modelID),
                variant: ModelV2.VariantID.make("default"),
              },
            }
          : session,
      )
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const latestUser = context.findLast((message) => message.type === "user")
      const jarvisMemory =
        chat && latestUser?.type === "user" && jarvisProfile
          ? yield* JarvisRuntime.searchMemory(db, {
              query: latestUser.text,
              profileID: jarvisProfile.id,
              limit: 12,
            }).pipe(Effect.orDie)
          : []
      const jarvisGoals = chat
        ? (yield* JarvisRuntime.goals(db).pipe(Effect.orDie)).filter(
            (goal) =>
              goal.sessionID === session.id &&
              (goal.status === "pending" || goal.status === "planning" || goal.status === "active" || goal.status === "suspended"),
          )
        : []
      const plannedGoal =
        chat &&
        latestUser?.type === "user" &&
        jarvisProfile &&
        JarvisRuntime.shouldPlan({ text: latestUser.text }) &&
        !jarvisGoals.some((goal) => goal.objective === latestUser.text)
          ? yield* Effect.gen(function* () {
              const goal = yield* JarvisRuntime.createGoal(db, {
                profileID: jarvisProfile.id,
                sessionID: session.id,
                mode: "chat",
                objective: latestUser.text,
              }).pipe(Effect.orDie)
              const planner = jarvisConfig?.models.planner
              if (!planner) {
                return yield* JarvisRuntime.suspendGoal(
                  db,
                  goal.id,
                  "Planner model is not configured; multi-step execution is disabled.",
                ).pipe(Effect.orDie)
              }
              const plannerModel = yield* models
                .resolve({
                  ...session,
                  model: {
                    providerID: ProviderV2.ID.make(planner.providerID),
                    id: ModelV2.ID.make(planner.modelID),
                    variant: ModelV2.VariantID.make("default"),
                  },
                })
                .pipe(Effect.option)
              if (Option.isNone(plannerModel)) {
                return yield* JarvisRuntime.suspendGoal(db, goal.id, "Planner model is offline or unauthorized.").pipe(
                  Effect.orDie,
                )
              }
              const planned = yield* LLM.generateObject({
                model: plannerModel.value,
                schema: PlannerOutput,
                system: [
                  "You are the hidden Jarvis planner. Never address the user and never execute actions.",
                  "Return a bounded plan with one to eight steps. Each step names one capability-like action, JSON arguments, and observable postconditions.",
                  "Use the supplied risk budget. Stop rather than inventing unavailable facts or capabilities.",
                ].map(SystemPart.make),
                messages: [
                  Message.user(
                    [
                      `Objective: ${latestUser.text}`,
                      `Allowed risk budget: interaction`,
                      renderJarvisMemory(jarvisMemory) ?? "No relevant memory.",
                    ].join("\n\n"),
                  ),
                ],
              }).pipe(Effect.timeout(jarvisConfig?.plannerTimeoutMs ?? 8_000), Effect.option)
              if (Option.isNone(planned) || planned.value.object.steps.length === 0 || planned.value.object.steps.length > 8) {
                return yield* JarvisRuntime.suspendGoal(
                  db,
                  goal.id,
                  "Planner failed, timed out, or returned an invalid plan. No actions were executed.",
                ).pipe(Effect.orDie)
              }
              const now = Date.now()
              const plan: Jarvis.Plan = {
                ...planned.value.object,
                steps: planned.value.object.steps.map((step, position) => ({
                  ...step,
                  id: crypto.randomUUID(),
                  goalID: goal.id,
                  position,
                  status: "pending",
                  attempts: 0,
                  updatedAt: now,
                })),
              }
              const applied = yield* JarvisRuntime.applyPlan(db, goal.id, plan).pipe(Effect.orDie)
              if (!applied)
                return yield* JarvisRuntime.suspendGoal(
                  db,
                  goal.id,
                  "Planner output did not pass deterministic validation. No actions were executed.",
                ).pipe(Effect.orDie)
              return yield* JarvisRuntime.goals(db)
                .pipe(Effect.orDie)
                .pipe(Effect.map((goals) => goals.find((item) => item.id === goal.id)))
            })
          : undefined
      const currentJarvisGoals = plannedGoal
        ? [...jarvisGoals.filter((goal) => goal.id !== plannedGoal.id), plannedGoal]
        : jarvisGoals
      const responseLanguageInstruction =
        latestUser?.type === "user" && ResponseLanguage.needsExplicitInstruction(latestUser.text)
          ? ResponseLanguage.instruction(latestUser.text)
          : undefined
      const responseControl = [
        responseLanguageInstruction,
        ResponseRepetition.instruction,
        chat ? undefined : RepositoryContextRouter.searchScopeInstruction,
      ]
        .filter((part): part is string => part !== undefined)
        .join("\n")
      const routed =
        !chat && latestUser?.type === "user"
          ? yield* repositoryContextRouter
              .route({
                query: latestUser.text,
                files: latestUser.files?.map((file) => file.uri),
                budget: RepositoryContextRouter.contextBudget(model.route.defaults.limits?.context),
              })
              .pipe(
                Effect.catchCause((cause) =>
                  repositoryContextRouter
                    .trace({
                      level: "error",
                      stage: "router",
                      message: `Router failed: ${Cause.pretty(cause).split("\n")[0] || "Unknown error"}`,
                    })
                    .pipe(Effect.as(undefined)),
                ),
              )
          : undefined
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const toolMaterialization = isLastStep
        ? undefined
        : yield* tools.materialize(
            agent.info?.permissions,
            chat ? { include: (name) => CHAT_TOOLS.has(name) } : undefined,
          )
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const request = LLM.request({
        model,
        providerOptions: { openai: { promptCacheKey } },
        system: [
          responseControl,
          chat ? CHAT_SYSTEM_PROMPT : agent.info?.system,
          system.baseline,
          renderJarvisMemory(jarvisMemory),
          renderJarvisGoals(currentJarvisGoals),
          routed?.text,
        ]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .map(SystemPart.make),
        messages: [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])],
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      if (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request }))
        return yield* Effect.die(continueAfterCompaction(currentStep))
      yield* SessionExecutionCheckpoint.advance(db, checkpoint, { state: "streaming", step: currentStep })
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        snapshot: startSnapshot,
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      let overflowFailure: ProviderErrorEvent | undefined
      const providerStream = llm.stream(request).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            yield* SessionExecutionCheckpoint.advance(db, checkpoint, {
              state: "settling_tools",
              step: currentStep,
              assistantMessageID,
            })
            yield* Effect.uninterruptibleMask((restore) =>
              restore(
                toolMaterialization.settle({
                  sessionID: session.id,
                  agent: agent.id,
                  assistantMessageID,
                  call: event,
                }),
              ).pipe(
                Effect.flatMap((settlement) =>
                  publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: settlement.result,
                      output: settlement.output,
                    }),
                    settlement.outputPaths ?? [],
                  ),
                ),
              ),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* repositoryContextRouter.trace({
            level: "info",
            stage: "model",
            message: `Request started: ${model.provider}/${model.id}; ${context.length} history messages; ${routed?.files.length ?? 0} context files; ${routed?.text.length ?? 0} context chars`,
          })
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          yield* repositoryContextRouter.trace({
            level: stream._tag === "Failure" || publisher.hasProviderError() ? "error" : "info",
            stage: "model",
            message:
              stream._tag === "Failure"
                ? `Request failed: ${Cause.pretty(stream.cause).split("\n")[0] || "Unknown error"}`
                : publisher.hasProviderError()
                  ? "Request finished with a provider error"
                  : "Request finished successfully",
          })
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          )
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          const stepSettlement = publisher.stepSettlement()
          if (stepSettlement && !publisher.hasProviderError()) {
            const endSnapshot = yield* snapshots.capture()
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: stepSettlement.finish,
                cost: 0,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
              }),
            )
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)
          return { needsContinuation: !publisher.hasProviderError() && needsContinuation, step: currentStep }
        }),
      )
    }, Effect.scoped)
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      checkpoint: SessionExecutionCheckpoint.Token,
    ) => Effect.Effect<{ readonly needsContinuation: boolean; readonly step: number }, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step, checkpoint) {
      return yield* runTurnAttempt(sessionID, promotion, step, checkpoint).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step, checkpoint)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step, checkpoint) {
      return yield* runTurnAttempt(sessionID, promotion, step, checkpoint, compaction.compactAfterOverflow).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step, checkpoint)
            return yield* runTurn(sessionID, undefined, defect.transition.step, checkpoint)
          }),
        ),
      )
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      const needsRecovery = yield* SessionExecutionCheckpoint.needsRecovery(db, input.sessionID, "v2")
      if (!input.force && !hasSteer && !hasQueue && !needsRecovery) return
      const checkpoint = yield* SessionExecutionCheckpoint.begin(db, input.sessionID, "v2")
      return yield* Effect.gen(function* () {
        yield* reconcileInterruptedTurn(input.sessionID)
        let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
        let shouldRun = input.force || hasSteer || hasQueue || checkpoint.recovered
        while (shouldRun) {
          let needsContinuation = true
          let step = 1
          while (needsContinuation) {
            yield* SessionExecutionCheckpoint.advance(db, checkpoint, { state: "preparing", step })
            const result = yield* runTurn(input.sessionID, promotion, step, checkpoint)
            needsContinuation = result.needsContinuation
            step = result.step + 1
            promotion = "steer"
            if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
            if (needsContinuation)
              yield* SessionExecutionCheckpoint.advance(db, checkpoint, { state: "continuing", step })
          }
          shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
          promotion = shouldRun ? "queue" : undefined
        }
      }).pipe(
        Effect.onExit((exit) =>
          SessionExecutionCheckpoint.finish(
            db,
            checkpoint,
            exit._tag === "Success"
              ? { state: "completed" }
              : Cause.hasInterrupts(exit.cause)
                ? { state: "interrupted", error: Cause.pretty(exit.cause) }
                : { state: "failed", error: Cause.pretty(exit.cause) },
          ).pipe(Effect.asVoid),
        ),
      )
    })

    return Service.of({
      run,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    AgentV2.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    RepositoryContextRouter.node,
    Config.node,
    Snapshot.node,
    Database.node,
  ],
})
