import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260817110142_jarvis_runtime",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`jarvis_config\` (
          \`id\` integer PRIMARY KEY,
          \`data\` text NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_goal_outcome\` (
          \`id\` text PRIMARY KEY,
          \`goal_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`summary\` text NOT NULL,
          \`changed_entity_ids\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_jarvis_goal_outcome_goal_id_jarvis_goal_id_fk\` FOREIGN KEY (\`goal_id\`) REFERENCES \`jarvis_goal\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_goal\` (
          \`id\` text PRIMARY KEY,
          \`profile_id\` text NOT NULL,
          \`session_id\` text,
          \`mode\` text NOT NULL,
          \`game_id\` text,
          \`save_slot_id\` text,
          \`character_id\` text,
          \`objective\` text NOT NULL,
          \`status\` text NOT NULL,
          \`suspension_reason\` text,
          \`world_revision\` integer,
          \`capability_revision\` text,
          \`action_count\` integer DEFAULT 0 NOT NULL,
          \`cycle_started_at\` integer,
          \`plan\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_memory\` (
          \`id\` text PRIMARY KEY,
          \`profile_id\` text,
          \`scope\` text NOT NULL,
          \`game_id\` text,
          \`save_slot_id\` text,
          \`character_id\` text,
          \`kind\` text NOT NULL,
          \`body\` text NOT NULL,
          \`source_id\` text NOT NULL,
          \`confidence\` real NOT NULL,
          \`importance\` real NOT NULL,
          \`lifecycle\` text NOT NULL,
          \`pinned\` integer DEFAULT false NOT NULL,
          \`conflicts_with\` text NOT NULL,
          \`embedding\` text,
          \`last_used_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_plan_step\` (
          \`id\` text PRIMARY KEY,
          \`goal_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`action\` text NOT NULL,
          \`arguments\` text NOT NULL,
          \`expected_postconditions\` text NOT NULL,
          \`status\` text NOT NULL,
          \`attempts\` integer DEFAULT 0 NOT NULL,
          \`last_error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_jarvis_plan_step_goal_id_jarvis_goal_id_fk\` FOREIGN KEY (\`goal_id\`) REFERENCES \`jarvis_goal\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_profile\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer NOT NULL,
          \`name\` text NOT NULL,
          \`data\` text NOT NULL,
          \`primary\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_wake\` (
          \`id\` text PRIMARY KEY,
          \`profile_id\` text NOT NULL,
          \`session_id\` text,
          \`kind\` text NOT NULL,
          \`topic\` text NOT NULL,
          \`body\` text NOT NULL,
          \`priority\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`not_before\` integer NOT NULL,
          \`time_created\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`jarvis_goal_outcome_goal_idx\` ON \`jarvis_goal_outcome\` (\`goal_id\`);`)
      yield* tx.run(`CREATE INDEX \`jarvis_goal_profile_status_idx\` ON \`jarvis_goal\` (\`profile_id\`,\`status\`);`)
      yield* tx.run(`CREATE INDEX \`jarvis_goal_session_idx\` ON \`jarvis_goal\` (\`session_id\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`jarvis_memory_source_idx\` ON \`jarvis_memory\` (\`source_id\`);`)
      yield* tx.run(`CREATE INDEX \`jarvis_memory_scope_profile_idx\` ON \`jarvis_memory\` (\`scope\`,\`profile_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`jarvis_memory_game_scope_idx\` ON \`jarvis_memory\` (\`game_id\`,\`save_slot_id\`,\`character_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`jarvis_plan_step_goal_position_idx\` ON \`jarvis_plan_step\` (\`goal_id\`,\`position\`);`,
      )
      yield* tx.run(`CREATE INDEX \`jarvis_profile_primary_idx\` ON \`jarvis_profile\` (\`primary\`);`)
      yield* tx.run(`CREATE INDEX \`jarvis_wake_status_time_idx\` ON \`jarvis_wake\` (\`status\`,\`not_before\`);`)
      yield* tx.run(
        `CREATE VIRTUAL TABLE IF NOT EXISTS \`jarvis_memory_fts\` USING fts5(\`body\`, content='jarvis_memory', content_rowid='rowid', tokenize='unicode61');`,
      )
      yield* tx.run(
        `CREATE TRIGGER IF NOT EXISTS \`jarvis_memory_fts_insert\` AFTER INSERT ON \`jarvis_memory\` BEGIN INSERT INTO \`jarvis_memory_fts\`(rowid, body) VALUES (new.rowid, new.body); END;`,
      )
      yield* tx.run(
        `CREATE TRIGGER IF NOT EXISTS \`jarvis_memory_fts_delete\` AFTER DELETE ON \`jarvis_memory\` BEGIN INSERT INTO \`jarvis_memory_fts\`(\`jarvis_memory_fts\`, rowid, body) VALUES ('delete', old.rowid, old.body); END;`,
      )
      yield* tx.run(
        `CREATE TRIGGER IF NOT EXISTS \`jarvis_memory_fts_update\` AFTER UPDATE OF \`body\` ON \`jarvis_memory\` BEGIN INSERT INTO \`jarvis_memory_fts\`(\`jarvis_memory_fts\`, rowid, body) VALUES ('delete', old.rowid, old.body); INSERT INTO \`jarvis_memory_fts\`(rowid, body) VALUES (new.rowid, new.body); END;`,
      )
      yield* tx.run(`INSERT INTO \`jarvis_memory_fts\`(\`jarvis_memory_fts\`) VALUES ('rebuild');`)
    })
  },
} satisfies DatabaseMigration.Migration
