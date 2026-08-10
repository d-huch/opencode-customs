export * as SessionExecutionCheckpoint from "./execution-checkpoint"

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Database } from "../database/database"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionExecutionCheckpointTable } from "./sql"
import { ModelCapabilityRouter } from "../model-capability-router"
import { ChangeRisk } from "../change-risk"
import { VerificationMatrix } from "../verification-matrix"
import { CriticPass } from "../critic-pass"

type DatabaseService = Database.Interface["db"]

export type ActiveState =
  | "preparing"
  | "streaming"
  | "settling_tools"
  | "verifying"
  | "repairing"
  | "verified"
  | "reviewing"
  | "reviewed"
  | "continuing"
export type TerminalState = "completed" | "interrupted" | "failed"
export type State = ActiveState | TerminalState
export type Phase = "classify" | "recall" | "execute" | "verify" | "critic" | "complete" | "failed"
export type PipelinePhase =
  | "prompt_admission"
  | "classification"
  | "repository_recall"
  | "memory_recall"
  | "model_readiness"
  | "context_compilation"
  | "execution"
  | "verification"
  | "critic_review"
  | "memory_admission"
  | "completion"
export type PipelineStatus = "pending" | "running" | "completed" | "skipped" | "timed_out" | "cancelled" | "failed"
export type PipelineState = {
  readonly phase: PipelinePhase
  readonly status: PipelineStatus
  readonly startedAt?: number
  readonly completedAt?: number
  readonly detail?: string
}

export type Token = {
  readonly sessionID: SessionSchema.ID
  readonly runtime: "v1" | "v2"
  readonly executionID: string
  readonly generation: number
  readonly recovered: boolean
}

export type Counter =
  | "evidence_attempts"
  | "classifier_turns"
  | "rag_retrievals"
  | "memory_retrievals"
  | "memory_writes"
  | "verification_turns"
  | "critic_turns"
  | "provider_turns"
  | "tool_calls"
  | "compactions"

export const Snapshot = Schema.Struct({
  sessionID: SessionSchema.ID,
  executionID: Schema.String,
  generation: Schema.Number,
  runtime: Schema.Literals(["v1", "v2"]),
  state: Schema.Literals([
    "preparing",
    "streaming",
    "settling_tools",
    "verifying",
    "repairing",
    "verified",
    "reviewing",
    "reviewed",
    "continuing",
    "completed",
    "interrupted",
    "failed",
  ]),
  phase: Schema.Literals(["classify", "recall", "execute", "verify", "critic", "complete", "failed"]),
  step: Schema.Number,
  requestMessageID: Schema.NullOr(Schema.String),
  selectedProviderID: Schema.NullOr(Schema.String),
  selectedModelID: Schema.NullOr(Schema.String),
  selectedInstanceID: Schema.NullOr(Schema.String),
  counters: Schema.Struct({
    evidenceAttempts: Schema.Number,
    classifierTurns: Schema.Number,
    ragRetrievals: Schema.Number,
    memoryRetrievals: Schema.Number,
    memoryWrites: Schema.Number,
    verificationTurns: Schema.Number,
    criticTurns: Schema.Number,
    providerTurns: Schema.Number,
    toolCalls: Schema.Number,
    compactions: Schema.Number,
  }),
  recoveries: Schema.Number,
  error: Schema.NullOr(Schema.String),
  timeStarted: Schema.Number,
  timeUpdated: Schema.Number,
  timeCompleted: Schema.NullOr(Schema.Number),
})
export type Snapshot = typeof Snapshot.Type

const activeStates: readonly ActiveState[] = [
  "preparing",
  "streaming",
  "settling_tools",
  "verifying",
  "repairing",
  "verified",
  "reviewing",
  "reviewed",
  "continuing",
]

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

