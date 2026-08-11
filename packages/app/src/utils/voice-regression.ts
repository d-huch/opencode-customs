export type VoiceRegressionScenario = {
  id: string
  name: string
  language: "uk" | "en"
  kind: "roundtrip" | "silence" | "noise"
  input: string
  expected: string
  punctuation?: string
}

export type VoiceRegressionResult = {
  scenario: VoiceRegressionScenario
  actual: string
  passed: boolean
  wordErrorRate: number
  characterErrorRate: number
  languageMatched: boolean
  punctuationMatched: boolean
  ttsMs: number
  sttMs: number
  totalMs: number
  error?: string
}

export type VoiceRegressionReport = {
  createdAt: string
  passed: number
  failed: number
  medianWordErrorRate: number
  medianCharacterErrorRate: number
  medianTotalMs: number
  results: VoiceRegressionResult[]
}

export const voiceRegressionScenarios: VoiceRegressionScenario[] = [
  {
    id: "uk-short",
    name: "Коротка українська репліка",
    language: "uk",
    kind: "roundtrip",
    input: "Мене звати Денис.",
    expected: "Мене звати Денис.",
    punctuation: ".",
  },
  {
    id: "uk-question",
    name: "Українське запитання",
    language: "uk",
    kind: "roundtrip",
    input: "Як мене звати?",
    expected: "Як мене звати?",
    punctuation: "?",
  },
  {
    id: "uk-pause",
    name: "Довга репліка з внутрішньою паузою",
    language: "uk",
    kind: "roundtrip",
    input: "Розкажи мені про Мобі Діка, а потім коротко підсумуй.",
    expected: "Розкажи мені про Мобі Діка, а потім коротко підсумуй.",
    punctuation: ".",
  },
  {
    id: "en-short",
    name: "English phrase",
    language: "en",
    kind: "roundtrip",
    input: "OpenCode Customs is ready to help.",
    expected: "OpenCode Customs is ready to help.",
    punctuation: ".",
  },
  {
    id: "silence",
    name: "Тиша не створює команду",
    language: "uk",
    kind: "silence",
    input: "",
    expected: "",
  },
  {
    id: "background-noise",
    name: "Тихий фон не створює команду",
    language: "uk",
    kind: "noise",
    input: "",
    expected: "",
  },
]

export async function runVoiceRegression(input: {
  scenarios?: VoiceRegressionScenario[]
  synthesize(text: string): Promise<{ audio: Blob; totalMs: number }>
  transcribe(audio: Blob, language: string): Promise<{ text: string; totalMs: number }>
  onResult?(result: VoiceRegressionResult): void
}) {
  const results: VoiceRegressionResult[] = []
  for (const scenario of input.scenarios ?? voiceRegressionScenarios) {
    const started = performance.now()
    const result = await runScenario(scenario, input.synthesize, input.transcribe).catch((error: unknown) => ({
      scenario,
      actual: "",
      passed: false,
      wordErrorRate: 1,
      characterErrorRate: 1,
      languageMatched: false,
      punctuationMatched: false,
      ttsMs: 0,
      sttMs: 0,
      totalMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }))
    results.push(result)
    input.onResult?.(result)
  }
  return createVoiceRegressionReport(results)
}

export function createVoiceRegressionReport(results: VoiceRegressionResult[]): VoiceRegressionReport {
  return {
    createdAt: new Date().toISOString(),
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    medianWordErrorRate: median(results.map((result) => result.wordErrorRate)),
    medianCharacterErrorRate: median(results.map((result) => result.characterErrorRate)),
    medianTotalMs: median(results.map((result) => result.totalMs)),
    results,
  }
}

export function compareVoiceRegression(current: VoiceRegressionReport, baseline?: VoiceRegressionReport) {
  if (!baseline) return
  return {
    passed: current.passed - baseline.passed,
    wordErrorRate: current.medianWordErrorRate - baseline.medianWordErrorRate,
    characterErrorRate: current.medianCharacterErrorRate - baseline.medianCharacterErrorRate,
    totalMs: current.medianTotalMs - baseline.medianTotalMs,
  }
}

export function wordErrorRate(expected: string, actual: string) {
  return errorRate(tokens(expected), tokens(actual))
}

export function characterErrorRate(expected: string, actual: string) {
  return errorRate([...normalize(expected).replaceAll(" ", "")], [...normalize(actual).replaceAll(" ", "")])
}

