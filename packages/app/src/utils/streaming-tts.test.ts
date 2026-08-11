import { describe, expect, test } from "bun:test"
import { localTTSWebSocketURL } from "./streaming-tts"

describe("streaming TTS", () => {
  test("derives a local websocket endpoint", () => {
    expect(localTTSWebSocketURL("http://127.0.0.1:8880/v1/audio/speech")).toBe(
      "ws://127.0.0.1:8880/v1/audio/speech/stream",
    )
    expect(localTTSWebSocketURL("https://localhost:8880/custom?ignored=true")).toBe(
      "wss://localhost:8880/v1/audio/speech/stream",
    )
  })

  test("rejects non-local endpoints", () => {
    expect(() => localTTSWebSocketURL("https://example.com/v1/audio/speech")).toThrow("localhost")
    expect(() => localTTSWebSocketURL("file:///tmp/speech")).toThrow("localhost")
  })
})
