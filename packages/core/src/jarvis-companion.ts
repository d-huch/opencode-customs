export * as JarvisCompanion from "./jarvis-companion"

import { Jarvis } from "@opencode-ai/schema/jarvis"
import { and, desc, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "./database/database"
import {
  JarvisCompanionActionExecutionTable,
  JarvisCompanionActionTable,
  JarvisCompanionConfigTable,
  JarvisDailyBriefingRunTable,
  JarvisDailyBriefingTable,
  JarvisGoalTable,
  JarvisMemoryTable,
  JarvisWakeTable,
} from "./jarvis.sql"

const CONFIG_ID = 1
const localBridge = (() => {
  const url = process.env.OPENCODE_GOOGLE_COMPANION_URL
  const token = process.env.OPENCODE_GOOGLE_COMPANION_TOKEN
  delete process.env.OPENCODE_GOOGLE_COMPANION_URL
  delete process.env.OPENCODE_GOOGLE_COMPANION_TOKEN
  return url && token ? { url, token } : undefined
})()

type SnapshotItem = {
  id: string
  title: string
  summary?: string
  timestamp?: number
  url?: string
  revision?: string
}

type SnapshotSource = {
  status: "ready" | "unavailable" | "error"
  items: SnapshotItem[]
  error?: string
}

type Snapshot = {
  accountID: string
  email?: string
  calendar: SnapshotSource
  gmail: SnapshotSource
  drive: SnapshotSource
}

export const defaultConfig = (): Jarvis.DailyCompanionConfig => ({
  enabled: false,
  schedule: "08:30",
  timezone: "Europe/Kyiv",
  catchUpUntil: "18:00",
  sources: {
    gmail: true,
    calendar: true,
    drive: true,
    goals: true,
    promises: true,
    inbox: true,
  },
  updatedAt: Date.now(),
})

export const getConfig = Effect.fn("JarvisCompanion.getConfig")(function* (db: Database.Interface["db"]) {
  const stored = (yield* db.select().from(JarvisCompanionConfigTable).where(eq(JarvisCompanionConfigTable.id, CONFIG_ID)).get())?.data
  if (!stored) return defaultConfig()
  return { ...defaultConfig(), ...stored, sources: { ...defaultConfig().sources, ...stored.sources } }
})

export const updateConfig = Effect.fn("JarvisCompanion.updateConfig")(function* (
  db: Database.Interface["db"],
  input: Jarvis.DailyCompanionConfig,
) {
  const config: Jarvis.DailyCompanionConfig = {
    ...input,
    schedule: validTime(input.schedule) ? input.schedule : "08:30",
    catchUpUntil: validTime(input.catchUpUntil) ? input.catchUpUntil : "18:00",
    timezone: validTimezone(input.timezone) ? input.timezone : "Europe/Kyiv",
    updatedAt: Date.now(),
  }
  yield* db
    .insert(JarvisCompanionConfigTable)
    .values({ id: CONFIG_ID, data: config, time_updated: config.updatedAt })
    .onConflictDoUpdate({ target: JarvisCompanionConfigTable.id, set: { data: config, time_updated: config.updatedAt } })
  return config
})

export const status = Effect.fn("JarvisCompanion.status")(function* (db: Database.Interface["db"]) {
  const config = yield* getConfig(db)
  const google = yield* bridgeRequest<Jarvis.GoogleConnectionStatus>("status", undefined).pipe(
    Effect.catch((error) => Effect.succeed(unavailableGoogle(String(error)))),
  )
  const last = yield* db.select().from(JarvisDailyBriefingRunTable).orderBy(desc(JarvisDailyBriefingRunTable.started_at)).limit(1).get()
  const now = Date.now()
  return {
    config,
    google,
    lastRun: last ? runFromRow(last) : undefined,
    nextRunAt: nextRun(now, config),
    catchUpAvailable: withinCatchUp(now, config),
    bridgeAvailable: Boolean(localBridge),
    error: localBridge ? undefined : "Google Companion is available only in the native Desktop app.",
  } satisfies Jarvis.DailyCompanionStatus
})

export const run = Effect.fn("JarvisCompanion.run")(function* (
  db: Database.Interface["db"],
  input: Jarvis.DailyBriefingRunRequest,
) {
  const config = yield* getConfig(db)
  const now = Date.now()
  const localDate = dateParts(now, config.timezone).date
  const trigger = input.trigger ?? "manual"
  const initial: Jarvis.DailyBriefingRun = {
    id: crypto.randomUUID(),
    trigger,
    status: "collecting",
    localDate,
    sourceCounts: {},
    startedAt: now,
  }
  yield* db.insert(JarvisDailyBriefingRunTable).values(runRow(initial))
  if (!config.enabled && trigger !== "manual") return yield* finishRun(db, initial, "skipped", "Daily Companion is disabled.")
  const google = yield* bridgeRequest<Jarvis.GoogleConnectionStatus>("status", undefined).pipe(
    Effect.catch(() => Effect.succeed(unavailableGoogle("Google Companion bridge is unavailable."))),
  )
  if (!google.accountID || google.phase !== "connected") return yield* finishRun(db, initial, "error", "Google account is not connected.")
  const existing = yield* db
    .select()
    .from(JarvisDailyBriefingTable)
    .where(and(eq(JarvisDailyBriefingTable.local_date, localDate), eq(JarvisDailyBriefingTable.account_id, google.accountID)))
    .get()
  if (existing && !input.force) {
    const run = { ...initial, briefingID: existing.id, accountID: google.accountID }
    return yield* finishRun(db, run, "skipped", "A briefing already exists for this account and date.")
  }
  const snapshotResult = yield* bridgeRequest<Snapshot>("snapshot", {
    timezone: config.timezone,
    sources: config.sources,
    limits: { gmail: 30, drive: 10 },
  }).pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catch((cause) => Effect.succeed({ ok: false as const, cause })),
  )
  if (!snapshotResult.ok) return yield* finishRun(db, initial, "error", `Google snapshot failed: ${String(snapshotResult.cause)}`.slice(0, 1_000))
  const snapshot = snapshotResult.value
  const goals = config.sources.goals
    ? yield* db.select().from(JarvisGoalTable).where(eq(JarvisGoalTable.status, "active")).limit(20)
    : []
  const suspended = config.sources.goals
    ? yield* db.select().from(JarvisGoalTable).where(eq(JarvisGoalTable.status, "suspended")).limit(20)
    : []
  const promises = config.sources.promises
    ? yield* db.select().from(JarvisMemoryTable).where(eq(JarvisMemoryTable.kind, "promise")).orderBy(desc(JarvisMemoryTable.time_updated)).limit(20)
    : []
  const inbox = config.sources.inbox
    ? yield* db.select().from(JarvisWakeTable).where(eq(JarvisWakeTable.status, "pending")).orderBy(desc(JarvisWakeTable.priority)).limit(20)
    : []
  const sources = [
    ...sourceRecords("calendar", snapshot.calendar),
    ...sourceRecords("gmail", snapshot.gmail),
    ...sourceRecords("drive", snapshot.drive),
    ...goals.map((item) => localSource("goal", item.id, item.objective, "Active goal")),
    ...suspended.map((item) => localSource("goal", item.id, item.objective, item.suspension_reason ?? "Suspended goal")),
    ...promises.map((item) => localSource("promise", item.id, item.body, "Jarvis promise")),
    ...inbox.map((item) => localSource("inbox", item.id, item.body, item.topic)),
  ] satisfies Jarvis.DailyBriefingSource[]
  const briefing: Jarvis.DailyBriefing = {
    id: existing?.id ?? crypto.randomUUID(),
    localDate,
    accountID: snapshot.accountID,
    status: sources.some((item) => item.status !== "ready") ? "partial" : "ready",
    summary: `Morning briefing: ${snapshot.calendar.items.length} calendar items, ${snapshot.gmail.items.length} important messages, ${snapshot.drive.items.length} recent files, ${goals.length + suspended.length} goals and ${promises.length} promises.`,
    schedule: snapshot.calendar.items.map((item) => attributed(item)),
    importantMessages: snapshot.gmail.items.map((item) => attributed(item)),
    goalsAndPromises: [...goals, ...suspended].map((item) => `[goal:${item.id}] ${item.objective}`).concat(promises.map((item) => `[promise:${item.id}] ${item.body}`)),
    conflicts: [],
    risks: sources.filter((item) => item.status !== "ready").map((item) => `${item.kind}: ${item.error ?? "unavailable"}`),
    sources,
    proposedActions: [],
    createdAt: existing?.time_created ?? now,
    updatedAt: Date.now(),
  }
  yield* db
    .insert(JarvisDailyBriefingTable)
    .values(briefingRow(briefing))
    .onConflictDoUpdate({
      target: [JarvisDailyBriefingTable.local_date, JarvisDailyBriefingTable.account_id],
      set: { status: briefing.status, data: briefing, time_updated: briefing.updatedAt },
    })
  const counts = { calendar: snapshot.calendar.items.length, gmail: snapshot.gmail.items.length, drive: snapshot.drive.items.length, goals: goals.length + suspended.length, promises: promises.length, inbox: inbox.length }
  const completed = { ...initial, briefingID: briefing.id, accountID: snapshot.accountID, sourceCounts: counts }
  return yield* finishRun(db, completed, briefing.status === "ready" ? "completed" : "partial")
})

