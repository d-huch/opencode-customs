import {
  createVoiceSessionOrchestrator,
  isCurrentVoiceEvent,
  isVoiceResponse,
  shouldRecoverVoiceTurn,
} from "./voice-session-orchestrator"

export type VoiceTurnRegressionResult = {
  id: string
  passed: boolean
  events: string[]
  error?: string
}

export type VoiceTurnRegressionReport = {
  createdAt: string
  passed: number
  failed: number
  staleCallbacksRejected: number
  duplicateFinalsRejected: number
  unrelatedResponsesRejected: number
  recoveredToIdle: number
  results: VoiceTurnRegressionResult[]
}

export function runVoiceTurnRegression(): VoiceTurnRegressionReport {
  const counters = {
    staleCallbacksRejected: 0,
    duplicateFinalsRejected: 0,
    unrelatedResponsesRejected: 0,
    recoveredToIdle: 0,
  }
  const results = [
    scenario("complete-turn", (events) => {
      const orchestrator = createRegressionOrchestrator(events)
      const turn = orchestrator.begin("microphone")
      require(orchestrator.transition(turn, "transcribing", "speech_start"), "STT did not start")
      require(orchestrator.acceptTranscript(turn, "Розкажи про проєкт"), "final transcript was rejected")
      require(orchestrator.transition(turn, "thinking", "submitted"), "model did not start")
      require(isVoiceResponse("user-1", "user-1"), "matching assistant response was rejected")
      require(orchestrator.transition(turn, "synthesizing", "response"), "TTS did not start")
      require(orchestrator.transition(turn, "speaking", "first_audio"), "playback did not start")
      orchestrator.cancel("playback_complete")
      require(orchestrator.snapshot().state === "idle", "completed turn did not return to idle")
    }),
    scenario("duplicate-final", (events) => {
      const orchestrator = createRegressionOrchestrator(events)
      const turn = orchestrator.begin()
      require(orchestrator.acceptTranscript(turn, "  Покажи файл  "), "first final transcript was rejected")
      require(!orchestrator.acceptTranscript(turn, "покажи   файл"), "duplicate final transcript was admitted")
      counters.duplicateFinalsRejected += 1
      orchestrator.cancel("complete")
    }),
    scenario("stale-transcript", (events) => {
      const orchestrator = createRegressionOrchestrator(events)
      const first = orchestrator.begin()
      require(orchestrator.transition(first, "transcribing", "speech_start"), "first STT did not start")
      orchestrator.cancel("superseded")
      const second = orchestrator.begin()
      require(!orchestrator.acceptTranscript(first, "Стара репліка"), "stale transcript was admitted")
      require(!orchestrator.transition(first, "thinking", "stale_final"), "stale callback changed state")
      require(orchestrator.acceptTranscript(second, "Нова репліка"), "current transcript was rejected")
      counters.staleCallbacksRejected += 2
      orchestrator.cancel("complete")
    }),
    scenario("previous-response", (events) => {
      const orchestrator = createRegressionOrchestrator(events)
      const turn = orchestrator.begin()
      require(orchestrator.transition(turn, "thinking", "submitted"), "model did not start")
      require(!isVoiceResponse("user-old", "user-current"), "previous turn response was accepted")
      require(isVoiceResponse("user-current", "user-current"), "current turn response was rejected")
      counters.unrelatedResponsesRejected += 1
      orchestrator.cancel("complete")
    }),
    scenario("stt-crash", (events) => {
      const orchestrator = createRegressionOrchestrator(events)
      const turn = orchestrator.begin()
      require(orchestrator.transition(turn, "transcribing", "speech_start"), "STT did not start")
      orchestrator.cancel("stt_error")
      require(orchestrator.snapshot().state === "idle", "STT crash left the turn active")
      require(!orchestrator.isCurrent(turn), "STT crash left its token current")
      counters.recoveredToIdle += 1
    }),
    scenario("tts-crash", (events) => {
      const orchestrator = createRegressionOrchestrator(events)
      const turn = orchestrator.begin()
      require(orchestrator.transition(turn, "thinking", "submitted"), "model did not start")
      require(orchestrator.transition(turn, "synthesizing", "response"), "TTS did not start")
      orchestrator.cancel("tts_error")
      require(orchestrator.snapshot().state === "idle", "TTS crash left the turn active")
      counters.recoveredToIdle += 1
    }),
    scenario("renderer-restart", (events) => {
      require(shouldRecoverVoiceTurn("speaking"), "unfinished renderer state was not detected")
      require(shouldRecoverVoiceTurn("thinking"), "unfinished model state was not detected")
      require(!shouldRecoverVoiceTurn("idle"), "idle renderer state requested recovery")
      events.push("speaking:idle:renderer_recovery")
      counters.recoveredToIdle += 1
    }),
    scenario("duplex-reconnect", (events) => {
      const orchestrator = createRegressionOrchestrator(events)
      const disconnected = orchestrator.begin("socket_open")
      orchestrator.cancel("socket_closed")
      const reconnected = orchestrator.begin("socket_reconnected")
      require(
        !isCurrentVoiceEvent(reconnected, {
          turn_id: disconnected.id,
          turn_generation: disconnected.generation,
        }),
        "event from disconnected stream was accepted",
      )
      require(
        isCurrentVoiceEvent(reconnected, {
          turn_id: reconnected.id,
          turn_generation: reconnected.generation,
        }),
        "event from reconnected stream was rejected",
      )
      counters.staleCallbacksRejected += 1
      orchestrator.cancel("complete")
    }),
    scenario("barge-in", (events) => {
      const orchestrator = createRegressionOrchestrator(events)
      const turn = orchestrator.begin()
      require(orchestrator.transition(turn, "thinking", "submitted"), "model did not start")
      require(orchestrator.transition(turn, "synthesizing", "response"), "TTS did not start")
      require(orchestrator.transition(turn, "speaking", "first_audio"), "playback did not start")
      require(orchestrator.transition(turn, "interrupted", "barge_in"), "barge-in was rejected")
      require(orchestrator.transition(turn, "listening", "resume_microphone"), "microphone did not resume")
      require(orchestrator.acceptTranscript(turn, "Нова команда"), "interruption transcript was rejected")
      require(orchestrator.transition(turn, "thinking", "submitted"), "interruption did not start a new response")
      orchestrator.cancel("complete")
    }),
  ]

  return {
    createdAt: new Date().toISOString(),
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    ...counters,
    results,
  }
}

