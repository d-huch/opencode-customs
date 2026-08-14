export type VoiceSessionState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "synthesizing"
  | "speaking"
  | "interrupted"

export type VoiceTurn = {
  id: string
  generation: number
}

export type VoiceTransition = {
  turn: VoiceTurn | undefined
  from: VoiceSessionState
  to: VoiceSessionState
  reason: string
}

export function isCurrentVoiceEvent(
  turn: VoiceTurn,
  event: { turn_id?: string; turn_generation?: number },
) {
  if (!event.turn_id) return true
  if (event.turn_id !== turn.id) return false
  return event.turn_generation === undefined || event.turn_generation === turn.generation
}

export function isVoiceResponse(parentID: string | undefined, expectedParentID: string | undefined) {
  return !!expectedParentID && parentID === expectedParentID
}

export function shouldRecoverVoiceTurn(state: string | undefined) {
  return !!state && state !== "idle" && state !== "interrupted"
}

const transitions: Record<VoiceSessionState, VoiceSessionState[]> = {
  idle: ["listening"],
  listening: ["transcribing", "thinking", "interrupted", "idle"],
  transcribing: ["listening", "thinking", "interrupted", "idle"],
  thinking: ["synthesizing", "speaking", "interrupted", "listening", "idle"],
  synthesizing: ["speaking", "interrupted", "listening", "idle"],
  speaking: ["interrupted", "listening", "idle"],
  interrupted: ["listening", "thinking", "idle"],
}

export function createVoiceSessionOrchestrator(input?: {
  createID?: () => string
  now?: () => number
  onTransition?: (transition: VoiceTransition) => void
}) {
  let generation = 0
  let state: VoiceSessionState = "idle"
  let turn: VoiceTurn | undefined
  const submittedGenerations = new Set<number>()
  let recentTranscript: { value: string; acceptedAt: number } | undefined
  let changedAt = input?.now?.() ?? Date.now()

  const transition = (token: VoiceTurn | undefined, next: VoiceSessionState, reason: string) => {
    if (token && !isCurrent(token)) return false
    if (state === next) return true
    if (!transitions[state].includes(next)) return false
    const from = state
    state = next
    changedAt = input?.now?.() ?? Date.now()
    input?.onTransition?.({ turn, from, to: next, reason })
    return true
  }

  const isCurrent = (token: VoiceTurn | undefined) =>
    !!token && token.generation === generation && token.id === turn?.id

  return {
    begin(reason = "start") {
      generation += 1
      turn = { id: input?.createID?.() ?? crypto.randomUUID(), generation }
      const from = state
      state = "listening"
      changedAt = input?.now?.() ?? Date.now()
      input?.onTransition?.({ turn, from, to: state, reason })
      return turn
    },
    cancel(reason = "cancel") {
      const previous = turn
      const from = state
      generation += 1
      turn = undefined
      state = "idle"
      changedAt = input?.now?.() ?? Date.now()
      if (from !== state) input?.onTransition?.({ turn: previous, from, to: state, reason })
    },
    transition,
    isCurrent,
    acceptTranscript(token: VoiceTurn, value: string) {
      if (!isCurrent(token)) return false
      const normalized = value
        .trim()
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
      const now = input?.now?.() ?? Date.now()
      if (
        !normalized ||
        submittedGenerations.has(token.generation) ||
        (recentTranscript?.value === normalized && now - recentTranscript.acceptedAt < 8_000)
      )
        return false
      submittedGenerations.add(token.generation)
      recentTranscript = { value: normalized, acceptedAt: now }
      return true
    },
    snapshot() {
      return { state, turn, generation, changedAt }
    },
  }
}
