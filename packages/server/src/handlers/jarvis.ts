import { Database } from "@opencode-ai/core/database/database"
import { JarvisRuntime } from "@opencode-ai/core/jarvis"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

const storage = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.orDie)

export const JarvisHandler = HttpApiBuilder.group(Api, "server.jarvis", (handlers) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return handlers
      .handle("jarvis.status", () => storage(JarvisRuntime.status(db)))
      .handle("jarvis.config", () => storage(JarvisRuntime.getConfig(db)))
      .handle("jarvis.updateConfig", (ctx) => storage(JarvisRuntime.updateConfig(db, ctx.payload)))
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
  }),
)
