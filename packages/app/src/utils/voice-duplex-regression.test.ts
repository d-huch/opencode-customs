import { describe, expect, test } from "bun:test"
import { evaluateDuplexRegression, type DuplexRegressionRawReport } from "./voice-duplex-regression"

const stage = (transcript: string, reference = "", wake?: { matched: boolean; has_command?: boolean }) => ({
  mode: reference ? ("speaking" as const) : ("listening" as const),
  reference,
  transcript,
  wake,
  events: [{ type: "final", input_index: 3 }],
  diagnostics: { recognition_ms: 100 },
})

describe("live duplex regression", () => {
  test("evaluates echo, barge-in, wake, pause, and full-cycle behavior with production rules", () => {
    const wake = stage("Джарвіс покажи останні логи", "", { matched: true, has_command: true })
    const echo = stage("OpenCode Customs відповідає голосом", "OpenCode Customs відповідає голосом")
    const interruption = stage("Зупинись і покажи останні логи", "OpenCode Customs відповідає голосом")
    const report = evaluateDuplexRegression({
      created_at: "2026-08-11T00:00:00Z",
      language: "uk",
      voice: "quality:kateryna",
      total_ms: 900,
      scenarios: [
        { id: "own-tts-echo", name: "echo", stages: [echo] },
        { id: "barge-in", name: "barge", stages: [interruption] },
        { id: "pre-roll", name: "pre-roll", stages: [stage("Як мене звати?")] },
        { id: "internal-pause", name: "pause", stages: [stage("Розкажи мені про Мобі Діка.")] },
        { id: "wake-command", name: "wake", stages: [wake] },
        { id: "background-noise", name: "noise", stages: [stage("")] },
        { id: "full-cycle", name: "cycle", stages: [wake, echo, interruption] },
      ],
    })

    expect(report.passed).toBe(7)
    expect(report.failed).toBe(0)
    expect(report.falseBargeIns).toBe(0)
    expect(report.missedBargeIns).toBe(0)
    expect(report.falseWakes).toBe(0)
    expect(report.missedWakes).toBe(0)
    expect(report.medianEndpointMs).toBe(100)
  })

  test("reports regressions instead of silently accepting them", () => {
    const raw: DuplexRegressionRawReport = {
      created_at: "2026-08-11T00:00:00Z",
      language: "uk",
      voice: "quality:kateryna",
      total_ms: 900,
      scenarios: [
        {
          id: "own-tts-echo",
          name: "echo",
          stages: [stage("Нова команда", "OpenCode Customs відповідає голосом")],
        },
        { id: "barge-in", name: "barge", stages: [stage("і", "OpenCode Customs відповідає голосом")] },
        { id: "wake-command", name: "wake", stages: [stage("")] },
        { id: "background-noise", name: "noise", stages: [stage("фон")] },
      ],
    }

    const report = evaluateDuplexRegression(raw)
    expect(report.failed).toBe(4)
    expect(report.falseBargeIns).toBe(1)
    expect(report.missedBargeIns).toBe(1)
    expect(report.falseWakes).toBe(1)
    expect(report.missedWakes).toBe(1)
  })
})
