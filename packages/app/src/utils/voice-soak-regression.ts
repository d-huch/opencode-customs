import {
  createVoiceSessionOrchestrator,
  isCurrentVoiceEvent,
  isVoiceResponse,
  shouldRecoverVoiceTurn,
  type VoiceSessionState,
} from "./voice-session-orchestrator"

export type VoiceSoakBatchResult = {
  batch: number
  turns: number
  passed: number
  failed: number
  stateLeaks: number
  errors: string[]
}

export type VoiceSoakRegressionReport = {
  createdAt: string
  seed: number
  turns: number
  passed: number
  failed: number
  completedTurns: number
  interruptedTurns: number
  recoveredTurns: number
  staleCallbacksRejected: number
  duplicateFinalsRejected: number
  unrelatedResponsesRejected: number
  stateLeaks: number
  finalState: VoiceSessionState
  finalGeneration: number
  batches: VoiceSoakBatchResult[]
}

type VoiceSoakTurnResult = {
  passed: boolean
  stateLeak: boolean
  error?: string
}

export function runVoiceSoakRegression(input?: { turns?: number; seed?: number; batchSize?: number }) {
  const turns = Math.max(9, Math.min(5_000, Math.floor(input?.turns ?? 500)))
  const seed = Math.abs(Math.floor(input?.seed ?? 20_260_811))
  const batchSize = Math.max(10, Math.min(250, Math.floor(input?.batchSize ?? 50)))
  const counters = {
    completedTurns: 0,
    interruptedTurns: 0,
    recoveredTurns: 0,
    staleCallbacksRejected: 0,
    duplicateFinalsRejected: 0,
    unrelatedResponsesRejected: 0,
  }
  let nextID = 0
  const orchestrator = createVoiceSessionOrchestrator({ createID: () => `soak-turn-${++nextID}` })
  const results = Array.from({ length: turns }, (_, index) => {
    const result = runSoakTurn(orchestrator, (index + seed) % 9, counters)
    const stateLeak = orchestrator.snapshot().state !== "idle" || orchestrator.snapshot().turn !== undefined
    if (stateLeak) orchestrator.cancel("soak_state_leak_cleanup")
    return { ...result, stateLeak, passed: result.passed && !stateLeak }
  })
  const batches = Array.from({ length: Math.ceil(turns / batchSize) }, (_, index) => {
    const batch = results.slice(index * batchSize, (index + 1) * batchSize)
    return {
      batch: index + 1,
      turns: batch.length,
      passed: batch.filter((result) => result.passed).length,
      failed: batch.filter((result) => !result.passed).length,
      stateLeaks: batch.filter((result) => result.stateLeak).length,
      errors: batch.flatMap((result) => (result.error ? [result.error] : [])).slice(0, 3),
    }
  })
  const snapshot = orchestrator.snapshot()

  return {
    createdAt: new Date().toISOString(),
    seed,
    turns,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    ...counters,
    stateLeaks: results.filter((result) => result.stateLeak).length,
    finalState: snapshot.state,
    finalGeneration: snapshot.generation,
    batches,
  } satisfies VoiceSoakRegressionReport
}

