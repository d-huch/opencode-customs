import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"

import { Effect, Layer, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { contextBudget } from "@/local-agent-runtime/resource-governor"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { buildPrompt, normalizeSummary } from "@opencode-ai/core/session/compaction"
import { ResponseLanguage } from "@opencode-ai/core/response-language"
import { SessionCompactionEvent } from "@opencode-ai/schema/session-compaction-event"
import type { ModelMessage, Tool } from "ai"
import { ModelSwitcher } from "@/local-agent-runtime/model-switcher"
import { CapabilityRouter } from "@/local-agent-runtime/capability-router"
import { SessionLog } from "@/local-agent-runtime/session-log"
import { SessionFreshness } from "./freshness"
import { ContextCompiler, type Preview, type SystemFragment } from "./context-compiler"

export const Event = SessionCompactionEvent

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const COMPACTION_PROMPT_HEADROOM = 512
const PRUNE_PROTECTED_TOOLS = ["skill"]
const REQUEST_ESTIMATE_MULTIPLIER = 1.35
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 15_000
type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

function safeEstimate(input: string) {
  return Math.ceil(Token.estimate(input) * REQUEST_ESTIMATE_MULTIPLIER)
}

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

const serialize = (message: SessionV1.WithParts) => {
  if (message.info.role === "user") {
    const text = message.parts
      .filter((part): part is SessionV1.TextPart => part.type === "text" && !part.ignored)
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n")
    const files = message.parts.flatMap((part) =>
      part.type === "file" ? [`[Attached ${part.mime}: ${part.filename ?? "file"}]`] : [],
    )
    return [...(text ? [`[User]: ${text}`] : []), ...files].join("\n")
  }
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return part.text ? [`[Assistant]: ${part.text}`] : []
      if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
      if (part.type !== "tool") return []
      const call = `[Assistant tool call]: ${part.tool}(${JSON.stringify(part.state.input)})`
      if (part.state.status === "completed") {
        const attachments = (part.state.attachments ?? []).map(
          (item) => `[Attached ${item.mime}: ${item.filename ?? "file"}]`,
        )
        const output = part.state.time.compacted
          ? "[Old tool result content cleared]"
          : truncate([part.state.output, ...attachments].join("\n"))
        return [call, `[Tool result]: ${output}`]
      }
      if (part.state.status === "error") return [call, `[Tool error]: ${part.state.error}`]
      return [call]
    })
    .join("\n")
}

