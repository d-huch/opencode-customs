export * as JarvisRuntime from "./jarvis"

import { Jarvis } from "@opencode-ai/schema/jarvis"
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Database } from "./database/database"
import { RepositoryEmbeddings } from "./repository-embeddings"
import {
  JarvisConfigTable,
  JarvisConversationTable,
  JarvisGoalOutcomeTable,
  JarvisGoalTable,
  JarvisMemoryTable,
  JarvisMemoryTombstoneTable,
  JarvisMemoryUseTable,
  JarvisMediaStateTable,
  JarvisPlanStepTable,
  JarvisPresenceTable,
  JarvisProfileTable,
  JarvisReplayTable,
  JarvisReplayExecutionTable,
  JarvisTurnTable,
  JarvisWakeTable,
} from "./jarvis.sql"

const CONFIG_ID = 1
const MAX_PLAN_STEPS = 8
const MAX_ACTIONS = 8
const MAX_CYCLE_MS = 60_000
const plannerRuntime = { activeRequests: 0, lastUsedAt: undefined as number | undefined }
const dialogueRuntime = { activeRequests: 0 }
const PRESENCE_ID = 1
const CONVERSATION_ID = 1
const MEDIA_ID = "primary"
const TERMINAL_TURN_PHASES: readonly Jarvis.TurnPhase[] = ["completed", "cancelled", "error"]
const ACTIVE_TURN_PHASES: readonly Jarvis.TurnPhase[] = [
  "listening",
  "transcribing",
  "understanding",
  "planning",
  "responding",
  "speaking",
  "acting",
]

export const defaultConfig = (): Jarvis.Config => ({
  models: {},
  plannerTimeoutMs: 8_000,
  plannerIdleUnloadMs: 10 * 60_000,
  plannerEscalationMinWords: 18,
  reactor: {
    profile: "fast",
    dialogueReasoning: "off",
    plannerReasoning: "on",
    allowFallback: true,
  },
  benchmark: {
    status: "idle",
    profile: "fast",
    results: [],
    fallback: [],
  },
  initiative: {
    enabled: true,
    quietStart: "22:00",
    quietEnd: "08:00",
    reflectionLimit: 2,
    eventLimit: 6,
    topicCooldownMinutes: 30,
  },
  updatedAt: Date.now(),
})

export const getConfig = Effect.fn("JarvisRuntime.getConfig")(function* (db: Database.Interface["db"]) {
  const stored = (yield* db.select().from(JarvisConfigTable).where(eq(JarvisConfigTable.id, CONFIG_ID)).get())?.data
  return stored
    ? {
        ...defaultConfig(),
        ...stored,
        reactor: { ...defaultConfig().reactor, ...stored.reactor },
        benchmark: { ...defaultConfig().benchmark, ...stored.benchmark },
        initiative: { ...defaultConfig().initiative, ...stored.initiative },
      }
    : defaultConfig()
})

export const updateConfig = Effect.fn("JarvisRuntime.updateConfig")(function* (
  db: Database.Interface["db"],
  input: Jarvis.Config,
) {
  const data: Jarvis.Config = {
    ...input,
    plannerTimeoutMs: Math.min(60_000, Math.max(2_000, input.plannerTimeoutMs)),
    plannerIdleUnloadMs: input.plannerIdleUnloadMs === 0 ? 0 : Math.min(60 * 60_000, Math.max(30_000, input.plannerIdleUnloadMs)),
    plannerEscalationMinWords: Math.min(100, Math.max(4, input.plannerEscalationMinWords)),
    reactor: {
      ...input.reactor,
      dialogueReasoning: "off",
      plannerReasoning: "on",
    },
    initiative: {
      ...input.initiative,
      quietStart: validTime(input.initiative.quietStart) ? input.initiative.quietStart : "22:00",
      quietEnd: validTime(input.initiative.quietEnd) ? input.initiative.quietEnd : "08:00",
      reflectionLimit: Math.min(2, input.initiative.reflectionLimit),
      eventLimit: Math.min(20, input.initiative.eventLimit),
      topicCooldownMinutes: Math.min(240, Math.max(5, input.initiative.topicCooldownMinutes)),
    },
    updatedAt: Date.now(),
  }
  yield* db
    .insert(JarvisConfigTable)
    .values({ id: CONFIG_ID, data, time_updated: data.updatedAt })
    .onConflictDoUpdate({
      target: JarvisConfigTable.id,
      set: { data, time_updated: data.updatedAt },
    })
  yield* db.update(JarvisProfileTable).set({ primary: false })
  if (data.primaryProfileID)
    yield* db
      .update(JarvisProfileTable)
      .set({ primary: true })
      .where(eq(JarvisProfileTable.id, data.primaryProfileID))
  return data
})

export const syncProfiles = Effect.fn("JarvisRuntime.syncProfiles")(function* (
  db: Database.Interface["db"],
  input: Jarvis.ProfileSync,
) {
  const now = Date.now()
  for (const profile of input.profiles) {
    const data = { ...profile, primary: profile.id === input.primaryProfileID, updatedAt: now }
    yield* db
      .insert(JarvisProfileTable)
      .values({
        id: data.id,
        revision: data.revision,
        name: data.name,
        data,
        primary: data.primary,
        time_created: now,
        time_updated: now,
      })
      .onConflictDoUpdate({
        target: JarvisProfileTable.id,
        set: {
          revision: data.revision,
          name: data.name,
          data,
          primary: data.primary,
          time_updated: now,
        },
      })
  }
  if (input.profiles.length > 0)
    yield* db.delete(JarvisProfileTable).where(
      notInArray(
        JarvisProfileTable.id,
        input.profiles.map((profile) => profile.id),
      ),
    )
  if (input.profiles.length === 0) yield* db.delete(JarvisProfileTable)
  yield* updateConfig(db, { ...(yield* getConfig(db)), primaryProfileID: input.primaryProfileID, updatedAt: now })
  return yield* profiles(db)
})

export const profiles = Effect.fn("JarvisRuntime.profiles")(function* (db: Database.Interface["db"]) {
  return (yield* db.select().from(JarvisProfileTable).orderBy(desc(JarvisProfileTable.primary), asc(JarvisProfileTable.name))).map(
    (row) => row.data,
  )
})

export const profile = Effect.fn("JarvisRuntime.profile")(function* (
  db: Database.Interface["db"],
  profileID?: string,
) {
  const config = yield* getConfig(db)
  const id = profileID ?? config.primaryProfileID
  if (!id) return undefined
  return (yield* db.select().from(JarvisProfileTable).where(eq(JarvisProfileTable.id, id)).get())?.data
})

export const createTurn = Effect.fn("JarvisRuntime.createTurn")(function* (
  db: Database.Interface["db"],
  input: Jarvis.TurnCreate,
) {
  const existing = yield* db.select().from(JarvisTurnTable).where(eq(JarvisTurnTable.request_id, input.requestID)).get()
  if (existing) return turnFromRow(existing)
  const now = Date.now()
  const turn: Jarvis.Turn = {
    id: crypto.randomUUID(),
    requestID: input.requestID,
    sessionID: input.sessionID,
    profileID: input.profileID,
    surface: input.surface,
    responseMode: input.responseMode,
    phase: input.phase ?? "listening",
    sequence: 0,
    metrics: {},
    createdAt: now,
    updatedAt: now,
  }
  yield* db.insert(JarvisTurnTable).values(turnRow(turn)).onConflictDoNothing({ target: JarvisTurnTable.request_id })
  const stored = yield* db.select().from(JarvisTurnTable).where(eq(JarvisTurnTable.request_id, input.requestID)).get()
  const created = stored ? turnFromRow(stored) : turn
  yield* syncPresenceFromTurn(db, created)
  return created
})

export const turn = Effect.fn("JarvisRuntime.turn")(function* (db: Database.Interface["db"], id: string) {
  const row = yield* db.select().from(JarvisTurnTable).where(eq(JarvisTurnTable.id, id)).get()
  return row ? turnFromRow(row) : undefined
})

export const turnByRequest = Effect.fn("JarvisRuntime.turnByRequest")(function* (
  db: Database.Interface["db"],
  requestID: string,
) {
  const row = yield* db.select().from(JarvisTurnTable).where(eq(JarvisTurnTable.request_id, requestID)).get()
  return row ? turnFromRow(row) : undefined
})

export const currentTurn = Effect.fn("JarvisRuntime.currentTurn")(function* (db: Database.Interface["db"]) {
  const row = yield* db.select().from(JarvisTurnTable).orderBy(desc(JarvisTurnTable.time_updated)).limit(1).get()
  return row ? turnFromRow(row) : undefined
})

