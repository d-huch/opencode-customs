import { describe, expect, test } from "bun:test"
import { ToolCallRepair } from "@/session/tool-call-repair"

describe("tool call repair", () => {
  test("repairs fenced JSON, trailing commas, and literal controls", () => {
    expect(ToolCallRepair.input('```json\n{"pattern":"journal\nsick",}\n```')).toBe(
      JSON.stringify({ pattern: "journal\nsick" }),
    )
  })

  test("does not invent the missing end of a truncated string", () => {
    expect(ToolCallRepair.input('{"pattern":"journal|sick|.')).toBeUndefined()
  })

  test("does not rewrite valid JSON or non-object inputs", () => {
    expect(ToolCallRepair.input('{"pattern":"journal"}')).toBeUndefined()
    expect(ToolCallRepair.input('["journal",]')).toBeUndefined()
  })
})
