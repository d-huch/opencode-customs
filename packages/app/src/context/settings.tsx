import { createStore, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { persisted } from "@/utils/persist"
import { usePlatform } from "@/context/platform"
import { normalizeVoiceDictionary, type VoiceDictionaryEntry } from "@/utils/voice-dictionary"
import type {
  AgentDetail,
  AgentHumor,
  AgentPersonalizationPreset,
  AgentProactivity,
  AgentTone,
} from "@/utils/agent-personalization"
import { migrateAgentPersonalization } from "@/utils/agent-personalization"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
}

export type VoicePersonalityMode = "normal" | "work" | "night" | "emergency"
export type FishSpeechLanguage = "auto" | "uk" | "en" | "mixed"
export type WebSearchEngine = "duckduckgo" | "google" | "bing"
export type ResearchBrowserVisibility = "background" | "always" | "hidden"

export interface WebSearchSettings {
  enabled: boolean
  engine: WebSearchEngine
  visibility: ResearchBrowserVisibility
  authenticatedPages: boolean
  privateNetwork: boolean
  externalFallback: boolean
}

export interface VoiceSettings {
  enabled: boolean
  autoSubmit: boolean
  speakResponses: boolean
  contextualCorrection: boolean
  confirmRiskyCommands: boolean
  personalDictionary: string
  dictionaryEntries: VoiceDictionaryEntry[]
  personalityMode: VoicePersonalityMode
  handsFree: boolean
  wakePhraseEnabled: boolean
  wakePhrases: string
  wakeFollowupSeconds: number
  wakeOnLaunch: boolean
  ttsProvider: "local" | "fish-local"
  ttsMode: "quality" | "fast"
  ttsEndpoint: string
  ttsModel: string
  ttsVoice: string
  fishEndpoint: string
  fishLatency: "normal" | "balanced"
  fishLanguage: FishSpeechLanguage
  fishPlaybackRate: number
  fishVolume: number
  fishTemperature: number
  fishTopP: number
  fishRepetitionPenalty: number
  fishSeed: number | null
  fishChunkLength: number
  fishNormalize: boolean
  fishStreaming: boolean
  fishMemoryCache: boolean
  fishMaxNewTokens: number
}

export interface AgentPersonalizationSettings {
  version: number
  defaultPresetID: string
  enabled: boolean
  activePresetID: string
  presets: AgentPersonalizationPreset[]
  assistantName: string
  userName: string
  addressAs: string
  language: string
  tone: AgentTone
  detail: AgentDetail
  proactivity: AgentProactivity
  humor: AgentHumor
  catchphrases: string
  customInstructions: string
}