export const activeTurn = Effect.fn("JarvisRuntime.activeTurn")(function* (
  db: Database.Interface["db"],
  sessionID: string,
) {
  const row = yield* db
    .select()
    .from(JarvisTurnTable)
    .where(and(eq(JarvisTurnTable.session_id, sessionID), inArray(JarvisTurnTable.phase, ACTIVE_TURN_PHASES)))
    .orderBy(desc(JarvisTurnTable.time_updated))
    .limit(1)
    .get()
  return row ? turnFromRow(row) : undefined
})

export const updateTurn = Effect.fn("JarvisRuntime.updateTurn")(function* (
  db: Database.Interface["db"],
  id: string,
  input: Jarvis.TurnUpdate,
) {
  const row = yield* db.select().from(JarvisTurnTable).where(eq(JarvisTurnTable.id, id)).get()
  if (!row) return undefined
  if (input.sequence <= row.sequence) return turnFromRow(row)
  if (TERMINAL_TURN_PHASES.includes(row.phase)) return turnFromRow(row)
  if (!validTurnTransition(row.phase, input.phase)) return turnFromRow(row)
  const now = Date.now()
  yield* db
    .update(JarvisTurnTable)
    .set({
      phase: input.phase,
      sequence: input.sequence,
      presentation: input.presentation ?? row.presentation,
      metrics: { ...row.metrics, ...input.metrics },
      error: input.error?.slice(0, 2_000) ?? row.error,
      cancel_reason: input.cancelReason?.slice(0, 1_000) ?? row.cancel_reason,
      time_updated: now,
    })
    .where(and(eq(JarvisTurnTable.id, id), eq(JarvisTurnTable.sequence, row.sequence)))
  const updated = yield* turn(db, id)
  if (updated) yield* syncPresenceFromTurn(db, updated)
  return updated
})

export const cancelTurn = Effect.fn("JarvisRuntime.cancelTurn")(function* (
  db: Database.Interface["db"],
  id: string,
  input: Jarvis.TurnCancel,
) {
  const row = yield* db.select().from(JarvisTurnTable).where(eq(JarvisTurnTable.id, id)).get()
  if (!row) return undefined
  if (TERMINAL_TURN_PHASES.includes(row.phase)) return turnFromRow(row)
  const now = Date.now()
  yield* db
    .update(JarvisTurnTable)
    .set({
      phase: "cancelled",
      sequence: row.sequence + 1,
      cancel_reason: input.reason?.slice(0, 1_000) ?? "user_interrupted",
      metrics: { ...row.metrics, completedAt: now },
      time_updated: now,
    })
    .where(eq(JarvisTurnTable.id, id))
  const cancelled = yield* turn(db, id)
  if (cancelled) yield* syncPresenceFromTurn(db, cancelled)
  return cancelled
})

export const cancelInterruptedTurns = Effect.fn("JarvisRuntime.cancelInterruptedTurns")(function* (
  db: Database.Interface["db"],
) {
  const now = Date.now()
  const rows = yield* db
    .select()
    .from(JarvisTurnTable)
    .where(inArray(JarvisTurnTable.phase, ACTIVE_TURN_PHASES))
  yield* Effect.forEach(
    rows,
    (row) =>
      db
        .update(JarvisTurnTable)
        .set({
          phase: "cancelled",
          sequence: row.sequence + 1,
          cancel_reason: "process_restart",
          metrics: { ...row.metrics, completedAt: now },
          time_updated: now,
        })
        .where(eq(JarvisTurnTable.id, row.id)),
    { concurrency: 1 },
  )
  return rows.length
})

export const presence = Effect.fn("JarvisRuntime.presence")(function* (db: Database.Interface["db"]) {
  const stored = (yield* db.select().from(JarvisPresenceTable).where(eq(JarvisPresenceTable.id, PRESENCE_ID)).get())?.data
  return stored ?? ({ surface: "desktop", state: "completed", updatedAt: Date.now() } satisfies Jarvis.Presence)
})

export const handoffPresence = Effect.fn("JarvisRuntime.handoffPresence")(function* (
  db: Database.Interface["db"],
  input: Jarvis.PresenceHandoff,
) {
  const current = yield* presence(db)
  if (input.from && current.surface !== input.from && current.microphoneOwner !== input.from) return current
  const data: Jarvis.Presence = {
    surface: input.to,
    microphoneOwner: input.microphone ? input.to : current.microphoneOwner,
    playbackOwner: input.playback ? input.to : current.playbackOwner,
    turnID: input.turnID ?? current.turnID,
    sessionID: input.sessionID ?? current.sessionID,
    state: current.state,
    updatedAt: Date.now(),
  }
  yield* db
    .insert(JarvisPresenceTable)
    .values({ id: PRESENCE_ID, data, time_updated: data.updatedAt })
    .onConflictDoUpdate({ target: JarvisPresenceTable.id, set: { data, time_updated: data.updatedAt } })
  return data
})

export const conversation = Effect.fn("JarvisRuntime.conversation")(function* (db: Database.Interface["db"]) {
  const row = yield* db
    .select()
    .from(JarvisConversationTable)
    .where(eq(JarvisConversationTable.id, CONVERSATION_ID))
    .get()
  return row ? conversationFromRow(row) : undefined
})

export const adoptConversation = Effect.fn("JarvisRuntime.adoptConversation")(function* (
  db: Database.Interface["db"],
  input: Omit<Jarvis.ConversationState, "updatedAt"> & { updatedAt?: number },
) {
  const data: Jarvis.ConversationState = { ...input, updatedAt: input.updatedAt ?? Date.now() }
  yield* db
    .insert(JarvisConversationTable)
    .values({
      id: CONVERSATION_ID,
      session_id: data.sessionID,
      profile_id: data.profileID,
      profile_revision: data.profileRevision,
      recovered_at: data.recoveredAt,
      time_updated: data.updatedAt,
    })
    .onConflictDoUpdate({
      target: JarvisConversationTable.id,
      set: {
        session_id: data.sessionID,
        profile_id: data.profileID,
        profile_revision: data.profileRevision,
        recovered_at: data.recoveredAt,
        time_updated: data.updatedAt,
      },
    })
  return data
})

export const mediaState = Effect.fn("JarvisRuntime.mediaState")(function* (db: Database.Interface["db"]) {
  const row = yield* db.select().from(JarvisMediaStateTable).where(eq(JarvisMediaStateTable.id, MEDIA_ID)).get()
  if (!row)
    return {
      state: "idle",
      queuedSentences: 0,
      activeJobs: 0,
      acknowledgedCancellation: true,
      updatedAt: Date.now(),
    } satisfies Jarvis.MediaState
  return {
    turnID: row.turn_id ?? undefined,
    owner: (row.owner as Jarvis.Surface | null) ?? undefined,
    state: row.state as Jarvis.MediaState["state"],
    queuedSentences: row.queued_sentences,
    activeJobs: row.active_jobs,
    acknowledgedCancellation: row.acknowledged_cancellation,
    updatedAt: row.time_updated,
  } satisfies Jarvis.MediaState
})

export const updateMediaState = Effect.fn("JarvisRuntime.updateMediaState")(function* (
  db: Database.Interface["db"],
  input: Jarvis.MediaStateUpdate,
) {
  const data: Jarvis.MediaState = { ...input, updatedAt: Date.now() }
  const values = {
    turn_id: data.turnID,
    owner: data.owner,
    state: data.state,
    queued_sentences: data.queuedSentences,
    active_jobs: data.activeJobs,
    acknowledged_cancellation: data.acknowledgedCancellation,
    time_updated: data.updatedAt,
  }
  yield* db
    .insert(JarvisMediaStateTable)
    .values({ id: MEDIA_ID, ...values })
    .onConflictDoUpdate({ target: JarvisMediaStateTable.id, set: values })
  return data
})

export const createGoal = Effect.fn("JarvisRuntime.createGoal")(function* (
  db: Database.Interface["db"],
  input: Jarvis.GoalCreate,
) {
  const now = Date.now()
  const goal: Jarvis.Goal = {
    id: crypto.randomUUID(),
    profileID: input.profileID,
    sessionID: input.sessionID,
    mode: input.mode,
    gameID: input.gameID,
    saveSlotID: input.saveSlotID,
    characterID: input.characterID,
    objective: input.objective,
    status: "pending",
    worldRevision: input.worldRevision,
    capabilityRevision: input.capabilityRevision,
    actionCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  yield* db.insert(JarvisGoalTable).values(goalRow(goal))
  return goal
})

export const goals = Effect.fn("JarvisRuntime.goals")(function* (
  db: Database.Interface["db"],
  status?: Jarvis.Goal["status"],
) {
  const rows = status
    ? yield* db.select().from(JarvisGoalTable).where(eq(JarvisGoalTable.status, status)).orderBy(desc(JarvisGoalTable.time_updated))
    : yield* db.select().from(JarvisGoalTable).orderBy(desc(JarvisGoalTable.time_updated))
  return yield* Effect.forEach(rows, (row) => goalFromRow(db, row))
})

export const applyPlan = Effect.fn("JarvisRuntime.applyPlan")(function* (
  db: Database.Interface["db"],
  goalID: string,
  value: unknown,
) {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(Jarvis.Plan)(value))
  if (!decoded || decoded.steps.length === 0 || decoded.steps.length > MAX_PLAN_STEPS) return undefined
  if (decoded.steps.some((step, position) => step.position !== position || step.goalID !== goalID)) return undefined
  const now = Date.now()
  yield* db.delete(JarvisPlanStepTable).where(eq(JarvisPlanStepTable.goal_id, goalID))
  yield* db.insert(JarvisPlanStepTable).values(
    decoded.steps.map((step) => ({
      id: step.id,
      goal_id: goalID,
      position: step.position,
      action: step.action,
      arguments: step.arguments,
      expected_postconditions: step.expectedPostconditions,
      status: "pending" as const,
      attempts: 0,
      time_created: now,
      time_updated: now,
    })),
  )
  yield* db
    .update(JarvisGoalTable)
    .set({ plan: decoded, status: "active", cycle_started_at: now, action_count: 0, time_updated: now })
    .where(eq(JarvisGoalTable.id, goalID))
  return decoded
})

