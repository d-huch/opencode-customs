import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260817125441_jarvis-settings-runtime",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`jarvis_memory\` ADD \`embedding_model\` text;`)
      yield* tx.run(`ALTER TABLE \`jarvis_wake\` ADD \`blocked_reason\` text;`)
      yield* tx.run(`ALTER TABLE \`jarvis_wake\` ADD \`time_updated\` integer NOT NULL DEFAULT 0;`)
      yield* tx.run(`UPDATE \`jarvis_wake\` SET \`time_updated\` = \`time_created\` WHERE \`time_updated\` = 0;`)
    })
  },
} satisfies DatabaseMigration.Migration
