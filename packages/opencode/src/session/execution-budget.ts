export * as SessionExecutionBudget from "./execution-budget"

import type { SessionExecutionCheckpoint } from "@opencode-ai/core/session/execution-checkpoint"

export const limits = {
  classifier_turns: 1,
  rag_retrievals: 1,
  memory_retrievals: 1,
  memory_writes: 1,
  verification_turns: 3,
  critic_turns: 1,
  provider_turns: 12,
  tool_calls: 32,
  compactions: 12,
} as const satisfies Partial<Record<SessionExecutionCheckpoint.Counter, number>>

export function message(counter: keyof typeof limits, limit = limits[counter]) {
  const label =
    counter === "classifier_turns"
      ? "classification turns"
      : counter === "rag_retrievals"
        ? "RAG retrievals"
        : counter === "memory_retrievals"
          ? "memory retrievals"
          : counter === "memory_writes"
            ? "memory writes"
            : counter === "verification_turns"
              ? "verification turns"
              : counter === "critic_turns"
                ? "critic turns"
              : counter === "provider_turns"
                ? "provider turns"
                : counter === "tool_calls"
                  ? "tool calls"
                  : "context compactions"
  return `Execution stopped after reaching the per-request limit of ${limit} ${label}. Start a new request to continue.`
}