export const latest = Effect.fn("SessionExecutionCheckpoint.latest")(function* (db: DatabaseService) {
  const row = yield* db
    .select()
    .from(SessionExecutionCheckpointTable)
    .orderBy(desc(SessionExecutionCheckpointTable.time_updated))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!row) return null
  return {
    sessionID: row.session_id,
    executionID: row.execution_id,
    generation: row.generation,
    runtime: row.runtime,
    state: row.state,
    phase: row.phase,
    step: row.step,
    requestMessageID: row.request_message_id,
    selectedProviderID: row.selected_provider_id,
    selectedModelID: row.selected_model_id,
    selectedInstanceID: row.selected_instance_id,
    counters: {
      evidenceAttempts: row.evidence_attempts,
      classifierTurns: row.classifier_turns,
      ragRetrievals: row.rag_retrievals,
      memoryRetrievals: row.memory_retrievals,
      memoryWrites: row.memory_writes,
      verificationTurns: row.verification_turns,
      criticTurns: row.critic_turns,
      providerTurns: row.provider_turns,
      toolCalls: row.tool_calls,
      compactions: row.compactions,
    },
    recoveries: row.recoveries,
    error: row.error,
    timeStarted: row.time_started,
    timeUpdated: row.time_updated,
    timeCompleted: row.time_completed,
  } satisfies Snapshot
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
  return yield* db
    .transaction((tx) =>
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
        const counters = recovered ? previous : undefined
        yield* tx
          .insert(SessionExecutionCheckpointTable)
          .values({
            session_id: sessionID,
            runtime,
            execution_id: executionID,
            generation,
            state: "preparing",
            phase: recovered ? previous.phase : "classify",
            step: 1,
            request_message_id: recovered ? previous.request_message_id : null,
            evidence_attempts: counters?.evidence_attempts ?? 0,
            classifier_turns: counters?.classifier_turns ?? 0,
            rag_retrievals: counters?.rag_retrievals ?? 0,
            memory_retrievals: counters?.memory_retrievals ?? 0,
            memory_writes: counters?.memory_writes ?? 0,
            verification_turns: counters?.verification_turns ?? 0,
            critic_turns: counters?.critic_turns ?? 0,
            provider_turns: counters?.provider_turns ?? 0,
            tool_calls: counters?.tool_calls ?? 0,
            compactions: counters?.compactions ?? 0,
            selected_provider_id: recovered ? previous.selected_provider_id : null,
            selected_model_id: recovered ? previous.selected_model_id : null,
            selected_instance_id: recovered ? previous.selected_instance_id : null,
            repository_context: recovered ? previous.repository_context : null,
            memory_context: recovered ? previous.memory_context : null,
            pipeline_state: recovered ? previous.pipeline_state : pipeline(),
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
              phase: recovered ? previous.phase : "classify",
              step: 1,
              request_message_id: recovered ? previous.request_message_id : null,
              evidence_attempts: counters?.evidence_attempts ?? 0,
              classifier_turns: counters?.classifier_turns ?? 0,
              rag_retrievals: counters?.rag_retrievals ?? 0,
              memory_retrievals: counters?.memory_retrievals ?? 0,
              memory_writes: counters?.memory_writes ?? 0,
              verification_turns: counters?.verification_turns ?? 0,
              critic_turns: counters?.critic_turns ?? 0,
              provider_turns: counters?.provider_turns ?? 0,
              tool_calls: counters?.tool_calls ?? 0,
              compactions: counters?.compactions ?? 0,
              assistant_message_id: null,
              model_route: null,
              risk_assessment: recovered ? previous.risk_assessment : null,
              verification_plan: recovered ? previous.verification_plan : null,
              critic_pass: recovered ? previous.critic_pass : null,
              selected_provider_id: recovered ? previous.selected_provider_id : null,
              selected_model_id: recovered ? previous.selected_model_id : null,
              selected_instance_id: recovered ? previous.selected_instance_id : null,
              repository_context: recovered ? previous.repository_context : null,
              memory_context: recovered ? previous.memory_context : null,
              pipeline_state: recovered ? previous.pipeline_state : pipeline(),
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
    )
    .pipe(Effect.orDie)
})

export const consume = Effect.fn("SessionExecutionCheckpoint.consume")(function* (
  db: DatabaseService,
  token: Token,
  input: { readonly counter: Counter; readonly limit: number },
) {
  const column = SessionExecutionCheckpointTable[input.counter]
  const value =
    input.counter === "evidence_attempts"
      ? { evidence_attempts: sql`${column} + 1` }
      : input.counter === "classifier_turns"
        ? { classifier_turns: sql`${column} + 1` }
        : input.counter === "rag_retrievals"
          ? { rag_retrievals: sql`${column} + 1` }
          : input.counter === "memory_retrievals"
            ? { memory_retrievals: sql`${column} + 1` }
            : input.counter === "memory_writes"
              ? { memory_writes: sql`${column} + 1` }
              : input.counter === "verification_turns"
                ? { verification_turns: sql`${column} + 1` }
                : input.counter === "critic_turns"
                  ? { critic_turns: sql`${column} + 1` }
                : input.counter === "provider_turns"
                  ? { provider_turns: sql`${column} + 1` }
                  : input.counter === "tool_calls"
                    ? { tool_calls: sql`${column} + 1` }
                    : { compactions: sql`${column} + 1` }
  return yield* db
    .update(SessionExecutionCheckpointTable)
    .set({ ...value, time_updated: Date.now() })
    .where(
      and(
        eq(SessionExecutionCheckpointTable.session_id, token.sessionID),
        eq(SessionExecutionCheckpointTable.execution_id, token.executionID),
        eq(SessionExecutionCheckpointTable.generation, token.generation),
        lt(column, input.limit),
      ),
    )
    .returning({ used: column })
    .get()
    .pipe(Effect.orDie)
})

export const bindRequest = Effect.fn("SessionExecutionCheckpoint.bindRequest")(function* (
  db: DatabaseService,
  token: Token,
  messageID: string,
) {
  const updated = yield* db
    .update(SessionExecutionCheckpointTable)
    .set({ request_message_id: messageID, time_updated: Date.now() })
    .where(
      and(
        eq(SessionExecutionCheckpointTable.session_id, token.sessionID),
        eq(SessionExecutionCheckpointTable.execution_id, token.executionID),
        eq(SessionExecutionCheckpointTable.generation, token.generation),
        isNull(SessionExecutionCheckpointTable.request_message_id),
      ),
    )
    .returning({ messageID: SessionExecutionCheckpointTable.request_message_id })
    .get()
    .pipe(Effect.orDie)
  if (updated) return true
  const current = yield* load(db, token.sessionID)
  return (
    current?.execution_id === token.executionID &&
    current.generation === token.generation &&
    current.request_message_id === messageID
  )
})

export const advanceRequest = Effect.fn("SessionExecutionCheckpoint.advanceRequest")(function* (
  db: DatabaseService,
  token: Token,
  input: { readonly previousMessageID: string; readonly messageID: string; readonly step: number },
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({
        state: "preparing",
        phase: "classify",
        step: input.step,
        request_message_id: input.messageID,
        evidence_attempts: 0,
        classifier_turns: 0,
        rag_retrievals: 0,
        memory_retrievals: 0,
        memory_writes: 0,
        verification_turns: 0,
        critic_turns: 0,
        provider_turns: 0,
        tool_calls: 0,
        compactions: 0,
        assistant_message_id: null,
        model_route: null,
        risk_assessment: null,
        verification_plan: null,
        critic_pass: null,
        selected_provider_id: null,
        selected_model_id: null,
        selected_instance_id: null,
        repository_context: null,
        memory_context: null,
        pipeline_state: pipeline("prompt_admission"),
        error: null,
        time_updated: Date.now(),
        time_completed: null,
      })
      .where(
        and(
          eq(SessionExecutionCheckpointTable.session_id, token.sessionID),
          eq(SessionExecutionCheckpointTable.execution_id, token.executionID),
          eq(SessionExecutionCheckpointTable.generation, token.generation),
          eq(SessionExecutionCheckpointTable.request_message_id, input.previousMessageID),
        ),
      )
      .returning({ sessionID: SessionExecutionCheckpointTable.session_id })
      .get()
      .pipe(Effect.orDie)) !== undefined
  )
})

