import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow, dialog } from "electron"

import { Deferred, Effect, Fiber } from "effect"
import contextMenu from "electron-context-menu"

import type { ServerReadyData } from "../preload/types"
import { checkAppExists, resolveAppPath } from "./apps"
import { CHANNEL, CUSTOMS } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { forwardInitializationFailure } from "./initialization"
import {
  clearDebugLogs,
  exportDebugLogs,
  initCrashReporter,
  initLogging,
  startNetLog,
  write as writeLog,
} from "./logging"
import { createMenu } from "./menu"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import {
  getDefaultServerUrl,
  preferAppEnv,
  setDefaultServerUrl,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
} from "./windows"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrate } from "./migrate"
import { cleanupStoreFiles } from "./store-cleanup"
import { startBackgroundCli } from "./background-cli"
import { setNativeTranslations } from "./native-translations"
import { startResearchBrowser, type ResearchBrowserController } from "./research-browser"
import { startAvatarBridge, type AvatarBridgeController } from "./avatar-bridge"
import { startPCMRecognition } from "./native-voice"
import { synthesizeLocalSpeech } from "./local-tts"
import { createNemotronVoiceController, type NemotronVoiceController } from "./nemotron-voice"
import { startGoogleCompanion, type GoogleCompanionController } from "./google-companion"

const APP_NAMES: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"
const SIDECAR_VERSION = process.env.OPENCODE_SIDECAR_V2 === "1" ? "v2" : "v1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

let logger: ReturnType<typeof initLogging>
let server: SidecarListener | null = null
let researchBrowser: ResearchBrowserController | undefined
let avatarBridge: AvatarBridgeController | undefined
let nemotronVoice: NemotronVoiceController | undefined
let googleCompanion: GoogleCompanionController | undefined

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  const win = getLastFocusedWindow()
  if (win) sendDeepLinks(win, urls)
}