export const briefings = Effect.fn("JarvisCompanion.briefings")(function* (db: Database.Interface["db"], limit = 30) {
  return (yield* db.select().from(JarvisDailyBriefingTable).orderBy(desc(JarvisDailyBriefingTable.time_created)).limit(Math.min(100, Math.max(1, limit)))).map((row) => row.data)
})

export const briefing = Effect.fn("JarvisCompanion.briefing")(function* (db: Database.Interface["db"], id: string) {
  return (yield* db.select().from(JarvisDailyBriefingTable).where(eq(JarvisDailyBriefingTable.id, id)).get())?.data
})

export const prepareAction = Effect.fn("JarvisCompanion.prepareAction")(function* (
  db: Database.Interface["db"],
  input: Jarvis.CompanionActionPrepare,
) {
  const existing = yield* db.select().from(JarvisCompanionActionTable).where(eq(JarvisCompanionActionTable.idempotency_key, input.idempotencyKey)).get()
  if (existing) return proposalFromRow(existing)
  const now = Date.now()
  const proposal: Jarvis.CompanionActionProposal = {
    id: crypto.randomUUID(),
    briefingID: input.briefingID,
    kind: input.kind,
    title: input.title.slice(0, 200),
    preview: input.preview.slice(0, 4_000),
    access: input.kind.startsWith("jarvis_") ? "local_write" : "external_write",
    input: input.input,
    requiredScopes: input.requiredScopes ?? [],
    idempotencyKey: input.idempotencyKey,
    externalRevision: input.externalRevision,
    status: "prepared",
    createdAt: now,
    updatedAt: now,
  }
  yield* db.insert(JarvisCompanionActionTable).values(proposalRow(proposal))
  return proposal
})

