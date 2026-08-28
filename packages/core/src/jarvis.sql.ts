import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "./database/schema.sql"
import type { Jarvis } from "@opencode-ai/schema/jarvis"

export const JarvisConfigTable = sqliteTable("jarvis_config", {
  id: integer().primaryKey(),
  data: text({ mode: "json" }).$type<Jarvis.Config>().notNull(),
  time_updated: integer().notNull(),
})

export const JarvisProfileTable = sqliteTable(
  "jarvis_profile",
  {
    id: text().primaryKey(),
    revision: integer().notNull(),
    name: text().notNull(),
    data: text({ mode: "json" }).$type<Jarvis.ProfileSnapshot>().notNull(),
    primary: integer({ mode: "boolean" }).notNull().default(false),
    ...Timestamps,
  },
  (table) => [index("jarvis_profile_primary_idx").on(table.primary)],
)

export const JarvisGoalTable = sqliteTable(
  "jarvis_goal",
  {
    id: text().primaryKey(),
    profile_id: text().notNull(),
    session_id: text(),
    mode: text().$type<Jarvis.Mode>().notNull(),
    game_id: text(),
    save_slot_id: text(),
    character_id: text(),
    objective: text().notNull(),
    status: text().$type<Jarvis.Goal["status"]>().notNull(),
    suspension_reason: text(),
    world_revision: integer(),
    capability_revision: text(),
    action_count: integer().notNull().default(0),
    cycle_started_at: integer(),
    plan: text({ mode: "json" }).$type<Jarvis.Plan>(),
    ...Timestamps,
  },
  (table) => [
    index("jarvis_goal_profile_status_idx").on(table.profile_id, table.status),
    index("jarvis_goal_session_idx").on(table.session_id),
  ],
)

