import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import type { DesktopMenuAction } from "../desktop-menu"
import { ServerConnection } from "./server"
import type { WslServersPlatform } from "../wsl/types"
import type { UpdaterPlatform } from "../updater"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenAttachmentPickerOptions = {
  title?: string
  multiple?: boolean
  accept?: string[]
  extensions?: string[]
  defaultPath?: string
}
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
type PlatformName = "web" | "desktop"
type DesktopOS = "macos" | "windows" | "linux"
export type MicrophoneAccess = "granted" | "denied" | "restricted" | "not-determined" | "unknown"
export type SpeechRecognitionEvent = {
  type: "listening" | "partial" | "final" | "retrying" | "error"
  text?: string
  error?: string
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

export type FatalRendererErrorLog = {
  error: string
  url: string
  version?: string
  platform: PlatformName
  os?: DesktopOS
}

type PlatformBase = {
  /** App version */
  version?: string

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Open a local path in a local app (desktop only) */
  openPath?(path: string, app?: string): Promise<void>

  /** Reveal a local path in the system file manager; false when the path does not exist (desktop only) */
  revealPath?(path: string): Promise<boolean>

  /** Restart the app  */
  restart(): Promise<void>

  /** Navigate back in history */
  back(): void

  /** Navigate forward in history */
  forward(): void

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open a native attachment picker and read selected files sequentially (desktop only) */
  openAttachmentPickerDialog?(
    opts: OpenAttachmentPickerOptions,
    onFile: (file: File) => Promise<unknown>,
  ): Promise<void>

  /** Resolve the native source path for a desktop File. */
  getPathForFile?(file: File): string

  /** Open a native save file picker dialog (desktop only) */
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Stable platform window identity for window-scoped persistence */
  windowID?: string

  /** Application-global desktop updater */
  updater?: UpdaterPlatform

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Create and return the dedicated repository-free chat workspace (desktop only) */
  ensureChatWorkspace?(): Promise<string>

  /** Manage WSL sidecar servers (Electron on Windows only) */
  wslServers?: WslServersPlatform

  /** Get the preferred display backend (desktop only) */
  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  /** Set the preferred display backend (desktop only) */
  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  /** Parse markdown to HTML using native parser (desktop only, returns unprocessed code blocks) */
  parseMarkdown?(markdown: string): Promise<string>

  /** Webview zoom level (desktop only) */
  webviewZoom?: Accessor<number>

  /** Get whether native pinch/Ctrl-scroll zoom gestures are enabled (desktop only) */
  getPinchZoomEnabled?(): Promise<boolean> | boolean

  /** Allow native pinch/Ctrl-scroll zoom gestures (desktop only) */
  setPinchZoomEnabled?(enabled: boolean): Promise<void> | void

  /** Run a desktop-only menu action from the app chrome */
  runDesktopMenuAction?(action: DesktopMenuAction): Promise<void> | void

  /** Check if an editor app exists (desktop only) */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard (desktop only) */
  readClipboardImage?(): Promise<File | null>

  /** Ask the operating system for microphone access (desktop only) */
  requestMicrophoneAccess?(): Promise<MicrophoneAccess>

  /** Recognize one spoken utterance using the operating system speech service (desktop only) */
  recognizeSpeech?(locale: string): Promise<string>

  /** Stop an active operating system speech recognition request (desktop only) */
  stopSpeechRecognition?(): Promise<void>

  /** Subscribe to the normalized live microphone level reported by native recognition. */
  onSpeechRecognitionLevel?(callback: (level: number) => void): () => void

  /** Subscribe to partial and final native speech recognition results. */
  onSpeechRecognitionEvent?(callback: (event: SpeechRecognitionEvent) => void): () => void

  /** Synthesize speech through a user-managed local OpenAI-compatible TTS endpoint. */
  synthesizeLocalSpeech?(input: {
    provider?: "local" | "fish-local"
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
  }): Promise<{
    audio: Blob
    metrics: { cache: string; prepareMs: number; synthesisMs: number; totalMs: number }
  }>

  /** Read the locally persisted Fish Audio voice reference. */
  getFishAudioLocalReference?(): Promise<
    { filename: string; contentType: string; transcript: string; bytes: number } | undefined
  >

  /** Check the user-managed Fish Speech API without sending voice data. */
  getFishAudioLocalStatus?(endpoint: string): Promise<{
    status: "ready" | "offline" | "error"
    endpoint: string
    latencyMs?: number
    detail?: string
  }>

  /** Persist a Fish Audio voice reference on this computer. */
  setFishAudioLocalReference?(input: {
    filename: string
    contentType: string
    audio: ArrayBuffer
    transcript: string
  }): Promise<{ filename: string; contentType: string; transcript: string; bytes: number }>

  /** Delete the locally persisted Fish Audio voice reference. */
  clearFishAudioLocalReference?(): Promise<void>

  /** Cancel an in-flight local TTS request. */
  cancelLocalSpeech?(): Promise<void>

  /** Append one event to the durable per-session voice JSONL log. */
  appendVoiceDiagnostic?(input: VoiceDiagnosticInput): Promise<void>

  /** Read the current session's recent voice timeline and local log path. */
  getVoiceDiagnostics?(sessionID: string): Promise<{ path: string; entries: VoiceDiagnosticEntry[] }>

  /** Clear one session's voice log, or every voice log when no session is supplied. */
  clearVoiceDiagnostics?(sessionID?: string): Promise<{ files: number; bytes: number }>
  exportVoiceDiagnostics?(sessionID: string): Promise<string>

  /** Persist one microphone utterance as a local WAV file outside the JSONL event log. */
  storeVoiceTurnAudio?(input: {
    sessionID: string
    turnID: string
    pcm: ArrayBuffer
    sampleRate: number
  }): Promise<{ path: string; bytes: number; durationMs: number; sampleRate: number }>

  /** Read the WAV recording associated with one durable voice turn. */
  getVoiceTurnAudio?(
    sessionID: string,
    turnID: string,
  ): Promise<{ path: string; contentType: string; audio: ArrayBuffer } | undefined>

  /** Export collected diagnostic logs (desktop only) */
  exportDebugLogs?(): Promise<string>

  /** Clear collected diagnostic and per-session logs (desktop only) */
  clearDebugLogs?(): Promise<{ files: number; bytes: number }>

  /** Force focus styles on interactive elements through desktop devtools (desktop only) */
  setForceFocus?(enabled: boolean): Promise<void>

  /** Record a fatal renderer error in platform logs (desktop only) */
  recordFatalRendererError?(error: FatalRendererErrorLog): Promise<void>
}

export type Platform = PlatformBase &
  (
    | { platform: "web"; os?: never }
    | {
        platform: "desktop"
        os?: DesktopOS
        openDirectoryPickerDialog(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>
      }
  )

export type DisplayBackend = "auto" | "wayland"

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
