export const MAX_CONTEXT_LIMIT = 1_048_576

export function parseContextLimit(value: string, output: number) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return
  if (parsed <= output) return
  if (parsed > MAX_CONTEXT_LIMIT) return
  return parsed
}