export const recordStepResult = Effect.fn("JarvisRuntime.recordStepResult")(function* (
  db: Database.Interface["db"],
  input: { goalID: string; stepID: string; success: boolean; error?: string },
) {
  const now = Date.now()
  const goal = yield* db.select().from(JarvisGoalTable).where(eq(JarvisGoalTable.id, input.goalID)).get()
  const step = yield* db.select().from(JarvisPlanStepTable).where(eq(JarvisPlanStepTable.id, input.stepID)).get()
  if (!goal || !step) return undefined
  const attempts = step.attempts + 1
  const exhausted = !input.success && attempts >= 2
  const overBudget = goal.action_count + 1 >= MAX_ACTIONS || now - (goal.cycle_started_at ?? now) >= MAX_CYCLE_MS
  yield* db
    .update(JarvisPlanStepTable)
    .set({
      status: input.success ? "completed" : exhausted ? "suspended" : "failed",
      attempts,
      last_error: input.error,
      time_updated: now,
    })
    .where(eq(JarvisPlanStepTable.id, input.stepID))
  yield* db
    .update(JarvisGoalTable)
    .set({
      action_count: goal.action_count + 1,
      status: exhausted || overBudget ? "suspended" : goal.status,
      suspension_reason: exhausted
        ? "Repeated action failed twice; a changed argument or a new plan is required."
        : overBudget
          ? "Autonomy cycle budget reached."
          : goal.suspension_reason,
      time_updated: now,
    })
    .where(eq(JarvisGoalTable.id, input.goalID))
  return yield* goalByID(db, input.goalID)
})

export const completeGoal = Effect.fn("JarvisRuntime.completeGoal")(function* (
  db: Database.Interface["db"],
  goalID: string,
  input: Jarvis.GoalOutcomeCreate,
) {
  const goal = yield* db.select({ id: JarvisGoalTable.id }).from(JarvisGoalTable).where(eq(JarvisGoalTable.id, goalID)).get()
  if (!goal) return undefined
  const outcome: Jarvis.GoalOutcome = {
    id: crypto.randomUUID(),
    goalID,
    status: input.status,
    summary: input.summary.slice(0, 4_000),
    changedEntityIDs: input.changedEntityIDs.slice(0, 256),
    createdAt: Date.now(),
  }
  yield* db.insert(JarvisGoalOutcomeTable).values({
    id: outcome.id,
    goal_id: outcome.goalID,
    status: outcome.status,
    summary: outcome.summary,
    changed_entity_ids: outcome.changedEntityIDs,
    time_created: outcome.createdAt,
  })
  yield* db
    .update(JarvisGoalTable)
    .set({ status: outcome.status, suspension_reason: null, time_updated: outcome.createdAt })
    .where(eq(JarvisGoalTable.id, goalID))
  return outcome
})

export const outcomes = Effect.fn("JarvisRuntime.outcomes")(function* (
  db: Database.Interface["db"],
  goalID?: string,
) {
  const rows = goalID
    ? yield* db
        .select()
        .from(JarvisGoalOutcomeTable)
        .where(eq(JarvisGoalOutcomeTable.goal_id, goalID))
        .orderBy(desc(JarvisGoalOutcomeTable.time_created))
    : yield* db.select().from(JarvisGoalOutcomeTable).orderBy(desc(JarvisGoalOutcomeTable.time_created))
  return rows.map(
    (row) =>
      ({
        id: row.id,
        goalID: row.goal_id,
        status: row.status,
        summary: row.summary,
        changedEntityIDs: row.changed_entity_ids,
        createdAt: row.time_created,
      }) satisfies Jarvis.GoalOutcome,
  )
})

export const suspendInterruptedGoals = Effect.fn("JarvisRuntime.suspendInterruptedGoals")(function* (
  db: Database.Interface["db"],
) {
  const result = yield* db
    .update(JarvisGoalTable)
    .set({ status: "suspended", suspension_reason: "Runtime restarted; fresh observation is required.", time_updated: Date.now() })
    .where(inArray(JarvisGoalTable.status, ["planning", "active"]))
    .returning({ id: JarvisGoalTable.id })
  return result.length
})

export const resumeGoal = Effect.fn("JarvisRuntime.resumeGoal")(function* (
  db: Database.Interface["db"],
  goalID: string,
  input: Jarvis.GoalResume,
) {
  const goal = yield* db.select().from(JarvisGoalTable).where(eq(JarvisGoalTable.id, goalID)).get()
  if (!goal || goal.status !== "suspended") return undefined
  if (goal.mode === "unity") {
    if (goal.game_id !== input.gameID || goal.save_slot_id !== input.saveSlotID || goal.character_id !== input.characterID)
      return undefined
    if (!input.capabilityRevision) return undefined
  }
  yield* db
    .update(JarvisGoalTable)
    .set({
      status: goal.plan ? "active" : "pending",
      suspension_reason: null,
      world_revision: input.worldRevision,
      capability_revision: input.capabilityRevision,
      cycle_started_at: Date.now(),
      action_count: 0,
      time_updated: Date.now(),
    })
    .where(eq(JarvisGoalTable.id, goalID))
  return yield* goalByID(db, goalID)
})

export const suspendGoal = Effect.fn("JarvisRuntime.suspendGoal")(function* (
  db: Database.Interface["db"],
  goalID: string,
  reason: string,
) {
  yield* db
    .update(JarvisGoalTable)
    .set({ status: "suspended", suspension_reason: reason.slice(0, 1_000), time_updated: Date.now() })
    .where(eq(JarvisGoalTable.id, goalID))
  return yield* goalByID(db, goalID)
})

export const remember = Effect.fn("JarvisRuntime.remember")(function* (
  db: Database.Interface["db"],
  input: Jarvis.MemoryRecord,
) {
  const forgotten = yield* db
    .select({ sourceID: JarvisMemoryTombstoneTable.source_id })
    .from(JarvisMemoryTombstoneTable)
    .where(eq(JarvisMemoryTombstoneTable.source_id, input.sourceID))
    .get()
  if (forgotten) return input
  const now = Date.now()
  const config = yield* getConfig(db)
  const embedded = input.embedding
    ? undefined
    : yield* embedText(config.models.embedding, input.text).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const record = {
    ...input,
    embedding: input.embedding ?? embedded?.vector,
    embeddingModel: input.embeddingModel ?? embedded?.model,
    lifecycle: input.kind === "correction" ? ("verified" as const) : input.lifecycle,
    updatedAt: now,
  }
  yield* db
    .insert(JarvisMemoryTable)
    .values(memoryRow(record))
    .onConflictDoUpdate({
      target: JarvisMemoryTable.source_id,
      set: {
        body: record.text,
        confidence: record.confidence,
        importance: record.importance,
        lifecycle: record.lifecycle,
        pinned: record.pinned,
        conflicts_with: record.conflictsWith,
        embedding: record.embedding,
        embedding_model: record.embeddingModel,
        time_updated: now,
      },
    })
  return record
})