export interface Settings {
  general: {
    autoSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    showFileTree: boolean
    showNavigation: boolean
    showSearch: boolean
    showStatus: boolean
    showTerminal: boolean
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    showCustomAgents: boolean
    mobileTitlebarPosition: "top" | "bottom"
    newLayoutDesigns?: boolean
    layoutTransitionEligible?: boolean
    agentVisibilityInitialized?: boolean
    newInterfaceNoticeDismissed?: boolean
    shouldDisplayTabsToast?: boolean
  }
  appearance: {
    fontSize: number
    mono: string
    sans: string
    terminal: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
  personalization: AgentPersonalizationSettings
  voice: VoiceSettings
  webSearch: WebSearchSettings
}

export const monoDefault = "System Mono"
export const sansDefault = "System Sans"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"
const legacyNewLayoutDesignsDefault = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"
export const newLayoutDesignsDefault = true
// Existing users can switch layouts until local midnight on this date. Set new Date(YYYY, M-1, D) to show.
export const oldInterfaceSunset = new Date(2026, 8, 14)
const newLayoutDesignsUpgradeCutoff = "1.17.19"

function compareVersions(a: string, b: string) {
  const parse = (version: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i.exec(version.trim())
    if (!match) return
    return match.slice(1).map(Number)
  }
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return
  const index = left.findIndex((part, index) => part !== right[index])
  return index === -1 ? 0 : left[index]! - right[index]!
}

export function isAppUpgrade(previous: string | undefined, current: string | undefined) {
  if (!previous || !current) return false
  const comparison = compareVersions(current, previous)
  return comparison !== undefined && comparison > 0
}

export function shouldDisplayTabsToast(
  previous: string | undefined,
  current: string | undefined,
  existingInstall: boolean,
) {
  return isAppUpgrade(previous, current) || (!previous && existingInstall)
}

export function hasExistingWebState(settings: Promise<string> | string | null, previousVersion: string | undefined) {
  return settings !== null || previousVersion !== undefined
}

export function initialAgentVisibility(initialized: boolean | undefined, existing: boolean, previousVersion?: string) {
  if (initialized === true) return
  return existing || previousVersion !== undefined
}

export function shouldEnableNewLayout(previous: string | undefined, current: string | undefined) {
  if (!current) return false
  const currentComparison = compareVersions(current, newLayoutDesignsUpgradeCutoff)
  if (!previous) return currentComparison !== undefined && currentComparison > 0
  if (!isAppUpgrade(previous, current)) return false
  const previousComparison = compareVersions(previous, newLayoutDesignsUpgradeCutoff)
  return (
    previousComparison !== undefined &&
    currentComparison !== undefined &&
    previousComparison <= 0 &&
    currentComparison > 0
  )
}

export function layoutTransitionState(scheduled: boolean, eligible: boolean, retired: boolean, dismissed: boolean) {
  return {
    available: scheduled && eligible && !retired,
    notice: scheduled && eligible && retired && !dismissed,
  }
}

export const maximumSunsetTimeout = 2_147_483_647

export function nextSunsetCheckDelay(sunset: number, now: number) {
  return Math.min(Math.max(0, sunset - now), maximumSunsetTimeout)
}

export function resolveNewLayoutDesigns(retired: boolean, preference: boolean | undefined, fallback = true) {
  if (retired) return true
  return preference ?? fallback
}

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = sansFallback
const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

export const showReasoningSummariesDefault = true
export const webSearchDefaults = {
  enabled: true,
  engine: "duckduckgo",
  visibility: "background",
  authenticatedPages: true,
  privateNetwork: false,
  externalFallback: false,
} satisfies WebSearchSettings

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    showFileTree: false,
    showNavigation: false,
    showSearch: false,
    showStatus: false,
    showTerminal: false,
    showReasoningSummaries: showReasoningSummariesDefault,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    showCustomAgents: false,
    mobileTitlebarPosition: "top",
  },
  appearance: {
    fontSize: 14,
    mono: "",
    sans: "",
    terminal: "",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
  personalization: {
    version: 0,
    defaultPresetID: "",
    enabled: true,
    activePresetID: "",
    presets: [],
    assistantName: "OpenCode Customs",
    userName: "",
    addressAs: "",
    language: "auto",
    tone: "natural",
    detail: "balanced",
    proactivity: "balanced",
    humor: "subtle",
    catchphrases: "",
    customInstructions: "",
  },
  voice: {
    enabled: true,
    autoSubmit: true,
    speakResponses: true,
    contextualCorrection: true,
    confirmRiskyCommands: true,
    personalDictionary: "",
    dictionaryEntries: [],
    personalityMode: "normal",
    handsFree: false,
    wakePhraseEnabled: false,
    wakePhrases: "джарвіс, jarvis",
    wakeFollowupSeconds: 30,
    wakeOnLaunch: false,
    ttsProvider: "local",
    ttsMode: "quality",
    ttsEndpoint: "http://127.0.0.1:8880/v1/audio/speech",
    ttsModel: "silero-v5-ukrainian",
    ttsVoice: "kateryna",
    fishEndpoint: "http://127.0.0.1:8080/v1/tts",
    fishLatency: "balanced",
    fishLanguage: "auto",
    fishPlaybackRate: 1,
    fishVolume: 1,
    fishTemperature: 0.8,
    fishTopP: 0.8,
    fishRepetitionPenalty: 1.1,
    fishSeed: null,
    fishChunkLength: 300,
    fishNormalize: true,
    fishStreaming: false,
    fishMemoryCache: true,
    fishMaxNewTokens: 1024,
  },
  webSearch: webSearchDefaults,
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

const qualityTTSVoices = ["kateryna", "lada", "mykyta", "oleksa", "tetiana"]

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const [store, setStore, settingsInit, ready] = persisted("settings.v3", createStore<Settings>(defaultSettings))
    const [launch, setLaunch, , launchReady] = persisted(
      "app-version.v1",
      createStore<{ version?: string }>({ version: undefined }),
    )
    const [launchState, setLaunchState] = createStore({
      classified: false,
      migrationApplied: false,
      previous: undefined as string | undefined,
    })
    const showFileTree = withFallback(() => store.general?.showFileTree, defaultSettings.general.showFileTree)
    const showSearch = withFallback(() => store.general?.showSearch, defaultSettings.general.showSearch)
    const showStatus = withFallback(() => store.general?.showStatus, defaultSettings.general.showStatus)
    const showCustomAgents = withFallback(
      () => store.general?.showCustomAgents,
      defaultSettings.general.showCustomAgents,
    )
    const sunset = oldInterfaceSunset
    const [oldInterfaceRetired, setOldInterfaceRetired] = createSignal(sunset ? Date.now() >= sunset.getTime() : false)
    const layoutTransitionClassified = createMemo(() => typeof store.general?.layoutTransitionEligible === "boolean")
    const layoutTransitionEligible = withFallback(() => store.general?.layoutTransitionEligible, false)
    const newInterfaceNoticeDismissed = withFallback(() => store.general?.newInterfaceNoticeDismissed, false)
    const layoutUpgrade = createMemo(() =>
      launchState.classified && !launchState.migrationApplied
        ? shouldEnableNewLayout(launchState.previous, platform.version)
        : false,
    )
    const layoutTransition = createMemo(() =>
      layoutTransitionState(!!sunset, layoutTransitionEligible(), oldInterfaceRetired(), newInterfaceNoticeDismissed()),
    )
    const newLayoutDesigns = createMemo(() => {
      if (layoutUpgrade()) return true
      if (!ready() && !oldInterfaceRetired()) return legacyNewLayoutDesignsDefault
      if (!layoutTransitionClassified()) {
        return resolveNewLayoutDesigns(
          oldInterfaceRetired(),
          store.general?.newLayoutDesigns,
          legacyNewLayoutDesignsDefault,
        )
      }
      return resolveNewLayoutDesigns(
        oldInterfaceRetired(),
        store.general?.newLayoutDesigns,
        layoutTransitionEligible() ? legacyNewLayoutDesignsDefault : newLayoutDesignsDefault,
      )
    })
    const visible = (preference: () => boolean) => createMemo(() => !newLayoutDesigns() || preference())
    const initializeAgentVisibility = (existing: boolean) => {
      const initial = initialAgentVisibility(store.general?.agentVisibilityInitialized, existing, launchState.previous)
      if (initial === undefined) return
      batch(() => {
        setStore("general", "showCustomAgents", initial)
        setStore("general", "agentVisibilityInitialized", true)
      })
    }

    createEffect(() => {
      if (!ready() || (store.personalization?.version ?? 0) >= 2) return
      const migration = migrateAgentPersonalization({
        enabled: store.personalization?.enabled,
        activePresetID: store.personalization?.activePresetID,
        presets: store.personalization?.presets,
        values: {
          archetype: "natural",
          assistantName: store.personalization?.assistantName ?? defaultSettings.personalization.assistantName,
          userName: store.personalization?.userName ?? defaultSettings.personalization.userName,
          addressAs: store.personalization?.addressAs ?? defaultSettings.personalization.addressAs,
          language: store.personalization?.language ?? defaultSettings.personalization.language,
          tone: store.personalization?.tone ?? defaultSettings.personalization.tone,
          detail: store.personalization?.detail ?? defaultSettings.personalization.detail,
          proactivity: store.personalization?.proactivity ?? defaultSettings.personalization.proactivity,
          humor: store.personalization?.humor ?? defaultSettings.personalization.humor,
          catchphrases: store.personalization?.catchphrases ?? defaultSettings.personalization.catchphrases,
          customInstructions:
            store.personalization?.customInstructions ?? defaultSettings.personalization.customInstructions,
        },
        createID: () => crypto.randomUUID(),
        now: Date.now(),
      })
      setStore("personalization", "presets", reconcile(migration.presets))
      setStore("personalization", "defaultPresetID", migration.defaultPresetID)
      setStore("personalization", "version", migration.version)
    })

    if (sunset && !oldInterfaceRetired()) {
      const timeout = { current: undefined as ReturnType<typeof setTimeout> | undefined }
      const checkSunset = () => {
        if (Date.now() >= sunset.getTime()) {
          setOldInterfaceRetired(true)
          return
        }
        timeout.current = setTimeout(checkSunset, nextSunsetCheckDelay(sunset.getTime(), Date.now()))
      }
      checkSunset()
      onCleanup(() => {
        if (timeout.current !== undefined) clearTimeout(timeout.current)
      })
    }

    createEffect(() => {
      if (!launchReady() || launchState.classified) return
      setLaunchState({
        classified: true,
        previous: launch.version,
      })
      if (!platform.version || launch.version === platform.version) return
      setLaunch("version", platform.version)
    })

    createEffect(() => {
      if (!ready() || !launchState.classified || platform.platform !== "web") return
      const existing = hasExistingWebState(settingsInit, launchState.previous)
      if (!layoutTransitionClassified()) setStore("general", "layoutTransitionEligible", existing)
      initializeAgentVisibility(existing)
    })

    createEffect(() => {
      if (!ready() || !launchState.classified || launchState.migrationApplied) return
      if (layoutUpgrade() && store.general?.newLayoutDesigns !== true) {
        setStore("general", "newLayoutDesigns", true)
      }
      setLaunchState("migrationApplied", true)
    })

    createEffect(() => {
      if (!ready() || !launchState.classified) return
      if (typeof store.general?.shouldDisplayTabsToast === "boolean") return
      if (!launchState.previous && !layoutTransitionClassified()) return
      setStore(
        "general",
        "shouldDisplayTabsToast",
        shouldDisplayTabsToast(launchState.previous, platform.version, layoutTransitionEligible()),
      )
    })

    createEffect(() => {
      if (!ready() || !oldInterfaceRetired()) return
      if (store.general?.newLayoutDesigns === true) return
      setStore("general", "newLayoutDesigns", true)
    })

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    createEffect(() => {
      if (store.general?.followup !== "queue") return
      setStore("general", "followup", "steer")
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        releaseNotes: withFallback(() => store.general?.releaseNotes, defaultSettings.general.releaseNotes),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
        },
        followup: withFallback(
          () => (store.general?.followup === "queue" ? "steer" : store.general?.followup),
          defaultSettings.general.followup,
        ),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value === "queue" ? "steer" : value)
        },
        showFileTree,
        setShowFileTree(value: boolean) {
          setStore("general", "showFileTree", value)
        },
        showNavigation: withFallback(() => store.general?.showNavigation, defaultSettings.general.showNavigation),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
        },
        showSearch,
        setShowSearch(value: boolean) {
          setStore("general", "showSearch", value)
        },
        showStatus,
        setShowStatus(value: boolean) {
          setStore("general", "showStatus", value)
        },
        showTerminal: withFallback(() => store.general?.showTerminal, defaultSettings.general.showTerminal),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        showCustomAgents,
        setShowCustomAgents(value: boolean) {
          setStore("general", "showCustomAgents", value)
        },
        mobileTitlebarPosition: withFallback(
          () => store.general?.mobileTitlebarPosition,
          defaultSettings.general.mobileTitlebarPosition,
        ),
        setMobileTitlebarPosition(value: "top" | "bottom") {
          setStore("general", "mobileTitlebarPosition", value)
        },
        newLayoutDesigns,
        setNewLayoutDesigns(value: boolean) {
          const next = oldInterfaceRetired() ? true : value
          if (newLayoutDesigns() === next) return
          setStore("general", "newLayoutDesigns", next)
          if (typeof window !== "undefined") setTimeout(() => window.location.reload())
        },
        layoutTransitionClassified,
        setOldLayoutEligible(eligible: boolean) {
          const current = store.general?.layoutTransitionEligible
          if (typeof current === "boolean") return
          setStore("general", "layoutTransitionEligible", eligible)
        },
        initializeAgentVisibility,
        layoutTransitionAvailable: createMemo(() => ready() && layoutTransition().available),
        newInterfaceNoticeVisible: createMemo(() => ready() && layoutTransition().notice),
        dismissNewInterfaceNotice() {
          setStore("general", "newInterfaceNoticeDismissed", true)
        },
        shouldDisplayTabsToast: withFallback(() => store.general?.shouldDisplayTabsToast, false),
        dismissTabsToast() {
          setStore("general", "shouldDisplayTabsToast", false)
        },
      },
      visibility: {
        fileTree: visible(showFileTree),
        search: visible(showSearch),
        status: visible(showStatus),
        customAgents: visible(showCustomAgents),
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
      webSearch: {
        enabled: withFallback(() => store.webSearch?.enabled, defaultSettings.webSearch.enabled),
        setEnabled(value: boolean) {
          setStore("webSearch", "enabled", value)
        },
        engine: withFallback(() => store.webSearch?.engine, defaultSettings.webSearch.engine),
        setEngine(value: WebSearchEngine) {
          setStore("webSearch", "engine", value)
        },
        visibility: withFallback(() => store.webSearch?.visibility, defaultSettings.webSearch.visibility),
        setVisibility(value: ResearchBrowserVisibility) {
          setStore("webSearch", "visibility", value)
        },
        authenticatedPages: withFallback(
          () => store.webSearch?.authenticatedPages,
          defaultSettings.webSearch.authenticatedPages,
        ),
        setAuthenticatedPages(value: boolean) {
          setStore("webSearch", "authenticatedPages", value)
        },
        privateNetwork: withFallback(() => store.webSearch?.privateNetwork, defaultSettings.webSearch.privateNetwork),
        setPrivateNetwork(value: boolean) {
          setStore("webSearch", "privateNetwork", value)
        },
        externalFallback: withFallback(
          () => store.webSearch?.externalFallback,
          defaultSettings.webSearch.externalFallback,
        ),
        setExternalFallback(value: boolean) {
          setStore("webSearch", "externalFallback", value)
        },
      },
      personalization: {
        version: withFallback(() => store.personalization?.version, defaultSettings.personalization.version),
        defaultPresetID: withFallback(
          () => store.personalization?.defaultPresetID,
          defaultSettings.personalization.defaultPresetID,
        ),
        setDefaultPresetID(value: string) {
          setStore("personalization", "defaultPresetID", value)
        },
        enabled: withFallback(() => store.personalization?.enabled, defaultSettings.personalization.enabled),
        setEnabled(value: boolean) {
          setStore("personalization", "enabled", value)
        },
        activePresetID: withFallback(
          () => store.personalization?.activePresetID,
          defaultSettings.personalization.activePresetID,
        ),
        setActivePresetID(value: string) {
          setStore("personalization", "activePresetID", value)
        },
        presets: withFallback(() => store.personalization?.presets, defaultSettings.personalization.presets),
        setPresets(value: AgentPersonalizationPreset[]) {
          setStore("personalization", "presets", reconcile(value.slice(0, 50)))
        },
        assistantName: withFallback(
          () => store.personalization?.assistantName,
          defaultSettings.personalization.assistantName,
        ),
        setAssistantName(value: string) {
          setStore("personalization", "assistantName", value.slice(0, 80))
        },
        userName: withFallback(() => store.personalization?.userName, defaultSettings.personalization.userName),
        setUserName(value: string) {
          setStore("personalization", "userName", value.slice(0, 80))
        },
        addressAs: withFallback(() => store.personalization?.addressAs, defaultSettings.personalization.addressAs),
        setAddressAs(value: string) {
          setStore("personalization", "addressAs", value.slice(0, 80))
        },
        language: withFallback(() => store.personalization?.language, defaultSettings.personalization.language),
        setLanguage(value: string) {
          setStore("personalization", "language", value.slice(0, 80))
        },
        tone: withFallback(() => store.personalization?.tone, defaultSettings.personalization.tone),
        setTone(value: AgentTone) {
          setStore("personalization", "tone", value)
        },
        detail: withFallback(() => store.personalization?.detail, defaultSettings.personalization.detail),
        setDetail(value: AgentDetail) {
          setStore("personalization", "detail", value)
        },
        proactivity: withFallback(
          () => store.personalization?.proactivity,
          defaultSettings.personalization.proactivity,
        ),
        setProactivity(value: AgentProactivity) {
          setStore("personalization", "proactivity", value)
        },
        humor: withFallback(() => store.personalization?.humor, defaultSettings.personalization.humor),
        setHumor(value: AgentHumor) {
          setStore("personalization", "humor", value)
        },
        catchphrases: withFallback(
          () => store.personalization?.catchphrases,
          defaultSettings.personalization.catchphrases,
        ),
        setCatchphrases(value: string) {
          setStore("personalization", "catchphrases", value.slice(0, 2_000))
        },
        customInstructions: withFallback(
          () => store.personalization?.customInstructions,
          defaultSettings.personalization.customInstructions,
        ),
        setCustomInstructions(value: string) {
          setStore("personalization", "customInstructions", value.slice(0, 4_000))
        },
        reset() {
          setStore("personalization", reconcile(defaultSettings.personalization))
        },
      },
      voice: {
        enabled: withFallback(() => store.voice?.enabled, defaultSettings.voice.enabled),
        setEnabled(value: boolean) {
          setStore("voice", "enabled", value)
        },
        autoSubmit: withFallback(() => store.voice?.autoSubmit, defaultSettings.voice.autoSubmit),
        setAutoSubmit(value: boolean) {
          setStore("voice", "autoSubmit", value)
        },
        speakResponses: withFallback(() => store.voice?.speakResponses, defaultSettings.voice.speakResponses),
        setSpeakResponses(value: boolean) {
          setStore("voice", "speakResponses", value)
        },
        contextualCorrection: withFallback(
          () => store.voice?.contextualCorrection,
          defaultSettings.voice.contextualCorrection,
        ),
        setContextualCorrection(value: boolean) {
          setStore("voice", "contextualCorrection", value)
        },
        confirmRiskyCommands: withFallback(
          () => store.voice?.confirmRiskyCommands,
          defaultSettings.voice.confirmRiskyCommands,
        ),
        setConfirmRiskyCommands(value: boolean) {
          setStore("voice", "confirmRiskyCommands", value)
        },
        personalDictionary: withFallback(
          () => store.voice?.personalDictionary,
          defaultSettings.voice.personalDictionary,
        ),
        setPersonalDictionary(value: string) {
          setStore("voice", "personalDictionary", value.slice(0, 10_000))
        },
        dictionaryEntries: createMemo(() =>
          normalizeVoiceDictionary([
            ...normalizeVoiceDictionary(store.voice?.personalDictionary),
            ...normalizeVoiceDictionary(store.voice?.dictionaryEntries),
          ]),
        ),
        setDictionaryEntries(value: VoiceDictionaryEntry[]) {
          setStore("voice", "dictionaryEntries", reconcile(normalizeVoiceDictionary(value)))
          if (store.voice?.personalDictionary) setStore("voice", "personalDictionary", "")
        },
        personalityMode: withFallback(() => store.voice?.personalityMode, defaultSettings.voice.personalityMode),
        setPersonalityMode(value: VoicePersonalityMode) {
          setStore("voice", "personalityMode", value)
        },
        handsFree: withFallback(() => store.voice?.handsFree, defaultSettings.voice.handsFree),
        setHandsFree(value: boolean) {
          setStore("voice", "handsFree", value)
        },
        wakePhraseEnabled: withFallback(() => store.voice?.wakePhraseEnabled, defaultSettings.voice.wakePhraseEnabled),
        setWakePhraseEnabled(value: boolean) {
          setStore("voice", "wakePhraseEnabled", value)
        },
        wakePhrases: withFallback(() => store.voice?.wakePhrases, defaultSettings.voice.wakePhrases),
        setWakePhrases(value: string) {
          setStore("voice", "wakePhrases", value.slice(0, 200))
        },
        wakeFollowupSeconds: withFallback(
          () => store.voice?.wakeFollowupSeconds,
          defaultSettings.voice.wakeFollowupSeconds,
        ),
        setWakeFollowupSeconds(value: number) {
          setStore("voice", "wakeFollowupSeconds", Math.min(120, Math.max(5, Math.round(value))))
        },
        wakeOnLaunch: withFallback(() => store.voice?.wakeOnLaunch, defaultSettings.voice.wakeOnLaunch),
        setWakeOnLaunch(value: boolean) {
          setStore("voice", "wakeOnLaunch", value)
        },
        ttsProvider: createMemo(() => {
          const value = store.voice?.ttsProvider as string | undefined
          if (value === "fish") return "fish-local" as const
          return value === "fish-local" ? value : "local"
        }),
        setTTSProvider(value: "local" | "fish-local") {
          setStore("voice", "ttsProvider", value)
        },
        ttsMode: withFallback(() => store.voice?.ttsMode, defaultSettings.voice.ttsMode),
        setTTSMode(value: "quality" | "fast") {
          setStore("voice", "ttsMode", value)
          setStore("voice", "ttsModel", value === "quality" ? "silero-v5-ukrainian" : "piper-ukrainian")
          if (value === "fast") setStore("voice", "ttsVoice", "ukrainian_tts")
          if (value === "quality" && !qualityTTSVoices.includes(store.voice?.ttsVoice ?? "")) {
            setStore("voice", "ttsVoice", "kateryna")
          }
        },
        ttsEndpoint: withFallback(() => store.voice?.ttsEndpoint, defaultSettings.voice.ttsEndpoint),
        setTTSEndpoint(value: string) {
          setStore("voice", "ttsEndpoint", value)
        },
        ttsModel: createMemo(() => {
          const value = store.voice?.ttsModel
          if (!value || value.startsWith("facebook/")) {
            return (store.voice?.ttsMode ?? defaultSettings.voice.ttsMode) === "quality"
              ? "silero-v5-ukrainian"
              : "piper-ukrainian"
          }
          return value
        }),
        setTTSModel(value: string) {
          setStore("voice", "ttsModel", value)
        },
        ttsVoice: createMemo(() => {
          const value = store.voice?.ttsVoice
          const mode = store.voice?.ttsMode ?? defaultSettings.voice.ttsMode
          if (mode === "fast") return "ukrainian_tts"
          return value && qualityTTSVoices.includes(value) ? value : defaultSettings.voice.ttsVoice
        }),
        setTTSVoice(value: string) {
          setStore("voice", "ttsVoice", value)
        },
        fishEndpoint: withFallback(() => store.voice?.fishEndpoint, defaultSettings.voice.fishEndpoint),
        setFishEndpoint(value: string) {
          setStore("voice", "fishEndpoint", value.slice(0, 500))
        },
        fishLatency: withFallback(() => store.voice?.fishLatency, defaultSettings.voice.fishLatency),
        setFishLatency(value: "normal" | "balanced") {
          setStore("voice", "fishLatency", value)
        },
        fishLanguage: withFallback(() => store.voice?.fishLanguage, defaultSettings.voice.fishLanguage),
        setFishLanguage(value: FishSpeechLanguage) {
          setStore("voice", "fishLanguage", value)
        },
        fishPlaybackRate: withFallback(() => store.voice?.fishPlaybackRate, defaultSettings.voice.fishPlaybackRate),
        setFishPlaybackRate(value: number) {
          setStore("voice", "fishPlaybackRate", Math.min(2, Math.max(0.5, value || 1)))
        },
        fishVolume: withFallback(() => store.voice?.fishVolume, defaultSettings.voice.fishVolume),
        setFishVolume(value: number) {
          setStore("voice", "fishVolume", Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1)))
        },
        fishTemperature: withFallback(() => store.voice?.fishTemperature, defaultSettings.voice.fishTemperature),
        setFishTemperature(value: number) {
          setStore("voice", "fishTemperature", Math.min(1, Math.max(0.1, value || 0.8)))
        },
        fishTopP: withFallback(() => store.voice?.fishTopP, defaultSettings.voice.fishTopP),
        setFishTopP(value: number) {
          setStore("voice", "fishTopP", Math.min(1, Math.max(0.1, value || 0.8)))
        },
        fishRepetitionPenalty: withFallback(
          () => store.voice?.fishRepetitionPenalty,
          defaultSettings.voice.fishRepetitionPenalty,
        ),
        setFishRepetitionPenalty(value: number) {
          setStore("voice", "fishRepetitionPenalty", Math.min(2, Math.max(0.9, value || 1.1)))
        },
        fishSeed: createMemo(() => store.voice?.fishSeed ?? null),
        setFishSeed(value: number | null) {
          setStore("voice", "fishSeed", value === null || !Number.isFinite(value) ? null : Math.round(value))
        },
        fishChunkLength: withFallback(() => store.voice?.fishChunkLength, defaultSettings.voice.fishChunkLength),
        setFishChunkLength(value: number) {
          setStore("voice", "fishChunkLength", Math.min(1_000, Math.max(100, Math.round(value || 300))))
        },
        fishNormalize: withFallback(() => store.voice?.fishNormalize, defaultSettings.voice.fishNormalize),
        setFishNormalize(value: boolean) {
          setStore("voice", "fishNormalize", value)
        },
        fishStreaming: withFallback(() => store.voice?.fishStreaming, defaultSettings.voice.fishStreaming),
        setFishStreaming(value: boolean) {
          setStore("voice", "fishStreaming", value)
        },
        fishMemoryCache: withFallback(() => store.voice?.fishMemoryCache, defaultSettings.voice.fishMemoryCache),
        setFishMemoryCache(value: boolean) {
          setStore("voice", "fishMemoryCache", value)
        },
        fishMaxNewTokens: withFallback(() => store.voice?.fishMaxNewTokens, defaultSettings.voice.fishMaxNewTokens),
        setFishMaxNewTokens(value: number) {
          setStore("voice", "fishMaxNewTokens", Math.min(4_096, Math.max(128, Math.round(value || 1_024))))
        },
      },
    }
  },
})
