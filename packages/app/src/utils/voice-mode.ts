export type VoiceMode = "full" | "listen" | "speak" | "off"

export function resolveVoiceMode(input: {
  enabled: boolean
  listeningEnabled: boolean
  speakResponses: boolean
}): VoiceMode {
  if (!input.enabled) return "off"
  if (input.listeningEnabled && input.speakResponses) return "full"
  if (input.listeningEnabled) return "listen"
  if (input.speakResponses) return "speak"
  return "off"
}

export function applyVoiceMode(
  mode: VoiceMode,
  current: { listeningEnabled: boolean; speakResponses: boolean },
) {
  if (mode === "off") return { enabled: false, ...current }
  if (mode === "full") return { enabled: true, listeningEnabled: true, speakResponses: true }
  if (mode === "listen") return { enabled: true, listeningEnabled: true, speakResponses: false }
  return { enabled: true, listeningEnabled: false, speakResponses: true }
}

export function applyVoiceMaster(
  enabled: boolean,
  current: { listeningEnabled: boolean; speakResponses: boolean },
) {
  if (!enabled) return { enabled: false, ...current }
  if (current.listeningEnabled || current.speakResponses) return { enabled: true, ...current }
  return { enabled: true, listeningEnabled: true, speakResponses: true }
}
