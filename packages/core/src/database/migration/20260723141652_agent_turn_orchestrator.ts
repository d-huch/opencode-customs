import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260723141652_agent_turn_orchestrator",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`phase\` text DEFAULT 'classify' NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`request_message_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`classifier_turns\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`rag_retrievals\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(
        `ALTER TABLE \`session_execution_checkpoint\` ADD \`memory_retrievals\` integer DEFAULT 0 NOT NULL;`,
      )
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`memory_writes\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(
        `ALTER TABLE \`session_execution_checkpoint\` ADD \`verification_turns\` integer DEFAULT 0 NOT NULL;`,
      )
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`selected_provider_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`selected_model_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`selected_instance_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`repository_context\` text;`)
      yield* tx.run(`ALTER TABLE \`session_execution_checkpoint\` ADD \`memory_context\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
