import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260726074759_change_risk_assessment",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`risk_assessment\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
