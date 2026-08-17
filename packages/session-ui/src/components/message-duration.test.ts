import { describe, expect, test } from "bun:test"
import type { UiI18n } from "@opencode-ai/ui/context/i18n"
import { elapsedMilliseconds, formatCompactDuration } from "./message-duration"

const i18n = {
  locale: () => "en",
  t: (key, params) => {
    if (key === "ui.message.duration.seconds") return `${params?.count}s`
    if (key === "ui.message.duration.minutesSeconds") return `${params?.minutes}m ${params?.seconds}s`
    return key
  },
} as UiI18n

describe("message duration", () => {
  test("uses the live clock until an end time is available", () => {
    expect(elapsedMilliseconds(1_000, undefined, 8_000)).toBe(7_000)
    expect(elapsedMilliseconds(1_000, 5_000, 8_000)).toBe(4_000)
  })

  test("rejects invalid and reversed timing", () => {
    expect(elapsedMilliseconds(Number.NaN, undefined, 8_000)).toBeUndefined()
    expect(elapsedMilliseconds(8_000, 7_000, 9_000)).toBeUndefined()
  })

  test("formats seconds and longer durations compactly", () => {
    expect(formatCompactDuration(i18n, 7_400)).toBe("7s")
    expect(formatCompactDuration(i18n, 67_000)).toBe("1m 7s")
    expect(formatCompactDuration(i18n, -1)).toBe("")
  })
})
