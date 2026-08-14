import type { VoiceDiagnosticEntry } from "@/context/platform"

export type VoiceEvaluationPhase = "wake" | "stt" | "model" | "tts" | "first_sound" | "total"

export type VoiceEvaluationTurn = {
  id: string
  startedAt: string
  text?: string
  completed: boolean
  interrupted: boolean
  error?: string
  phases: Partial<Record<VoiceEvaluationPhase, number>>
  bottleneck?: VoiceEvaluationPhase
  preview?: string
  finalTranscript?: string
  correctedTranscript?: string
  confidence?: number
  corrections: string[]
  sendReason?: string
  endpointReason?: string
  audioMs?: number
  speechMs?: number
  silenceMs?: number
  preRollMs?: number
  transcriptionMs?: number
  hasAudio: boolean
}

export type VoiceEvaluation = {
  turns: VoiceEvaluationTurn[]
  completed: number
  failed: number
  interrupted: number
  backgroundIgnored: number
  medians: Partial<Record<VoiceEvaluationPhase, number>>
  bottleneck?: VoiceEvaluationPhase
}

const phases: VoiceEvaluationPhase[] = ["wake", "stt", "model", "tts", "first_sound", "total"]

export function evaluateVoiceDiagnostics(entries: VoiceDiagnosticEntry[]): VoiceEvaluation {
  const grouped = entries.filter((entry) => entry.turnID).reduce((result, entry) => {
    const current = result.get(entry.turnID!) ?? []
    current.push(entry)
    result.set(entry.turnID!, current)
    return result
  }, new Map<string, VoiceDiagnosticEntry[]>())
  const turns = [...grouped].map(([id, values]) => evaluateTurn(id, values))
  const medians = Object.fromEntries(
    phases.flatMap((phase) => {
      const values = turns
        .map((turn) => turn.phases[phase])
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right)
      if (!values.length) return []
      const middle = Math.floor(values.length / 2)
      const value = values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
      return [[phase, value] as const]
    }),
  )
  const bottleneck = (["wake", "stt", "model", "tts"] as VoiceEvaluationPhase[])
    .filter((phase) => medians[phase] !== undefined)
    .sort((left, right) => medians[right]! - medians[left]!)[0]
  return {
    turns: turns.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)),
    completed: turns.filter((turn) => turn.completed).length,
    failed: turns.filter((turn) => turn.error).length,
    interrupted: turns.filter((turn) => turn.interrupted).length,
    backgroundIgnored: entries.filter((entry) => entry.event === "wake_ignored").length,
    medians,
    bottleneck,
  }
}

export function diagnosticLevelTrace(entry: VoiceDiagnosticEntry) {
  const value = entry.diagnostics?.level_trace
  if (typeof value !== "string") return []
  return value
    .split(",")
    .map(Number)
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 1)
}

function evaluateTurn(id: string, entries: VoiceDiagnosticEntry[]): VoiceEvaluationTurn {
  const ordered = [...entries].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
  const find = (event: string) => ordered.find((entry) => entry.event === event)
  const accepted = find("transcript_accepted")
  const responseStarted = find("response_started")
  const playbackStarted = find("playback_started")
  const playbackCompleted = [...ordered].reverse().find((entry) => entry.event === "playback_completed")
  const responseCompleted = find("response_completed")
  const wake = find("wake_detected")
  const final = [...ordered].reverse().find((entry) => entry.source === "stt" && entry.event === "final")
  const preview = [...ordered].reverse().find((entry) => entry.source === "stt" && entry.event === "partial")
  const assessment = [...ordered].reverse().find((entry) => entry.event === "transcript_assessed")
  const correction = [...ordered].reverse().find((entry) => entry.event === "manual_correction")
  const redecode = [...ordered].reverse().find((entry) => entry.event === "turn_redecoded")
  const audio = [...ordered].reverse().find((entry) => entry.event === "audio_saved")
  const synthesis = find("synthesis_completed")
  const error = ordered.find((entry) => entry.error)
  const started = find("speech_start") ?? find("listening_started") ?? ordered[0]!
  const completedAt = playbackCompleted ?? responseCompleted
  const values: Partial<Record<VoiceEvaluationPhase, number>> = {
    wake: diagnosticNumber(wake, "wake_recognition_ms"),
    stt: diagnosticNumber(final, "transcription_ms"),
    model: responseStarted?.durationMs,
    tts: synthesis?.durationMs,
    first_sound: accepted && playbackStarted ? elapsed(accepted, playbackStarted) : undefined,
    total: completedAt ? elapsed(started, completedAt) : undefined,
  }
  const bottleneck = (["wake", "stt", "model", "tts"] as VoiceEvaluationPhase[])
    .filter((phase) => values[phase] !== undefined)
    .sort((left, right) => values[right]! - values[left]!)[0]
  return {
    id,
    startedAt: started.timestamp,
    text: accepted?.text ?? final?.text,
    completed: Boolean(completedAt),
    interrupted: ordered.some((entry) => entry.event === "interrupted"),
    error: error?.error,
    phases: values,
    bottleneck,
    preview: preview?.text,
    finalTranscript: final?.text,
    correctedTranscript: correction?.text ?? redecode?.text,
    confidence: diagnosticNumber(final, "final_confidence") ?? diagnosticNumber(assessment, "final_confidence"),
    corrections:
      typeof assessment?.diagnostics?.corrections === "string"
        ? assessment.diagnostics.corrections.split(",").map((item) => item.trim()).filter(Boolean)
        : [],
    sendReason:
      typeof assessment?.diagnostics?.reason === "string"
        ? `${assessment.diagnostics.decision ?? "assessed"}: ${assessment.diagnostics.reason}`
        : undefined,
    endpointReason: typeof final?.diagnostics?.endpoint_reason === "string" ? final.diagnostics.endpoint_reason : undefined,
    audioMs: diagnosticNumber(final, "audio_ms") ?? audio?.durationMs,
    speechMs: diagnosticNumber(final, "speech_ms"),
    silenceMs: diagnosticNumber(final, "silence_ms"),
    preRollMs: diagnosticNumber(final, "pre_roll_ms"),
    transcriptionMs: diagnosticNumber(final, "transcription_ms"),
    hasAudio: Boolean(audio),
  }
}

function diagnosticNumber(entry: VoiceDiagnosticEntry | undefined, key: string) {
  const value = entry?.diagnostics?.[key]
  return typeof value === "number" ? value : undefined
}

function elapsed(start: VoiceDiagnosticEntry, end: VoiceDiagnosticEntry) {
  return Math.max(0, Date.parse(end.timestamp) - Date.parse(start.timestamp))
}
