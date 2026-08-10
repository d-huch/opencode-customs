import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260725183114_tidy_iron_man",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`pipeline_state\` text DEFAULT '[]' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