export function voiceRegressionHTML(report: VoiceRegressionReport, baseline?: VoiceRegressionReport) {
  const comparison = compareVoiceRegression(report, baseline)
  const rows = report.results
    .map(
      (result) =>
        `<tr><td>${escapeHTML(result.scenario.name)}</td><td>${result.passed ? "PASS" : "FAIL"}</td><td>${escapeHTML(result.actual || "—")}</td><td>${percent(result.wordErrorRate)}</td><td>${percent(result.characterErrorRate)}</td><td>${Math.round(result.totalMs)} ms</td><td>${escapeHTML(result.error ?? "")}</td></tr>`,
    )
    .join("")
  return `<!doctype html><html lang="uk"><meta charset="utf-8"><title>OpenCode Customs Voice Regression</title><style>body{font:14px system-ui;margin:32px;color:#171717}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f3f3f3}.summary{display:flex;gap:24px;margin:20px 0}</style><h1>OpenCode Customs Voice Regression</h1><p>${escapeHTML(report.createdAt)}</p><div class="summary"><b>Passed: ${report.passed}</b><b>Failed: ${report.failed}</b><b>Median WER: ${percent(report.medianWordErrorRate)}</b><b>Median CER: ${percent(report.medianCharacterErrorRate)}</b><b>Median total: ${Math.round(report.medianTotalMs)} ms</b></div>${comparison ? `<p>Baseline delta: passed ${comparison.passed >= 0 ? "+" : ""}${comparison.passed}; WER ${signedPercent(comparison.wordErrorRate)}; CER ${signedPercent(comparison.characterErrorRate)}; latency ${Math.round(comparison.totalMs)} ms.</p>` : ""}<table><thead><tr><th>Scenario</th><th>Status</th><th>Transcript</th><th>WER</th><th>CER</th><th>Latency</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></html>`
}

async function runScenario(
  scenario: VoiceRegressionScenario,
  synthesize: (text: string) => Promise<{ audio: Blob; totalMs: number }>,
  transcribe: (audio: Blob, language: string) => Promise<{ text: string; totalMs: number }>,
): Promise<VoiceRegressionResult> {
  const started = performance.now()
  const speech =
    scenario.kind === "roundtrip"
      ? await synthesize(scenario.input)
      : { audio: generatedWAV(scenario.kind), totalMs: 0 }
  const transcript = await transcribe(speech.audio, scenario.language)
  const wer = wordErrorRate(scenario.expected, transcript.text)
  const cer = characterErrorRate(scenario.expected, transcript.text)
  const languageMatched = matchesLanguage(transcript.text, scenario.language, !scenario.expected)
  const punctuationMatched = !scenario.punctuation || transcript.text.trim().endsWith(scenario.punctuation)
  const passed = !scenario.expected
    ? !normalize(transcript.text)
    : wer <= 0.34 && cer <= 0.3 && languageMatched && punctuationMatched
  return {
    scenario,
    actual: transcript.text,
    passed,
    wordErrorRate: wer,
    characterErrorRate: cer,
    languageMatched,
    punctuationMatched,
    ttsMs: speech.totalMs,
    sttMs: transcript.totalMs,
    totalMs: performance.now() - started,
  }
}

function generatedWAV(kind: "silence" | "noise") {
  const sampleRate = 16_000
  const samples = new Int16Array(sampleRate)
  if (kind === "noise") {
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.round((Math.sin(index * 0.173) + Math.sin(index * 0.071)) * 32)
    }
  }
  const buffer = new ArrayBuffer(44 + samples.byteLength)
  const view = new DataView(buffer)
  const write = (offset: number, value: string) =>
    [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  write(0, "RIFF")
  view.setUint32(4, 36 + samples.byteLength, true)
  write(8, "WAVEfmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, "data")
  view.setUint32(40, samples.byteLength, true)
  new Int16Array(buffer, 44).set(samples)
  return new Blob([buffer], { type: "audio/wav" })
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function tokens(value: string) {
  const normalized = normalize(value)
  return normalized ? normalized.split(" ") : []
}

function errorRate<T>(expected: T[], actual: T[]) {
  if (!expected.length) return actual.length ? 1 : 0
  const previous = Array.from({ length: actual.length + 1 }, (_, index) => index)
  expected.forEach((expectedValue, expectedIndex) => {
    const current = [expectedIndex + 1]
    actual.forEach((actualValue, actualIndex) => {
      current.push(
        Math.min(
          current[actualIndex] + 1,
          previous[actualIndex + 1] + 1,
          previous[actualIndex] + (expectedValue === actualValue ? 0 : 1),
        ),
      )
    })
    previous.splice(0, previous.length, ...current)
  })
  return previous[actual.length] / expected.length
}

function matchesLanguage(value: string, language: "uk" | "en", empty: boolean) {
  if (empty && !value.trim()) return true
  const letters = value.match(/\p{L}/gu) ?? []
  if (!letters.length) return false
  const matching = letters.filter((letter) =>
    language === "uk" ? /[а-щьюяєіїґ]/iu.test(letter) : /[a-z]/iu.test(letter),
  ).length
  return matching / letters.length >= 0.8
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`
}

function escapeHTML(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  )
}
