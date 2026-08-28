import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260825054554_jarvis-live-runtime",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`jarvis_conversation\` (
          \`id\` integer PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`profile_id\` text,
          \`profile_revision\` integer,
          \`recovered_at\` integer,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_replay_execution\` (
          \`id\` text PRIMARY KEY,
          \`replay_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`fixture_only\` integer DEFAULT true NOT NULL,
          \`assertions\` text NOT NULL,
          \`metrics\` text NOT NULL,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`jarvis_replay_execution_replay_idx\` ON \`jarvis_replay_execution\` (\`replay_id\`,\`time_created\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
