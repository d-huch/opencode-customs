import { describe, expect, test } from "bun:test"
import {
  characterErrorRate,
  compareVoiceRegression,
  createVoiceRegressionReport,
  voiceRegressionHTML,
  wordErrorRate,
  type VoiceRegressionResult,
} from "./voice-regression"

const result = (input: Partial<VoiceRegressionResult> = {}): VoiceRegressionResult => ({
  scenario: {
    id: "uk-question",
    name: "Question",
    language: "uk",
    kind: "roundtrip",
    input: "Як мене звати?",
    expected: "Як мене звати?",
  },
  actual: "Як мене звати",
  passed: true,
  wordErrorRate: 0,
  characterErrorRate: 0,
  languageMatched: true,
  punctuationMatched: false,
  ttsMs: 100,
  sttMs: 200,
  totalMs: 300,
  ...input,
})

describe("voice regression", () => {
  test("normalizes punctuation and case for WER and CER", () => {
    expect(wordErrorRate("Як мене звати?", "як мене звати")).toBe(0)
    expect(characterErrorRate("OpenCode Customs!", "opencode customs")).toBe(0)
  })

  test("measures substitutions, insertions, and deletions", () => {
    expect(wordErrorRate("one two three", "one four three")).toBeCloseTo(1 / 3)
    expect(wordErrorRate("one two", "one two three")).toBeCloseTo(1 / 2)
    expect(wordErrorRate("one two three", "one three")).toBeCloseTo(1 / 3)
  })

  test("summarizes results and compares a baseline", () => {
    const baseline = createVoiceRegressionReport([result({ totalMs: 400 })])
    const current = createVoiceRegressionReport([result({ totalMs: 300 }), result({ passed: false, totalMs: 500 })])
    expect(current.passed).toBe(1)
    expect(current.failed).toBe(1)
    expect(current.medianTotalMs).toBe(400)
    expect(compareVoiceRegression(current, baseline)).toEqual({
      passed: 0,
      wordErrorRate: 0,
      characterErrorRate: 0,
      totalMs: 0,
    })
  })

  test("renders a self-contained HTML report", () => {
    const html = voiceRegressionHTML(createVoiceRegressionReport([result()]))
    expect(html).toContain("OpenCode Customs Voice Regression")
    expect(html).toContain("Як мене звати")
    expect(html).toContain("PASS")
  })
})
