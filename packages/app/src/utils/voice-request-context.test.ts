import { beforeEach, describe, expect, test } from "bun:test"
import { clearVoiceRequestContext, stageVoiceRequestContext, takeVoiceRequestContext } from "./voice-request-context"

describe("voice request context", () => {
  beforeEach(clearVoiceRequestContext)

  test("is consumed exactly once by the matching transcript", () => {
    stageVoiceRequestContext("Привіт", "hidden", 1_000)
    expect(takeVoiceRequestContext("Інше", 1_001)).toBeUndefined()
    expect(takeVoiceRequestContext("Привіт", 1_002)).toBe("hidden")
    expect(takeVoiceRequestContext("Привіт", 1_003)).toBeUndefined()
  })

  test("expires stale context", () => {
    stageVoiceRequestContext("Привіт", "hidden", 1_000)
    expect(takeVoiceRequestContext("Привіт", 121_001)).toBeUndefined()
  })
})
