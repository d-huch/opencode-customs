import { describe, expect, test } from "bun:test"
import { adaptivePrebufferFrames, resamplePlaybackPCM } from "./gapless-audio-player"

describe("gapless audio player", () => {
  test("starts with a short interactive prebuffer", () => {
    expect(adaptivePrebufferFrames(48_000, 0)).toBe(5_760)
  })

  test("increases buffering after underruns and keeps it bounded", () => {
    expect(adaptivePrebufferFrames(48_000, 2)).toBe(9_600)
    expect(adaptivePrebufferFrames(48_000, 100)).toBe(15_360)
  })

  test("converts and resamples raw PCM without decoding WAV containers", () => {
    const output = resamplePlaybackPCM(new Int16Array([-32768, 0, 32767]), 24_000, 48_000)
    expect(output.length).toBe(6)
    expect(output[0]).toBe(-1)
    expect(output.at(-1)).toBeCloseTo(1, 4)
  })
})
