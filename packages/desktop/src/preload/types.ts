import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { WslServersPlatform } from "@opencode-ai/app/wsl/types"
import type { UpdaterState } from "@opencode-ai/app/updater"
import type { DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"
export type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "@opencode-ai/app/wsl/types"

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type WslServersAPI = WslServersPlatform
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type LinuxDisplayBackend = "wayland" | "auto"
export type MicrophoneAccess = "granted" | "denied" | "restricted" | "not-determined" | "unknown"
export type SpeechRecognitionEvent = {
  type: "listening" | "partial" | "final" | "retrying" | "error"
  text?: string
  error?: string
}
export type LocalTTSInput = {
  provider?: "local" | "fish-local"
  fishPresetID?: string
  endpoint: string
  model: string
  voice: string
  mode: "quality" | "fast"
  speed?: number
  text: string
  latency?: "normal" | "balanced"
  language?: "auto" | "uk" | "en" | "mixed"
  temperature?: number
  topP?: number
  repetitionPenalty?: number
  seed?: number | null
  chunkLength?: number
  normalize?: boolean
  streaming?: boolean
  useMemoryCache?: boolean
  maxNewTokens?: number
}
export type FishAudioLocalReference = {
  filename: string
  contentType: string
  transcript: string
  bytes: number
}
export type FishAudioLocalReferenceInput = {
  filename: string
  contentType: string
  audio: ArrayBuffer
  transcript: string
}
export type FishAudioVoicePreset = FishAudioLocalReference & {
  id: string
  name: string
  createdAt: string
  active: boolean
}
export type FishAudioVoicePresetInput = FishAudioLocalReferenceInput & {
  name: string
  activate?: boolean
}
export type VoiceDiagnosticInput = {
  sessionID: string
  turnID?: string
  source: "agent" | "stt" | "tts" | "ui" | "replay"
  event: string
  state?: string
  text?: string
  error?: string
  generation?: number
  level?: number
  durationMs?: number
  diagnostics?: Record<string, string | number | boolean | null | undefined>
}
export type VoiceDiagnosticEntry = VoiceDiagnosticInput & { timestamp: string }
export type VoiceTurnAudioInput = { sessionID: string; turnID: string; pcm: ArrayBuffer; sampleRate: number }
export type TitlebarTheme = {
  mode: "light" | "dark"
  scheme?: "system" | "light" | "dark"
}
export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

export type ResearchBrowserStatus = {
  available: boolean
  phase: "idle" | "searching" | "reading" | "waiting_user" | "requires_user" | "failed"
  engine: "duckduckgo" | "google" | "bing"
  visible: boolean
  query?: string
  url?: string
  domain?: string
  resultCount?: number
  message?: string
}

export type AvatarBridgeStatus = {
  available: boolean
  protocol: number
  url?: string
  token?: string
  message?: string
  connectedClients: Array<{
    clientID: string
    characterID: string
    sessionID?: string
    actions: string[]
  }>
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: () => Promise<ServerReadyData>
  wslServers: WslServersAPI
  updater: UpdaterAPI
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  isFirstLaunchOnboardingPending: () => Promise<boolean>
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null>
  isOldLayoutEligible: () => Promise<boolean>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  checkAppExists: (appName: string) => Promise<boolean>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>
  draftGet: (key: string) => Promise<string | null>
  draftSet: (key: string, value: string) => Promise<void>
  draftDelete: (key: string) => Promise<void>
  draftBlobPut: (data: ArrayBuffer) => Promise<string>
  draftBlobGet: (id: string) => Promise<ArrayBuffer | null>

  getWindowID: () => Promise<string>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
  }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
  readPickedFile: (token: string, path: string) => Promise<ArrayBuffer>
  releasePickedFiles: (token: string) => Promise<void>
  getPathForFile: (file: File) => string
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openExternal: (url: string) => void
  openLocalFile: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  revealPath: (path: string) => Promise<boolean>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  requestMicrophoneAccess: () => Promise<MicrophoneAccess>
  recognizeSpeech: (locale: string) => Promise<string>
  stopSpeechRecognition: () => Promise<void>
  onSpeechRecognitionLevel: (cb: (level: number) => void) => () => void
  onSpeechRecognitionEvent: (cb: (event: SpeechRecognitionEvent) => void) => () => void
  synthesizeLocalSpeech: (input: LocalTTSInput) => Promise<{
    audio: ArrayBuffer
    contentType: string
    metrics: { cache: string; prepareMs: number; synthesisMs: number; totalMs: number }
  }>
  getFishAudioLocalReference: () => Promise<FishAudioLocalReference | undefined>
  getFishAudioLocalStatus: (endpoint: string) => Promise<{
    status: "ready" | "offline" | "error"
    endpoint: string
    latencyMs?: number
    detail?: string
  }>
  setFishAudioLocalReference: (input: FishAudioLocalReferenceInput) => Promise<FishAudioLocalReference>
  clearFishAudioLocalReference: () => Promise<void>
  listFishAudioVoicePresets: () => Promise<FishAudioVoicePreset[]>
  saveFishAudioVoicePreset: (input: FishAudioVoicePresetInput) => Promise<FishAudioVoicePreset>
  activateFishAudioVoicePreset: (id: string) => Promise<FishAudioVoicePreset>
  deleteFishAudioVoicePreset: (id: string) => Promise<void>
  cancelLocalSpeech: () => Promise<void>
  appendVoiceDiagnostic: (input: VoiceDiagnosticInput) => Promise<void>
  getVoiceDiagnostics: (sessionID: string) => Promise<{ path: string; entries: VoiceDiagnosticEntry[] }>
  clearVoiceDiagnostics: (sessionID?: string) => Promise<{ files: number; bytes: number }>
  exportVoiceDiagnostics: (sessionID: string) => Promise<string>
  storeVoiceTurnAudio: (
    input: VoiceTurnAudioInput,
  ) => Promise<{ path: string; bytes: number; durationMs: number; sampleRate: number }>
  getVoiceTurnAudio: (
    sessionID: string,
    turnID: string,
  ) => Promise<{ path: string; contentType: string; audio: ArrayBuffer } | undefined>
  getResearchBrowserStatus: () => Promise<ResearchBrowserStatus>
  showResearchBrowser: () => Promise<void>
  clearResearchBrowserData: () => Promise<void>
  getAvatarBridgeStatus: () => Promise<AvatarBridgeStatus>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  getWindowFullscreen: () => Promise<boolean>
  onWindowFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  clearDebugLogs: () => Promise<{ files: number; bytes: number }>
  setForceFocus: (enabled: boolean) => Promise<void>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
  setNativeTranslations: (bundle: DesktopNativeBundle) => Promise<void>
}
