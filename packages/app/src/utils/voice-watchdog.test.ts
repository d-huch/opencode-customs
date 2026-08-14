import { describe, expect, test } from "bun:test"
import { inspectVoiceWatchdog } from "./voice-watchdog"

describe("voice watchdog", () => {
  test("reports a stuck bounded phase", () => {
    expect(inspectVoiceWatchdog({ state: "transcribing", changedAt: 1_000 }, 50_001)).toEqual({
      state: "transcribing",
      elapsedMs: 49_001,
      limitMs: 45_000,
    })
  })

  test("does not time out continuous listening or an active bounded phase", () => {
    expect(inspectVoiceWatchdog({ state: "listening", changedAt: 0 }, 999_999)).toBeUndefined()
    expect(inspectVoiceWatchdog({ state: "thinking", changedAt: 10_000 }, 20_000)).toBeUndefined()
  })

  test("supports deterministic thresholds for regression tests", () => {
    expect(
      inspectVoiceWatchdog({ state: "speaking", changedAt: 100 }, 201, {
        speaking: 100,
      }),
    ).toEqual({ state: "speaking", elapsedMs: 101, limitMs: 100 })
  })
})
