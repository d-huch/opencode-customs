import { isDeliberateSpeechInterruption, isLikelySpeechEcho, sameSpeechCandidate } from "./voice-agent"

export type DuplexRegressionEvent = {
  type: string
  text?: string
  input_index?: number
  reason?: string
}

export type DuplexRegressionStage = {
  mode: "listening" | "speaking"
  reference: string
  transcript: string
  wake?: {
    matched: boolean
    has_command?: boolean
    error?: string
  }
  events: DuplexRegressionEvent[]
  diagnostics: {
    audio_ms?: number
    pre_roll_ms?: number
    recognition_ms?: number
  }
}

export type DuplexRegressionRawReport = {
  created_at: string
  language: string
  voice: string
  total_ms: number
  scenarios: {
    id: string
    name: string
    stages: DuplexRegressionStage[]
  }[]
}

export type DuplexRegressionResult = {
  id: string
  name: string
  passed: boolean
  transcript: string
  latencyMs: number
  error?: string
}

export type DuplexRegressionReport = {
  createdAt: string
  voice: string
  passed: number
  failed: number
  falseBargeIns: number
  missedBargeIns: number
  falseWakes: number
  missedWakes: number
  medianEndpointMs: number
  totalMs: number
  results: DuplexRegressionResult[]
  raw: DuplexRegressionRawReport
}

export function evaluateDuplexRegression(raw: DuplexRegressionRawReport): DuplexRegressionReport {
  const results = raw.scenarios.map((scenario) => evaluateScenario(scenario))
  return {
    createdAt: raw.created_at,
    voice: raw.voice,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    falseBargeIns: results.some((result) => result.id === "own-tts-echo" && !result.passed) ? 1 : 0,
    missedBargeIns: results.some((result) => result.id === "barge-in" && !result.passed) ? 1 : 0,
    falseWakes: results.some((result) => result.id === "background-noise" && !result.passed) ? 1 : 0,
    missedWakes: results.some((result) => result.id === "wake-command" && !result.passed) ? 1 : 0,
    medianEndpointMs: median(results.map((result) => result.latencyMs)),
    totalMs: raw.total_ms,
    results,
    raw,
  }
}

export function compareDuplexRegression(current: DuplexRegressionReport, baseline?: DuplexRegressionReport) {
  if (!baseline) return
  return {
    passed: current.passed - baseline.passed,
    falseBargeIns: current.falseBargeIns - baseline.falseBargeIns,
    missedBargeIns: current.missedBargeIns - baseline.missedBargeIns,
    falseWakes: current.falseWakes - baseline.falseWakes,
    missedWakes: current.missedWakes - baseline.missedWakes,
    endpointMs: current.medianEndpointMs - baseline.medianEndpointMs,
    totalMs: current.totalMs - baseline.totalMs,
  }
}

export function duplexRegressionHTML(report: DuplexRegressionReport, baseline?: DuplexRegressionReport) {
  const comparison = compareDuplexRegression(report, baseline)
  const rows = report.results
    .map(
      (result) =>
        `<tr><td>${escapeHTML(result.name)}</td><td>${result.passed ? "PASS" : "FAIL"}</td><td>${escapeHTML(result.transcript || "—")}</td><td>${Math.round(result.latencyMs)} ms</td><td>${escapeHTML(result.error ?? "")}</td></tr>`,
    )
    .join("")
  return `<!doctype html><html lang="uk"><meta charset="utf-8"><title>OpenCode Customs Live Duplex Regression</title><style>body{font:14px system-ui;margin:32px;color:#171717}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f3f3f3}.summary{display:flex;flex-wrap:wrap;gap:24px;margin:20px 0}</style><h1>OpenCode Customs Live Duplex Regression</h1><p>${escapeHTML(report.createdAt)}</p><div class="summary"><b>Passed: ${report.passed}</b><b>Failed: ${report.failed}</b><b>False barge-ins: ${report.falseBargeIns}</b><b>Missed barge-ins: ${report.missedBargeIns}</b><b>False wakes: ${report.falseWakes}</b><b>Missed wakes: ${report.missedWakes}</b><b>Median endpoint: ${Math.round(report.medianEndpointMs)} ms</b></div>${comparison ? `<p>Baseline delta: passed ${signed(comparison.passed)}; false/missed barge-in ${signed(comparison.falseBargeIns)}/${signed(comparison.missedBargeIns)}; false/missed wake ${signed(comparison.falseWakes)}/${signed(comparison.missedWakes)}; endpoint ${signed(Math.round(comparison.endpointMs))} ms.</p>` : ""}<table><thead><tr><th>Scenario</th><th>Status</th><th>Transcript</th><th>Endpoint</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></html>`
}

function evaluateScenario(scenario: DuplexRegressionRawReport["scenarios"][number]): DuplexRegressionResult {
  const stages = scenario.stages
  const transcripts = stages.map((stage) => stage.transcript).filter(Boolean)
  const latencyMs = stages.reduce((total, stage) => total + (stage.diagnostics.recognition_ms ?? 0), 0)
  const result = (() => {
    if (scenario.id === "own-tts-echo") {
      return isLikelySpeechEcho(stages[0]?.transcript ?? "", stages[0]?.reference ?? "")
    }
    if (scenario.id === "barge-in") {
      const stage = stages[0]
      return Boolean(
        stage &&
          !isLikelySpeechEcho(stage.transcript, stage.reference) &&
          isDeliberateSpeechInterruption(stage.transcript),
      )
    }
    if (scenario.id === "pre-roll") return sameSpeechCandidate("Як мене звати", stages[0]?.transcript ?? "")
    if (scenario.id === "internal-pause") {
      const stage = stages[0]
      const submittedBeforeSecondClause = stage?.events.some(
        (event) => event.type === "final" && (event.input_index ?? 0) < 2,
      )
      return Boolean(
        stage &&
          !submittedBeforeSecondClause &&
          sameSpeechCandidate("Розкажи мені про Мобі Діка", stage.transcript),
      )
    }
    if (scenario.id === "wake-command") return Boolean(stages[0]?.wake?.matched && stages[0]?.wake?.has_command)
    if (scenario.id === "background-noise") {
      return Boolean(!stages[0]?.transcript && !stages[0]?.events.some((event) => event.type === "speech_start"))
    }
    if (scenario.id === "full-cycle") {
      const wake = stages[0]
      const echo = stages[1]
      const interruption = stages[2]
      return Boolean(
        wake?.wake?.matched &&
          wake.wake.has_command &&
          echo &&
          isLikelySpeechEcho(echo.transcript, echo.reference) &&
          interruption &&
          !isLikelySpeechEcho(interruption.transcript, interruption.reference) &&
          isDeliberateSpeechInterruption(interruption.transcript),
      )
    }
    return false
  })()
  const errors = stages.map((stage) => stage.wake?.error).filter((error): error is string => Boolean(error))
  return {
    id: scenario.id,
    name: scenario.name,
    passed: result,
    transcript: transcripts.join(" → "),
    latencyMs,
    error: errors.join(" | ") || undefined,
  }
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value}`
}

function escapeHTML(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  )
}
