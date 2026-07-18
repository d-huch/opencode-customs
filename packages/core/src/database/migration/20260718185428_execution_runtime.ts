import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260718185428_execution_runtime",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`runtime\` text DEFAULT 'v2' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
