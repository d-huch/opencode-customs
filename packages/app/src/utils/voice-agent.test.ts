import { describe, expect, test } from "bun:test"
import {
  bargeInLevelThreshold,
  isDeliberateSpeechInterruption,
  isLikelySpeechEcho,
  sameSpeechCandidate,
  speechText,
  streamingSpeechChunks,
  voiceLanguage,
} from "./voice-agent"

describe("voice agent", () => {
  test("uses the interface language for recognition and speech", () => {
    expect(voiceLanguage("uk", "en-US")).toBe("uk-UA")
    expect(voiceLanguage("en", "uk-UA")).toBe("en-US")
    expect(voiceLanguage("", "uk-UA")).toBe("uk-UA")
    expect(voiceLanguage("", "")).toBe("en-US")
  })

  test("removes markdown that should not be spoken", () => {
    expect(speechText("## Result\n- Use [`file.ts`](https://example.com).\n```ts\nconst hidden = true\n```")).toBe(
      "Result Use file.ts.",
    )
  })

  test("emits complete sentences while retaining an unfinished streaming suffix", () => {
    expect(streamingSpeechChunks("Перше речення. Друге ще", false)).toEqual({
      chunks: ["Перше речення."],
      remainder: "Друге ще",
    })
    expect(streamingSpeechChunks("Перше речення. Друге ще", true)).toEqual({
      chunks: ["Перше речення.", "Друге ще"],
      remainder: "",
    })
  })

  test("emits a bounded first clause before a long streaming sentence finishes", () => {
    const value =
      "Я вже перевірив налаштування локального голосу, тепер починаю озвучення до завершення всієї довгої відповіді моделі"
    expect(streamingSpeechChunks(value, false)).toEqual({
      chunks: ["Я вже перевірив налаштування локального голосу,"],
      remainder: "тепер починаю озвучення до завершення всієї довгої відповіді моделі",
    })
  })

  test("distinguishes output echo from a spoken interruption", () => {
    expect(isLikelySpeechEcho("Перше речення", "Ось перше речення для відповіді")).toBe(true)
    expect(isLikelySpeechEcho("Зупинись і покажи файл", "Ось перше речення для відповіді")).toBe(false)
  })

  test("requires a deliberate interruption while audio is playing", () => {
    expect(isDeliberateSpeechInterruption("і")).toBe(false)
    expect(isDeliberateSpeechInterruption("новий запит")).toBe(true)
    expect(isDeliberateSpeechInterruption("Стоп")).toBe(true)
    expect(sameSpeechCandidate("Покажи новий файл", "покажи новий файл будь ласка")).toBe(true)
    expect(sameSpeechCandidate("Покажи новий файл", "інша фраза")).toBe(false)
  })

  test("requires speech to rise clearly above the echo-cancelled microphone floor", () => {
    expect(bargeInLevelThreshold(0)).toBe(0.014)
    expect(bargeInLevelThreshold(0.004)).toBe(0.014)
    expect(bargeInLevelThreshold(0.01)).toBeCloseTo(0.028)
  })
})