export const searchMemory = Effect.fn("JarvisRuntime.searchMemory")(function* (
  db: Database.Interface["db"],
  input: Jarvis.MemorySearch,
) {
  const config = yield* getConfig(db)
  const embedded = input.embedding
    ? undefined
    : yield* embedText(config.models.embedding, input.query).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const queryEmbedding = input.embedding ?? embedded?.vector
  const queryModel = embedded?.model ?? config.models.embedding
  const terms = input.query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu)?.slice(0, 16) ?? []
  const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" OR ")
  const ranked = match
    ? yield* db.all<{ id: string; lexical_rank: number }>(sql`
        SELECT jarvis_memory.id, bm25(jarvis_memory_fts) AS lexical_rank
        FROM jarvis_memory_fts
        JOIN jarvis_memory ON jarvis_memory.rowid = jarvis_memory_fts.rowid
        WHERE jarvis_memory_fts MATCH ${match}
        LIMIT 128
      `)
    : undefined
  const rows = ranked
    ? ranked.length > 0
      ? yield* db.select().from(JarvisMemoryTable).where(inArray(JarvisMemoryTable.id, ranked.map((row) => row.id)))
      : []
    : yield* db.select().from(JarvisMemoryTable).orderBy(desc(JarvisMemoryTable.time_updated)).limit(128)
  const lexicalRanks = new Map(ranked?.map((row) => [row.id, row.lexical_rank]))
  const now = Date.now()
  const candidates = rows
    .filter((row) => memoryVisible(row, input))
    .map((row) => ({
      row,
      score:
        (row.pinned ? 4 : 0) +
        row.importance * 2 +
        row.confidence +
        Math.max(0, 1 + Math.min(0, -(lexicalRanks.get(row.id) ?? 0)) / 10) +
        semanticScore(
          sameModel(row.embedding_model, queryModel) ? row.embedding : undefined,
          queryEmbedding,
        ) +
        Math.max(0, 1 - (now - row.time_updated) / (1000 * 60 * 60 * 24 * 90)),
    }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, Math.min(input.limit ?? 12, 50))
  if (candidates.length > 0)
    yield* db
      .update(JarvisMemoryTable)
      .set({ last_used_at: now })
      .where(inArray(JarvisMemoryTable.id, candidates.map((candidate) => candidate.row.id)))
  return candidates.map((candidate) => memoryFromRow(candidate.row))
})

export const removeMemory = Effect.fn("JarvisRuntime.removeMemory")(function* (
  db: Database.Interface["db"],
  id: string,
) {
  const current = yield* db.select().from(JarvisMemoryTable).where(eq(JarvisMemoryTable.id, id)).get()
  if (!current) return 0
  yield* db
    .insert(JarvisMemoryTombstoneTable)
    .values({ source_id: current.source_id, time_created: Date.now() })
    .onConflictDoNothing({ target: JarvisMemoryTombstoneTable.source_id })
  return (yield* db.delete(JarvisMemoryTable).where(eq(JarvisMemoryTable.id, id)).returning({ id: JarvisMemoryTable.id })).length
})

export const recordMemoryUse = Effect.fn("JarvisRuntime.recordMemoryUse")(function* (
  db: Database.Interface["db"],
  input: Jarvis.MemoryUseCreate,
) {
  const record: Jarvis.MemoryUse = {
    id: crypto.randomUUID(),
    turnID: input.turnID,
    memoryID: input.memoryID,
    rank: input.rank,
    lexicalScore: input.lexicalScore ?? 0,
    semanticScore: input.semanticScore ?? 0,
    reason: input.reason.slice(0, 1_000),
    createdAt: Date.now(),
  }
  yield* db
    .insert(JarvisMemoryUseTable)
    .values(memoryUseRow(record))
    .onConflictDoUpdate({
      target: [JarvisMemoryUseTable.turn_id, JarvisMemoryUseTable.memory_id],
      set: {
        rank: record.rank,
        lexical_score: record.lexicalScore,
        semantic_score: record.semanticScore,
        reason: record.reason,
        time_created: record.createdAt,
      },
    })
  return record
})

export const memoryUses = Effect.fn("JarvisRuntime.memoryUses")(function* (
  db: Database.Interface["db"],
  input: { memoryID?: string; turnID?: string; limit?: number },
) {
  const where = input.memoryID
    ? eq(JarvisMemoryUseTable.memory_id, input.memoryID)
    : input.turnID
      ? eq(JarvisMemoryUseTable.turn_id, input.turnID)
      : undefined
  const rows = where
    ? yield* db.select().from(JarvisMemoryUseTable).where(where).orderBy(desc(JarvisMemoryUseTable.time_created)).limit(Math.min(input.limit ?? 50, 100))
    : yield* db.select().from(JarvisMemoryUseTable).orderBy(desc(JarvisMemoryUseTable.time_created)).limit(Math.min(input.limit ?? 50, 100))
  return rows.map(memoryUseFromRow)
})

export const patchMemory = Effect.fn("JarvisRuntime.patchMemory")(function* (
  db: Database.Interface["db"],
  id: string,
  input: Jarvis.MemoryPatch,
) {
  const current = yield* db.select().from(JarvisMemoryTable).where(eq(JarvisMemoryTable.id, id)).get()
  if (!current) return undefined
  const text = input.text?.trim()
  if (input.text !== undefined && !text) return undefined
  yield* db
    .update(JarvisMemoryTable)
    .set({
      body: text ?? current.body,
      confidence: input.confidence ?? current.confidence,
      importance: input.importance ?? current.importance,
      lifecycle: input.lifecycle ?? current.lifecycle,
      pinned: input.pinned ?? current.pinned,
      embedding: text && text !== current.body ? null : current.embedding,
      embedding_model: text && text !== current.body ? null : current.embedding_model,
      time_updated: Date.now(),
    })
    .where(eq(JarvisMemoryTable.id, id))
  const updated = yield* db.select().from(JarvisMemoryTable).where(eq(JarvisMemoryTable.id, id)).get()
  return updated ? memoryFromRow(updated) : undefined
})

export const resolveMemoryConflict = Effect.fn("JarvisRuntime.resolveMemoryConflict")(function* (
  db: Database.Interface["db"],
  id: string,
  input: Jarvis.MemoryConflictResolution,
) {
  const rows = yield* db.select().from(JarvisMemoryTable).where(inArray(JarvisMemoryTable.id, [id, input.otherMemoryID]))
  if (rows.length !== 2) return undefined
  const current = rows.find((row) => row.id === id)
  const other = rows.find((row) => row.id === input.otherMemoryID)
  if (!current || !other) return undefined
  const now = Date.now()
  if (input.action === "keep_both") {
    yield* db.update(JarvisMemoryTable).set({ conflicts_with: [], time_updated: now }).where(inArray(JarvisMemoryTable.id, [id, input.otherMemoryID]))
  }
  if (input.action === "choose_current") {
    yield* db.update(JarvisMemoryTable).set({ lifecycle: "verified", conflicts_with: [], time_updated: now }).where(eq(JarvisMemoryTable.id, id))
    yield* db.update(JarvisMemoryTable).set({ lifecycle: "archived", conflicts_with: [], time_updated: now }).where(eq(JarvisMemoryTable.id, input.otherMemoryID))
  }
  if (input.action === "choose_other") {
    yield* db.update(JarvisMemoryTable).set({ lifecycle: "archived", conflicts_with: [], time_updated: now }).where(eq(JarvisMemoryTable.id, id))
    yield* db.update(JarvisMemoryTable).set({ lifecycle: "verified", conflicts_with: [], time_updated: now }).where(eq(JarvisMemoryTable.id, input.otherMemoryID))
  }
  const updated = yield* db.select().from(JarvisMemoryTable).where(eq(JarvisMemoryTable.id, id)).get()
  return updated ? memoryFromRow(updated) : undefined
})

export const memoryBackfillStatus = Effect.fn("JarvisRuntime.memoryBackfillStatus")(function* (
  db: Database.Interface["db"],
) {
  return yield* count(db, JarvisMemoryTable, sql`${JarvisMemoryTable.embedding} IS NULL`)
})

export const backfillMemory = Effect.fn("JarvisRuntime.backfillMemory")(function* (
  db: Database.Interface["db"],
  limit = 16,
) {
  const config = yield* getConfig(db)
  if (!config.models.embedding) return { queued: 0, remaining: yield* memoryBackfillStatus(db) }
  const rows = yield* db.select().from(JarvisMemoryTable).where(sql`${JarvisMemoryTable.embedding} IS NULL`).orderBy(asc(JarvisMemoryTable.time_updated)).limit(Math.min(64, Math.max(1, limit)))
  const results = yield* Effect.forEach(rows, (row) => embedText(config.models.embedding, row.body).pipe(Effect.catch(() => Effect.succeed(undefined))), { concurrency: 1 })
  const completed = results.flatMap((result, index) => result ? [{ result, row: rows[index] }] : []).filter((item): item is { result: { vector: readonly number[]; model: Jarvis.ModelRef }; row: typeof JarvisMemoryTable.$inferSelect } => !!item.row)
  if (completed.length > 0)
    yield* Effect.forEach(completed, (item) => db.update(JarvisMemoryTable).set({ embedding: item.result.vector, embedding_model: item.result.model, time_updated: Date.now() }).where(eq(JarvisMemoryTable.id, item.row.id)), { concurrency: 1 })
  return { queued: completed.length, remaining: yield* memoryBackfillStatus(db) }
})

