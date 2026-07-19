import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260719055409_model_capability_route",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`model_route\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
