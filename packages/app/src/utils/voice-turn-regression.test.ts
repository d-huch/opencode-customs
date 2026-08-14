import { describe, expect, test } from "bun:test"
import { runVoiceTurnRegression, voiceTurnRegressionHTML } from "./voice-turn-regression"

describe("voice turn recovery regression", () => {
  test("covers the complete turn and recovery boundaries without stale work", () => {
    const report = runVoiceTurnRegression()

    expect(report.results).toHaveLength(9)
    expect(report.passed).toBe(9)
    expect(report.failed).toBe(0)
    expect(report.staleCallbacksRejected).toBe(3)
    expect(report.duplicateFinalsRejected).toBe(1)
    expect(report.unrelatedResponsesRejected).toBe(1)
    expect(report.recoveredToIdle).toBe(3)
  })

  test("exports a standalone evidence report", () => {
    const html = voiceTurnRegressionHTML(runVoiceTurnRegression())

    expect(html).toContain("Voice Turn Recovery Runner")
    expect(html).toContain("renderer-restart")
    expect(html).toContain("PASS")
  })
})