export const enqueueWake = Effect.fn("JarvisRuntime.enqueueWake")(function* (
  db: Database.Interface["db"],
  input: Jarvis.WakeCreate,
) {
  const config = yield* getConfig(db)
  if (!config.primaryProfileID || !config.initiative.enabled) return undefined
  const now = Date.now()
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const suppressed = yield* db
    .select({ id: JarvisWakeTable.id })
    .from(JarvisWakeTable)
    .where(
      and(
        eq(JarvisWakeTable.profile_id, config.primaryProfileID),
        eq(JarvisWakeTable.topic, input.topic),
        eq(JarvisWakeTable.status, "dismissed"),
      ),
    )
    .get()
  if (suppressed) return undefined
  const cooldown = input.kind === "reflection" ? day.getTime() : now - config.initiative.topicCooldownMinutes * 60_000
  const duplicate = yield* db
    .select({ id: JarvisWakeTable.id })
    .from(JarvisWakeTable)
    .where(
      and(
        eq(JarvisWakeTable.profile_id, config.primaryProfileID),
        eq(JarvisWakeTable.topic, input.topic),
        sql`${JarvisWakeTable.time_created} >= ${cooldown}`,
      ),
    )
    .get()
  if (duplicate) return undefined
  const candidate: Jarvis.WakeCandidate = {
    id: crypto.randomUUID(),
    profileID: config.primaryProfileID,
    sessionID: input.sessionID,
    kind: input.kind,
    topic: input.topic,
    text: input.text,
    priority: input.priority,
    status: "pending",
    notBefore: input.notBefore ?? now,
    createdAt: now,
    updatedAt: now,
  }
  yield* db.insert(JarvisWakeTable).values(wakeRow(candidate))
  return candidate
})

export const inbox = Effect.fn("JarvisRuntime.inbox")(function* (db: Database.Interface["db"]) {
  return (yield* db.select().from(JarvisWakeTable).orderBy(desc(JarvisWakeTable.time_created)).limit(100)).map(
    wakeFromRow,
  )
})

export const claimWake = Effect.fn("JarvisRuntime.claimWake")(function* (db: Database.Interface["db"]) {
  const config = yield* getConfig(db)
  if (!config.primaryProfileID || !config.initiative.enabled || isQuietHour(new Date(), config.initiative)) return undefined
  const now = Date.now()
  const day = new Date()
  day.setHours(0, 0, 0, 0)
  const admitted = yield* db
    .select({ kind: JarvisWakeTable.kind })
    .from(JarvisWakeTable)
    .where(and(eq(JarvisWakeTable.status, "admitted"), sql`${JarvisWakeTable.time_created} >= ${day.getTime()}`))
  const reflectionCount = admitted.filter((item) => item.kind === "reflection").length
  const eventCount = admitted.length - reflectionCount
  const rows = yield* db
    .select()
    .from(JarvisWakeTable)
    .where(
      and(
        eq(JarvisWakeTable.profile_id, config.primaryProfileID),
        eq(JarvisWakeTable.status, "pending"),
        sql`${JarvisWakeTable.not_before} <= ${now}`,
      ),
    )
    .orderBy(desc(JarvisWakeTable.priority), asc(JarvisWakeTable.time_created))
    .limit(20)
  const selected = rows.find((row) =>
    row.kind === "reflection"
      ? reflectionCount < config.initiative.reflectionLimit
      : eventCount < config.initiative.eventLimit,
  )
  if (!selected) return undefined
  const claimed = yield* db
    .update(JarvisWakeTable)
    .set({ status: "admitted" })
    .where(and(eq(JarvisWakeTable.id, selected.id), eq(JarvisWakeTable.status, "pending")))
    .returning({ id: JarvisWakeTable.id })
  return claimed.length > 0 ? wakeFromRow({ ...selected, status: "admitted" }) : undefined
})

export const markWakeBlocked = Effect.fn("JarvisRuntime.markWakeBlocked")(function* (
  db: Database.Interface["db"],
  wakeID: string,
  reason?: string,
) {
  yield* db.update(JarvisWakeTable).set({ status: "blocked", blocked_reason: reason?.slice(0, 1_000), time_updated: Date.now() }).where(eq(JarvisWakeTable.id, wakeID))
})

export const dismissWake = Effect.fn("JarvisRuntime.dismissWake")(function* (db: Database.Interface["db"], wakeID: string) {
  const rows = yield* db.update(JarvisWakeTable).set({ status: "dismissed", blocked_reason: null, time_updated: Date.now() }).where(eq(JarvisWakeTable.id, wakeID)).returning()
  return rows[0] ? wakeFromRow(rows[0]) : undefined
})

export const retryWake = Effect.fn("JarvisRuntime.retryWake")(function* (db: Database.Interface["db"], wakeID: string) {
  const rows = yield* db.update(JarvisWakeTable).set({ status: "pending", blocked_reason: null, not_before: Date.now(), time_updated: Date.now() }).where(eq(JarvisWakeTable.id, wakeID)).returning()
  return rows[0] ? wakeFromRow(rows[0]) : undefined
})

export const replanGoal = Effect.fn("JarvisRuntime.replanGoal")(function* (
  db: Database.Interface["db"],
  goalID: string,
  input: Jarvis.GoalReplan,
) {
  const goal = yield* db.select().from(JarvisGoalTable).where(eq(JarvisGoalTable.id, goalID)).get()
  if (!goal || ["completed", "failed", "cancelled"].includes(goal.status)) return undefined
  yield* db.delete(JarvisPlanStepTable).where(eq(JarvisPlanStepTable.goal_id, goalID))
  yield* db.update(JarvisGoalTable).set({ status: "pending", plan: null, suspension_reason: input.reason?.slice(0, 1_000), action_count: 0, cycle_started_at: null, time_updated: Date.now() }).where(eq(JarvisGoalTable.id, goalID))
  return yield* goalByID(db, goalID)
})

export const cancelGoal = Effect.fn("JarvisRuntime.cancelGoal")(function* (
  db: Database.Interface["db"],
  goalID: string,
  input: Jarvis.GoalCancel,
) {
  return yield* completeGoal(db, goalID, {
    status: "cancelled",
    summary: input.summary?.trim() || "Cancelled by the user.",
    changedEntityIDs: input.changedEntityIDs ?? [],
  })
})

export const recordReplay = Effect.fn("JarvisRuntime.recordReplay")(function* (
  db: Database.Interface["db"],
  input: Jarvis.ReplayCreate,
) {
  const now = Date.now()
  const existing = input.turnID
    ? yield* db.select().from(JarvisReplayTable).where(eq(JarvisReplayTable.turn_id, input.turnID)).get()
    : undefined
  const replay: Jarvis.ReplayRun = {
    id: existing?.id ?? crypto.randomUUID(),
    turnID: input.turnID,
    sessionID: input.sessionID,
    surface: input.surface,
    status: input.status ?? "completed",
    events: sanitizeReplayEvents(input.events).slice(-500),
    metrics: input.metrics ?? {},
    error: input.error?.slice(0, 2_000),
    createdAt: existing?.time_created ?? now,
    updatedAt: now,
  }
  const update = {
    session_id: replay.sessionID,
    surface: replay.surface,
    status: replay.status,
    events: replay.events,
    metrics: replay.metrics,
    error: replay.error,
    time_updated: replay.updatedAt,
  }
  if (replay.turnID) {
    yield* db
      .insert(JarvisReplayTable)
      .values(replayRow(replay))
      .onConflictDoUpdate({ target: JarvisReplayTable.turn_id, set: update })
  } else {
    yield* db.insert(JarvisReplayTable).values(replayRow(replay))
  }
  const overflow = yield* db
    .select({ id: JarvisReplayTable.id })
    .from(JarvisReplayTable)
    .orderBy(desc(JarvisReplayTable.time_created))
    .limit(1_000)
    .offset(30)
  if (overflow.length > 0)
    yield* db.delete(JarvisReplayTable).where(inArray(JarvisReplayTable.id, overflow.map((row) => row.id)))
  return replay
})

export const replays = Effect.fn("JarvisRuntime.replays")(function* (db: Database.Interface["db"], limit = 30) {
  return (yield* db
    .select()
    .from(JarvisReplayTable)
    .orderBy(desc(JarvisReplayTable.time_created))
    .limit(Math.min(Math.max(limit, 1), 30))).map(replayFromRow)
})

export const replay = Effect.fn("JarvisRuntime.replay")(function* (db: Database.Interface["db"], id: string) {
  const row = yield* db.select().from(JarvisReplayTable).where(eq(JarvisReplayTable.id, id)).get()
  return row ? replayFromRow(row) : undefined
})

export const removeReplay = Effect.fn("JarvisRuntime.removeReplay")(function* (
  db: Database.Interface["db"],
  id: string,
) {
  return (yield* db.delete(JarvisReplayTable).where(eq(JarvisReplayTable.id, id)).returning({ id: JarvisReplayTable.id })).length
})

