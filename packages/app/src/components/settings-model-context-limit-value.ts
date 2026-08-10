import { ModelV2 } from "@opencode-ai/core/model"

export const MIN_CONTEXT_LIMIT = ModelV2.MIN_CONTEXT_LIMIT
export const MAX_CONTEXT_LIMIT = 1_048_576

export function minimumContextLimit(output: number) {
  return Math.max(MIN_CONTEXT_LIMIT, output + 1)
}

export function parseContextLimit(value: string, output: number) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return
  if (parsed < minimumContextLimit(output)) return
  if (parsed > MAX_CONTEXT_LIMIT) return
  return parsed
}
