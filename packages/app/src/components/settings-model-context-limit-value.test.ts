import { describe, expect, test } from "bun:test"
import {
  MAX_CONTEXT_LIMIT,
  MIN_CONTEXT_LIMIT,
  minimumContextLimit,
  parseContextLimit,
} from "./settings-model-context-limit-value"

describe("parseContextLimit", () => {
  test("accepts an integer above the model output budget", () => {
    expect(parseContextLimit("32768", 512)).toBe(32_768)
    expect(parseContextLimit(String(MIN_CONTEXT_LIMIT), 512)).toBe(MIN_CONTEXT_LIMIT)
  })

  test("rejects invalid or unsafe limits", () => {
    expect(parseContextLimit("4096.5", 512)).toBeUndefined()
    expect(parseContextLimit(String(MIN_CONTEXT_LIMIT - 1), 512)).toBeUndefined()
    expect(parseContextLimit("512", 512)).toBeUndefined()
    expect(parseContextLimit(String(MAX_CONTEXT_LIMIT + 1), 512)).toBeUndefined()
  })

  test("keeps the context above unusually large output budgets", () => {
    expect(minimumContextLimit(10_000)).toBe(10_001)
    expect(parseContextLimit("10000", 10_000)).toBeUndefined()
    expect(parseContextLimit("10001", 10_000)).toBe(10_001)
  })
})