function summaryText(message: SessionV1.WithParts) {
  const text = message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function compactionEvidence(messages: SessionV1.WithParts[]) {
  return messages.flatMap((message) => {
    if (message.info.role === "user") {
      return message.parts.flatMap((part) => {
        if (part.type === "text" && part.synthetic !== true) return [part.text]
        if (part.type !== "file") return []
        return [part.filename, part.url.startsWith("data:") ? undefined : part.url].filter(
          (item): item is string => !!item,
        )
      })
    }
    return message.parts.flatMap((part) => {
      if (part.type !== "tool" || part.state.status !== "completed") return []
      return [part.state.title, part.state.output, JSON.stringify(part.state.metadata)]
    })
  })
}

function completedCompactions(messages: SessionV1.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}

function turns(messages: SessionV1.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: SessionV1.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: SessionV1.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly isRequestOverflow: (input: {
    system: string[]
    messages: ModelMessage[]
    tools: Record<string, Tool>
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly fitRequest: (input: {
    fixedSystem: string[]
    system: string[]
    systemFragments?: SystemFragment[]
    messages: ModelMessage[]
    tools: Record<string, Tool>
    model: Provider.Model
    requiredTools?: string[]
    currentUserText?: string
    checkpointSummary?: string
  }) => Effect.Effect<{
    system: string[]
    messages: ModelMessage[]
    tools: Record<string, Tool>
    tokens: number
    limit: number
    usage: number
    compressed: boolean
    overflow: boolean
    preview: Preview
  }>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: SessionV1.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: SessionV1.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({
        cfg: yield* config.get(),
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    const isRequestOverflow = Effect.fn("SessionCompaction.isRequestOverflow")(function* (input: {
      system: string[]
      messages: ModelMessage[]
      tools: Record<string, Tool>
      model: Provider.Model
    }) {
      const cfg = yield* config.get()
      if (cfg.compaction?.auto === false) return false
      if (input.model.limit.context === 0) return false
      return (
        Token.estimate(JSON.stringify({ system: input.system, messages: input.messages, tools: input.tools })) >=
        usable({ cfg, model: input.model, outputTokenMax: flags.outputTokenMax })
      )
    })

    const fitRequest = Effect.fn("SessionCompaction.fitRequest")(function* (input: {
      fixedSystem: string[]
      system: string[]
      systemFragments?: SystemFragment[]
      messages: ModelMessage[]
      tools: Record<string, Tool>
      model: Provider.Model
      requiredTools?: string[]
      currentUserText?: string
      checkpointSummary?: string
    }) {
      const cfg = yield* config.get()
      const providerConfig = cfg.provider?.[input.model.providerID]
      const governed = yield* Effect.promise(() =>
        contextBudget({
          providerID: input.model.providerID,
          modelID: input.model.api.id,
          requestedContext: input.model.limit.context,
          outputTokens: Math.min(input.model.limit.output, flags.outputTokenMax ?? input.model.limit.output),
          apiURL: input.model.api.url,
          baseURL: providerConfig?.options?.baseURL,
          apiKey: providerConfig?.options?.apiKey,
        }),
      )
      const limit = Math.min(
        usable({ cfg, model: input.model, outputTokenMax: flags.outputTokenMax }),
        governed?.safeInputTokens ?? Number.POSITIVE_INFINITY,
      )
      return ContextCompiler.compile({
        fixedSystem: input.fixedSystem,
        system:
          input.systemFragments ??
          input.system.map((content, index) => ({
            source: "stable_system_prefix",
            provenance: `legacy_system_${index}`,
            content,
          })),
        messages: input.messages,
        tools: input.tools,
        requiredTools: input.requiredTools,
        currentUserText: input.currentUserText,
        checkpointSummary: input.checkpointSummary,
        limit,
      })
    })

    const fitCompactionHead = Effect.fn("SessionCompaction.fitHead")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
      cfg: ConfigV1.Info
      prompt: string
    }) {
      const budget = Math.max(
        0,
        usable({ cfg: input.cfg, model: input.model, outputTokenMax: flags.outputTokenMax }) -
          safeEstimate(input.prompt) -
          COMPACTION_PROMPT_HEADROOM,
      )
      const convert = (messages: SessionV1.WithParts[]) =>
        MessageV2.toModelMessagesEffect(messages, input.model, {
          stripMedia: true,
          toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
        })
      const all = yield* convert(input.messages)
      if (safeEstimate(JSON.stringify(all)) <= budget) return input.messages

      const candidates = turns(input.messages)
      for (const turn of candidates.slice(1)) {
        const messages = yield* convert(input.messages.slice(turn.start))
        if (safeEstimate(JSON.stringify(messages)) > budget) continue
        yield* Effect.logWarning("trimmed old history before compaction", {
          dropped: turn.start,
          budget,
        })
        return input.messages.slice(turn.start)
      }

      const last = input.messages.findLast((message) => message.info.role === "user")
      if (!last) return input.messages
      yield* Effect.logWarning("compaction history reduced to latest user turn", { budget })
      return [last]
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: SessionV1.WithParts[]
      cfg: ConfigV1.Info
      model: Provider.Model
    }) {
      const limit = input.cfg.compaction?.tail_turns
      if (limit !== undefined && limit <= 0) return { head: input.messages, tail_start_id: undefined }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = limit === undefined ? all : all.slice(-limit)

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        // estimate lazily so cost stays proportional to the retained tail, not the whole session
        const size = yield* estimate({
          messages: input.messages.slice(turn.start, turn.end),
          model: input.model,
        })
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) {
          yield* Effect.logInfo("tail fallback", { budget, size, total })
        }
        break
      }

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      yield* Effect.logInfo("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      yield* Effect.logInfo("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: SessionV1.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      yield* Effect.promise(() =>
        SessionLog.write({
          sessionID: input.sessionID,
          type: "compaction.started",
          data: { parentID: input.parentID, auto: input.auto, overflow: input.overflow === true },
        }),
      )
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")

      let messages = input.messages
      let replay:
        | {
            info: SessionV1.User
            parts: SessionV1.Part[]
          }
        | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }

      const agent = yield* agents.get("compaction")
      const cfg = yield* config.get()
      const preferredModel = agent.model && CapabilityRouter.automaticRoutingEnabled(cfg)
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie)
      const activation =
        preferredModel.providerID === "lmstudio"
          ? yield* Effect.promise(() =>
              ModelSwitcher.activate({
                config: cfg,
                preferredModel,
                role: "utility",
                requestShape: { textCharacters: 0, files: 0, images: 0, tools: 0 },
              }),
            )
          : undefined
      const model = activation?.model ?? preferredModel
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const selected = yield* select({
        messages: history.filter((_, index) => !hidden.has(index)),
        cfg,
        model,
      })
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const languageSample = input.messages
        .findLast(
          (message) =>
            message.info.role === "user" &&
            message.parts.some((part) => part.type === "text" && part.synthetic !== true && part.text.trim()),
        )
        ?.parts.flatMap((part) =>
          part.type === "text" && part.synthetic !== true && part.text.trim() ? [part.text.trim()] : [],
        )
        .join("\n")
      const msgs = structuredClone(selected.head)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const promptHead = compacting.prompt ?? buildPrompt({ previousSummary, context: compacting.context })
      const fitted = yield* fitCompactionHead({ messages: msgs, model, cfg, prompt: promptHead })
      const conversation = fitted.map(serialize).filter(Boolean).join("\n\n")
      const nextPrompt =
        compacting.prompt ??
        [
          buildPrompt({
            previousSummary,
            context: [conversation],
          }),
          ...compacting.context,
        ]
          .filter(Boolean)
          .join("\n\n")
      const ctx = yield* InstanceState.context
      const msg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: userMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
      }
      yield* session.updateMessage(msg)
      const processor = yield* processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model,
      })
      const result = yield* processor.process({
        user: userMessage,
        agent,
        sessionID: input.sessionID,
        tools: {},
        system: [ResponseLanguage.instruction(languageSample ?? "")].filter(
          (part): part is string => part !== undefined,
        ),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  nextPrompt,
                  ...(compacting.prompt ? ["The following is the conversation history:", conversation] : []),
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              },
            ],
          },
        ],
        model,
      })

      if (result === "compact") {
        processor.message.error = new SessionV1.ContextOverflowError({
          message: replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : "Session too large to compact - context exceeds model limit even after stripping media",
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        yield* Effect.promise(() =>
          SessionLog.write({
            sessionID: input.sessionID,
            type: "compaction.failed",
            messageID: processor.message.id,
            data: { reason: processor.message.error },
          }),
        )
        return "stop"
      }

      const summaryParts =
        (yield* session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)).find(
          (message) => message.info.id === processor.message.id,
        )?.parts ?? []
      const textParts = summaryParts.filter((part): part is SessionV1.TextPart => part.type === "text")
      const firstText = textParts[0]
      if (firstText) {
        const summary = normalizeSummary({
          text: textParts.map((part) => part.text).join("\n\n"),
          evidence: [...compactionEvidence(msgs), ...compacting.context],
        })
        yield* session.updatePart({
          ...firstText,
          text: summary,
          metadata: { ...firstText.metadata, compaction_normalized: true },
        })
        yield* Effect.forEach(textParts.slice(1), (part) =>
          session.removePart({ sessionID: input.sessionID, messageID: processor.message.id, partID: part.id }),
        )
      }

      if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
        yield* session.updatePart({
          ...compactionPart,
          tail_start_id: selected.tail_start_id,
        })
      }

      if (result === "continue" && input.auto) {
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider
                  .getModel(userMessage.model.providerID, userMessage.model.modelID)
                  .pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            // A nested compaction may no longer project the original user message.
            // In that case the previous compaction continuation is the durable copy
            // of the active request and must win over a generic continuation prompt.
            const latestRequest =
              MessageV2.latestUserRequest(input.messages) ?? MessageV2.activeUserRequest(input.messages)
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
              format: latestRequest?.info.format,
              tools: latestRequest?.info.tools,
              system: latestRequest?.info.system,
            })
            const requestText = MessageV2.userRequestText(latestRequest)
            const text = input.overflow
              ? "The latest user request exceeded the provider's size limit because of large media attachments. Explain that the attachments were too large to process and suggest retrying with smaller or fewer files."
              : requestText?.slice(0, 2_000) || "Continue the latest request."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: SessionFreshness.continuationMetadata({
                messages: input.messages,
                request: latestRequest,
              }),
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (processor.message.error) return "stop"
      if (result === "continue") {
        yield* events.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      yield* Effect.promise(() =>
        SessionLog.write({
          sessionID: input.sessionID,
          type: "compaction.finished",
          messageID: processor.message.id,
          data: { result, auto: input.auto, overflow: input.overflow === true },
        }),
      )
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
    })

    return Service.of({
      isOverflow,
      isRequestOverflow,
      fitRequest,
      prune,
      process: processCompaction,
      create,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Config.node,
    Session.node,
    Agent.node,
    Plugin.node,
    SessionProcessor.node,
    Provider.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
  ],
})

export * as SessionCompaction from "./compaction"
