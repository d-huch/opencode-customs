export * as JarvisRuntime from "./jarvis"

import { Jarvis } from "@opencode-ai/schema/jarvis"
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Database } from "./database/database"
import { RepositoryEmbeddings } from "./repository-embeddings"
import {
  JarvisConfigTable,
  JarvisGoalOutcomeTable,
  JarvisGoalTable,
  JarvisMemoryTable,
  JarvisPlanStepTable,
  JarvisProfileTable,
  JarvisWakeTable,
} from "./jarvis.sql"

const CONFIG_ID = 1
const MAX_PLAN_STEPS = 8
const MAX_ACTIONS = 8
const MAX_CYCLE_MS = 60_000
const plannerRuntime = { activeRequests: 0, lastUsedAt: undefined as number | undefined }

export const defaultConfig = (): Jarvis.Config => ({
  models: {},
  plannerTimeoutMs: 8_000,
  plannerIdleUnloadMs: 10 * 60_000,
  plannerEscalationMinWords: 18,
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
  return stored ? { ...defaultConfig(), ...stored, initiative: { ...defaultConfig().initiative, ...stored.initiative } } : defaultConfig()
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
  return (yield* db.delete(JarvisMemoryTable).where(eq(JarvisMemoryTable.id, id)).returning({ id: JarvisMemoryTable.id })).length
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

export const status = Effect.fn("JarvisRuntime.status")(function* (db: Database.Interface["db"]) {
  const config = yield* getConfig(db)
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
    ...(config.models.planner ? [] : ["Planner model is not configured; multi-step goals will be suspended."]),
  ]
  const modelRoles = (["dialogue", "planner", "embedding"] as const).map((role) => ({
    role,
    status: config.models[role] ? ("degraded" as const) : ("unconfigured" as const),
    model: config.models[role],
    verified: false,
    detail: config.models[role] ? "Configured manually; runtime availability has not been verified." : undefined,
  }))
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
    /(?:склади|створи|побудуй|план|кілька крок|спочатку.+потім|plan|multiple steps|first.+then)/iu.test(text) ||
    text.trim().split(/\s+/u).length >= Math.max(4, input.minWords ?? 18)
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
  table: typeof JarvisGoalTable | typeof JarvisWakeTable | typeof JarvisMemoryTable,
  where?: ReturnType<typeof eq> | ReturnType<typeof inArray>,
) {
  const query = db.select({ count: sql<number>`count(*)` }).from(table)
  return Number((where ? yield* query.where(where).get() : yield* query.get())?.count ?? 0)
})
