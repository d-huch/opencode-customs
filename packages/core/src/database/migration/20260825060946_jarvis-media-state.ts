import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260825060946_jarvis-media-state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`jarvis_media_state\` (
          \`id\` text PRIMARY KEY,
          \`turn_id\` text,
          \`owner\` text,
          \`state\` text NOT NULL,
          \`queued_sentences\` integer NOT NULL,
          \`active_jobs\` integer NOT NULL,
          \`acknowledged_cancellation\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
