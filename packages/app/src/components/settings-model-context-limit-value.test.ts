import { describe, expect, test } from "bun:test"
import { MAX_CONTEXT_LIMIT, parseContextLimit } from "./settings-model-context-limit-value"

describe("parseContextLimit", () => {
  test("accepts an integer above the model output budget", () => {
    expect(parseContextLimit("32768", 512)).toBe(32_768)
  })

  test("rejects invalid or unsafe limits", () => {
    expect(parseContextLimit("4096.5", 512)).toBeUndefined()
    expect(parseContextLimit("512", 512)).toBeUndefined()
    expect(parseContextLimit(String(MAX_CONTEXT_LIMIT + 1), 512)).toBeUndefined()
  })
})
