import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { app, BrowserWindow, Notification, clipboard, dialog, ipcMain, shell, systemPreferences } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"

import type {
  AvatarBridgeStatus,
  FatalRendererError,
  ResearchBrowserStatus,
  ServerReadyData,
  TitlebarTheme,
} from "../preload/types"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { setForceFocus } from "./debug"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { getStore, removeStoreFileIfEmpty } from "./store"
import {
  getPinchZoomEnabled,
  getWindowID,
  openExternalURL,
  openLocalFileURL,
  setPinchZoomEnabled,
  setTitlebar,
  updateTitlebar,
} from "./windows"
import type { UpdaterController } from "./updater-controller"
import { createUpdaterSubscriptions } from "./updater-subscriptions"
import { createNativeVoiceController } from "./native-voice"
import { synthesizeLocalSpeech, type LocalTTSInput } from "./local-tts"
import {
  activateFishAudioVoicePreset,
  clearFishAudioLocalReference,
  deleteFishAudioVoicePreset,
  getFishAudioLocalReference,
  getFishAudioLocalStatus,
  listFishAudioVoicePresets,
  saveFishAudioVoicePreset,
  setFishAudioLocalReference,
  type FishAudioLocalReferenceInput,
  type FishAudioVoicePresetInput,
} from "./fish-audio"
import {
  appendVoiceDiagnostic,
  clearVoiceDiagnostics,
  exportVoiceDiagnostics,
  getVoiceDiagnostics,
  getVoiceTurnAudio,
  storeVoiceTurnAudio,
  type VoiceDiagnosticInput,
  type VoiceTurnAudioInput,
} from "./voice-diagnostics"
import { createDesktopDraftStore } from "./draft-store"
import { nativeT } from "./native-translations"
import { createAvatarModelStore } from "./avatar-model"
import type { NemotronVoiceController, NemotronVoiceEngine, NemotronVoiceStatus } from "./nemotron-voice"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: nativeT("desktop.dialog.files"), extensions: ext }]
}

const pickedFiles = createPickedFileAuthorizations()

type Deps = {
  killSidecar: () => Promise<void> | void
  relaunch: () => void
  awaitInitialization: () => Promise<ServerReadyData>
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  isFirstLaunchOnboardingPending: () => Promise<boolean> | boolean
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null> | string | null
  isOldLayoutEligible: () => Promise<boolean> | boolean
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  resolveAppPath: (appName: string) => Promise<string | null>
  updater: UpdaterController
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  clearDebugLogs: () => Promise<{ files: number; bytes: number }>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
  getResearchBrowserStatus: () => ResearchBrowserStatus
  showResearchBrowser: () => Promise<void>
  clearResearchBrowserData: () => Promise<void>
  getAvatarBridgeStatus: () => AvatarBridgeStatus
  routeAvatarSpeech: (sessionID: string, text: string) => Promise<boolean>
  updateAvatarBridgeConfig: (input: {
    lanEnabled?: boolean
    interactionAutoApprove?: boolean
    maximumActionsPerCycle?: number
    cycleTimeoutMs?: number
    attentionThreshold?: number
    attentionCooldownMs?: number
    plannerEscalationMinWords?: number
    plannerIdleUnloadMs?: number
    dialogueModel?: { providerID: string; modelID: string }
    plannerModel?: { providerID: string; modelID: string }
    trustedProfiles?: Array<{
      gameID: string
      allowInteraction: boolean
      allowedCriticalCategories: string[]
    }>
  }) => Promise<unknown>
  startAvatarBridgePairing: () => unknown
  cancelAvatarBridgePairing: () => unknown
  retryAvatarBridgeSync: () => unknown
  revokeAvatarBridgeDevice: (id: string) => Promise<unknown>
  resolveAvatarBridgeApproval: (id: string, approved: boolean) => boolean
  deleteAvatarBridgeMemory: (id: string) => Promise<unknown>
  updateAvatarBridgeMemory: (
    id: string,
    input: string | { text?: string; pinned?: boolean; confidence?: number; importance?: number },
  ) => Promise<unknown>
  clearAvatarBridgeMemories: (filter?: { gameID?: string; saveSlotID?: string; characterID?: string }) => Promise<unknown>
  getNemotronVoiceStatus: () => Promise<NemotronVoiceStatus>
  configureNemotronVoice: (input: { engine: NemotronVoiceEngine; systemPrompt?: string }) => Promise<NemotronVoiceStatus>
  installNemotronVoice: () => Promise<NemotronVoiceStatus>
  startNemotronVoice: () => Promise<NemotronVoiceStatus>
  stopNemotronVoice: () => Promise<void>
  beginNemotronVoice: Parameters<NemotronVoiceController["begin"]>[0] extends infer Input ? (input: Input) => Promise<void> : never
  appendNemotronVoice: Parameters<NemotronVoiceController["append"]>[0] extends infer Input ? (input: Input) => boolean : never
  commitNemotronVoice: (requestID: string) => Promise<void>
  cancelNemotronVoice: (requestID?: string) => Promise<void>
  subscribeNemotronVoice: NemotronVoiceController["subscribe"]
}

