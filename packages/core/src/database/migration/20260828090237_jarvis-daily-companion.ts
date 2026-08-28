import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260828090237_jarvis-daily-companion",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`jarvis_companion_action_execution\` (
          \`id\` text PRIMARY KEY,
          \`proposal_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`result\` text,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_companion_action\` (
          \`id\` text PRIMARY KEY,
          \`briefing_id\` text,
          \`kind\` text NOT NULL,
          \`title\` text NOT NULL,
          \`preview\` text NOT NULL,
          \`access\` text NOT NULL,
          \`input\` text NOT NULL,
          \`required_scopes\` text NOT NULL,
          \`idempotency_key\` text NOT NULL,
          \`external_revision\` text,
          \`status\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_companion_config\` (
          \`id\` integer PRIMARY KEY,
          \`data\` text NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_daily_briefing_run\` (
          \`id\` text PRIMARY KEY,
          \`briefing_id\` text,
          \`trigger\` text NOT NULL,
          \`status\` text NOT NULL,
          \`local_date\` text NOT NULL,
          \`account_id\` text,
          \`source_counts\` text NOT NULL,
          \`error\` text,
          \`started_at\` integer NOT NULL,
          \`completed_at\` integer
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`jarvis_daily_briefing\` (
          \`id\` text PRIMARY KEY,
          \`local_date\` text NOT NULL,
          \`account_id\` text NOT NULL,
          \`session_id\` text,
          \`status\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`jarvis_companion_action_execution_proposal_idx\` ON \`jarvis_companion_action_execution\` (\`proposal_id\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`jarvis_companion_action_idempotency_idx\` ON \`jarvis_companion_action\` (\`idempotency_key\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`jarvis_companion_action_briefing_idx\` ON \`jarvis_companion_action\` (\`briefing_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`jarvis_daily_briefing_run_time_idx\` ON \`jarvis_daily_briefing_run\` (\`started_at\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`jarvis_daily_briefing_day_account_idx\` ON \`jarvis_daily_briefing\` (\`local_date\`,\`account_id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`jarvis_daily_briefing_time_idx\` ON \`jarvis_daily_briefing\` (\`time_created\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
