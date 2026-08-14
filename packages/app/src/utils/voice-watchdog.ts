import type { VoiceSessionState } from "./voice-session-orchestrator"

export type VoiceWatchdogIssue = {
  state: VoiceSessionState
  elapsedMs: number
  limitMs: number
}

const limits: Partial<Record<VoiceSessionState, number>> = {
  transcribing: 45_000,
  thinking: 300_000,
  synthesizing: 120_000,
  speaking: 600_000,
  interrupted: 30_000,
}

export function inspectVoiceWatchdog(
  snapshot: { state: VoiceSessionState; changedAt: number },
  now = Date.now(),
  overrides?: Partial<Record<VoiceSessionState, number>>,
) {
  const limitMs = overrides?.[snapshot.state] ?? limits[snapshot.state]
  if (limitMs === undefined) return
  const elapsedMs = Math.max(0, now - snapshot.changedAt)
  if (elapsedMs <= limitMs) return
  return { state: snapshot.state, elapsedMs, limitMs } satisfies VoiceWatchdogIssue
}