export const action = Effect.fn("JarvisCompanion.action")(function* (db: Database.Interface["db"], proposalID: string) {
  const row = yield* db.select().from(JarvisCompanionActionTable).where(eq(JarvisCompanionActionTable.id, proposalID)).get()
  return row ? proposalFromRow(row) : undefined
})

export const actions = Effect.fn("JarvisCompanion.actions")(function* (db: Database.Interface["db"], limit = 100) {
  return (yield* db.select().from(JarvisCompanionActionTable).orderBy(desc(JarvisCompanionActionTable.time_created)).limit(Math.min(100, Math.max(1, limit)))).map(proposalFromRow)
})

export const completeLocalAction = Effect.fn("JarvisCompanion.completeLocalAction")(function* (
  db: Database.Interface["db"],
  proposalID: string,
  result: NonNullable<Jarvis.CompanionActionExecution["result"]>,
) {
  const row = yield* db.select().from(JarvisCompanionActionTable).where(eq(JarvisCompanionActionTable.id, proposalID)).get()
  if (!row || row.status !== "prepared") return undefined
  const now = Date.now()
  const execution: Jarvis.CompanionActionExecution = {
    id: crypto.randomUUID(),
    proposalID,
    status: "completed",
    result,
    createdAt: now,
    updatedAt: now,
  }
  yield* db.insert(JarvisCompanionActionExecutionTable).values(executionRow(execution))
  yield* db.update(JarvisCompanionActionTable).set({ status: "completed", time_updated: now }).where(eq(JarvisCompanionActionTable.id, proposalID))
  return execution
})

