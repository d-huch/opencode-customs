import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260726085033_critic_pass",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`critic_turns\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`critic_pass\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