export function voiceSoakRegressionHTML(report: VoiceSoakRegressionReport) {
  const rows = report.batches
    .map(
      (batch) =>
        `<tr><td>${batch.batch}</td><td>${batch.turns}</td><td>${batch.passed}</td><td>${batch.failed}</td><td>${batch.stateLeaks}</td><td>${escapeHTML(batch.errors.join(" · ") || "—")}</td></tr>`,
    )
    .join("")
  return `<!doctype html><html><head><meta charset="utf-8"><title>Voice Soak &amp; Chaos</title><style>body{font:14px system-ui;margin:32px;color:#18181b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d4d4d8;padding:8px;text-align:left}</style></head><body><h1>Voice Soak &amp; Chaos Runner</h1><p>${report.passed}/${report.turns} passed · ${report.stateLeaks} state leaks · final state ${escapeHTML(report.finalState)}</p><p>Seed ${report.seed} · generation ${report.finalGeneration} · stale ${report.staleCallbacksRejected} · duplicate ${report.duplicateFinalsRejected} · unrelated response ${report.unrelatedResponsesRejected}</p><table><thead><tr><th>Batch</th><th>Turns</th><th>Passed</th><th>Failed</th><th>State leaks</th><th>Errors</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
}

function runSoakTurn(
  orchestrator: ReturnType<typeof createVoiceSessionOrchestrator>,
  scenario: number,
  counters: {
    completedTurns: number
    interruptedTurns: number
    recoveredTurns: number
    staleCallbacksRejected: number
    duplicateFinalsRejected: number
    unrelatedResponsesRejected: number
  },
): VoiceSoakTurnResult {
  try {
    if (scenario === 0) {
      const turn = orchestrator.begin("soak_complete")
      require(orchestrator.transition(turn, "transcribing", "speech_start"), "normal STT transition rejected")
      require(orchestrator.acceptTranscript(turn, "Перевір голосовий цикл"), "normal transcript rejected")
      require(orchestrator.transition(turn, "thinking", "submitted"), "normal model transition rejected")
      require(orchestrator.transition(turn, "synthesizing", "response"), "normal TTS transition rejected")
      require(orchestrator.transition(turn, "speaking", "first_audio"), "normal playback transition rejected")
      orchestrator.cancel("playback_complete")
      counters.completedTurns += 1
      return { passed: true, stateLeak: false }
    }
    if (scenario === 1) {
      const turn = orchestrator.begin("soak_duplicate")
      require(orchestrator.acceptTranscript(turn, "Покажи статус"), "first transcript rejected")
      require(!orchestrator.acceptTranscript(turn, "  покажи   статус "), "duplicate transcript admitted")
      counters.duplicateFinalsRejected += 1
      orchestrator.cancel("duplicate_checked")
      counters.completedTurns += 1
      return { passed: true, stateLeak: false }
    }
    if (scenario === 2) {
      const stale = orchestrator.begin("soak_stale")
      orchestrator.cancel("superseded")
      const current = orchestrator.begin("replacement")
      require(!orchestrator.acceptTranscript(stale, "Стара репліка"), "stale transcript admitted")
      require(!orchestrator.transition(stale, "thinking", "stale_callback"), "stale callback changed state")
      require(orchestrator.acceptTranscript(current, "Актуальна репліка"), "replacement transcript rejected")
      counters.staleCallbacksRejected += 2
      orchestrator.cancel("replacement_complete")
      counters.completedTurns += 1
      return { passed: true, stateLeak: false }
    }
    if (scenario === 3) {
      const turn = orchestrator.begin("soak_response")
      require(orchestrator.transition(turn, "thinking", "submitted"), "model transition rejected")
      require(!isVoiceResponse("old-message", "current-message"), "unrelated response admitted")
      require(isVoiceResponse("current-message", "current-message"), "related response rejected")
      counters.unrelatedResponsesRejected += 1
      orchestrator.cancel("response_checked")
      counters.completedTurns += 1
      return { passed: true, stateLeak: false }
    }
    if (scenario === 4) {
      const turn = orchestrator.begin("soak_stt_crash")
      require(orchestrator.transition(turn, "transcribing", "speech_start"), "STT crash setup rejected")
      orchestrator.cancel("stt_error")
      counters.recoveredTurns += 1
      return { passed: true, stateLeak: false }
    }
    if (scenario === 5) {
      const turn = orchestrator.begin("soak_tts_crash")
      require(orchestrator.transition(turn, "thinking", "submitted"), "TTS crash model setup rejected")
      require(orchestrator.transition(turn, "synthesizing", "response"), "TTS crash setup rejected")
      orchestrator.cancel("tts_error")
      counters.recoveredTurns += 1
      return { passed: true, stateLeak: false }
    }
    if (scenario === 6) {
      const turn = orchestrator.begin("soak_renderer_restart")
      require(orchestrator.transition(turn, "thinking", "submitted"), "renderer recovery setup rejected")
      require(shouldRecoverVoiceTurn(orchestrator.snapshot().state), "unfinished renderer state was not recoverable")
      orchestrator.cancel("renderer_recovery")
      counters.recoveredTurns += 1
      return { passed: true, stateLeak: false }
    }
    if (scenario === 7) {
      const disconnected = orchestrator.begin("soak_socket_open")
      orchestrator.cancel("socket_closed")
      const reconnected = orchestrator.begin("socket_reconnected")
      require(!isCurrentVoiceEvent(reconnected, {
        turn_id: disconnected.id,
        turn_generation: disconnected.generation,
      }), "disconnected stream event admitted")
      require(isCurrentVoiceEvent(reconnected, {
        turn_id: reconnected.id,
        turn_generation: reconnected.generation,
      }), "reconnected stream event rejected")
      counters.staleCallbacksRejected += 1
      orchestrator.cancel("reconnect_checked")
      counters.completedTurns += 1
      return { passed: true, stateLeak: false }
    }

    const turn = orchestrator.begin("soak_barge_in")
    require(orchestrator.transition(turn, "thinking", "submitted"), "barge-in model setup rejected")
    require(orchestrator.transition(turn, "synthesizing", "response"), "barge-in TTS setup rejected")
    require(orchestrator.transition(turn, "speaking", "first_audio"), "barge-in playback setup rejected")
    require(orchestrator.transition(turn, "interrupted", "barge_in"), "barge-in transition rejected")
    require(orchestrator.transition(turn, "listening", "resume_microphone"), "barge-in microphone resume rejected")
    require(orchestrator.acceptTranscript(turn, "Нова команда"), "barge-in transcript rejected")
    require(orchestrator.transition(turn, "thinking", "submitted"), "barge-in continuation rejected")
    orchestrator.cancel("barge_in_complete")
    counters.interruptedTurns += 1
    return { passed: true, stateLeak: false }
  } catch (error) {
    return { passed: false, stateLeak: false, error: error instanceof Error ? error.message : String(error) }
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
