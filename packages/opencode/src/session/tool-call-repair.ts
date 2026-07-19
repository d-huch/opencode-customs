export * as ToolCallRepair from "./tool-call-repair"

export const instruction =
  "Tool arguments must be one complete JSON object matching the provided schema. Never put a JSON object inside a string field or add regex delimiters around a search pattern. If malformed arguments are rejected, retry that tool at most once with complete JSON, then stop and report the limitation."

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
