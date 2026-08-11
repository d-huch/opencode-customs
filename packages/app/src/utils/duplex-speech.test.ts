import { describe, expect, test } from "bun:test"
import { localSTTWebSocketURL, resamplePCM16 } from "./duplex-speech"

describe("duplex speech", () => {
  test("derives the local streaming endpoint from the configured TTS endpoint", () => {
    expect(localSTTWebSocketURL("http://127.0.0.1:8880/v1/audio/speech")).toBe(
      "ws://127.0.0.1:8880/v1/audio/transcriptions/stream",
    )
    expect(localSTTWebSocketURL("https://localhost:8880/custom?token=ignored")).toBe(
      "wss://localhost:8880/v1/audio/transcriptions/stream",
    )
    expect(() => localSTTWebSocketURL("https://example.com/v1/audio/speech")).toThrow("localhost")
  })

  test("resamples and clamps microphone frames to 16-bit PCM", () => {
    const output = resamplePCM16(new Float32Array([-2, -0.5, 0, 0.5, 2]), 48_000, 16_000)
    expect(output.length).toBe(2)
    expect(output[0]).toBe(-32767)
    expect(output[1]).toBe(32767)
  })
})