export const setPhase = Effect.fn("SessionExecutionCheckpoint.setPhase")(function* (
  db: DatabaseService,
  token: Token,
  input: { readonly phase: Phase; readonly step: number },
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({ phase: input.phase, step: input.step, time_updated: Date.now() })
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

export const setPipelinePhase = Effect.fn("SessionExecutionCheckpoint.setPipelinePhase")(function* (
  db: DatabaseService,
  token: Token,
  input: {
    readonly phase: PipelinePhase
    readonly status: Exclude<PipelineStatus, "pending">
    readonly detail?: string
  },
) {
  return yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const current = yield* tx
          .select({ pipelineState: SessionExecutionCheckpointTable.pipeline_state })
          .from(SessionExecutionCheckpointTable)
          .where(
            and(
              eq(SessionExecutionCheckpointTable.session_id, token.sessionID),
              eq(SessionExecutionCheckpointTable.execution_id, token.executionID),
              eq(SessionExecutionCheckpointTable.generation, token.generation),
            ),
          )
          .get()
        if (!current) return false
        const now = Date.now()
        const next = current.pipelineState.map((item) =>
          item.phase !== input.phase
            ? item
            : item.status === "completed" && input.status === "skipped"
              ? item
              : {
                  ...item,
                  status: input.status,
                  startedAt: item.startedAt ?? (input.status === "running" ? now : undefined),
                  completedAt: input.status === "running" ? undefined : now,
                  detail: input.detail,
                },
        )
        return (
          (yield* tx
            .update(SessionExecutionCheckpointTable)
            .set({ pipeline_state: next, time_updated: now })
            .where(
              and(
                eq(SessionExecutionCheckpointTable.session_id, token.sessionID),
                eq(SessionExecutionCheckpointTable.execution_id, token.executionID),
                eq(SessionExecutionCheckpointTable.generation, token.generation),
              ),
            )
            .returning({ sessionID: SessionExecutionCheckpointTable.session_id })
            .get()) !== undefined
        )
      }),
    )
    .pipe(Effect.orDie)
})

