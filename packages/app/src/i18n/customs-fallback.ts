// Customs features ship faster than the upstream locale set. These exact English
// values are the intentional fallback contract until a locale provides its own copy.
export const CUSTOMS_FALLBACK = {
  "settings.jarvis.replay.run": "Run fixture",
  "settings.jarvis.replay.execution": "Replay execution · {{status}}",
  "settings.jarvis.replay.comparison": "Run comparison",
  "settings.jarvis.replay.noRegressions": "No regressions detected.",
  "settings.jarvis.replay.passed": "Passed",
  "settings.jarvis.replay.failed": "Regression",
  "settings.jarvis.overview.session": "Canonical session",
  "settings.jarvis.overview.session.empty": "A shared Jarvis session has not been created yet.",
  "settings.jarvis.overview.idle": "idle",
  "settings.jarvis.overview.owners": "Surface ownership",
  "settings.jarvis.overview.owners.description": "Microphone: {{microphone}} · playback: {{playback}}",
  "settings.jarvis.overview.media": "Media queue",
  "settings.jarvis.overview.media.description": "{{queued}} sentence(s) queued · {{jobs}} synthesis job(s)",
  "settings.jarvis.overview.latency": "Live latency",
  "settings.jarvis.overview.latency.description": "STT {{stt}} ms · TTFT {{ttft}} ms · TTS {{tts}} ms",
  "settings.jarvis.diagnostics.sqlite.ready": "Jarvis storage is available",
  "settings.jarvis.diagnostics.sqlite.degraded": "Jarvis storage is degraded",
  "settings.jarvis.diagnostics.sqlite.error": "Jarvis storage failed",
  "settings.jarvis.diagnostics.conversation.ready": "Canonical session is ready",
  "settings.jarvis.diagnostics.conversation.degraded": "Canonical session will be created on first use",
  "settings.jarvis.diagnostics.conversation.error": "Canonical session is unavailable",
  "settings.jarvis.diagnostics.replay.ready": "Replay Lab has sanitized traces",
  "settings.jarvis.diagnostics.replay.degraded": "Replay Lab has no traces yet",
  "settings.jarvis.diagnostics.replay.error": "Replay Lab is unavailable",
  "settings.jarvis.diagnostics.bridge.ready": "Unity Avatar Bridge is available",
  "settings.jarvis.diagnostics.bridge.degraded": "Unity Avatar Bridge is not connected",
  "settings.jarvis.diagnostics.bridge.error": "Unity Avatar Bridge check failed",
  "settings.general.voice.listening.title": "Listening",
  "settings.general.voice.listening.description": "Allow microphone input and speech recognition in Desktop Chat",
  "voice.mode.menu": "Voice mode: {{mode}}",
  "voice.mode.full": "Full voice",
  "voice.mode.full.description": "Listen and speak responses",
  "voice.mode.listen": "Listening only",
  "voice.mode.listen.description": "Use speech recognition without voice playback",
  "voice.mode.speak": "Speech only",
  "voice.mode.speak.description": "Speak responses without opening the microphone",
  "voice.mode.off": "Off",
  "voice.mode.off.description": "Disable listening and voice playback",
  "voice.mode.listeningDisabled": "Listening is disabled in the selected voice mode",
} as const satisfies Record<string, string>

export const CUSTOMS_FALLBACK_KEYS = new Set<string>(Object.keys(CUSTOMS_FALLBACK))

const CUSTOMS_FALLBACK_PREFIXES = [
  "avatar.presentation.",
  "desktop.researchBrowser.",
  "ui.tool.websearch.",
  "settings.avatarBridge.",
  "settings.jarvis.",
  "settings.webSearch.",
  "settings.general.voice.engine.",
  "settings.general.voice.nemotron.",
] as const

export function isCustomsFallbackKey(key: string) {
  return (
    CUSTOMS_FALLBACK_KEYS.has(key) ||
    CUSTOMS_FALLBACK_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    ["settings.tab.jarvis", "settings.tab.webSearch", "settings.tab.avatarBridge", "common.refresh"].includes(key)
  )
}
