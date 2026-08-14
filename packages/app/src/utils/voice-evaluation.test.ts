import { describe, expect, test } from "bun:test"
import type { VoiceDiagnosticEntry } from "@/context/platform"
import { diagnosticLevelTrace, evaluateVoiceDiagnostics } from "./voice-evaluation"

const entry = (value: Partial<VoiceDiagnosticEntry> & Pick<VoiceDiagnosticEntry, "timestamp" | "source" | "event">) =>
  ({ sessionID: "session", turnID: "turn", ...value }) as VoiceDiagnosticEntry

describe("voice evaluation", () => {
  test("measures one complete wake to playback critical path", () => {
    const result = evaluateVoiceDiagnostics([
      entry({ timestamp: "2026-08-11T10:00:00.000Z", source: "agent", event: "listening_started" }),
      entry({
        timestamp: "2026-08-11T10:00:00.200Z",
        source: "stt",
        event: "wake_detected",
        diagnostics: { wake_recognition_ms: 90 },
      }),
      entry({
        timestamp: "2026-08-11T10:00:00.500Z",
        source: "stt",
        event: "final",
        text: "Відкрий проєкт",
        diagnostics: { transcription_ms: 240 },
      }),
      entry({ timestamp: "2026-08-11T10:00:00.550Z", source: "agent", event: "transcript_accepted" }),
      entry({ timestamp: "2026-08-11T10:00:01.550Z", source: "agent", event: "response_started", durationMs: 1_000 }),
      entry({ timestamp: "2026-08-11T10:00:01.600Z", source: "tts", event: "synthesis_completed", durationMs: 300 }),
      entry({ timestamp: "2026-08-11T10:00:01.650Z", source: "tts", event: "playback_started" }),
      entry({ timestamp: "2026-08-11T10:00:03.000Z", source: "tts", event: "playback_completed" }),
    ])

    expect(result.completed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.turns[0]?.phases).toEqual({
      wake: 90,
      stt: 240,
      model: 1_000,
      tts: 300,
      first_sound: 1_100,
      total: 3_000,
    })
    expect(result.turns[0]?.bottleneck).toBe("model")
  })

  test("tracks failed and ignored turns without inventing completion", () => {
    const result = evaluateVoiceDiagnostics([
      entry({ timestamp: "2026-08-11T10:00:00.000Z", source: "agent", event: "listening_started" }),
      entry({ timestamp: "2026-08-11T10:00:00.200Z", source: "stt", event: "wake_ignored" }),
      entry({ timestamp: "2026-08-11T10:00:00.300Z", source: "stt", event: "error", error: "offline" }),
    ])

    expect(result.completed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.backgroundIgnored).toBe(1)
  })

  test("parses a bounded normalized microphone trace", () => {
    expect(
      diagnosticLevelTrace(
        entry({
          timestamp: "2026-08-11T10:00:00.000Z",
          source: "stt",
          event: "final",
          diagnostics: { level_trace: "0,0.25,1,2,nope" },
        }),
      ),
    ).toEqual([0, 0.25, 1])
  })

  test("assembles a durable inspector turn with audio, transcripts, timings, and corrections", () => {
    const result = evaluateVoiceDiagnostics([
      entry({ timestamp: "2026-08-11T10:00:00.000Z", source: "stt", event: "speech_start" }),
      entry({ timestamp: "2026-08-11T10:00:00.100Z", source: "stt", event: "partial", text: "відкрий про" }),
      entry({
        timestamp: "2026-08-11T10:00:01.000Z",
        source: "stt",
        event: "final",
        text: "Відкрий проєкт",
        diagnostics: {
          final_confidence: 0.92,
          endpoint_reason: "semantic_complete",
          audio_ms: 1_400,
          speech_ms: 900,
          silence_ms: 320,
          pre_roll_ms: 180,
          transcription_ms: 240,
        },
      }),
      entry({
        timestamp: "2026-08-11T10:00:01.010Z",
        source: "agent",
        event: "transcript_assessed",
        diagnostics: {
          decision: "accepted",
          reason: "high_confidence",
          corrections: "проэкт → проєкт, terminal → термінал",
        },
      }),
      entry({
        timestamp: "2026-08-11T10:00:01.020Z",
        source: "ui",
        event: "audio_saved",
        durationMs: 1_400,
      }),
      entry({
        timestamp: "2026-08-11T10:00:01.030Z",
        source: "replay",
        event: "turn_redecoded",
        text: "Відкрий потрібний проєкт",
      }),
    ])

    expect(result.turns[0]).toMatchObject({
      preview: "відкрий про",
      finalTranscript: "Відкрий проєкт",
      correctedTranscript: "Відкрий потрібний проєкт",
      confidence: 0.92,
      corrections: ["проэкт → проєкт", "terminal → термінал"],
      sendReason: "accepted: high_confidence",
      endpointReason: "semantic_complete",
      audioMs: 1_400,
      speechMs: 900,
      silenceMs: 320,
      preRollMs: 180,
      transcriptionMs: 240,
      hasAudio: true,
    })
  })
})