export function voiceTurnRegressionHTML(report: VoiceTurnRegressionReport) {
  const rows = report.results
    .map(
      (result) =>
        `<tr><td>${escapeHTML(result.id)}</td><td>${result.passed ? "PASS" : "FAIL"}</td><td>${escapeHTML(result.error ?? result.events.join(" → "))}</td></tr>`,
    )
    .join("")
  return `<!doctype html><html><head><meta charset="utf-8"><title>Voice Turn Recovery</title><style>body{font:14px system-ui;margin:32px;color:#18181b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d4d4d8;padding:8px;text-align:left}</style></head><body><h1>Voice Turn Recovery Runner</h1><p>${report.passed} passed, ${report.failed} failed</p><table><thead><tr><th>Scenario</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
}

function createRegressionOrchestrator(events: string[]) {
  let next = 0
  return createVoiceSessionOrchestrator({
    createID: () => `turn-${++next}`,
    onTransition: (event) => events.push(`${event.from}:${event.to}:${event.reason}`),
  })
}

function scenario(id: string, run: (events: string[]) => void): VoiceTurnRegressionResult {
  const events: string[] = []
  try {
    run(events)
    return { id, passed: true, events }
  } catch (error) {
    return { id, passed: false, events, error: error instanceof Error ? error.message : String(error) }
  }
}

function require(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message)
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }
    return escaped[character as keyof typeof escaped]
  })
}
