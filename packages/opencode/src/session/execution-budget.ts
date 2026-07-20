export * as SessionExecutionBudget from "./execution-budget"

import type { SessionExecutionCheckpoint } from "@opencode-ai/core/session/execution-checkpoint"

export const limits = {
  provider_turns: 32,
  tool_calls: 64,
  compactions: 12,
} as const satisfies Partial<Record<SessionExecutionCheckpoint.Counter, number>>

export function message(counter: keyof typeof limits, limit = limits[counter]) {
  const label =
    counter === "provider_turns" ? "provider turns" : counter === "tool_calls" ? "tool calls" : "context compactions"
  return `Execution stopped after reaching the per-request limit of ${limit} ${label}. Start a new request to continue.`
}
