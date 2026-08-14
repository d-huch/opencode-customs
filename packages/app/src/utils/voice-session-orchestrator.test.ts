import { describe, expect, test } from "bun:test"
import {
  createVoiceSessionOrchestrator,
  isCurrentVoiceEvent,
  isVoiceResponse,
  shouldRecoverVoiceTurn,
} from "./voice-session-orchestrator"

describe("voice session orchestrator", () => {
  test("rejects callbacks from superseded turns", () => {
    let next = 0
    const orchestrator = createVoiceSessionOrchestrator({ createID: () => `turn-${++next}` })
    const first = orchestrator.begin()
    orchestrator.cancel("interrupted")
    const second = orchestrator.begin()

    expect(orchestrator.isCurrent(first)).toBe(false)
    expect(orchestrator.transition(first, "thinking", "stale transcript")).toBe(false)
    expect(orchestrator.isCurrent(second)).toBe(true)
    expect(orchestrator.snapshot().state).toBe("listening")
  })

  test("admits exactly one final transcript within one turn generation", () => {
    const orchestrator = createVoiceSessionOrchestrator({ createID: () => "turn" })
    const turn = orchestrator.begin()

    expect(orchestrator.acceptTranscript(turn, "  Покажи файл  ")).toBe(true)
    expect(orchestrator.acceptTranscript(turn, "покажи   файл")).toBe(false)
    expect(orchestrator.acceptTranscript(turn, "Покажи інший файл")).toBe(false)
  })

  test("deduplicates one microphone utterance repeated across consecutive turns", () => {
    let now = 1_000
    let next = 0
    const orchestrator = createVoiceSessionOrchestrator({
      createID: () => `turn-${++next}`,
      now: () => now,
    })
    const first = orchestrator.begin()
    expect(orchestrator.acceptTranscript(first, "І що це за цитата?")).toBe(true)
    orchestrator.cancel("response completed")

    const second = orchestrator.begin()
    expect(orchestrator.acceptTranscript(second, "і що це за цитата")).toBe(false)
    now += 8_001
    expect(orchestrator.acceptTranscript(second, "І що це за цитата?")).toBe(true)
  })

  test("records deterministic legal transitions", () => {
    const events: string[] = []
    const orchestrator = createVoiceSessionOrchestrator({
      createID: () => "turn",
      onTransition: (event) => events.push(`${event.from}:${event.to}:${event.reason}`),
    })
    const turn = orchestrator.begin("microphone")

    expect(orchestrator.transition(turn, "transcribing", "speech_start")).toBe(true)
    expect(orchestrator.transition(turn, "thinking", "final")).toBe(true)
    expect(orchestrator.transition(turn, "listening", "invalid backwards transition")).toBe(true)
    expect(orchestrator.transition(turn, "speaking", "illegal")).toBe(false)
    expect(events).toEqual([
      "idle:listening:microphone",
      "listening:transcribing:speech_start",
      "transcribing:thinking:final",
      "thinking:listening:invalid backwards transition",
    ])
  })

  test("rejects stale duplex events and unrelated assistant responses", () => {
    const turn = { id: "turn-2", generation: 2 }
    expect(isCurrentVoiceEvent(turn, {})).toBe(true)
    expect(isCurrentVoiceEvent(turn, { turn_id: "turn-2", turn_generation: 2 })).toBe(true)
    expect(isCurrentVoiceEvent(turn, { turn_id: "turn-1", turn_generation: 1 })).toBe(false)
    expect(isVoiceResponse("msg-user-2", "msg-user-2")).toBe(true)
    expect(isVoiceResponse("msg-user-1", "msg-user-2")).toBe(false)
    expect(isVoiceResponse("msg-user-2", undefined)).toBe(false)
  })

  test("recovers only unfinished durable states", () => {
    expect(shouldRecoverVoiceTurn("thinking")).toBe(true)
    expect(shouldRecoverVoiceTurn("speaking")).toBe(true)
    expect(shouldRecoverVoiceTurn("idle")).toBe(false)
    expect(shouldRecoverVoiceTurn("interrupted")).toBe(false)
    expect(shouldRecoverVoiceTurn(undefined)).toBe(false)
  })

  test("tracks when the current phase began", () => {
    let now = 100
    const orchestrator = createVoiceSessionOrchestrator({ createID: () => "turn", now: () => now })
    const turn = orchestrator.begin()
    expect(orchestrator.snapshot().changedAt).toBe(100)

    now = 250
    orchestrator.transition(turn, "transcribing", "speech_start")
    expect(orchestrator.snapshot().changedAt).toBe(250)

    now = 400
    orchestrator.cancel("done")
    expect(orchestrator.snapshot().changedAt).toBe(400)
  })
})