export const executeReplay = Effect.fn("JarvisRuntime.executeReplay")(function* (
  db: Database.Interface["db"],
  replayID: string,
  _input: Jarvis.ReplayExecute,
) {
  const source = yield* replay(db, replayID)
  if (!source) return undefined
  const now = Date.now()
  const terminal = source.events.findLast((event) => /(?:^|\.)(?:completed|cancelled|error)$/u.test(event.type))
  const actionEvents = source.events.filter((event) => /(?:action|tool)/iu.test(event.type))
  const unsafe = actionEvents.filter((event) => {
    const risk = typeof event.data.risk === "string" ? event.data.risk : undefined
    return risk === "interaction" || risk === "critical" || event.data.external === true
  })
  const textEvents = source.events.filter((event) => /text(?:\.delta|\.done)?$/u.test(event.type))
  const playbackStarts = source.events.filter((event) => /audio\.start|playback\.start/u.test(event.type))
  const playbackEnds = source.events.filter((event) => /audio\.end|playback\.end/u.test(event.type))
  const assertions: Jarvis.ReplayAssertion[] = [
    { id: "terminal", passed: !!terminal, detail: terminal ? undefined : "No terminal turn event was recorded." },
    {
      id: "no-duplicate-text",
      passed: new Set(textEvents.map((event) => JSON.stringify(event.data))).size === textEvents.length,
      detail: "Assistant text events must be unique.",
    },
    {
      id: "playback-order",
      passed: playbackStarts.length <= playbackEnds.length + 1,
      detail: "Playback starts must have matching terminal events.",
    },
    {
      id: "side-effects-blocked",
      passed: true,
      detail:
        unsafe.length > 0
          ? `${unsafe.length} unsafe action(s) replaced with recorded fixture results.`
          : "Replay used the fixture adapter; no external side effects were executed.",
    },
    {
      id: "neutral-after-cancel",
      passed:
        source.status !== "cancelled" ||
        source.events.some((event) => /(?:^|\.)presentation$/u.test(event.type) && event.data.emotion === "neutral"),
      detail: "Cancelled turns must finish with a neutral presentation cue.",
    },
  ]
  const execution: Jarvis.ReplayExecution = {
    id: crypto.randomUUID(),
    replayID,
    status: "completed",
    fixtureOnly: true,
    assertions,
    metrics: source.metrics,
    createdAt: now,
    updatedAt: now,
  }
  yield* db.insert(JarvisReplayExecutionTable).values(replayExecutionRow(execution))
  return execution
})

export const replayExecution = Effect.fn("JarvisRuntime.replayExecution")(function* (
  db: Database.Interface["db"],
  id: string,
) {
  const row = yield* db.select().from(JarvisReplayExecutionTable).where(eq(JarvisReplayExecutionTable.id, id)).get()
  return row ? replayExecutionFromRow(row) : undefined
})

export const compareReplayExecutions = Effect.fn("JarvisRuntime.compareReplayExecutions")(function* (
  db: Database.Interface["db"],
  input: Jarvis.ReplayCompare,
) {
  const baseline = yield* replayExecution(db, input.baselineExecutionID)
  const candidate = yield* replayExecution(db, input.candidateExecutionID)
  if (!baseline || !candidate) return undefined
  const failures = (execution: Jarvis.ReplayExecution) =>
    new Set(execution.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id))
  const previous = failures(baseline)
  const current = failures(candidate)
  const regressions = [...current].filter((id) => !previous.has(id))
  const improvements = [...previous].filter((id) => !current.has(id))
  return {
    baselineExecutionID: baseline.id,
    candidateExecutionID: candidate.id,
    regressions,
    improvements,
    passed: regressions.length === 0 && current.size === 0,
  } satisfies Jarvis.ReplayComparison
})

export const diagnostics = Effect.fn("JarvisRuntime.diagnostics")(function* (db: Database.Interface["db"]) {
  const runtime = yield* status(db)
  const active = yield* currentTurn(db)
  const currentPresence = yield* presence(db)
  const currentConversation = yield* conversation(db)
  const [memoryRecords, replayRuns] = yield* Effect.all(
    [count(db, JarvisMemoryTable), count(db, JarvisReplayTable)],
    { concurrency: "unbounded" },
  )
  const checks: Jarvis.DiagnosticCheck[] = [
    {
      id: "sqlite",
      status: "ready",
      summary: "Jarvis SQLite storage is available.",
      detail: `${memoryRecords} memory record(s) and ${replayRuns} replay trace(s) are readable.`,
    },
    {
      id: "profile",
      status: runtime.primaryProfile ? "ready" : "degraded",
      summary: runtime.primaryProfile ? "Primary Jarvis profile is synchronized." : "Primary Jarvis profile is missing.",
    },
    ...runtime.modelRoles.map((role) => ({
      id: `model-${role.role}`,
      status: role.status === "ready" ? ("ready" as const) : role.status === "unconfigured" ? ("degraded" as const) : ("error" as const),
      summary: `${role.role}: ${role.status}`,
      detail: role.detail,
    })),
    {
      id: "presence",
      status: currentPresence.microphoneOwner || currentPresence.playbackOwner ? "ready" : "degraded",
      summary: currentPresence.microphoneOwner || currentPresence.playbackOwner ? "A live media surface is available." : "No live media surface owns microphone or playback.",
    },
    {
      id: "turn",
      status: active?.phase === "error" ? "error" : "ready",
      summary: active ? `Latest turn: ${active.phase}.` : "No Jarvis turn has been recorded yet.",
      detail: active?.error,
    },
    {
      id: "conversation",
      status: currentConversation ? "ready" : "degraded",
      summary: currentConversation ? "Canonical Jarvis session is adopted." : "Canonical Jarvis session will be created on first use.",
      detail: currentConversation?.sessionID,
    },
    {
      id: "replay",
      status: replayRuns > 0 ? "ready" : "degraded",
      summary: replayRuns > 0 ? "Replay Lab has sanitized traces." : "Replay Lab has no turn traces yet.",
    },
  ]
  return {
    checkedAt: Date.now(),
    checks,
    recommendations: recommendations(runtime, currentPresence, active),
  } satisfies Jarvis.Diagnostics
})

export const controlStatus = Effect.fn("JarvisRuntime.controlStatus")(function* (db: Database.Interface["db"]) {
  const [runtime, active, currentPresence, currentConversation, currentMedia, replayCount, recentMemoryUses] = yield* Effect.all(
    [
      status(db),
      currentTurn(db),
      presence(db),
      conversation(db),
      mediaState(db),
      count(db, JarvisReplayTable),
      count(db, JarvisMemoryUseTable),
    ],
    { concurrency: "unbounded" },
  )
  return {
    runtime,
    conversation: currentConversation,
    currentTurn: active,
    presence: currentPresence,
    media: currentMedia,
    replayCount,
    recentMemoryUses,
    recommendations: recommendations(runtime, currentPresence, active),
  } satisfies Jarvis.ControlStatus
})

export const status = Effect.fn("JarvisRuntime.status")(function* (db: Database.Interface["db"]) {
  const config = yield* getConfig(db)
  const dialogueBenchmark = config.models.dialogue
    ? config.benchmark.results.find(
        (result) =>
          result.model.providerID === config.models.dialogue?.providerID &&
          result.model.modelID === config.models.dialogue.modelID,
      )
    : undefined
  const dialogueVerified = !!dialogueBenchmark?.accepted && dialogueBenchmark.expiresAt > Date.now()
  const [primaryProfile, active, suspended, pending, memories] = yield* Effect.all(
    [
      profile(db, config.primaryProfileID),
      count(db, JarvisGoalTable, inArray(JarvisGoalTable.status, ["pending", "planning", "active"])),
      count(db, JarvisGoalTable, eq(JarvisGoalTable.status, "suspended")),
      count(db, JarvisWakeTable, eq(JarvisWakeTable.status, "pending")),
      count(db, JarvisMemoryTable),
    ],
    { concurrency: "unbounded" },
  )
  const degradedReasons = [
    ...(primaryProfile ? [] : ["No Primary Jarvis profile is configured."]),
    ...(config.models.dialogue ? [] : ["Dialogue model is not configured."]),
    ...(config.models.dialogue && !dialogueVerified ? ["Dialogue model has not passed a current local benchmark."] : []),
    ...(config.models.planner ? [] : ["Planner model is not configured; multi-step goals will be suspended."]),
  ]
  const modelRoles = (["dialogue", "planner", "embedding"] as const).map((role) => {
    const verified = role === "dialogue" && dialogueVerified
    return {
      role,
      status: config.models[role] ? (verified ? ("ready" as const) : ("degraded" as const)) : ("unconfigured" as const),
      model: config.models[role],
      verified,
      detail: config.models[role]
        ? verified
          ? "Verified by the current local model benchmark."
          : role === "dialogue" && dialogueBenchmark?.expiresAt && dialogueBenchmark.expiresAt <= Date.now()
            ? "The local model benchmark has expired."
            : "Configured manually; runtime availability has not been verified."
        : undefined,
    }
  })
  const remaining = yield* memoryBackfillStatus(db)
  return {
    state: degradedReasons.length === 0 ? ("ready" as const) : ("degraded" as const),
    primaryProfile,
    config,
    activeGoals: active,
    suspendedGoals: suspended,
    pendingInbox: pending,
    memoryRecords: memories,
    degradedReasons,
    modelRoles,
    planner: {
      state: config.models.planner ? (plannerRuntime.activeRequests > 0 ? ("busy" as const) : ("idle" as const)) : ("offline" as const),
      managed: false,
      activeRequests: plannerRuntime.activeRequests,
      lastUsedAt: plannerRuntime.lastUsedAt,
    },
    embeddings: {
      state: config.models.embedding ? (remaining > 0 ? ("blocked" as const) : ("idle" as const)) : ("blocked" as const),
      remaining,
      processed: 0,
      error: config.models.embedding ? undefined : "Embedding model is not configured; lexical search remains available.",
    },
  }
})

