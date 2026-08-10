import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260726082237_verification_matrix",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`verification_plan\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
