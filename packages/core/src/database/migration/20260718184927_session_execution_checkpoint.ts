import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260718184927_session_execution_checkpoint",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_execution_checkpoint\` (
          \`session_id\` text PRIMARY KEY,
          \`execution_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          \`state\` text NOT NULL,
          \`step\` integer NOT NULL,
          \`assistant_message_id\` text,
          \`owner_pid\` integer NOT NULL,
          \`recoveries\` integer DEFAULT 0 NOT NULL,
          \`error\` text,
          \`time_started\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_completed\` integer,
          CONSTRAINT \`fk_session_execution_checkpoint_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_execution_checkpoint_state_idx\` ON \`session_execution_checkpoint\` (\`state\`,\`time_updated\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