export const approveExternalAction = Effect.fn("JarvisCompanion.approveExternalAction")(function* (
  db: Database.Interface["db"],
  proposalID: string,
  input: Jarvis.CompanionActionApprove,
) {
  const row = yield* db.select().from(JarvisCompanionActionTable).where(eq(JarvisCompanionActionTable.id, proposalID)).get()
  if (!row || row.status !== "prepared") return undefined
  if (row.external_revision && row.external_revision !== input.externalRevision) return yield* conflictAction(db, row)
  const now = Date.now()
  yield* db.update(JarvisCompanionActionTable).set({ status: "executing", time_updated: now }).where(eq(JarvisCompanionActionTable.id, row.id))
  const result = yield* bridgeRequest<NonNullable<Jarvis.CompanionActionExecution["result"]>>("action", {
    kind: row.kind,
    input: row.input,
    idempotencyKey: row.idempotency_key,
    externalRevision: row.external_revision,
  }).pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catch((cause) => Effect.succeed({ ok: false as const, cause })),
  )
  const execution: Jarvis.CompanionActionExecution = {
    id: crypto.randomUUID(),
    proposalID: row.id,
    status: result.ok ? "completed" : "error",
    result: result.ok ? result.value : undefined,
    error: result.ok ? undefined : String(result.cause),
    createdAt: now,
    updatedAt: Date.now(),
  }
  yield* db.insert(JarvisCompanionActionExecutionTable).values(executionRow(execution))
  yield* db.update(JarvisCompanionActionTable).set({ status: execution.status, time_updated: execution.updatedAt }).where(eq(JarvisCompanionActionTable.id, row.id))
  return execution
})

export const cancelAction = Effect.fn("JarvisCompanion.cancelAction")(function* (db: Database.Interface["db"], proposalID: string) {
  const rows = yield* db.update(JarvisCompanionActionTable).set({ status: "cancelled", time_updated: Date.now() }).where(and(eq(JarvisCompanionActionTable.id, proposalID), eq(JarvisCompanionActionTable.status, "prepared"))).returning()
  return rows[0] ? proposalFromRow(rows[0]) : undefined
})

export const actionAudit = Effect.fn("JarvisCompanion.actionAudit")(function* (db: Database.Interface["db"], limit = 100) {
  return (yield* db.select().from(JarvisCompanionActionExecutionTable).orderBy(desc(JarvisCompanionActionExecutionTable.time_created)).limit(Math.min(100, Math.max(1, limit)))).map(executionFromRow)
})

export function scheduleDecision(now: number, config: Jarvis.DailyCompanionConfig, completedDate?: string) {
  const parts = dateParts(now, config.timezone)
  if (!config.enabled || completedDate === parts.date) return undefined
  const minute = parts.hour * 60 + parts.minute
  const schedule = timeMinutes(config.schedule)
  const catchUp = timeMinutes(config.catchUpUntil)
  if (minute < schedule || minute > catchUp) return undefined
  return minute === schedule ? "scheduled" as const : "catch_up" as const
}

function bridgeRequest<T>(path: "status" | "snapshot" | "action", body: unknown) {
  return Effect.tryPromise({
    try: async () => {
      if (!localBridge) throw new Error("Google Companion bridge is unavailable")
      const response = await fetch(new URL(path, localBridge.url), {
        method: path === "status" ? "GET" : "POST",
        headers: { authorization: `Bearer ${localBridge.token}`, "content-type": "application/json" },
        body: path === "status" ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(path === "snapshot" ? 45_000 : 20_000),
      })
      if (!response.ok) throw new Error(`Google Companion bridge returned HTTP ${response.status}`)
      return await response.json() as T
    },
    catch: (error) => error,
  })
}

function sourceRecords(kind: "gmail" | "calendar" | "drive", source: SnapshotSource): Jarvis.DailyBriefingSource[] {
  if (source.status !== "ready") return [{ id: `${kind}:unavailable`, kind, status: source.status, title: kind, error: source.error }]
  return source.items.map((item) => ({ id: `${kind}:${item.id}`, kind, status: "ready", title: item.title, summary: item.summary, timestamp: item.timestamp, url: item.url }))
}

function localSource(kind: "goal" | "promise" | "inbox", id: string, title: string, summary: string): Jarvis.DailyBriefingSource {
  return { id: `${kind}:${id}`, kind, status: "ready", title: title.slice(0, 500), summary: summary.slice(0, 1_000) }
}

function attributed(item: SnapshotItem) {
  return `[${item.id}] ${item.title}${item.summary ? ` — ${item.summary}` : ""}`
}

function unavailableGoogle(error: string): Jarvis.GoogleConnectionStatus {
  return { available: false, phase: "unavailable", scopes: [], writeScopes: [], checkedAt: Date.now(), error: error.slice(0, 1_000) }
}

function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function timeMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number)
  return hour * 60 + minute
}

function dateParts(now: number, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour), minute: Number(values.minute) }
}

function nextRun(now: number, config: Jarvis.DailyCompanionConfig) {
  if (!config.enabled) return undefined
  const parts = dateParts(now, config.timezone)
  const candidate = new Date(`${parts.date}T${config.schedule}:00`)
  const offset = new Date(new Date(candidate).toLocaleString("en-US", { timeZone: config.timezone })).getTime() - candidate.getTime()
  const today = candidate.getTime() - offset
  return today > now ? today : today + 24 * 60 * 60_000
}

