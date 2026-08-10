import type { LanguageModelV3Middleware, LanguageModelV3StreamPart } from "@ai-sdk/provider"

export * as ToolCallRepair from "./tool-call-repair"

export const instruction =
  "Call only tools exposed in the current request and use their exact names. Never invent a tool name or print a serialized tool-call envelope as assistant text. Tool arguments must be one complete JSON object matching the provided schema. Never put a JSON object inside a string field or add regex delimiters around a search pattern. A malformed, unavailable, or repeated tool call is blocked before execution; do not retry it under another name."

type SerializedToolCall = {
  readonly id: string
  readonly index?: number
  readonly type: "function"
  readonly function: {
    readonly name: string
    readonly arguments: string | Record<string, unknown>
  }
}

type TextBlock = {
  readonly start: Extract<LanguageModelV3StreamPart, { type: "text-start" }>
  pending: string
  visible: boolean
  capturing: boolean
}

export function compatibilityMiddleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      const blocks = new Map<string, TextBlock>()
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(chunk, controller) {
              if (chunk.type === "text-start") {
                blocks.set(chunk.id, { start: chunk, pending: "", visible: false, capturing: false })
                return
              }
              if (chunk.type === "text-delta") {
                const block = blocks.get(chunk.id)
                if (!block) {
                  controller.enqueue(chunk)
                  return
                }
                block.pending += chunk.delta
                if (block.capturing) return
                const candidate = serializedCandidate(block.pending)
                if (candidate !== undefined) {
                  emitText(block, block.pending.slice(0, candidate), controller)
                  block.pending = block.pending.slice(candidate)
                  block.capturing = true
                  return
                }
                if (block.pending.length <= 512) return
                emitText(block, block.pending.slice(0, -256), controller)
                block.pending = block.pending.slice(-256)
                return
              }
              if (chunk.type === "text-end") {
                const block = blocks.get(chunk.id)
                if (!block) {
                  controller.enqueue(chunk)
                  return
                }
                const recovered = block.capturing ? serializedOutput(block.pending) : undefined
                if (block.capturing && !recovered) {
                  blocks.delete(chunk.id)
                  controller.error(
                    new Error("Model emitted a malformed serialized tool call. The call was blocked before execution."),
                  )
                  return
                }
                if (!recovered) emitText(block, block.pending, controller)
                if (recovered) emitText(block, recovered.text, controller)
                if (block.visible) controller.enqueue(chunk)
                for (const call of recovered?.calls ?? []) {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: call.id,
                    toolName: call.function.name,
                    input:
                      typeof call.function.arguments === "string"
                        ? call.function.arguments
                        : JSON.stringify(call.function.arguments),
                  })
                }
                blocks.delete(chunk.id)
                return
              }
              controller.enqueue(chunk)
            },
          }),
        ),
      }
    },
  }
}

function emitText(
  block: TextBlock,
  text: string,
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
) {
  if (!text) return
  if (!block.visible) {
    controller.enqueue(block.start)
    block.visible = true
  }
  controller.enqueue({
    type: "text-delta",
    id: block.start.id,
    delta: text,
    providerMetadata: block.start.providerMetadata,
  })
}

function serializedCandidate(text: string) {
  const match = /(?:^|\n)[ \t]*(?=\[\s*\{\s*"id"\s*:[\s\S]{0,8192}?"function"\s*:)/g.exec(text)
  if (!match) return
  return match.index + (match[0].startsWith("\n") ? 1 : 0)
}

function serializedOutput(text: string) {
  const start = serializedCandidate(text)
  if (start === undefined) return
  const calls: SerializedToolCall[] = []
  const input = text.slice(start)
  let offset = 0
  while (offset < input.length) {
    while (/\s/.test(input[offset] ?? "")) offset++
    if (offset >= input.length) break
    if (input[offset] !== "[") return
    const end = jsonArrayEnd(input, offset)
    if (end === undefined) return
    const parsed = parseJSON(input.slice(offset, end))
    if (!Array.isArray(parsed) || !parsed.every(isSerializedToolCall)) return
    calls.push(...parsed)
    offset = end
  }
  if (calls.length === 0) return
  const latest = new Map(calls.map((call) => [call.id, call]))
  return {
    text: text.slice(0, start),
    calls: [...latest.values()].toSorted((left, right) => (left.index ?? 0) - (right.index ?? 0)),
  }
}

function parseJSON(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return
  }
}

function jsonArrayEnd(text: string, start: number) {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\" && quoted) {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (character === "[" || character === "{") depth++
    if (character === "]" || character === "}") depth--
    if (depth === 0) return index + 1
    if (depth < 0) return
  }
}

function isSerializedToolCall(value: unknown): value is SerializedToolCall {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (typeof item.id !== "string" || item.type !== "function") return false
  if (!item.function || typeof item.function !== "object" || Array.isArray(item.function)) return false
  const fn = item.function as Record<string, unknown>
  if (typeof fn.name !== "string" || !fn.name) return false
  return typeof fn.arguments === "string" || (!!fn.arguments && typeof fn.arguments === "object")
}

export function input(value: unknown) {
  if (typeof value !== "string" || value.length > 64 * 1024) return
  const trimmed = value.trim()
  if (!trimmed) return
  try {
    JSON.parse(trimmed)
    return
  } catch {
    // Only repair syntax that preserves every value emitted by the model.
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed
  let quoted = false
  let escaped = false
  const controls = [...fenced]
    .map((character) => {
      if (escaped) {
        escaped = false
        return character
      }
      if (character === "\\" && quoted) {
        escaped = true
        return character
      }
      if (character === '"') {
        quoted = !quoted
        return character
      }
      if (!quoted) return character
      if (character === "\n") return "\\n"
      if (character === "\r") return "\\r"
      if (character === "\t") return "\\t"
      return character
    })
    .join("")
  if (quoted || escaped) return

  const repaired = controls.replace(/,(\s*[}\]])/g, "$1")
  if (repaired === trimmed) return
  try {
    const parsed: unknown = JSON.parse(repaired)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return
    return JSON.stringify(parsed)
  } catch {
    return
  }
}
