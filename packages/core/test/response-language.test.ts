import { describe, expect, test } from "bun:test"
import { ResponseLanguage } from "../src/response-language"

describe("ResponseLanguage", () => {
  test("anchors the response to the latest genuine request instead of compacted context", () => {
    const instruction = ResponseLanguage.instruction("Чого ти мовчиш?")
    const reminder = ResponseLanguage.reminder("Чого ти мовчиш?")

    expect(instruction).toContain("latest active user request")
    expect(instruction).toContain("English compaction summary")
    expect(instruction).toContain("progress text before and between tool calls")
    expect(instruction).toContain('"Чого ти мовчиш?"')
    expect(reminder).toContain("active user request immediately above")
  })

  test("omits language constraints without a genuine text sample", () => {
    expect(ResponseLanguage.instruction("  ")).toBeUndefined()
    expect(ResponseLanguage.reminder("  ")).toBeUndefined()
  })
})