function withinCatchUp(now: number, config: Jarvis.DailyCompanionConfig) {
  const parts = dateParts(now, config.timezone)
  const minute = parts.hour * 60 + parts.minute
  return minute >= timeMinutes(config.schedule) && minute <= timeMinutes(config.catchUpUntil)
}

function finishRun(db: Database.Interface["db"], run: Jarvis.DailyBriefingRun, status: Jarvis.DailyBriefingRun["status"], error?: string) {
  const completed = { ...run, status, error, completedAt: Date.now() }
  return db.update(JarvisDailyBriefingRunTable).set({ briefing_id: completed.briefingID, status, account_id: completed.accountID, source_counts: completed.sourceCounts, error, completed_at: completed.completedAt }).where(eq(JarvisDailyBriefingRunTable.id, run.id)).pipe(Effect.as(completed))
}

function conflictAction(db: Database.Interface["db"], row: typeof JarvisCompanionActionTable.$inferSelect) {
  const now = Date.now()
  const execution: Jarvis.CompanionActionExecution = { id: crypto.randomUUID(), proposalID: row.id, status: "conflict", error: "External state changed. Review a new preview before approval.", createdAt: now, updatedAt: now }
  return db.insert(JarvisCompanionActionExecutionTable).values(executionRow(execution)).pipe(
    Effect.andThen(db.update(JarvisCompanionActionTable).set({ status: "conflict", time_updated: now }).where(eq(JarvisCompanionActionTable.id, row.id))),
    Effect.as(execution),
  )
}

function runRow(run: Jarvis.DailyBriefingRun): typeof JarvisDailyBriefingRunTable.$inferInsert {
  return { id: run.id, briefing_id: run.briefingID, trigger: run.trigger, status: run.status, local_date: run.localDate, account_id: run.accountID, source_counts: run.sourceCounts, error: run.error, started_at: run.startedAt, completed_at: run.completedAt }
}

function runFromRow(row: typeof JarvisDailyBriefingRunTable.$inferSelect): Jarvis.DailyBriefingRun {
  return { id: row.id, briefingID: row.briefing_id ?? undefined, trigger: row.trigger, status: row.status, localDate: row.local_date, accountID: row.account_id ?? undefined, sourceCounts: row.source_counts, error: row.error ?? undefined, startedAt: row.started_at, completedAt: row.completed_at ?? undefined }
}

function briefingRow(briefing: Jarvis.DailyBriefing): typeof JarvisDailyBriefingTable.$inferInsert {
  return { id: briefing.id, local_date: briefing.localDate, account_id: briefing.accountID, session_id: briefing.sessionID, status: briefing.status, data: briefing, time_created: briefing.createdAt, time_updated: briefing.updatedAt }
}

function proposalRow(proposal: Jarvis.CompanionActionProposal): typeof JarvisCompanionActionTable.$inferInsert {
  return { id: proposal.id, briefing_id: proposal.briefingID, kind: proposal.kind, title: proposal.title, preview: proposal.preview, access: proposal.access, input: proposal.input, required_scopes: proposal.requiredScopes, idempotency_key: proposal.idempotencyKey, external_revision: proposal.externalRevision, status: proposal.status, time_created: proposal.createdAt, time_updated: proposal.updatedAt }
}

function proposalFromRow(row: typeof JarvisCompanionActionTable.$inferSelect): Jarvis.CompanionActionProposal {
  return { id: row.id, briefingID: row.briefing_id ?? undefined, kind: row.kind, title: row.title, preview: row.preview, access: row.access, input: row.input, requiredScopes: row.required_scopes, idempotencyKey: row.idempotency_key, externalRevision: row.external_revision ?? undefined, status: row.status, createdAt: row.time_created, updatedAt: row.time_updated }
}

function executionRow(execution: Jarvis.CompanionActionExecution): typeof JarvisCompanionActionExecutionTable.$inferInsert {
  return { id: execution.id, proposal_id: execution.proposalID, status: execution.status, result: execution.result, error: execution.error, time_created: execution.createdAt, time_updated: execution.updatedAt }
}

function executionFromRow(row: typeof JarvisCompanionActionExecutionTable.$inferSelect): Jarvis.CompanionActionExecution {
  return { id: row.id, proposalID: row.proposal_id, status: row.status, result: row.result ?? undefined, error: row.error ?? undefined, createdAt: row.time_created, updatedAt: row.time_updated }
}