export const JarvisPlanStepTable = sqliteTable(
  "jarvis_plan_step",
  {
    id: text().primaryKey(),
    goal_id: text()
      .notNull()
      .references(() => JarvisGoalTable.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    action: text().notNull(),
    arguments: text({ mode: "json" }).$type<Jarvis.PlanStep["arguments"]>().notNull(),
    expected_postconditions: text({ mode: "json" }).$type<readonly string[]>().notNull(),
    status: text().$type<Jarvis.PlanStep["status"]>().notNull(),
    attempts: integer().notNull().default(0),
    last_error: text(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("jarvis_plan_step_goal_position_idx").on(table.goal_id, table.position)],
)

export const JarvisGoalOutcomeTable = sqliteTable(
  "jarvis_goal_outcome",
  {
    id: text().primaryKey(),
    goal_id: text()
      .notNull()
      .references(() => JarvisGoalTable.id, { onDelete: "cascade" }),
    status: text().$type<Jarvis.GoalOutcome["status"]>().notNull(),
    summary: text().notNull(),
    changed_entity_ids: text({ mode: "json" }).$type<readonly string[]>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("jarvis_goal_outcome_goal_idx").on(table.goal_id)],
)

export const JarvisMemoryTable = sqliteTable(
  "jarvis_memory",
  {
    id: text().primaryKey(),
    profile_id: text(),
    scope: text().$type<Jarvis.MemoryRecord["scope"]>().notNull(),
    game_id: text(),
    save_slot_id: text(),
    character_id: text(),
    kind: text().$type<Jarvis.MemoryRecord["kind"]>().notNull(),
    body: text().notNull(),
    source_id: text().notNull(),
    confidence: real().notNull(),
    importance: real().notNull(),
    lifecycle: text().$type<Jarvis.MemoryRecord["lifecycle"]>().notNull(),
    pinned: integer({ mode: "boolean" }).notNull().default(false),
    conflicts_with: text({ mode: "json" }).$type<readonly string[]>().notNull(),
    embedding: text({ mode: "json" }).$type<readonly number[]>(),
    embedding_model: text({ mode: "json" }).$type<Jarvis.ModelRef>(),
    last_used_at: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("jarvis_memory_source_idx").on(table.source_id),
    index("jarvis_memory_scope_profile_idx").on(table.scope, table.profile_id),
    index("jarvis_memory_game_scope_idx").on(table.game_id, table.save_slot_id, table.character_id),
  ],
)

export const JarvisWakeTable = sqliteTable(
  "jarvis_wake",
  {
    id: text().primaryKey(),
    profile_id: text().notNull(),
    session_id: text(),
    kind: text().$type<Jarvis.WakeCandidate["kind"]>().notNull(),
    topic: text().notNull(),
    body: text().notNull(),
    priority: integer().notNull(),
    status: text().$type<Jarvis.WakeCandidate["status"]>().notNull(),
    not_before: integer().notNull(),
    blocked_reason: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("jarvis_wake_status_time_idx").on(table.status, table.not_before)],
)

export const JarvisTurnTable = sqliteTable(
  "jarvis_turn",
  {
    id: text().primaryKey(),
    request_id: text().notNull(),
    session_id: text().notNull(),
    profile_id: text(),
    surface: text().$type<Jarvis.Surface>().notNull(),
    response_mode: text().$type<Jarvis.Turn["responseMode"]>().notNull(),
    phase: text().$type<Jarvis.TurnPhase>().notNull(),
    sequence: integer().notNull().default(0),
    presentation: text({ mode: "json" }).$type<Jarvis.PresentationCue>(),
    metrics: text({ mode: "json" }).$type<Jarvis.TurnMetrics>().notNull(),
    error: text(),
    cancel_reason: text(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("jarvis_turn_request_idx").on(table.request_id),
    index("jarvis_turn_session_time_idx").on(table.session_id, table.time_updated),
    index("jarvis_turn_phase_idx").on(table.phase),
  ],
)

export const JarvisPresenceTable = sqliteTable("jarvis_presence", {
  id: integer().primaryKey(),
  data: text({ mode: "json" }).$type<Jarvis.Presence>().notNull(),
  time_updated: integer().notNull(),
})

export const JarvisConversationTable = sqliteTable("jarvis_conversation", {
  id: integer().primaryKey(),
  session_id: text().notNull(),
  profile_id: text(),
  profile_revision: integer(),
  recovered_at: integer(),
  time_updated: integer().notNull(),
})

export const JarvisMediaStateTable = sqliteTable("jarvis_media_state", {
  id: text().primaryKey(),
  turn_id: text(),
  owner: text(),
  state: text().notNull(),
  queued_sentences: integer().notNull(),
  active_jobs: integer().notNull(),
  acknowledged_cancellation: integer({ mode: "boolean" }).notNull(),
  time_updated: integer().notNull(),
})

export const JarvisMemoryUseTable = sqliteTable(
  "jarvis_memory_use",
  {
    id: text().primaryKey(),
    turn_id: text()
      .notNull()
      .references(() => JarvisTurnTable.id, { onDelete: "cascade" }),
    memory_id: text().notNull(),
    rank: integer().notNull(),
    lexical_score: real().notNull(),
    semantic_score: real().notNull(),
    reason: text().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [
    uniqueIndex("jarvis_memory_use_turn_memory_idx").on(table.turn_id, table.memory_id),
    index("jarvis_memory_use_memory_idx").on(table.memory_id, table.time_created),
  ],
)

export const JarvisMemoryTombstoneTable = sqliteTable("jarvis_memory_tombstone", {
  source_id: text().primaryKey(),
  time_created: integer().notNull(),
})

export const JarvisReplayTable = sqliteTable(
  "jarvis_replay",
  {
    id: text().primaryKey(),
    turn_id: text(),
    session_id: text(),
    surface: text().$type<Jarvis.Surface>().notNull(),
    status: text().$type<Jarvis.ReplayRun["status"]>().notNull(),
    events: text({ mode: "json" }).$type<readonly Jarvis.ReplayEvent[]>().notNull(),
    metrics: text({ mode: "json" }).$type<Jarvis.TurnMetrics>().notNull(),
    error: text(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("jarvis_replay_turn_idx").on(table.turn_id),
    index("jarvis_replay_time_idx").on(table.time_created),
  ],
)

export const JarvisReplayExecutionTable = sqliteTable(
  "jarvis_replay_execution",
  {
    id: text().primaryKey(),
    replay_id: text().notNull(),
    status: text().$type<Jarvis.ReplayExecution["status"]>().notNull(),
    fixture_only: integer({ mode: "boolean" }).notNull().default(true),
    assertions: text({ mode: "json" }).$type<readonly Jarvis.ReplayAssertion[]>().notNull(),
    metrics: text({ mode: "json" }).$type<Jarvis.TurnMetrics>().notNull(),
    error: text(),
    ...Timestamps,
  },
  (table) => [index("jarvis_replay_execution_replay_idx").on(table.replay_id, table.time_created)],
)

export const JarvisCompanionConfigTable = sqliteTable("jarvis_companion_config", {
  id: integer().primaryKey(),
  data: text({ mode: "json" }).$type<Jarvis.DailyCompanionConfig>().notNull(),
  time_updated: integer().notNull(),
})

export const JarvisDailyBriefingTable = sqliteTable(
  "jarvis_daily_briefing",
  {
    id: text().primaryKey(),
    local_date: text().notNull(),
    account_id: text().notNull(),
    session_id: text(),
    status: text().$type<Jarvis.DailyBriefing["status"]>().notNull(),
    data: text({ mode: "json" }).$type<Jarvis.DailyBriefing>().notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("jarvis_daily_briefing_day_account_idx").on(table.local_date, table.account_id),
    index("jarvis_daily_briefing_time_idx").on(table.time_created),
  ],
)

export const JarvisDailyBriefingRunTable = sqliteTable(
  "jarvis_daily_briefing_run",
  {
    id: text().primaryKey(),
    briefing_id: text(),
    trigger: text().$type<Jarvis.DailyBriefingRun["trigger"]>().notNull(),
    status: text().$type<Jarvis.DailyBriefingRun["status"]>().notNull(),
    local_date: text().notNull(),
    account_id: text(),
    source_counts: text({ mode: "json" }).$type<Record<string, number>>().notNull(),
    error: text(),
    started_at: integer().notNull(),
    completed_at: integer(),
  },
  (table) => [index("jarvis_daily_briefing_run_time_idx").on(table.started_at)],
)

export const JarvisCompanionActionTable = sqliteTable(
  "jarvis_companion_action",
  {
    id: text().primaryKey(),
    briefing_id: text(),
    kind: text().$type<Jarvis.CompanionActionKind>().notNull(),
    title: text().notNull(),
    preview: text().notNull(),
    access: text().$type<Jarvis.CompanionActionProposal["access"]>().notNull(),
    input: text({ mode: "json" }).$type<Jarvis.CompanionActionProposal["input"]>().notNull(),
    required_scopes: text({ mode: "json" }).$type<readonly string[]>().notNull(),
    idempotency_key: text().notNull(),
    external_revision: text(),
    status: text().$type<Jarvis.CompanionActionProposal["status"]>().notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("jarvis_companion_action_idempotency_idx").on(table.idempotency_key),
    index("jarvis_companion_action_briefing_idx").on(table.briefing_id),
  ],
)

export const JarvisCompanionActionExecutionTable = sqliteTable(
  "jarvis_companion_action_execution",
  {
    id: text().primaryKey(),
    proposal_id: text().notNull(),
    status: text().$type<Jarvis.CompanionActionExecution["status"]>().notNull(),
    result: text({ mode: "json" }).$type<NonNullable<Jarvis.CompanionActionExecution["result"]>>(),
    error: text(),
    ...Timestamps,
  },
  (table) => [index("jarvis_companion_action_execution_proposal_idx").on(table.proposal_id, table.time_created)],
)