async function killSidecar() {
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? (CUSTOMS ? "OpenCode Customs" : APP_NAMES[CHANNEL]) : CUSTOMS ? "OpenCode Customs" : "OpenCode Dev")
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  const stopSidecars = async () => {
    await killSidecar()
    await researchBrowser?.stop()
    researchBrowser = undefined
    await avatarBridge?.stop()
    avatarBridge = undefined
    await nemotronVoice?.stop()
    nemotronVoice = undefined
    await googleCompanion?.stop()
    googleCompanion = undefined
    wslServers.stopAll()
  }
  const relaunch = () => {
    setAppQuitting()
    void stopSidecars().finally(() => {
      app.relaunch()
      app.quit()
    })
  }

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  const shellEnv = preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("will-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      setAppQuitting()
      void stopSidecars().finally(() => app.quit())
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())

  researchBrowser = yield* Effect.promise(() => startResearchBrowser()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start research browser", error)
        return undefined
      }),
    ),
  )
  if (researchBrowser) {
    process.env.OPENCODE_RESEARCH_BROWSER_URL = researchBrowser.url
    process.env.OPENCODE_RESEARCH_BROWSER_TOKEN = researchBrowser.token
  }
  googleCompanion = yield* Effect.promise(() =>
    startGoogleCompanion({ stateDirectory: join(app.getPath("userData"), "google-companion"), log: writeLog }),
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start Google Companion bridge", error)
        return undefined
      }),
    ),
  )
  if (googleCompanion) {
    process.env.OPENCODE_GOOGLE_COMPANION_URL = googleCompanion.url
    process.env.OPENCODE_GOOGLE_COMPANION_TOKEN = googleCompanion.token
  }
  nemotronVoice = createNemotronVoiceController({
    stateDirectory: join(app.getPath("userData"), "nemotron-voice"),
    log: writeLog,
  })
  avatarBridge = yield* Effect.promise(() =>
    startAvatarBridge({
      stateDirectory: join(app.getPath("userData"), "avatar-bridge"),
      log: writeLog,
      synthesize: synthesizeLocalSpeech,
      startRecognition: startPCMRecognition,
      nemotronVoice,
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start Unity Avatar Bridge", error)
        return undefined
      }),
    ),
  )
  if (avatarBridge) {
    process.env.OPENCODE_AVATAR_BRIDGE_URL = avatarBridge.url.replace("/avatar", "")
    process.env.OPENCODE_AVATAR_BRIDGE_TOKEN = avatarBridge.token
  }

  if (!TEST_ONBOARDING) migrate()
  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient("opencode")
  registerRendererProtocol()
  setDockIcon()
  const updater = setupAutoUpdater(stopSidecars)
  const menuDeps = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater, true),
    relaunch,
  }
  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    updater,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    clearDebugLogs: () => clearDebugLogs(),
    getResearchBrowserStatus: () =>
      researchBrowser?.status() ?? {
        available: false,
        phase: "failed",
        engine: "duckduckgo",
        visible: false,
        message: "Research Browser is unavailable",
      },
    showResearchBrowser: () => researchBrowser?.show() ?? Promise.reject(new Error("Research Browser is unavailable")),
    clearResearchBrowserData: () => researchBrowser?.clear() ?? Promise.resolve(),
    getGoogleCompanionStatus: () =>
      googleCompanion?.status() ?? {
        available: false,
        phase: "unavailable",
        scopes: [],
        writeScopes: [],
        checkedAt: Date.now(),
        error: "Google Companion is unavailable",
      },
    importGoogleOAuthClient: async () => {
      if (!googleCompanion) throw new Error("Google Companion is unavailable")
      const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Google OAuth JSON", extensions: ["json"] }] })
      if (result.canceled || !result.filePaths[0]) return googleCompanion.status()
      return googleCompanion.importClient(result.filePaths[0])
    },
    connectGoogleCompanion: (writeScopes) => googleCompanion?.connect(writeScopes) ?? Promise.reject(new Error("Google Companion is unavailable")),
    testGoogleCompanion: () => googleCompanion?.test() ?? Promise.reject(new Error("Google Companion is unavailable")),
    disconnectGoogleCompanion: () => googleCompanion?.disconnect() ?? Promise.reject(new Error("Google Companion is unavailable")),
    getAvatarBridgeStatus: () =>
      avatarBridge?.status() ?? {
        available: false,
        protocol: 2,
        connectedClients: [],
        message: "Unity Avatar Bridge is unavailable",
      },
    routeAvatarSpeech: (sessionID, text) => avatarBridge?.speakSession(sessionID, text) ?? Promise.resolve(false),
    updateAvatarBridgeConfig: (input) =>
      avatarBridge?.updateConfig(input) ?? Promise.reject(new Error("Unity Avatar Bridge is unavailable")),
    startAvatarBridgePairing: () => {
      if (!avatarBridge) throw new Error("Unity Avatar Bridge is unavailable")
      return avatarBridge.startPairing()
    },
    cancelAvatarBridgePairing: () => {
      if (!avatarBridge) throw new Error("Unity Avatar Bridge is unavailable")
      avatarBridge.cancelPairing()
    },
    retryAvatarBridgeSync: () =>
      avatarBridge?.retrySync() ?? Promise.reject(new Error("Unity Avatar Bridge is unavailable")),
    executeJarvisReplayFixture: (replayID) =>
      avatarBridge?.executeReplayFixture(replayID) ?? Promise.reject(new Error("Unity Avatar Bridge is unavailable")),
    revokeAvatarBridgeDevice: (id) =>
      avatarBridge?.revokeDevice(id) ?? Promise.reject(new Error("Unity Avatar Bridge is unavailable")),
    resolveAvatarBridgeApproval: (id, approved) => avatarBridge?.resolveApproval(id, approved) ?? false,
    deleteAvatarBridgeMemory: (id) =>
      avatarBridge?.deleteMemory(id) ?? Promise.reject(new Error("Unity Avatar Bridge is unavailable")),
    updateAvatarBridgeMemory: (id, text) =>
      avatarBridge?.updateMemory(id, text) ?? Promise.reject(new Error("Unity Avatar Bridge is unavailable")),
    clearAvatarBridgeMemories: (filter) =>
      avatarBridge?.clearMemories(filter) ?? Promise.reject(new Error("Unity Avatar Bridge is unavailable")),
    getNemotronVoiceStatus: () =>
      nemotronVoice?.status() ?? Promise.reject(new Error("Nemotron voice runtime is unavailable")),
    configureNemotronVoice: (input) =>
      nemotronVoice?.configure(input) ?? Promise.reject(new Error("Nemotron voice runtime is unavailable")),
    installNemotronVoice: () =>
      nemotronVoice?.install() ?? Promise.reject(new Error("Nemotron voice runtime is unavailable")),
    startNemotronVoice: () =>
      nemotronVoice?.start() ?? Promise.reject(new Error("Nemotron voice runtime is unavailable")),
    stopNemotronVoice: () => nemotronVoice?.stop() ?? Promise.resolve(),
    beginNemotronVoice: (input) =>
      nemotronVoice?.begin(input) ?? Promise.reject(new Error("Nemotron voice runtime is unavailable")),
    appendNemotronVoice: (input) => nemotronVoice?.append(input) ?? false,
    commitNemotronVoice: (requestID) =>
      nemotronVoice?.commit(requestID) ?? Promise.reject(new Error("Nemotron voice runtime is unavailable")),
    cancelNemotronVoice: (requestID) => nemotronVoice?.cancel(requestID) ?? Promise.resolve(),
    subscribeNemotronVoice: (listener) => nemotronVoice?.subscribe(listener) ?? (() => undefined),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    setNativeTranslations: (bundle) => {
      if (setNativeTranslations(bundle)) createMenu(menuDeps)
    },
  })
  registerWslIpcHandlers(wslServers)
  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))
  yield* Effect.promise(() => startNetLog()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start net log", error)
      }),
    ),
  )

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { version: SIDECAR_VERSION })

    ensureLoopbackNoProxy()
    useEnvProxy()

    if (SIDECAR_VERSION === "v2") {
      logger.log("spawning v2 sidecar")
      const sidecar = yield* Effect.promise(() => startBackgroundCli(logger, shellEnv?.XDG_STATE_HOME))
      yield* Deferred.succeed(serverReady, {
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })
      avatarBridge?.configureServer({
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })

      if (process.platform === "win32") {
        void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
      }

      logger.log("loading task finished")
      return
    }

    const port = yield* Effect.gen(function* () {
      const fromEnv = process.env.OPENCODE_PORT
      if (fromEnv) {
        const parsed = Number.parseInt(fromEnv, 10)
        if (!Number.isNaN(parsed)) return parsed
      }

      const res = yield* Deferred.make<number, unknown>()
      const socket = createServer()
      socket.on("error", (e) => Deferred.failSync(res, () => e))
      socket.listen(0, "127.0.0.1", () => {
        const address = socket.address()
        if (typeof address !== "object" || !address) {
          socket.close()
          Deferred.failSync(res, () => new Error("Failed to get port"))
          return
        }
        const port = address.port
        socket.close(() => Effect.runSync(Deferred.succeed(res, port)))
      })

      return yield* Deferred.await(res)
    })
    const hostname = "127.0.0.1"
    const url = `http://${hostname}:${port}`
    const password = randomUUID()

    logger.log("spawning sidecar", { url })
    const { listener, health } = yield* Effect.promise(() =>
      spawnLocalServer(hostname, port, password, {
        userDataPath: app.getPath("userData"),
        onStdout: (message) => writeLog("server", "stdout", { message }),
        onStderr: (message) => writeLog("server", "stderr", { message }, "warn"),
        onExit: (code) => writeLog("utility", "sidecar exited", { code }, "warn"),
      }),
    )
    server = listener
    yield* Deferred.succeed(serverReady, {
      url,
      username: "opencode",
      password,
    })
    avatarBridge?.configureServer({ url, username: "opencode", password })

    if (process.platform === "win32") {
      void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
    }

    yield* Effect.promise(() => health.wait).pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", e.toString())
        }),
      ),
    )

    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  yield* Fiber.await(loadingTask)

  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    restoreMainWindows()
  })

  const windows = restoreMainWindows()
  if (windows.length) createMenu(menuDeps)
})

Effect.runFork(main)
