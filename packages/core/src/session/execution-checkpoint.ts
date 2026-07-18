export * as SessionExecutionCheckpoint from "./execution-checkpoint"

import { and, eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionExecutionCheckpointTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export type ActiveState = "preparing" | "streaming" | "settling_tools" | "continuing"
export type TerminalState = "completed" | "interrupted" | "failed"
export type State = ActiveState | TerminalState

export type Token = {
  readonly sessionID: SessionSchema.ID
  readonly runtime: "v1" | "v2"
  readonly executionID: string
  readonly generation: number
  readonly recovered: boolean
}

const activeStates: readonly ActiveState[] = ["preparing", "streaming", "settling_tools", "continuing"]

export const isActive = (state: State): state is ActiveState => activeStates.includes(state as ActiveState)

export const load = Effect.fn("SessionExecutionCheckpoint.load")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  return yield* db
    .select()
    .from(SessionExecutionCheckpointTable)
    .where(eq(SessionExecutionCheckpointTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

export const abandoned = Effect.fn("SessionExecutionCheckpoint.abandoned")(function* (
  db: DatabaseService,
  runtime: "v1" | "v2",
) {
  const rows = yield* db
    .select()
    .from(SessionExecutionCheckpointTable)
    .where(
      and(
        eq(SessionExecutionCheckpointTable.runtime, runtime),
        inArray(SessionExecutionCheckpointTable.state, activeStates),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  return rows.filter((row) => !processAlive(row.owner_pid)).map((row) => SessionSchema.ID.make(row.session_id))
})

export const needsRecovery = Effect.fn("SessionExecutionCheckpoint.needsRecovery")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  runtime: "v1" | "v2",
) {
  const checkpoint = yield* load(db, sessionID)
  return (
    checkpoint !== undefined &&
    checkpoint.runtime === runtime &&
    isActive(checkpoint.state) &&
    !processAlive(checkpoint.owner_pid)
  )
})

export const begin = Effect.fn("SessionExecutionCheckpoint.begin")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  runtime: "v1" | "v2",
) {
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const previous = yield* tx
        .select()
        .from(SessionExecutionCheckpointTable)
        .where(eq(SessionExecutionCheckpointTable.session_id, sessionID))
        .get()
      if (
        previous !== undefined &&
        isActive(previous.state) &&
        previous.owner_pid !== process.pid &&
        processAlive(previous.owner_pid)
      )
        return yield* Effect.die(`Session execution is owned by live process ${previous.owner_pid}`)
      const recovered =
        previous !== undefined &&
        previous.runtime === runtime &&
        isActive(previous.state) &&
        !processAlive(previous.owner_pid)
      const generation = (previous?.generation ?? 0) + 1
      const now = Date.now()
      const executionID = crypto.randomUUID()
      yield* tx
        .insert(SessionExecutionCheckpointTable)
        .values({
          session_id: sessionID,
          runtime,
          execution_id: executionID,
          generation,
          state: "preparing",
          step: 1,
          owner_pid: process.pid,
          recoveries: (previous?.recoveries ?? 0) + Number(recovered),
          time_started: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: SessionExecutionCheckpointTable.session_id,
          set: {
            execution_id: executionID,
            runtime,
            generation,
            state: "preparing",
            step: 1,
            assistant_message_id: null,
            owner_pid: process.pid,
            recoveries: (previous?.recoveries ?? 0) + Number(recovered),
            error: null,
            time_started: now,
            time_updated: now,
            time_completed: null,
          },
        })
        .run()
      return { sessionID, runtime, executionID, generation, recovered } satisfies Token
    }),
  ).pipe(Effect.orDie)
})

export const advance = Effect.fn("SessionExecutionCheckpoint.advance")(function* (
  db: DatabaseService,
  token: Token,
  input: { readonly state: ActiveState; readonly step: number; readonly assistantMessageID?: SessionMessage.ID },
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({
        state: input.state,
        step: input.step,
        assistant_message_id: input.assistantMessageID,
        time_updated: Date.now(),
      })
      .where(
        and(
          eq(SessionExecutionCheckpointTable.session_id, token.sessionID),
          eq(SessionExecutionCheckpointTable.execution_id, token.executionID),
          eq(SessionExecutionCheckpointTable.generation, token.generation),
        ),
      )
      .returning({ sessionID: SessionExecutionCheckpointTable.session_id })
      .get()
      .pipe(Effect.orDie)) !== undefined
  )
})

export const finish = Effect.fn("SessionExecutionCheckpoint.finish")(function* (
  db: DatabaseService,
  token: Token,
  input: { readonly state: TerminalState; readonly error?: string },
) {
  const now = Date.now()
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({ state: input.state, error: input.error, time_updated: now, time_completed: now })
      .where(
        and(
          eq(SessionExecutionCheckpointTable.session_id, token.sessionID),
          eq(SessionExecutionCheckpointTable.execution_id, token.executionID),
          eq(SessionExecutionCheckpointTable.generation, token.generation),
        ),
      )
      .returning({ sessionID: SessionExecutionCheckpointTable.session_id })
      .get()
      .pipe(Effect.orDie)) !== undefined
  )
})

function processAlive(pid: number) {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}
