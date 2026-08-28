export * as JarvisWakeScheduler from "./wake-scheduler"

import { AgentV2 } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { JarvisRuntime } from "@opencode-ai/core/jarvis"
import { JarvisCompanion } from "@opencode-ai/core/jarvis-companion"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Effect, Layer, Option, Schedule, Scope } from "effect"
import path from "path"

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const fs = yield* FSUtil.Service
    const sessions = yield* SessionV2.Service
    const scope = yield* Scope.Scope

    yield* JarvisRuntime.suspendInterruptedGoals(db).pipe(Effect.orDie)
    yield* JarvisRuntime.cancelInterruptedTurns(db).pipe(Effect.orDie)

    const ensureReflectionCandidates = Effect.fn("JarvisWakeScheduler.ensureReflections")(function* () {
      const config = yield* JarvisRuntime.getConfig(db)
      if (!config.primaryProfileID || !config.initiative.enabled) return
      const now = new Date()
      const date = now.toISOString().slice(0, 10)
      const slots = [
        ...(now.getHours() >= 10 ? [{ topic: `reflection:${date}:morning`, text: "Review open promises, active goals, and genuinely useful check-ins." }] : []),
        ...(now.getHours() >= 18 ? [{ topic: `reflection:${date}:evening`, text: "Review today's unresolved goals and only surface something actionable." }] : []),
      ]
      yield* Effect.forEach(
        slots,
        (slot) =>
          JarvisRuntime.enqueueWake(db, {
            kind: "reflection",
            topic: slot.topic,
            text: slot.text,
            priority: 10,
          }),
        { discard: true },
      )
    })

    const ensureDailyBriefing = Effect.fn("JarvisWakeScheduler.ensureDailyBriefing")(function* () {
      const status = yield* JarvisCompanion.status(db)
      const lastRun = status.lastRun
      const completedDate =
        lastRun && lastRun.accountID === status.google.accountID && ["completed", "partial", "skipped"].includes(lastRun.status)
          ? lastRun.localDate
          : undefined
      const trigger = JarvisCompanion.scheduleDecision(Date.now(), status.config, completedDate)
      if (!trigger) return
      const run = yield* JarvisCompanion.run(db, { trigger })
      if (!run.briefingID || !["completed", "partial"].includes(run.status)) return
      const briefing = yield* JarvisCompanion.briefing(db, run.briefingID)
      if (!briefing) return
      yield* JarvisRuntime.enqueueWake(db, {
        kind: "manual",
        topic: `daily-briefing:${briefing.localDate}:${briefing.accountID}`,
        text: [
          `<daily_briefing id="${briefing.id}" date="${briefing.localDate}">`,
          briefing.summary,
          ...briefing.schedule,
          ...briefing.importantMessages,
          ...briefing.goalsAndPromises,
          ...briefing.risks,
          "Use only the supplied source IDs. Never infer missing facts or execute a proposed external action without separate approval.",
          "</daily_briefing>",
        ].join("\n"),
        priority: 90,
      })
    })

    const ensureInbox = Effect.fn("JarvisWakeScheduler.ensureInbox")(function* () {
      const config = yield* JarvisRuntime.getConfig(db)
      if (!config.primaryProfileID) return undefined
      const existing = config.inboxSessionID
        ? yield* sessions.get(SessionV2.ID.make(config.inboxSessionID)).pipe(Effect.option)
        : Option.none()
      if (Option.isSome(existing)) return existing.value
      const profile = yield* JarvisRuntime.profile(db, config.primaryProfileID)
      if (!profile) return undefined
      const directory = path.join(Global.Path.data, "chat")
      yield* fs.ensureDir(directory)
      const session = yield* sessions.create({
        location: { directory: AbsolutePath.make(directory) },
        mode: "chat",
        agent: AgentV2.ID.make("chat"),
        jarvis: {
          profileID: profile.id,
          profileRevision: profile.revision,
          mode: "chat",
          inbox: true,
        },
      })
      yield* JarvisRuntime.updateConfig(db, { ...config, inboxSessionID: session.id, updatedAt: Date.now() })
      return session
    })

    const tick = Effect.fn("JarvisWakeScheduler.tick")(function* () {
      yield* ensureDailyBriefing()
      yield* ensureReflectionCandidates()
      const wake = yield* JarvisRuntime.claimWake(db)
      if (!wake) return
      const session = wake.sessionID
        ? yield* sessions.get(SessionV2.ID.make(wake.sessionID)).pipe(Effect.option)
        : Option.none()
      const target = Option.isSome(session) ? session.value : yield* ensureInbox()
      if (!target) {
        yield* JarvisRuntime.markWakeBlocked(db, wake.id)
        return
      }
      yield* sessions
        .prompt({
          sessionID: target.id,
          delivery: "queue",
          prompt: {
            text: [
              `<jarvis_initiative kind="${wake.kind}" topic="${wake.topic}">`,
              wake.text,
              "Only respond if this is timely and useful. Read-only reasoning is allowed; request permission before any external, file, paid, interaction, or critical action.",
              "</jarvis_initiative>",
            ].join("\n"),
          },
        })
        .pipe(
          Effect.catchCause((cause) =>
            JarvisRuntime.markWakeBlocked(db, wake.id).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
        )
    })

    yield* tick().pipe(
      Effect.catchCause((cause) => Effect.logWarning("Jarvis wake scheduler tick failed", { cause: String(cause) })),
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkIn(scope),
    )
  }),
)
