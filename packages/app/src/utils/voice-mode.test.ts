import { describe, expect, test } from "bun:test"
import { applyVoiceMaster, applyVoiceMode, resolveVoiceMode } from "./voice-mode"

describe("voice mode", () => {
  test("resolves all supported modes", () => {
    expect(resolveVoiceMode({ enabled: true, listeningEnabled: true, speakResponses: true })).toBe("full")
    expect(resolveVoiceMode({ enabled: true, listeningEnabled: true, speakResponses: false })).toBe("listen")
    expect(resolveVoiceMode({ enabled: true, listeningEnabled: false, speakResponses: true })).toBe("speak")
    expect(resolveVoiceMode({ enabled: false, listeningEnabled: true, speakResponses: true })).toBe("off")
  })

  test("off preserves channel preferences for master restore", () => {
    expect(applyVoiceMode("off", { listeningEnabled: true, speakResponses: false })).toEqual({
      enabled: false,
      listeningEnabled: true,
      speakResponses: false,
    })
  })

  test("maps explicit modes atomically", () => {
    const current = { listeningEnabled: false, speakResponses: false }
    expect(applyVoiceMode("full", current)).toEqual({ enabled: true, listeningEnabled: true, speakResponses: true })
    expect(applyVoiceMode("listen", current)).toEqual({ enabled: true, listeningEnabled: true, speakResponses: false })
    expect(applyVoiceMode("speak", current)).toEqual({ enabled: true, listeningEnabled: false, speakResponses: true })
  })

  test("restores channel preferences when the master switch is enabled", () => {
    expect(applyVoiceMaster(false, { listeningEnabled: true, speakResponses: false })).toEqual({
      enabled: false,
      listeningEnabled: true,
      speakResponses: false,
    })
    expect(applyVoiceMaster(true, { listeningEnabled: true, speakResponses: false })).toEqual({
      enabled: true,
      listeningEnabled: true,
      speakResponses: false,
    })
    expect(applyVoiceMaster(true, { listeningEnabled: false, speakResponses: false })).toEqual({
      enabled: true,
      listeningEnabled: true,
      speakResponses: true,
    })
  })
})