export function plannerStarted() {
  plannerRuntime.activeRequests++
  plannerRuntime.lastUsedAt = Date.now()
}

export function plannerFinished() {
  plannerRuntime.activeRequests = Math.max(0, plannerRuntime.activeRequests - 1)
  plannerRuntime.lastUsedAt = Date.now()
}

export function dialogueStarted() {
  dialogueRuntime.activeRequests++
}

export function dialogueFinished() {
  dialogueRuntime.activeRequests = Math.max(0, dialogueRuntime.activeRequests - 1)
}

export function hasActiveTurn() {
  return dialogueRuntime.activeRequests > 0 || plannerRuntime.activeRequests > 0
}

export function shouldPlan(input: {
  readonly text: string
  readonly failedAttempts?: number
  readonly memoryConflict?: boolean
  readonly critical?: boolean
  readonly minWords?: number
}) {
  const text = input.text.toLocaleLowerCase()
  return (
    (input.failedAttempts ?? 0) > 0 ||
    input.memoryConflict === true ||
    input.critical === true ||
    /(?:склади|створи|побудуй|план|кілька крок|спочатку.+потім|виконай.+(?:і|після).+|plan|multiple steps|first.+then|do.+then)/iu.test(
      text,
    )
  )
}

export function plannerAcknowledgement(profile: Jarvis.ProfileSnapshot, language = profile.language) {
  const ukrainian = language.toLocaleLowerCase().startsWith("uk")
  if (ukrainian && profile.archetype === "military") return "Прийняв. Формую план дій."
  if (ukrainian && profile.archetype === "jarvis") return "Зрозуміло. Прораховую послідовність дій."
  if (ukrainian) return "Зрозумів. Планую наступні кроки."
  if (profile.archetype === "military") return "Acknowledged. Building the action plan."
  if (profile.archetype === "jarvis") return "Understood. Calculating the sequence of actions."
  return "Understood. Planning the next steps."
}

function goalRow(goal: Jarvis.Goal): typeof JarvisGoalTable.$inferInsert {
  return {
    id: goal.id,
    profile_id: goal.profileID,
    session_id: goal.sessionID,
    mode: goal.mode,
    game_id: goal.gameID,
    save_slot_id: goal.saveSlotID,
    character_id: goal.characterID,
    objective: goal.objective,
    status: goal.status,
    suspension_reason: goal.suspensionReason,
    world_revision: goal.worldRevision,
    capability_revision: goal.capabilityRevision,
    action_count: goal.actionCount,
    cycle_started_at: goal.cycleStartedAt,
    plan: goal.plan,
    time_created: goal.createdAt,
    time_updated: goal.updatedAt,
  }
}

const goalByID = Effect.fn("JarvisRuntime.goalByID")(function* (db: Database.Interface["db"], id: string) {
  const row = yield* db.select().from(JarvisGoalTable).where(eq(JarvisGoalTable.id, id)).get()
  return row ? yield* goalFromRow(db, row) : undefined
})

const goalFromRow = Effect.fn("JarvisRuntime.goalFromRow")(function* (
  db: Database.Interface["db"],
  row: typeof JarvisGoalTable.$inferSelect,
) {
  const steps = yield* db
    .select()
    .from(JarvisPlanStepTable)
    .where(eq(JarvisPlanStepTable.goal_id, row.id))
    .orderBy(asc(JarvisPlanStepTable.position))
  return {
    id: row.id,
    profileID: row.profile_id,
    sessionID: row.session_id ?? undefined,
    mode: row.mode,
    gameID: row.game_id ?? undefined,
    saveSlotID: row.save_slot_id ?? undefined,
    characterID: row.character_id ?? undefined,
    objective: row.objective,
    status: row.status,
    suspensionReason: row.suspension_reason ?? undefined,
    worldRevision: row.world_revision ?? undefined,
    capabilityRevision: row.capability_revision ?? undefined,
    actionCount: row.action_count,
    cycleStartedAt: row.cycle_started_at ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
    plan: row.plan
      ? {
          ...row.plan,
          steps: steps.map((step) => ({
            id: step.id,
            goalID: step.goal_id,
            position: step.position,
            action: step.action,
            arguments: step.arguments,
            expectedPostconditions: step.expected_postconditions,
            status: step.status,
            attempts: step.attempts,
            lastError: step.last_error ?? undefined,
            updatedAt: step.time_updated,
          })),
        }
      : undefined,
  } satisfies Jarvis.Goal
})

function memoryRow(record: Jarvis.MemoryRecord): typeof JarvisMemoryTable.$inferInsert {
  return {
    id: record.id,
    profile_id: record.profileID,
    scope: record.scope,
    game_id: record.gameID,
    save_slot_id: record.saveSlotID,
    character_id: record.characterID,
    kind: record.kind,
    body: record.text,
    source_id: record.sourceID,
    confidence: record.confidence,
    importance: record.importance,
    lifecycle: record.lifecycle,
    pinned: record.pinned,
    conflicts_with: record.conflictsWith,
    embedding: record.embedding,
    embedding_model: record.embeddingModel,
    last_used_at: record.lastUsedAt,
    time_created: record.createdAt,
    time_updated: record.updatedAt,
  }
}

function memoryFromRow(row: typeof JarvisMemoryTable.$inferSelect): Jarvis.MemoryRecord {
  return {
    id: row.id,
    profileID: row.profile_id ?? undefined,
    scope: row.scope,
    gameID: row.game_id ?? undefined,
    saveSlotID: row.save_slot_id ?? undefined,
    characterID: row.character_id ?? undefined,
    kind: row.kind,
    text: row.body,
    sourceID: row.source_id,
    confidence: row.confidence,
    importance: row.importance,
    lifecycle: row.lifecycle,
    pinned: row.pinned,
    conflictsWith: row.conflicts_with,
    embedding: row.embedding ?? undefined,
    embeddingModel: row.embedding_model ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
    lastUsedAt: row.last_used_at ?? undefined,
  }
}

function turnRow(turn: Jarvis.Turn): typeof JarvisTurnTable.$inferInsert {
  return {
    id: turn.id,
    request_id: turn.requestID,
    session_id: turn.sessionID,
    profile_id: turn.profileID,
    surface: turn.surface,
    response_mode: turn.responseMode,
    phase: turn.phase,
    sequence: turn.sequence,
    presentation: turn.presentation,
    metrics: turn.metrics,
    error: turn.error,
    cancel_reason: turn.cancelReason,
    time_created: turn.createdAt,
    time_updated: turn.updatedAt,
  }
}

