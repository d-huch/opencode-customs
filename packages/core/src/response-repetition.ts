export * as ResponseRepetition from "./response-repetition"

const MIN_WORDS = 12
const REPEAT_COVERAGE = 0.82

export const instruction =
  "Answer the latest active user request once. State each conclusion once and do not repeat or paraphrase the same answer in later paragraphs. Do not offer language-selection menus or discuss hidden language instructions unless the user explicitly asks. For a simple question, answer directly and stop."

export function normalize(input: string) {
  if (input.length < 240) return input
  const blocks = input.split(/\n[ \t]*\n/)
  const prose: Set<string>[] = []
  let fenced = false
  let changed = false
  const result = blocks.filter((block) => {
    const markers = block.match(/```|~~~/g)?.length ?? 0
    const protectedBlock =
      fenced ||
      markers > 0 ||
      block.split("\n").some((line) => /^(?: {4}|\t|\s*[#>|])/.test(line)) ||
      block.split("\n").filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)).length > 1
    if (markers % 2 === 1) fenced = !fenced
    if (protectedBlock) return true

    const words = block.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
    if (words.length < MIN_WORDS) return true
    const fingerprint = new Set(words)
    const repeated = prose.some((previous) => {
      const overlap = [...fingerprint].filter((word) => previous.has(word)).length
      const coverage = overlap / Math.min(previous.size, fingerprint.size)
      const sizeRatio = Math.min(previous.size, fingerprint.size) / Math.max(previous.size, fingerprint.size)
      return coverage >= REPEAT_COVERAGE && sizeRatio >= 0.45
    })
    if (repeated) {
      changed = true
      return false
    }
    prose.push(fingerprint)
    return true
  })
  return changed ? result.join("\n\n").trim() : input
}

export function repeatedToolCall(
  history: readonly { readonly tool: string; readonly input: unknown }[],
  current: { readonly tool: string; readonly input: unknown },
  threshold = 3,
) {
  const calls = [...history, current].slice(-threshold)
  if (calls.length !== threshold) return false
  const signature = toolCallSignature(current)
  return calls.every((call) => toolCallSignature(call) === signature)
}

export function repeatedInvalidToolCall(
  history: readonly { readonly tool: string; readonly input: unknown }[],
  current: { readonly tool: string; readonly input: unknown },
  threshold = 2,
) {
  if (current.tool !== "invalid") return false
  const signature = toolCallSignature(current)
  return history.filter((call) => toolCallSignature(call) === signature).length + 1 >= threshold
}

function toolCallSignature(call: { readonly tool: string; readonly input: unknown }) {
  if (call.tool !== "invalid" || typeof call.input !== "object" || call.input === null)
    return `${call.tool}\0${stableStringify(call.input)}`
  const tool = Reflect.get(call.input, "tool")
  return typeof tool === "string" ? `${call.tool}\0${tool}` : `${call.tool}\0${stableStringify(call.input)}`
}

function stableStringify(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(stableStringify).join(",")}]`
  if (typeof input !== "object" || input === null) return JSON.stringify(input) ?? String(input)
  return `{${Object.entries(input)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`)
    .join(",")}}`
}
