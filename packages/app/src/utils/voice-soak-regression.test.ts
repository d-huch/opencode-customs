import { describe, expect, test } from "bun:test"
import { runVoiceSoakRegression, voiceSoakRegressionHTML } from "./voice-soak-regression"

describe("voice soak regression", () => {
  test("survives a long deterministic sequence without leaking state", () => {
    const report = runVoiceSoakRegression({ turns: 500, seed: 42, batchSize: 50 })

    expect(report.passed).toBe(500)
    expect(report.failed).toBe(0)
    expect(report.stateLeaks).toBe(0)
    expect(report.finalState).toBe("idle")
    expect(report.batches).toHaveLength(10)
    expect(report.staleCallbacksRejected).toBeGreaterThan(0)
    expect(report.duplicateFinalsRejected).toBeGreaterThan(0)
    expect(report.unrelatedResponsesRejected).toBeGreaterThan(0)
    expect(report.recoveredTurns).toBeGreaterThan(0)
    expect(report.interruptedTurns).toBeGreaterThan(0)
  })

  test("uses the seed to reproduce the same chaos schedule", () => {
    const first = runVoiceSoakRegression({ turns: 90, seed: 7, batchSize: 30 })
    const second = runVoiceSoakRegression({ turns: 90, seed: 7, batchSize: 30 })

    expect({ ...first, createdAt: "" }).toEqual({ ...second, createdAt: "" })
  })

  test("exports a standalone report", () => {
    const report = runVoiceSoakRegression({ turns: 18, seed: 1 })
    const html = voiceSoakRegressionHTML(report)

    expect(html).toContain("Voice Soak &amp; Chaos Runner")
    expect(html).toContain("18/18 passed")
    expect(html).toContain("final state idle")
  })
})