export const pinModel = Effect.fn("SessionExecutionCheckpoint.pinModel")(function* (
  db: DatabaseService,
  token: Token,
  input: { readonly providerID: string; readonly modelID: string; readonly instanceID: string },
) {
  const updated = yield* db
    .update(SessionExecutionCheckpointTable)
    .set({
      selected_provider_id: input.providerID,
      selected_model_id: input.modelID,
      selected_instance_id: input.instanceID,
      time_updated: Date.now(),
    })
    .where(
      and(
        eq(SessionExecutionCheckpointTable.session_id, token.sessionID),
        eq(SessionExecutionCheckpointTable.execution_id, token.executionID),
        eq(SessionExecutionCheckpointTable.generation, token.generation),
        isNull(SessionExecutionCheckpointTable.selected_model_id),
      ),
    )
    .returning({ modelID: SessionExecutionCheckpointTable.selected_model_id })
    .get()
    .pipe(Effect.orDie)
  if (updated) return true
  const current = yield* load(db, token.sessionID)
  return (
    current?.execution_id === token.executionID &&
    current.generation === token.generation &&
    current.selected_provider_id === input.providerID &&
    current.selected_model_id === input.modelID &&
    current.selected_instance_id === input.instanceID
  )
})

export const pinReviewerModel = Effect.fn("SessionExecutionCheckpoint.pinReviewerModel")(function* (
  db: DatabaseService,
  token: Token,
  input: { readonly providerID: string; readonly modelID: string; readonly instanceID: string },
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({
        selected_provider_id: input.providerID,
        selected_model_id: input.modelID,
        selected_instance_id: input.instanceID,
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

export const setMemoryContext = Effect.fn("SessionExecutionCheckpoint.setMemoryContext")(function* (
  db: DatabaseService,
  token: Token,
  notes: readonly string[],
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({ memory_context: notes, time_updated: Date.now() })
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

export const setRepositoryContext = Effect.fn("SessionExecutionCheckpoint.setRepositoryContext")(function* (
  db: DatabaseService,
  token: Token,
  context: string | null,
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({ repository_context: context, time_updated: Date.now() })
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

export const setModelRoute = Effect.fn("SessionExecutionCheckpoint.setModelRoute")(function* (
  db: DatabaseService,
  token: Token,
  plan: ModelCapabilityRouter.Plan,
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({ model_route: plan, time_updated: Date.now() })
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

export const setRiskAssessment = Effect.fn("SessionExecutionCheckpoint.setRiskAssessment")(function* (
  db: DatabaseService,
  token: Token,
  assessment: ChangeRisk.Assessment,
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({ risk_assessment: assessment, time_updated: Date.now() })
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

export const setVerificationPlan = Effect.fn("SessionExecutionCheckpoint.setVerificationPlan")(function* (
  db: DatabaseService,
  token: Token,
  plan: VerificationMatrix.Plan,
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({ verification_plan: plan, time_updated: Date.now() })
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

export const setCriticPass = Effect.fn("SessionExecutionCheckpoint.setCriticPass")(function* (
  db: DatabaseService,
  token: Token,
  review: CriticPass.Review,
) {
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({ critic_pass: review, time_updated: Date.now() })
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
  const phase = input.state === "completed" ? "complete" : input.state === "failed" ? "failed" : undefined
  const current = yield* load(db, token.sessionID)
  const pipelineState = current?.pipeline_state.map((item) => {
    if (item.phase === "completion")
      return {
        ...item,
        status:
          input.state === "completed"
            ? ("completed" as const)
            : input.state === "interrupted"
              ? ("cancelled" as const)
              : ("failed" as const),
        startedAt: item.startedAt ?? now,
        completedAt: now,
        detail: input.error,
      }
    if (item.status !== "running") return item
    return {
      ...item,
      status: input.state === "interrupted" ? ("cancelled" as const) : ("failed" as const),
      completedAt: now,
      detail: input.error,
    }
  })
  return (
    (yield* db
      .update(SessionExecutionCheckpointTable)
      .set({
        state: input.state,
        ...(phase ? { phase } : {}),
        ...(pipelineState ? { pipeline_state: pipelineState } : {}),
        error: input.error,
        time_updated: now,
        time_completed: now,
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

function processAlive(pid: number) {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

function pipeline(completed?: PipelinePhase): readonly PipelineState[] {
  return [
    "prompt_admission",
    "classification",
    "repository_recall",
    "memory_recall",
    "model_readiness",
    "context_compilation",
    "execution",
    "verification",
    "critic_review",
    "memory_admission",
    "completion",
  ].map((phase) => ({
    phase: phase as PipelinePhase,
    status: phase === completed ? "completed" : "pending",
    ...(phase === completed ? { startedAt: Date.now(), completedAt: Date.now() } : {}),
  }))
}