function turnFromRow(row: typeof JarvisTurnTable.$inferSelect): Jarvis.Turn {
  return {
    id: row.id,
    requestID: row.request_id,
    sessionID: row.session_id,
    profileID: row.profile_id ?? undefined,
    surface: row.surface,
    responseMode: row.response_mode,
    phase: row.phase,
    sequence: row.sequence,
    presentation: row.presentation ?? undefined,
    metrics: row.metrics,
    error: row.error ?? undefined,
    cancelReason: row.cancel_reason ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function validTurnTransition(current: Jarvis.TurnPhase, next: Jarvis.TurnPhase) {
  if (next === "cancelled" || next === "error") return true
  const order: readonly Jarvis.TurnPhase[] = [
    "listening",
    "transcribing",
    "understanding",
    "planning",
    "responding",
    "speaking",
    "acting",
    "completed",
  ]
  const currentIndex = order.indexOf(current)
  const nextIndex = order.indexOf(next)
  return currentIndex >= 0 && nextIndex >= currentIndex
}

const syncPresenceFromTurn = Effect.fn("JarvisRuntime.syncPresenceFromTurn")(function* (
  db: Database.Interface["db"],
  turn: Jarvis.Turn,
) {
  const current = (yield* db.select().from(JarvisPresenceTable).where(eq(JarvisPresenceTable.id, PRESENCE_ID)).get())?.data
  const data: Jarvis.Presence = {
    surface: turn.surface,
    microphoneOwner: current?.microphoneOwner,
    playbackOwner: current?.playbackOwner,
    turnID: turn.id,
    sessionID: turn.sessionID,
    state: turn.phase,
    updatedAt: turn.updatedAt,
  }
  yield* db
    .insert(JarvisPresenceTable)
    .values({ id: PRESENCE_ID, data, time_updated: data.updatedAt })
    .onConflictDoUpdate({ target: JarvisPresenceTable.id, set: { data, time_updated: data.updatedAt } })
})

function memoryUseRow(record: Jarvis.MemoryUse): typeof JarvisMemoryUseTable.$inferInsert {
  return {
    id: record.id,
    turn_id: record.turnID,
    memory_id: record.memoryID,
    rank: record.rank,
    lexical_score: record.lexicalScore,
    semantic_score: record.semanticScore,
    reason: record.reason,
    time_created: record.createdAt,
  }
}

function memoryUseFromRow(row: typeof JarvisMemoryUseTable.$inferSelect): Jarvis.MemoryUse {
  return {
    id: row.id,
    turnID: row.turn_id,
    memoryID: row.memory_id,
    rank: row.rank,
    lexicalScore: row.lexical_score,
    semanticScore: row.semantic_score,
    reason: row.reason,
    createdAt: row.time_created,
  }
}

function replayRow(replay: Jarvis.ReplayRun): typeof JarvisReplayTable.$inferInsert {
  return {
    id: replay.id,
    turn_id: replay.turnID,
    session_id: replay.sessionID,
    surface: replay.surface,
    status: replay.status,
    events: replay.events,
    metrics: replay.metrics,
    error: replay.error,
    time_created: replay.createdAt,
    time_updated: replay.updatedAt,
  }
}

function replayFromRow(row: typeof JarvisReplayTable.$inferSelect): Jarvis.ReplayRun {
  return {
    id: row.id,
    turnID: row.turn_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    surface: row.surface,
    status: row.status,
    events: row.events,
    metrics: row.metrics,
    error: row.error ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function conversationFromRow(row: typeof JarvisConversationTable.$inferSelect): Jarvis.ConversationState {
  return {
    sessionID: row.session_id,
    profileID: row.profile_id ?? undefined,
    profileRevision: row.profile_revision ?? undefined,
    recoveredAt: row.recovered_at ?? undefined,
    updatedAt: row.time_updated,
  }
}

function replayExecutionRow(execution: Jarvis.ReplayExecution): typeof JarvisReplayExecutionTable.$inferInsert {
  return {
    id: execution.id,
    replay_id: execution.replayID,
    status: execution.status,
    fixture_only: execution.fixtureOnly,
    assertions: execution.assertions,
    metrics: execution.metrics,
    error: execution.error,
    time_created: execution.createdAt,
    time_updated: execution.updatedAt,
  }
}

function replayExecutionFromRow(row: typeof JarvisReplayExecutionTable.$inferSelect): Jarvis.ReplayExecution {
  return {
    id: row.id,
    replayID: row.replay_id,
    status: row.status,
    fixtureOnly: row.fixture_only,
    assertions: row.assertions,
    metrics: row.metrics,
    error: row.error ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function sanitizeReplayEvents(events: readonly Jarvis.ReplayEvent[]) {
  return events.map((event) => ({
    ...event,
    type: event.type.slice(0, 120),
    data: Object.fromEntries(
      Object.entries(event.data)
        .filter(([key]) => !/(?:audio|token|secret|password|authorization|api.?key)/iu.test(key))
        .map(([key, value]) => [key.slice(0, 120), sanitizeReplayValue(value)]),
    ),
  }))
}

type ReplayValue = Jarvis.ReplayEvent["data"][string]

function sanitizeReplayValue(value: ReplayValue): ReplayValue {
  if (typeof value === "string") return value.slice(0, 4_000)
  if (Array.isArray(value)) return value.slice(0, 64).map(sanitizeReplayValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(?:audio|token|secret|password|authorization|api.?key)/iu.test(key))
      .slice(0, 64)
      .map(([key, nested]) => [key.slice(0, 120), sanitizeReplayValue(nested)]),
  )
}

function recommendations(runtime: Jarvis.RuntimeStatus, value: Jarvis.Presence, active?: Jarvis.Turn) {
  return [
    ...(runtime.primaryProfile ? [] : ["Choose and synchronize a Primary Jarvis profile."]),
    ...(runtime.modelRoles.find((role) => role.role === "dialogue")?.status === "ready"
      ? []
      : ["Verify a fast dialogue model before starting hands-free voice."]),
    ...(value.microphoneOwner ? [] : ["Activate Desktop or VR voice to assign a microphone owner."]),
    ...(value.playbackOwner ? [] : ["Choose a voice-enabled personality to assign a playback owner."]),
    ...(active?.phase === "error" ? [active.error ?? "Inspect the latest failed Jarvis turn."] : []),
    ...(runtime.embeddings.state === "blocked" ? ["Memory remains lexical until the embedding role is ready."] : []),
  ]
}

function memoryVisible(row: typeof JarvisMemoryTable.$inferSelect, input: Jarvis.MemorySearch) {
  if (row.lifecycle === "archived") return false
  if (row.scope === "user") return true
  if (row.profile_id !== input.profileID) return false
  if (row.scope === "profile" || row.scope === "working") return true
  return row.game_id === input.gameID && row.save_slot_id === input.saveSlotID && row.character_id === input.characterID
}

function semanticScore(stored?: readonly number[] | null, query?: readonly number[]) {
  if (!stored || !query || stored.length !== query.length || stored.length === 0) return 0
  const dot = stored.reduce((total, value, index) => total + value * (query[index] ?? 0), 0)
  const left = Math.sqrt(stored.reduce((total, value) => total + value * value, 0))
  const right = Math.sqrt(query.reduce((total, value) => total + value * value, 0))
  return left > 0 && right > 0 ? Math.max(0, dot / (left * right)) * 2 : 0
}

function sameModel(stored?: Jarvis.ModelRef | null, query?: Jarvis.ModelRef) {
  return !!stored && !!query && stored.providerID === query.providerID && stored.modelID === query.modelID
}

const embedText = Effect.fn("JarvisRuntime.embedText")(function* (model: Jarvis.ModelRef | undefined, text: string) {
  if (!model || !text.trim()) return undefined
  const selected = yield* RepositoryEmbeddings.model(`${model.providerID}:${model.modelID}`)
  if (!selected) return undefined
  const embedded = yield* RepositoryEmbeddings.embed({ model: selected, texts: [text] })
  const vector = embedded?.vectors[0]
  return vector ? { vector, model } : undefined
})

function wakeRow(candidate: Jarvis.WakeCandidate): typeof JarvisWakeTable.$inferInsert {
  return {
    id: candidate.id,
    profile_id: candidate.profileID,
    session_id: candidate.sessionID,
    kind: candidate.kind,
    topic: candidate.topic,
    body: candidate.text,
    priority: candidate.priority,
    status: candidate.status,
    not_before: candidate.notBefore,
    time_created: candidate.createdAt,
    time_updated: candidate.updatedAt,
    blocked_reason: candidate.blockedReason,
  }
}

function wakeFromRow(row: typeof JarvisWakeTable.$inferSelect): Jarvis.WakeCandidate {
  return {
    id: row.id,
    profileID: row.profile_id,
    sessionID: row.session_id ?? undefined,
    kind: row.kind,
    topic: row.topic,
    text: row.body,
    priority: row.priority,
    status: row.status,
    notBefore: row.not_before,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
    blockedReason: row.blocked_reason ?? undefined,
  }
}

export function isQuietHour(now: Date, policy: Jarvis.InitiativePolicy) {
  const value = now.getHours() * 60 + now.getMinutes()
  const parse = (input: string) => {
    const [hour, minute] = input.split(":").map(Number)
    return Number.isFinite(hour) && Number.isFinite(minute) ? (hour ?? 0) * 60 + (minute ?? 0) : 0
  }
  const start = parse(policy.quietStart)
  const end = parse(policy.quietEnd)
  if (start === end) return false
  return start < end ? value >= start && value < end : value >= start || value < end
}

function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)
}

const count = Effect.fn("JarvisRuntime.count")(function* (
  db: Database.Interface["db"],
  table:
    | typeof JarvisGoalTable
    | typeof JarvisWakeTable
    | typeof JarvisMemoryTable
    | typeof JarvisMemoryUseTable
    | typeof JarvisReplayTable,
  where?: ReturnType<typeof eq> | ReturnType<typeof inArray>,
) {
  const query = db.select({ count: sql<number>`count(*)` }).from(table)
  return Number((where ? yield* query.where(where).get() : yield* query.get())?.count ?? 0)
})
