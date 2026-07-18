import { describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecutionCheckpoint } from "@opencode-ai/core/session/execution-checkpoint"
import { SessionExecutionCheckpointTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node])))

const setup = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: sessionID,
        directory: "/project",
        title: "checkpoint",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    return db
  })

describe("SessionExecutionCheckpoint", () => {
  it.effect("persists execution phases and terminal completion", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_checkpoint_phases")
      const db = yield* setup(sessionID)
      const checkpoint = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v2")

      expect(checkpoint.recovered).toBe(false)
      expect(yield* SessionExecutionCheckpoint.advance(db, checkpoint, { state: "streaming", step: 2 })).toBe(true)
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        execution_id: checkpoint.executionID,
        runtime: "v2",
        generation: 1,
        state: "streaming",
        step: 2,
        owner_pid: process.pid,
      })

      expect(yield* SessionExecutionCheckpoint.finish(db, checkpoint, { state: "completed" })).toBe(true)
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        state: "completed",
        time_completed: expect.any(Number),
      })
    }),
  )

  it.effect("recovers an abandoned generation and rejects stale checkpoint writes", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_checkpoint_recovery")
      const db = yield* setup(sessionID)
      const abandoned = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v2")
      yield* db
        .update(SessionExecutionCheckpointTable)
        .set({ state: "continuing", owner_pid: 2_147_483_647 })
        .where(eq(SessionExecutionCheckpointTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)

      expect(yield* SessionExecutionCheckpoint.abandoned(db, "v2")).toEqual([sessionID])
      expect(yield* SessionExecutionCheckpoint.abandoned(db, "v1")).toEqual([])
      const recovered = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v2")

      expect(recovered.recovered).toBe(true)
      expect(recovered.generation).toBe(2)
      expect(yield* SessionExecutionCheckpoint.advance(db, abandoned, { state: "streaming", step: 3 })).toBe(false)
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        execution_id: recovered.executionID,
        generation: 2,
        state: "preparing",
        recoveries: 1,
      })
    }),
  )
})
