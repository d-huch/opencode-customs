import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { JarvisRuntime } from "@opencode-ai/core/jarvis"
import { JarvisCompanion } from "@opencode-ai/core/jarvis-companion"
import { JarvisBenchmark } from "@opencode-ai/core/jarvis-benchmark"
import { Jarvis } from "@opencode-ai/protocol/groups/jarvis"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { SessionV2 } from "@opencode-ai/core/session"
import { JarvisTurnCoordinator } from "../jarvis-turn-coordinator"

const storage = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.orDie)

export const JarvisHandler = HttpApiBuilder.group(Api, "server.jarvis", (handlers) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const sessions = yield* SessionV2.Service
    return handlers
      .handle("jarvis.conversation", () =>
        storage(JarvisTurnCoordinator.conversation(db, sessions, { surface: "desktop" })),
      )
      .handle("jarvis.adoptConversation", (ctx) =>
        storage(JarvisTurnCoordinator.conversation(db, sessions, ctx.payload)),
      )
      .handle("jarvis.prewarm", (ctx) => storage(JarvisTurnCoordinator.prewarm(db, ctx.payload)))
      .handle("jarvis.admitFinal", (ctx) =>
        storage(
          JarvisTurnCoordinator.admit(db, sessions, ctx.payload).pipe(
            Effect.tap((result) => events.publish(Jarvis.TurnUpdated, { turn: result.turn })),
          ),
        ),
      )
      .handle("jarvis.controlStatus", () => storage(JarvisRuntime.controlStatus(db)))
      .handle("jarvis.updateMediaState", (ctx) => storage(JarvisRuntime.updateMediaState(db, ctx.payload)))
      .handle("jarvis.runDiagnostics", () => storage(JarvisRuntime.diagnostics(db)))
      .handle("jarvis.createTurn", (ctx) =>
        storage(
          JarvisRuntime.createTurn(db, ctx.payload).pipe(
            Effect.tap((turn) => events.publish(Jarvis.TurnUpdated, { turn })),
          ),
        ),
      )
      .handle("jarvis.currentTurn", () => storage(JarvisRuntime.currentTurn(db).pipe(Effect.map((turn) => turn ?? null))))
      .handle("jarvis.turn", (ctx) =>
        storage(JarvisRuntime.turn(db, ctx.params.turnID).pipe(Effect.map((turn) => turn ?? null))),
      )
      .handle("jarvis.updateTurn", (ctx) =>
        storage(
          JarvisRuntime.updateTurn(db, ctx.params.turnID, ctx.payload).pipe(
            Effect.tap((turn) => (turn ? events.publish(Jarvis.TurnUpdated, { turn }) : Effect.void)),
            Effect.map((turn) => turn ?? null),
          ),
        ),
      )
      .handle("jarvis.cancelTurn", (ctx) =>
        storage(
          JarvisRuntime.cancelTurn(db, ctx.params.turnID, ctx.payload).pipe(
            Effect.tap((turn) => (turn ? events.publish(Jarvis.TurnUpdated, { turn }) : Effect.void)),
            Effect.map((turn) => turn ?? null),
          ),
        ),
      )
      .handle("jarvis.presence", () => storage(JarvisRuntime.presence(db)))
      .handle("jarvis.handoffPresence", (ctx) =>
        storage(
          JarvisRuntime.handoffPresence(db, ctx.payload).pipe(
            Effect.tap((presence) => events.publish(Jarvis.PresenceUpdated, { presence })),
          ),
        ),
      )
      .handle("jarvis.status", () => storage(JarvisRuntime.status(db)))
      .handle("jarvis.config", () => storage(JarvisRuntime.getConfig(db)))
      .handle("jarvis.updateConfig", (ctx) => storage(JarvisRuntime.updateConfig(db, ctx.payload)))
      .handle(
        "jarvis.benchmarkStatus",
        Effect.fn(function* () {
          const benchmark = yield* JarvisBenchmark.Service
          return yield* benchmark.status()
        }),
      )
      .handle(
        "jarvis.runBenchmark",
        Effect.fn(function* (ctx) {
          const benchmark = yield* JarvisBenchmark.Service
          return yield* benchmark.run(ctx.payload.profile).pipe(Effect.orDie)
        }),
      )
      .handle(
        "jarvis.cancelBenchmark",
        Effect.fn(function* () {
          const benchmark = yield* JarvisBenchmark.Service
          return yield* benchmark.cancel()
        }),
      )
      .handle("jarvis.profiles", () => storage(JarvisRuntime.profiles(db)))
      .handle("jarvis.syncProfiles", (ctx) => storage(JarvisRuntime.syncProfiles(db, ctx.payload)))
      .handle("jarvis.goals", (ctx) => storage(JarvisRuntime.goals(db, ctx.query.status)))
      .handle("jarvis.createGoal", (ctx) => storage(JarvisRuntime.createGoal(db, ctx.payload)))
      .handle("jarvis.resumeGoal", (ctx) =>
        storage(JarvisRuntime.resumeGoal(db, ctx.params.goalID, ctx.payload).pipe(Effect.map((goal) => goal ?? null))),
      )
      .handle("jarvis.replanGoal", (ctx) =>
        storage(JarvisRuntime.replanGoal(db, ctx.params.goalID, ctx.payload).pipe(Effect.map((goal) => goal ?? null))),
      )
      .handle("jarvis.cancelGoal", (ctx) =>
        storage(JarvisRuntime.cancelGoal(db, ctx.params.goalID, ctx.payload).pipe(Effect.map((outcome) => outcome ?? null))),
      )
      .handle("jarvis.recordGoalStep", (ctx) =>
        storage(
          JarvisRuntime.recordStepResult(db, { goalID: ctx.params.goalID, ...ctx.payload }).pipe(
            Effect.map((goal) => goal ?? null),
          ),
        ),
      )
      .handle("jarvis.outcomes", (ctx) => storage(JarvisRuntime.outcomes(db, ctx.query.goalID)))
      .handle("jarvis.completeGoal", (ctx) =>
        storage(JarvisRuntime.completeGoal(db, ctx.params.goalID, ctx.payload).pipe(Effect.map((outcome) => outcome ?? null))),
      )
      .handle("jarvis.searchMemory", (ctx) => storage(JarvisRuntime.searchMemory(db, ctx.payload)))
      .handle("jarvis.remember", (ctx) => storage(JarvisRuntime.remember(db, ctx.payload)))
      .handle("jarvis.removeMemory", (ctx) =>
        storage(JarvisRuntime.removeMemory(db, ctx.params.memoryID).pipe(Effect.map((changed) => ({ changed })))),
      )
      .handle("jarvis.patchMemory", (ctx) =>
        storage(JarvisRuntime.patchMemory(db, ctx.params.memoryID, ctx.payload).pipe(Effect.map((memory) => memory ?? null))),
      )
      .handle("jarvis.resolveMemoryConflict", (ctx) =>
        storage(
          JarvisRuntime.resolveMemoryConflict(db, ctx.params.memoryID, ctx.payload).pipe(
            Effect.map((memory) => memory ?? null),
          ),
        ),
      )
      .handle("jarvis.reindexMemory", () =>
        storage(JarvisRuntime.backfillMemory(db)),
      )
      .handle("jarvis.memoryUses", (ctx) => storage(JarvisRuntime.memoryUses(db, ctx.query)))
      .handle("jarvis.recordMemoryUse", (ctx) => storage(JarvisRuntime.recordMemoryUse(db, ctx.payload)))
      .handle("jarvis.replays", (ctx) => storage(JarvisRuntime.replays(db, ctx.query.limit)))
      .handle("jarvis.recordReplay", (ctx) =>
        storage(
          JarvisRuntime.recordReplay(db, ctx.payload).pipe(
            Effect.tap((replay) => events.publish(Jarvis.ReplayUpdated, { replay })),
          ),
        ),
      )
      .handle("jarvis.replay", (ctx) =>
        storage(JarvisRuntime.replay(db, ctx.params.replayID).pipe(Effect.map((replay) => replay ?? null))),
      )
      .handle("jarvis.removeReplay", (ctx) =>
        storage(JarvisRuntime.removeReplay(db, ctx.params.replayID).pipe(Effect.map((changed) => ({ changed })))),
      )
      .handle("jarvis.executeReplay", (ctx) =>
        storage(JarvisRuntime.executeReplay(db, ctx.params.replayID, ctx.payload).pipe(Effect.map((value) => value ?? null))),
      )
      .handle("jarvis.replayExecution", (ctx) =>
        storage(JarvisRuntime.replayExecution(db, ctx.params.executionID).pipe(Effect.map((value) => value ?? null))),
      )
      .handle("jarvis.compareReplays", (ctx) =>
        storage(JarvisRuntime.compareReplayExecutions(db, ctx.payload).pipe(Effect.map((value) => value ?? null))),
      )
      .handle("jarvis.inbox", () => storage(JarvisRuntime.inbox(db)))
      .handle("jarvis.wake", (ctx) =>
        storage(JarvisRuntime.enqueueWake(db, ctx.payload).pipe(Effect.map((wake) => wake ?? null))),
      )
      .handle("jarvis.dismissInbox", (ctx) =>
        storage(JarvisRuntime.dismissWake(db, ctx.params.wakeID).pipe(Effect.map((wake) => wake ?? null))),
      )
      .handle("jarvis.retryInbox", (ctx) =>
        storage(JarvisRuntime.retryWake(db, ctx.params.wakeID).pipe(Effect.map((wake) => wake ?? null))),
      )
      .handle("jarvis.companionStatus", () => storage(JarvisCompanion.status(db)))
      .handle("jarvis.companionConfig", () => storage(JarvisCompanion.getConfig(db)))
      .handle("jarvis.updateCompanionConfig", (ctx) => storage(JarvisCompanion.updateConfig(db, ctx.payload)))
      .handle("jarvis.runDailyBriefing", (ctx) =>
        storage(
          JarvisCompanion.run(db, ctx.payload).pipe(
            Effect.tap((run) =>
              run.briefingID
                ? JarvisCompanion.briefing(db, run.briefingID).pipe(
                    Effect.flatMap((briefing) => {
                      if (!briefing) return Effect.void
                      return Effect.all([
                        events.publish(Jarvis.DailyBriefingUpdated, { briefing }),
                        JarvisRuntime.enqueueWake(db, {
                          kind: "manual",
                          topic: `daily-briefing:${briefing.localDate}:${briefing.accountID}`,
                          text: dailyBriefingPrompt(briefing),
                          priority: 90,
                        }),
                      ]).pipe(Effect.asVoid)
                    }),
                  )
                : Effect.void,
            ),
          ),
        ),
      )
      .handle("jarvis.dailyBriefings", (ctx) => storage(JarvisCompanion.briefings(db, ctx.query.limit)))
      .handle("jarvis.dailyBriefing", (ctx) =>
        storage(JarvisCompanion.briefing(db, ctx.params.briefingID).pipe(Effect.map((value) => value ?? null))),
      )
      .handle("jarvis.prepareCompanionAction", (ctx) => storage(JarvisCompanion.prepareAction(db, ctx.payload)))
      .handle("jarvis.companionActions", (ctx) => storage(JarvisCompanion.actions(db, ctx.query.limit)))
      .handle("jarvis.approveCompanionAction", (ctx) =>
        storage(
          Effect.gen(function* () {
            const proposal = yield* JarvisCompanion.action(db, ctx.params.actionID)
            if (!proposal) return null
            if (proposal.kind === "jarvis_reminder") {
              const wake = yield* JarvisRuntime.enqueueWake(db, {
                kind: "manual",
                topic: `companion-reminder:${proposal.id}`,
                text: companionText(proposal.input, proposal.preview),
                priority: 80,
              })
              const execution = yield* JarvisCompanion.completeLocalAction(db, proposal.id, { wakeID: wake?.id ?? null })
              return execution ?? null
            }
            if (proposal.kind === "jarvis_goal") {
              const config = yield* JarvisRuntime.getConfig(db)
              if (!config.primaryProfileID) return null
              const goal = yield* JarvisRuntime.createGoal(db, {
                profileID: config.primaryProfileID,
                mode: "chat",
                objective: companionText(proposal.input, proposal.preview),
              })
              const execution = yield* JarvisCompanion.completeLocalAction(db, proposal.id, { goalID: goal.id })
              return execution ?? null
            }
            return (yield* JarvisCompanion.approveExternalAction(db, ctx.params.actionID, ctx.payload)) ?? null
          }),
        ),
      )
      .handle("jarvis.cancelCompanionAction", (ctx) =>
        storage(JarvisCompanion.cancelAction(db, ctx.params.actionID).pipe(Effect.map((value) => value ?? null))),
      )
      .handle("jarvis.companionActionAudit", (ctx) => storage(JarvisCompanion.actionAudit(db, ctx.query.limit)))
  }),
)

function dailyBriefingPrompt(briefing: Jarvis.DailyBriefing) {
  return [
    `<daily_briefing id="${briefing.id}" date="${briefing.localDate}">`,
    briefing.summary,
    "Schedule:",
    ...briefing.schedule,
    "Important messages:",
    ...briefing.importantMessages,
    "Goals and promises:",
    ...briefing.goalsAndPromises,
    "Risks:",
    ...briefing.risks,
    "Use only the supplied source IDs. Mark unavailable sections explicitly and do not infer missing facts. Propose actions, but never execute an external change without a separate approval.",
    "</daily_briefing>",
  ].join("\n")
}

function companionText(input: Readonly<Record<string, unknown>>, fallback: string) {
  const value = input.text ?? input.objective
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}