export function registerIpcHandlers(deps: Deps) {
  const drafts = createDesktopDraftStore(join(app.getPath("userData"), "drafts.sqlite"))
  const avatarModels = createAvatarModelStore({
    userDataPath: app.getPath("userData"),
    bundledModelPath: join(app.getAppPath(), "resources", "avatar", "Vita.vrm"),
  })
  const updaterSubscriptions = createUpdaterSubscriptions()
  const nativeVoice = createNativeVoiceController()
  const localSpeech = new Map<number, AbortController>()
  app.once("will-quit", updaterSubscriptions.clear)
  app.once("will-quit", () => nativeVoice.stopAll())
  app.once("will-quit", () => localSpeech.forEach((request) => request.abort()))
  const nemotronSubscriptions = new Map<number, () => void>()
  app.once("will-quit", () => nemotronSubscriptions.forEach((unsubscribe) => unsubscribe()))
  app.on("before-quit", () => drafts.flush())
  app.once("will-quit", () => drafts.close())
  app.on("browser-window-created", (_event, win) => win.on("session-end", () => drafts.flush()))

  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("await-initialization", () => deps.awaitInitialization())
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  ipcMain.handle("is-first-launch-onboarding-pending", () => deps.isFirstLaunchOnboardingPending())
  ipcMain.handle("finish-first-launch-onboarding", (_event: IpcMainInvokeEvent, createDefaultProject: boolean) =>
    deps.finishFirstLaunchOnboarding(createDefaultProject),
  )
  ipcMain.handle("is-old-layout-eligible", () => deps.isOldLayoutEligible())
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend())
  ipcMain.handle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  ipcMain.handle("updater-subscribe", (event) => {
    const id = event.sender.id
    updaterSubscriptions.set(
      id,
      deps.updater.subscribe((state) => {
        if (event.sender.isDestroyed()) return updaterSubscriptions.delete(id)
        event.sender.send("updater-state", state)
      }),
    )
    event.sender.once("destroyed", () => updaterSubscriptions.delete(id))
  })
  ipcMain.handle("updater-unsubscribe", (event) => updaterSubscriptions.delete(event.sender.id))
  ipcMain.handle("updater-check", () => deps.updater.check())
  ipcMain.handle("updater-install", () => deps.updater.install())
  ipcMain.handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  ipcMain.handle("export-debug-logs", () => deps.exportDebugLogs())
  ipcMain.handle("clear-debug-logs", () => deps.clearDebugLogs())
  ipcMain.handle("get-research-browser-status", () => deps.getResearchBrowserStatus())
  ipcMain.handle("show-research-browser", () => deps.showResearchBrowser())
  ipcMain.handle("clear-research-browser-data", () => deps.clearResearchBrowserData())
  ipcMain.handle("get-avatar-bridge-status", () => deps.getAvatarBridgeStatus())
  ipcMain.handle("get-nemotron-voice-status", () => deps.getNemotronVoiceStatus())
  ipcMain.handle("configure-nemotron-voice", (_event, input: { engine: NemotronVoiceEngine; systemPrompt?: string }) =>
    deps.configureNemotronVoice(input),
  )
  ipcMain.handle("install-nemotron-voice", () => deps.installNemotronVoice())
  ipcMain.handle("start-nemotron-voice", () => deps.startNemotronVoice())
  ipcMain.handle("stop-nemotron-voice", () => deps.stopNemotronVoice())
  ipcMain.handle("begin-nemotron-voice", (_event, input: Parameters<NemotronVoiceController["begin"]>[0]) =>
    deps.beginNemotronVoice(input),
  )
  ipcMain.on("append-nemotron-voice", (_event, input: Parameters<NemotronVoiceController["append"]>[0]) => {
    deps.appendNemotronVoice(input)
  })
  ipcMain.handle("commit-nemotron-voice", (_event, requestID: string) => deps.commitNemotronVoice(requestID))
  ipcMain.handle("cancel-nemotron-voice", (_event, requestID?: string) => deps.cancelNemotronVoice(requestID))
  ipcMain.handle("subscribe-nemotron-voice", (event) => {
    const id = event.sender.id
    nemotronSubscriptions.get(id)?.()
    nemotronSubscriptions.set(id, deps.subscribeNemotronVoice((value) => {
      if (event.sender.isDestroyed()) return
      event.sender.send("nemotron-voice-event", value)
    }))
    event.sender.once("destroyed", () => {
      nemotronSubscriptions.get(id)?.()
      nemotronSubscriptions.delete(id)
    })
  })
  ipcMain.handle("unsubscribe-nemotron-voice", (event) => {
    nemotronSubscriptions.get(event.sender.id)?.()
    nemotronSubscriptions.delete(event.sender.id)
  })
  ipcMain.handle("route-avatar-speech", (_event: IpcMainInvokeEvent, sessionID: string, text: string) => {
    if (!sessionID || !text || text.length > 100_000) throw new Error("Invalid avatar speech request")
    return deps.routeAvatarSpeech(sessionID, text)
  })
  ipcMain.handle("select-avatar-model", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      title: "Choose Jarvis VRM model",
      filters: [{ name: "VRM avatar", extensions: ["vrm"] }],
    })
    if (result.canceled) return null
    const source = result.filePaths[0]
    if (!source) return null
    return avatarModels.install(source)
  })
  ipcMain.handle("get-avatar-model", () => avatarModels.get())
  ipcMain.handle("clear-avatar-model", () => avatarModels.clear())
  ipcMain.handle("update-avatar-bridge-config", (_event: IpcMainInvokeEvent, input) =>
    deps.updateAvatarBridgeConfig(input),
  )
  ipcMain.handle("start-avatar-bridge-pairing", () => deps.startAvatarBridgePairing())
  ipcMain.handle("cancel-avatar-bridge-pairing", () => deps.cancelAvatarBridgePairing())
  ipcMain.handle("retry-avatar-bridge-sync", () => deps.retryAvatarBridgeSync())
  ipcMain.handle("revoke-avatar-bridge-device", (_event: IpcMainInvokeEvent, id: string) =>
    deps.revokeAvatarBridgeDevice(id),
  )
  ipcMain.handle(
    "resolve-avatar-bridge-approval",
    (_event: IpcMainInvokeEvent, id: string, approved: boolean) => deps.resolveAvatarBridgeApproval(id, approved),
  )
  ipcMain.handle("delete-avatar-bridge-memory", (_event: IpcMainInvokeEvent, id: string) =>
    deps.deleteAvatarBridgeMemory(id),
  )
  ipcMain.handle("update-avatar-bridge-memory", (_event: IpcMainInvokeEvent, id: string, input) =>
    deps.updateAvatarBridgeMemory(id, input),
  )
  ipcMain.handle("clear-avatar-bridge-memories", (_event: IpcMainInvokeEvent, filter) =>
    deps.clearAvatarBridgeMemories(filter),
  )
  ipcMain.handle("set-force-focus", (event: IpcMainInvokeEvent, enabled: boolean) =>
    setForceFocus(event.sender, enabled),
  )
  ipcMain.handle("record-fatal-renderer-error", (_event: IpcMainInvokeEvent, error: FatalRendererError) =>
    deps.recordFatalRendererError(error),
  )
  ipcMain.handle("set-native-translations", (event: IpcMainInvokeEvent, value: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Invalid native translation sender")
    }
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })
  ipcMain.handle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    try {
      const store = getStore(name)
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  ipcMain.handle("store-set", (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
    getStore(name).set(key, value)
  })
  ipcMain.handle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    getStore(name).delete(key)
    void removeStoreFileIfEmpty(name)
  })
  ipcMain.handle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    getStore(name).clear()
    void removeStoreFileIfEmpty(name)
  })
  ipcMain.handle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  ipcMain.handle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })
  ipcMain.handle("draft-get", (_event, key: string) => drafts.get(key))
  ipcMain.handle("draft-set", (_event, key: string, value: string) => drafts.set(key, value))
  ipcMain.handle("draft-delete", (_event, key: string) => drafts.set(key, null))
  ipcMain.handle("draft-blob-put", (_event, data: ArrayBuffer) => drafts.putBlob(new Uint8Array(data)))
  ipcMain.handle("draft-blob-get", (_event, id: string) => {
    const data = drafts.getBlob(id)
    return data ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFolder"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (
      event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFile"),
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      const files = await Promise.all(
        result.filePaths.map(async (filePath) => ({
          path: filePath,
          name: basename(filePath),
          size: (await stat(filePath)).size,
        })),
      )
      assertAttachmentBudget(files)
      const token = pickedFiles.add(event.sender.id, result.filePaths)
      return { token, files }
    },
  )

  ipcMain.handle("read-picked-file", async (event: IpcMainInvokeEvent, token: string, filePath: string) => {
    return pickedFiles.read(event.sender.id, token, filePath)
  })

  ipcMain.handle("release-picked-files", (event: IpcMainInvokeEvent, token: string) => {
    pickedFiles.release(event.sender.id, token)
  })

  ipcMain.handle(
    "save-file-picker",
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? nativeT("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

  ipcMain.on("open-external", (_event: IpcMainEvent, url: string) => {
    openExternalURL(url)
  })

  ipcMain.on("open-local-file", (_event: IpcMainEvent, url: string) => {
    openLocalFileURL(url)
  })

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  ipcMain.handle("reveal-path", async (_event: IpcMainInvokeEvent, path: string) => {
    const exists = await stat(path).then(
      () => true,
      () => false,
    )
    if (!exists) return false
    shell.showItemInFolder(path)
    return true
  })

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })
  ipcMain.handle("request-microphone-access", async () => {
    if (process.platform !== "darwin") return "granted"
    const status = systemPreferences.getMediaAccessStatus("microphone")
    if (status !== "not-determined") return status
    const granted = await systemPreferences.askForMediaAccess("microphone")
    if (granted) return "granted"
    return systemPreferences.getMediaAccessStatus("microphone")
  })
  ipcMain.handle("recognize-speech", (event: IpcMainInvokeEvent, locale: string) =>
    nativeVoice.recognize(event.sender, locale),
  )
  ipcMain.handle("stop-speech-recognition", (event: IpcMainInvokeEvent) => nativeVoice.stop(event.sender.id))
  ipcMain.handle("synthesize-local-speech", async (event: IpcMainInvokeEvent, input: LocalTTSInput) => {
    const request = new AbortController()
    localSpeech.set(event.sender.id, request)
    return synthesizeLocalSpeech(input, request.signal).finally(() => {
      if (localSpeech.get(event.sender.id) !== request) return
      localSpeech.delete(event.sender.id)
    })
  })
  ipcMain.handle("get-fish-audio-local-reference", () => getFishAudioLocalReference())
  ipcMain.handle("get-fish-audio-local-status", (_event: IpcMainInvokeEvent, endpoint: string) =>
    getFishAudioLocalStatus(endpoint),
  )
  ipcMain.handle("set-fish-audio-local-reference", (_event: IpcMainInvokeEvent, input: FishAudioLocalReferenceInput) =>
    setFishAudioLocalReference(input),
  )
  ipcMain.handle("clear-fish-audio-local-reference", () => clearFishAudioLocalReference())
  ipcMain.handle("list-fish-audio-voice-presets", () => listFishAudioVoicePresets())
  ipcMain.handle("save-fish-audio-voice-preset", (_event: IpcMainInvokeEvent, input: FishAudioVoicePresetInput) =>
    saveFishAudioVoicePreset(input),
  )
  ipcMain.handle("activate-fish-audio-voice-preset", (_event: IpcMainInvokeEvent, id: string) =>
    activateFishAudioVoicePreset(id),
  )
  ipcMain.handle("delete-fish-audio-voice-preset", (_event: IpcMainInvokeEvent, id: string) =>
    deleteFishAudioVoicePreset(id),
  )
  ipcMain.handle("cancel-local-speech", (event: IpcMainInvokeEvent) => {
    localSpeech.get(event.sender.id)?.abort()
    localSpeech.delete(event.sender.id)
  })
  ipcMain.handle("append-voice-diagnostic", (_event: IpcMainInvokeEvent, input: VoiceDiagnosticInput) =>
    appendVoiceDiagnostic(input),
  )
  ipcMain.handle("get-voice-diagnostics", (_event: IpcMainInvokeEvent, sessionID: string) =>
    getVoiceDiagnostics(sessionID),
  )
  ipcMain.handle("clear-voice-diagnostics", (_event: IpcMainInvokeEvent, sessionID?: string) =>
    clearVoiceDiagnostics(sessionID),
  )
  ipcMain.handle("export-voice-diagnostics", (_event: IpcMainInvokeEvent, sessionID: string) =>
    exportVoiceDiagnostics(sessionID),
  )
  ipcMain.handle("store-voice-turn-audio", (_event: IpcMainInvokeEvent, input: VoiceTurnAudioInput) =>
    storeVoiceTurnAudio(input),
  )
  ipcMain.handle("get-voice-turn-audio", (_event: IpcMainInvokeEvent, sessionID: string, turnID: string) =>
    getVoiceTurnAudio(sessionID, turnID),
  )

  ipcMain.handle("get-window-id", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error("Window not found")
    const id = getWindowID(win)
    if (!id) throw new Error("Window ID not found")
    return id
  })

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.handle("get-window-fullscreen", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  ipcMain.handle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  ipcMain.handle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  ipcMain.on("relaunch", () => {
    deps.relaunch()
  })

  ipcMain.handle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  ipcMain.handle("get-pinch-zoom-enabled", () => getPinchZoomEnabled())
  ipcMain.handle("set-pinch-zoom-enabled", (_event: IpcMainInvokeEvent, enabled: boolean) => {
    setPinchZoomEnabled(enabled)
  })
  ipcMain.handle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  ipcMain.handle("run-desktop-menu-action", (event: IpcMainInvokeEvent, action: DesktopMenuAction) => {
    runDesktopMenuAction(BrowserWindow.fromWebContents(event.sender), action, {
      checkForUpdates: () => void deps.showUpdater(),
      relaunch: deps.relaunch,
    })
  })
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
