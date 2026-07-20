import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260719120708_durable_execution_budgets",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `ALTER TABLE \`session_execution_checkpoint\` ADD \`evidence_attempts\` integer DEFAULT 0 NOT NULL;`,
      )
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`provider_turns\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`tool_calls\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`compactions\` integer DEFAULT 0 NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
