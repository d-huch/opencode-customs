import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ElectronAPI, WslServersEvent } from "./types"
import type { UpdaterState } from "@opencode-ai/app/updater"

const updaterCallbacks = new Set<(state: UpdaterState) => void>()
let updaterState: UpdaterState | undefined
let updaterSubscription: Promise<void> | undefined
const updaterHandler = (_: unknown, state: UpdaterState) => {
  updaterState = state
  updaterCallbacks.forEach((callback) => callback(state))
}

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: () => ipcRenderer.invoke("await-initialization"),
  wslServers: {
    getState: () => ipcRenderer.invoke("wsl-servers-get-state"),
    subscribe: (cb) => {
      const handler = (_: unknown, event: WslServersEvent) => cb(event)
      ipcRenderer.on("wsl-servers-event", handler)
      void ipcRenderer.invoke("wsl-servers-subscribe")
      return () => {
        ipcRenderer.removeListener("wsl-servers-event", handler)
        void ipcRenderer.invoke("wsl-servers-unsubscribe")
      }
    },
    probeRuntime: () => ipcRenderer.invoke("wsl-servers-probe-runtime"),
    refreshDistros: () => ipcRenderer.invoke("wsl-servers-refresh-distros"),
    installWsl: () => ipcRenderer.invoke("wsl-servers-install-wsl"),
    installDistro: (name) => ipcRenderer.invoke("wsl-servers-install-distro", name),
    probeAddable: (distros) => ipcRenderer.invoke("wsl-servers-probe-addable", distros),
    installOpencode: (name) => ipcRenderer.invoke("wsl-servers-install-opencode", name),
    openTerminal: (name) => ipcRenderer.invoke("wsl-servers-open-terminal", name),
    addServer: (distro) => ipcRenderer.invoke("wsl-servers-add", distro),
    removeServer: (id) => ipcRenderer.invoke("wsl-servers-remove", id),
    startServer: (id) => ipcRenderer.invoke("wsl-servers-start", id),
  },
  updater: {
    subscribe: async (cb) => {
      updaterCallbacks.add(cb)
      if (updaterState) cb(updaterState)
      if (!updaterSubscription) {
        ipcRenderer.on("updater-state", updaterHandler)
        updaterSubscription = ipcRenderer.invoke("updater-subscribe")
      }
      await updaterSubscription
      return () => {
        updaterCallbacks.delete(cb)
        if (updaterCallbacks.size > 0) return
        ipcRenderer.removeListener("updater-state", updaterHandler)
        updaterSubscription = undefined
        void ipcRenderer.invoke("updater-unsubscribe")
      }
    },
    check: () => ipcRenderer.invoke("updater-check"),
    install: () => ipcRenderer.invoke("updater-install"),
  },
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  isFirstLaunchOnboardingPending: () => ipcRenderer.invoke("is-first-launch-onboarding-pending"),
  finishFirstLaunchOnboarding: (createDefaultProject) =>
    ipcRenderer.invoke("finish-first-launch-onboarding", createDefaultProject),
  isOldLayoutEligible: () => ipcRenderer.invoke("is-old-layout-eligible"),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),
  draftGet: (key) => ipcRenderer.invoke("draft-get", key),
  draftSet: (key, value) => ipcRenderer.invoke("draft-set", key, value),
  draftDelete: (key) => ipcRenderer.invoke("draft-delete", key),
  draftBlobPut: (data) => ipcRenderer.invoke("draft-blob-put", data),
  draftBlobGet: (id) => ipcRenderer.invoke("draft-blob-get", id),

  getWindowID: () => ipcRenderer.invoke("get-window-id"),
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  readPickedFile: (token, path) => ipcRenderer.invoke("read-picked-file", token, path),
  releasePickedFiles: (token) => ipcRenderer.invoke("release-picked-files", token),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  openLocalFile: (url) => ipcRenderer.send("open-local-file", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  revealPath: (path) => ipcRenderer.invoke("reveal-path", path),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  requestMicrophoneAccess: () => ipcRenderer.invoke("request-microphone-access"),
  recognizeSpeech: (locale) => ipcRenderer.invoke("recognize-speech", locale),
  stopSpeechRecognition: () => ipcRenderer.invoke("stop-speech-recognition"),
  onSpeechRecognitionLevel: (cb) => {
    const handler = (_: unknown, level: number) => cb(level)
    ipcRenderer.on("speech-recognition-level", handler)
    return () => ipcRenderer.removeListener("speech-recognition-level", handler)
  },
  onSpeechRecognitionEvent: (cb) => {
    const handler = (_: unknown, event: Parameters<typeof cb>[0]) => cb(event)
    ipcRenderer.on("speech-recognition-event", handler)
    return () => ipcRenderer.removeListener("speech-recognition-event", handler)
  },
  synthesizeLocalSpeech: (input) => ipcRenderer.invoke("synthesize-local-speech", input),
  getFishAudioLocalReference: () => ipcRenderer.invoke("get-fish-audio-local-reference"),
  getFishAudioLocalStatus: (endpoint) => ipcRenderer.invoke("get-fish-audio-local-status", endpoint),
  setFishAudioLocalReference: (input) => ipcRenderer.invoke("set-fish-audio-local-reference", input),
  clearFishAudioLocalReference: () => ipcRenderer.invoke("clear-fish-audio-local-reference"),
  listFishAudioVoicePresets: () => ipcRenderer.invoke("list-fish-audio-voice-presets"),
  saveFishAudioVoicePreset: (input) => ipcRenderer.invoke("save-fish-audio-voice-preset", input),
  activateFishAudioVoicePreset: (id) => ipcRenderer.invoke("activate-fish-audio-voice-preset", id),
  deleteFishAudioVoicePreset: (id) => ipcRenderer.invoke("delete-fish-audio-voice-preset", id),
  cancelLocalSpeech: () => ipcRenderer.invoke("cancel-local-speech"),
  appendVoiceDiagnostic: (input) => ipcRenderer.invoke("append-voice-diagnostic", input),
  getVoiceDiagnostics: (sessionID) => ipcRenderer.invoke("get-voice-diagnostics", sessionID),
  clearVoiceDiagnostics: (sessionID) => ipcRenderer.invoke("clear-voice-diagnostics", sessionID),
  exportVoiceDiagnostics: (sessionID) => ipcRenderer.invoke("export-voice-diagnostics", sessionID),
  storeVoiceTurnAudio: (input) => ipcRenderer.invoke("store-voice-turn-audio", input),
  getVoiceTurnAudio: (sessionID, turnID) => ipcRenderer.invoke("get-voice-turn-audio", sessionID, turnID),
  getNemotronVoiceStatus: () => ipcRenderer.invoke("get-nemotron-voice-status"),
  configureNemotronVoice: (input) => ipcRenderer.invoke("configure-nemotron-voice", input),
  installNemotronVoice: () => ipcRenderer.invoke("install-nemotron-voice"),
  startNemotronVoice: () => ipcRenderer.invoke("start-nemotron-voice"),
  stopNemotronVoice: () => ipcRenderer.invoke("stop-nemotron-voice"),
  beginNemotronVoice: (input) => ipcRenderer.invoke("begin-nemotron-voice", input),
  appendNemotronVoice: (input) => ipcRenderer.send("append-nemotron-voice", input),
  commitNemotronVoice: (requestID) => ipcRenderer.invoke("commit-nemotron-voice", requestID),
  cancelNemotronVoice: (requestID) => ipcRenderer.invoke("cancel-nemotron-voice", requestID),
  onNemotronVoiceEvent: (cb) => {
    const handler = (_: unknown, event: Parameters<typeof cb>[0]) => cb(event)
    ipcRenderer.on("nemotron-voice-event", handler)
    void ipcRenderer.invoke("subscribe-nemotron-voice")
    return () => {
      ipcRenderer.removeListener("nemotron-voice-event", handler)
      void ipcRenderer.invoke("unsubscribe-nemotron-voice")
    }
  },
  getResearchBrowserStatus: () => ipcRenderer.invoke("get-research-browser-status"),
  showResearchBrowser: () => ipcRenderer.invoke("show-research-browser"),
  clearResearchBrowserData: () => ipcRenderer.invoke("clear-research-browser-data"),
  getAvatarBridgeStatus: () => ipcRenderer.invoke("get-avatar-bridge-status"),
  routeAvatarSpeech: (sessionID, text) => ipcRenderer.invoke("route-avatar-speech", sessionID, text),
  selectAvatarModel: () => ipcRenderer.invoke("select-avatar-model"),
  getAvatarModel: () => ipcRenderer.invoke("get-avatar-model"),
  clearAvatarModel: () => ipcRenderer.invoke("clear-avatar-model"),
  updateAvatarBridgeConfig: (input) => ipcRenderer.invoke("update-avatar-bridge-config", input),
  startAvatarBridgePairing: () => ipcRenderer.invoke("start-avatar-bridge-pairing"),
  cancelAvatarBridgePairing: () => ipcRenderer.invoke("cancel-avatar-bridge-pairing"),
  retryAvatarBridgeSync: () => ipcRenderer.invoke("retry-avatar-bridge-sync"),
  revokeAvatarBridgeDevice: (id) => ipcRenderer.invoke("revoke-avatar-bridge-device", id),
  resolveAvatarBridgeApproval: (id, approved) => ipcRenderer.invoke("resolve-avatar-bridge-approval", id, approved),
  deleteAvatarBridgeMemory: (id) => ipcRenderer.invoke("delete-avatar-bridge-memory", id),
  updateAvatarBridgeMemory: (id, text) => ipcRenderer.invoke("update-avatar-bridge-memory", id, text),
  clearAvatarBridgeMemories: (filter) => ipcRenderer.invoke("clear-avatar-bridge-memories", filter),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  getWindowFullscreen: () => ipcRenderer.invoke("get-window-fullscreen"),
  onWindowFullscreenChanged: (cb) => {
    const handler = (_: unknown, fullscreen: boolean) => cb(fullscreen)
    ipcRenderer.on("window-fullscreen-changed", handler)
    return () => ipcRenderer.removeListener("window-fullscreen-changed", handler)
  },
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  getPinchZoomEnabled: () => ipcRenderer.invoke("get-pinch-zoom-enabled"),
  setPinchZoomEnabled: (enabled) => ipcRenderer.invoke("set-pinch-zoom-enabled", enabled),
  onPinchZoomEnabledChanged: (cb) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on("pinch-zoom-enabled-changed", handler)
    return () => ipcRenderer.removeListener("pinch-zoom-enabled-changed", handler)
  },
  onZoomFactorChanged: (cb) => {
    const handler = (_: unknown, factor: number) => cb(factor)
    ipcRenderer.on("zoom-factor-changed", handler)
    return () => ipcRenderer.removeListener("zoom-factor-changed", handler)
  },
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  runDesktopMenuAction: (action) => ipcRenderer.invoke("run-desktop-menu-action", action),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  exportDebugLogs: () => ipcRenderer.invoke("export-debug-logs"),
  clearDebugLogs: () => ipcRenderer.invoke("clear-debug-logs"),
  setForceFocus: (enabled) => ipcRenderer.invoke("set-force-focus", enabled),
  recordFatalRendererError: (error) => ipcRenderer.invoke("record-fatal-renderer-error", error),
  setNativeTranslations: (bundle) => ipcRenderer.invoke("set-native-translations", bundle),
}

contextBridge.exposeInMainWorld("api", api)
