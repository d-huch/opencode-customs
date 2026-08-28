import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260824211118_jarvis-live-alpha",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`jarvis_memory_tombstone\` (
          \`source_id\` text PRIMARY KEY,
          \`time_created\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_memory_use\` (
          \`id\` text PRIMARY KEY,
          \`turn_id\` text NOT NULL,
          \`memory_id\` text NOT NULL,
          \`rank\` integer NOT NULL,
          \`lexical_score\` real NOT NULL,
          \`semantic_score\` real NOT NULL,
          \`reason\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_jarvis_memory_use_turn_id_jarvis_turn_id_fk\` FOREIGN KEY (\`turn_id\`) REFERENCES \`jarvis_turn\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_presence\` (
          \`id\` integer PRIMARY KEY,
          \`data\` text NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_replay\` (
          \`id\` text PRIMARY KEY,
          \`turn_id\` text,
          \`session_id\` text,
          \`surface\` text NOT NULL,
          \`status\` text NOT NULL,
          \`events\` text NOT NULL,
          \`metrics\` text NOT NULL,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_turn\` (
          \`id\` text PRIMARY KEY,
          \`request_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`profile_id\` text,
          \`surface\` text NOT NULL,
          \`response_mode\` text NOT NULL,
          \`phase\` text NOT NULL,
          \`sequence\` integer DEFAULT 0 NOT NULL,
          \`presentation\` text,
          \`metrics\` text NOT NULL,
          \`error\` text,
          \`cancel_reason\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`jarvis_memory_use_turn_memory_idx\` ON \`jarvis_memory_use\` (\`turn_id\`,\`memory_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`jarvis_memory_use_memory_idx\` ON \`jarvis_memory_use\` (\`memory_id\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE UNIQUE INDEX \`jarvis_replay_turn_idx\` ON \`jarvis_replay\` (\`turn_id\`);`)
      yield* tx.run(`CREATE INDEX \`jarvis_replay_time_idx\` ON \`jarvis_replay\` (\`time_created\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`jarvis_turn_request_idx\` ON \`jarvis_turn\` (\`request_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`jarvis_turn_session_time_idx\` ON \`jarvis_turn\` (\`session_id\`,\`time_updated\`);`,
      )
      yield* tx.run(`CREATE INDEX \`jarvis_turn_phase_idx\` ON \`jarvis_turn\` (\`phase\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
