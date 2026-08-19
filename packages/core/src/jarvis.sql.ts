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
