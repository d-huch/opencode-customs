import { Component, For, Show, createMemo, createResource, createSignal, onMount } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { useUpdaterAction } from "../updater-action"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  terminalDefault,
  terminalFontFamily,
  terminalInput,
  useSettings,
} from "@/context/settings"
import { playSoundById, SOUND_OPTIONS } from "@/utils/sound"
import { Link } from "../link"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { LayoutRetirementNotice, LayoutTransitionToggle } from "./interface-transition"
import "./settings-v2.css"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

type ThemeOption = {
  id: string
  name: string
}

type ShellOption = {
  path: string
  name: string
  acceptable: boolean
}

type ShellSelectOption = {
  id: string
  value: string
  label: string
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const stopDemoSound = () => {
  demoSoundState.run += 1
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }
  clearTimeout(demoSoundState.timeout)
  demoSoundState.cleanup = undefined
}

const playDemoSound = (id: string | undefined) => {
  stopDemoSound()
  if (!id) return

  const run = ++demoSoundState.run
  demoSoundState.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoSoundState.run !== run) {
        cleanup?.()
        return
      }
      demoSoundState.cleanup = cleanup
    })
  }, 100)
}

export const SettingsGeneralV2: Component<{
  sessionID?: string
}> = (props) => {
  const theme = useTheme()
  const language = useLanguage()
  const permission = usePermission()
  const platform = usePlatform()
  const dialog = useDialog()
  const settings = useSettings()
  const serverSync = useServerSync()
  const serverSdk = useServerSDK()
  const mobile = createMediaQuery("(max-width: 767px)")

  const updater = useUpdaterAction()
  const [voiceTest, setVoiceTest] = createSignal<"idle" | "running" | string>("idle")
  const [fishVoiceTranscript, setFishVoiceTranscript] = createSignal("")
  const [fishVoiceState, setFishVoiceState] = createSignal<"idle" | "saving" | string>("idle")
  const [fishReferenceFile, setFishReferenceFile] = createSignal<File>()
  const [fishSavedReference, setFishSavedReference] = createSignal<{
    filename: string
    contentType: string
    transcript: string
    bytes: number
  }>()
  const [fishDebugText, setFishDebugText] = createSignal(language.t("settings.general.voice.test.phrase"))
  const [fishDebugState, setFishDebugState] = createSignal<"idle" | "running">("idle")
  const [fishServerState, setFishServerState] = createSignal<{
    status: "idle" | "checking" | "ready" | "offline" | "error"
    latencyMs?: number
    detail?: string
  }>({ status: "idle" })
  const [fishDebugLog, setFishDebugLog] = createSignal<
    Array<{ at: string; kind: "info" | "success" | "error"; text: string }>
  >([])
  const voiceProviders = [
    { value: "local" as const, label: language.t("settings.general.voice.provider.local") },
    { value: "fish-local" as const, label: language.t("settings.general.voice.provider.fish") },
  ]
  const fishLatencies = [
    { value: "balanced" as const, label: language.t("settings.general.voice.fish.latency.balanced") },
    { value: "normal" as const, label: language.t("settings.general.voice.fish.latency.normal") },
  ]
  const fishLanguages = ["auto", "uk", "en", "mixed"].map((value) => ({
    value: value as "auto" | "uk" | "en" | "mixed",
    label: language.t(`settings.general.voice.fish.language.${value}`),
  }))
  const voiceModes = [
    { value: "quality" as const, label: language.t("settings.general.voice.mode.quality") },
    { value: "fast" as const, label: language.t("settings.general.voice.mode.fast") },
  ]
  const personalityModes = ["normal", "work", "night", "emergency"].map((value) => ({
    value: value as "normal" | "work" | "night" | "emergency",
    label: language.t(`settings.general.voice.personality.mode.${value}`),
  }))
  const qualityVoices = [
    { value: "kateryna", label: language.t("settings.general.voice.voice.kateryna") },
    { value: "lada", label: language.t("settings.general.voice.voice.lada") },
    { value: "mykyta", label: language.t("settings.general.voice.voice.mykyta") },
    { value: "oleksa", label: language.t("settings.general.voice.voice.oleksa") },
    { value: "tetiana", label: language.t("settings.general.voice.voice.tetiana") },
  ]
  const fastVoices = [{ value: "ukrainian_tts", label: language.t("settings.general.voice.voice.piper") }]
  const voiceOptions = createMemo(() => (settings.voice.ttsMode() === "quality" ? qualityVoices : fastVoices))

  const checkFishServer = async () => {
    if (!platform.getFishAudioLocalStatus) {
      setFishServerState({ status: "error", detail: language.t("settings.general.voice.fish.status.unavailable") })
      return
    }
    setFishServerState({ status: "checking" })
    const result = await platform.getFishAudioLocalStatus(settings.voice.fishEndpoint()).catch((error: unknown) => ({
      status: "error" as const,
      detail: error instanceof Error ? error.message : String(error),
    }))
    setFishServerState(result)
  }

  onMount(() => {
    void platform.getFishAudioLocalReference?.().then((reference) => {
      setFishSavedReference(reference)
      if (reference) setFishVoiceTranscript(reference.transcript)
    })
    if (settings.voice.ttsProvider() === "fish-local") void checkFishServer()
  })
  const openAgentPersonalization = async () => {
    const module = await import("@/components/dialog-agent-personalization")
    void dialog.show(() => <module.DialogAgentPersonalization />)
  }

  const testVoice = async () => {
    if (!platform.synthesizeLocalSpeech) {
      setVoiceTest(language.t("settings.general.voice.test.unavailable"))
      return
    }
    setVoiceTest("running")
    const started = performance.now()
    const result = await platform
      .synthesizeLocalSpeech({
        provider: settings.voice.ttsProvider(),
        endpoint:
          settings.voice.ttsProvider() === "fish-local"
            ? settings.voice.fishEndpoint()
            : settings.voice.ttsEndpoint(),
        model: settings.voice.ttsModel(),
        voice: settings.voice.ttsVoice(),
        mode: settings.voice.ttsMode(),
        latency: settings.voice.fishLatency(),
        language: settings.voice.fishLanguage(),
        temperature: settings.voice.fishTemperature(),
        topP: settings.voice.fishTopP(),
        repetitionPenalty: settings.voice.fishRepetitionPenalty(),
        seed: settings.voice.fishSeed(),
        chunkLength: settings.voice.fishChunkLength(),
        normalize: settings.voice.fishNormalize(),
        streaming: settings.voice.fishStreaming(),
        useMemoryCache: settings.voice.fishMemoryCache(),
        maxNewTokens: settings.voice.fishMaxNewTokens(),
        text: language.t("settings.general.voice.test.phrase"),
      })
      .catch((error: unknown) => {
        setVoiceTest(error instanceof Error ? error.message : String(error))
        return undefined
      })
    if (!result) return
    const url = URL.createObjectURL(result.audio)
    const audio = new Audio(url)
    if (settings.voice.ttsProvider() === "fish-local") {
      audio.playbackRate = settings.voice.fishPlaybackRate()
      audio.volume = settings.voice.fishVolume()
    }
    audio.onended = () => URL.revokeObjectURL(url)
    audio.onerror = () => URL.revokeObjectURL(url)
    const played = await audio.play().then(
      () => true,
      (error: unknown) => {
        URL.revokeObjectURL(url)
        setVoiceTest(error instanceof Error ? error.message : String(error))
        return false
      },
    )
    if (!played) return
    setVoiceTest(
      language.t("settings.general.voice.test.metrics", {
        first: Math.round(performance.now() - started),
        total: Math.round(result.metrics.totalMs),
        synthesis: Math.round(result.metrics.synthesisMs),
        cache: result.metrics.cache,
      }),
    )
  }

  const addFishDebug = (text: string, kind: "info" | "success" | "error" = "info") => {
    setFishDebugLog((entries) => [...entries.slice(-39), { at: new Date().toLocaleTimeString(), kind, text }])
  }

  const fishContentType = (file: File) => {
    if (file.type) return file.type
    const extension = file.name.split(".").at(-1)?.toLowerCase()
    return (
      {
        wav: "audio/wav",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        mp4: "audio/mp4",
        ogg: "audio/ogg",
        oga: "audio/ogg",
        flac: "audio/flac",
        aac: "audio/aac",
      }[extension ?? ""] ?? "application/octet-stream"
    )
  }

  const chooseFishReference = async () => {
    if (!platform.openAttachmentPickerDialog) {
      setFishVoiceState(language.t("settings.general.voice.fish.clone.unavailable"))
      return
    }
    await platform.openAttachmentPickerDialog(
      {
        title: language.t("settings.general.voice.fish.clone.choose"),
        extensions: ["wav", "mp3", "m4a", "mp4", "ogg", "oga", "flac", "aac"],
      },
      async (file) => {
        setFishReferenceFile(file)
        setFishVoiceState("idle")
        addFishDebug(
          language.t("settings.general.voice.fish.debug.selected", {
            name: file.name,
            type: fishContentType(file),
            size: (file.size / 1024 / 1024).toFixed(2),
          }),
        )
      },
    )
  }

  const saveFishReference = async () => {
    const file = fishReferenceFile()
    if (!file || !platform.setFishAudioLocalReference) {
      setFishVoiceState(language.t("settings.general.voice.fish.clone.unavailable"))
      return undefined
    }
    if (!fishVoiceTranscript().trim()) {
      setFishVoiceState(language.t("settings.general.voice.fish.debug.missingTranscript"))
      return undefined
    }
    setFishVoiceState("saving")
    addFishDebug(language.t("settings.general.voice.fish.debug.cloning"))
    return platform
      .setFishAudioLocalReference({
        filename: file.name,
        contentType: fishContentType(file),
        audio: await file.arrayBuffer(),
        transcript: fishVoiceTranscript(),
      })
      .then(
        (result) => {
          setFishSavedReference(result)
          setFishVoiceState(language.t("settings.general.voice.fish.clone.created", { name: result.filename }))
          addFishDebug(language.t("settings.general.voice.fish.debug.cloned", { name: result.filename }), "success")
          return result
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setFishVoiceState(message)
          addFishDebug(message, "error")
          return undefined
        },
      )
  }

  const playFishReference = async () => {
    const file = fishReferenceFile()
    if (!file) return
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    audio.onended = () => URL.revokeObjectURL(url)
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      addFishDebug(language.t("settings.general.voice.fish.debug.referencePlaybackFailed"), "error")
    }
    await audio.play().then(
      () => addFishDebug(language.t("settings.general.voice.fish.debug.referencePlayback")),
      (error: unknown) => {
        URL.revokeObjectURL(url)
        addFishDebug(error instanceof Error ? error.message : String(error), "error")
      },
    )
  }

  const testFishVoice = async () => {
    if (!platform.synthesizeLocalSpeech) {
      addFishDebug(language.t("settings.general.voice.test.unavailable"), "error")
      return
    }
    if (!fishDebugText().trim()) {
      addFishDebug(language.t("settings.general.voice.fish.debug.emptyText"), "error")
      return
    }
    setFishDebugState("running")
    const started = performance.now()
    const reference = fishReferenceFile() ? await saveFishReference() : fishSavedReference()
    if (!reference) {
      addFishDebug(language.t("settings.general.voice.fish.debug.missingReference"), "error")
      setFishDebugState("idle")
      return
    }
    addFishDebug(language.t("settings.general.voice.fish.debug.synthesizing", { name: reference.filename }))
    const result = await platform
      .synthesizeLocalSpeech({
        provider: "fish-local",
        endpoint: settings.voice.fishEndpoint(),
        model: settings.voice.ttsModel(),
        voice: settings.voice.ttsVoice(),
        mode: settings.voice.ttsMode(),
        latency: settings.voice.fishLatency(),
        language: settings.voice.fishLanguage(),
        temperature: settings.voice.fishTemperature(),
        topP: settings.voice.fishTopP(),
        repetitionPenalty: settings.voice.fishRepetitionPenalty(),
        seed: settings.voice.fishSeed(),
        chunkLength: settings.voice.fishChunkLength(),
        normalize: settings.voice.fishNormalize(),
        streaming: settings.voice.fishStreaming(),
        useMemoryCache: settings.voice.fishMemoryCache(),
        maxNewTokens: settings.voice.fishMaxNewTokens(),
        text: fishDebugText().trim(),
      })
      .catch((error: unknown) => {
        addFishDebug(error instanceof Error ? error.message : String(error), "error")
        return undefined
      })
    if (!result) {
      setFishDebugState("idle")
      return
    }
    const url = URL.createObjectURL(result.audio)
    const audio = new Audio(url)
    audio.playbackRate = settings.voice.fishPlaybackRate()
    audio.volume = settings.voice.fishVolume()
    audio.onended = () => URL.revokeObjectURL(url)
    audio.onerror = () => URL.revokeObjectURL(url)
    const played = await audio.play().then(
      () => true,
      (error: unknown) => {
        URL.revokeObjectURL(url)
        addFishDebug(error instanceof Error ? error.message : String(error), "error")
        return false
      },
    )
    setFishDebugState("idle")
    if (!played) return
    addFishDebug(
      language.t("settings.general.voice.fish.debug.playing", {
        first: Math.round(performance.now() - started),
        total: Math.round(result.metrics.totalMs),
        bytes: result.audio.size,
        type: result.audio.type || "audio/mpeg",
      }),
      "success",
    )
  }
  const openVoiceInspector = async () => {
    const module = await import("../dialog-voice-inspector")
    void dialog.show(() => <module.DialogVoiceInspector sessionID={props.sessionID} />)
  }

  const dir = createMemo(() => {
    if (!props.sessionID) return undefined
    return serverSync().session.lineage.peek(props.sessionID)?.session.directory
  })
  const openVoiceDictionary = async () => {
    const module = await import("../dialog-voice-dictionary")
    void dialog.show(() => <module.DialogVoiceDictionary project={dir()} sessionID={props.sessionID} />)
  }
  const accepting = createMemo(() => {
    const value = dir()
    if (!value || !props.sessionID) return false
    return permission.isAutoAccepting(props.sessionID, value)
  })

  const toggleAccept = (checked: boolean) => {
    const value = dir()
    if (!value || !props.sessionID) return

    if (checked) {
      permission.enableAutoAccept(props.sessionID, value)
      return
    }

    permission.disableAutoAccept(props.sessionID, value)
  }
  const desktop = createMemo(() => platform.platform === "desktop")

  const themeOptions = createMemo<ThemeOption[]>(() => theme.ids().map((id) => ({ id, name: theme.name(id) })))

  const [shells] = createResource(
    () =>
      serverSdk()
        .client.pty.shells()
        .then((res) => res.data ?? [])
        .catch(() => [] as ShellOption[]),
    { initialValue: [] as ShellOption[] },
  )

  const [pinchZoom, { mutate: setPinchZoom }] = createResource(
    () => (desktop() && platform.getPinchZoomEnabled ? true : false),
    () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  onMount(() => {
    void theme.loadThemes()
  })

  const autoOption = { id: "auto", value: "", label: language.t("settings.general.row.shell.autoDefault") }
  const currentShell = createMemo(() => serverSync().data.config.shell ?? "")

  const shellOptions = createMemo<ShellSelectOption[]>(() => {
    const list = shells.latest
    const current = serverSync().data.config.shell

    const nameCounts = new Map<string, number>()
    for (const s of list) {
      nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1)
    }

    const options = [
      autoOption,
      ...list.map((s) => {
        const ambiguousName = (nameCounts.get(s.name) || 0) > 1
        const text = ambiguousName ? s.path : s.name
        const label = s.acceptable ? text : `${text} (${language.t("settings.general.row.shell.terminalOnly")})`
        return {
          id: s.path,
          // Prefer name over path - "bash" is much cleaner than the explicit full route even when it may change due to PATH.
          value: ambiguousName ? s.path : s.name,
          label,
        }
      }),
    ]

    if (current && !options.some((o) => o.value === current)) {
      options.push({ id: current, value: current, label: current })
    }

    return options
  })

  const onPinchZoomChange = (checked: boolean) => {
    setPinchZoom(checked)
    const update = platform.setPinchZoomEnabled?.(checked)
    if (!update) return
    void update.catch(() => setPinchZoom(!checked))
  }

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const languageOptions = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )

  const noneSound = { id: "none", label: "sound.option.none" } as const
  const soundOptions = [noneSound, ...SOUND_OPTIONS]
  const mono = () => monoInput(settings.appearance.font())
  const sans = () => sansInput(settings.appearance.uiFont())
  const terminal = () => terminalInput(settings.appearance.terminalFont())

  const soundSelectProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: soundOptions,
    current: enabled() ? (soundOptions.find((o) => o.id === current()) ?? noneSound) : noneSound,
    value: (o: (typeof soundOptions)[number]) => o.id,
    label: (o: (typeof soundOptions)[number]) => language.t(o.label),
    onHighlight: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      playDemoSound(option.id === "none" ? undefined : option.id)
    },
    onSelect: (option: (typeof soundOptions)[number] | null) => {
      if (!option) return
      if (option.id === "none") {
        setEnabled(false)
        stopDemoSound()
        return
      }
      setEnabled(true)
      set(option.id)
      playDemoSound(option.id)
    },
  })

  const InterfaceSection = () => (
    <LayoutTransitionToggle
      title={language.t("settings.general.row.newInterface.title")}
      badge={language.t("settings.general.row.newInterface.badge")}
      description={language.t("settings.general.row.newInterface.description")}
      checked={settings.general.newLayoutDesigns()}
      onChange={(checked) => {
        settings.general.setNewLayoutDesigns(checked)
        if (checked) return
        void import("@/components/dialog-settings").then((module) => {
          void dialog.show(() => <module.DialogSettings />)
        })
      }}
    />
  )

  const InterfaceNoticeSection = () => (
    <LayoutRetirementNotice
      title={language.t("settings.general.row.newInterfaceNotice.title")}
      description={language.t("settings.general.row.newInterfaceNotice.description")}
      dismiss={language.t("settings.general.row.newInterfaceNotice.dismiss")}
      onDismiss={settings.general.dismissNewInterfaceNotice}
    />
  )

  const GeneralSection = () => (
    <div class="settings-v2-section">
      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.language.title")}
          description={language.t("settings.general.row.language.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-language"
            options={languageOptions()}
            placement="bottom-end"
            gutter={6}
            current={languageOptions().find((o) => o.value === language.locale())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && language.setLocale(option.value)}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.personalization.title")}
          description={language.t("settings.general.row.personalization.description")}
        >
          <div class="flex items-center gap-2">
            <Switch checked={settings.personalization.enabled()} onChange={settings.personalization.setEnabled} />
            <ButtonV2
              data-action="settings-agent-personalization"
              variant="neutral"
              onClick={() => void openAgentPersonalization()}
            >
              {language.t("settings.general.row.personalization.configure")}
            </ButtonV2>
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("command.permissions.autoaccept.enable")}
          description={language.t("toast.permissions.autoaccept.on.description")}
        >
          <div data-action="settings-auto-accept-permissions">
            <Switch checked={accepting()} disabled={!dir()} onChange={toggleAccept} />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.shell.title")}
          description={language.t("settings.general.row.shell.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-shell"
            options={shellOptions()}
            current={shellOptions().find((o) => o.value === currentShell()) ?? autoOption}
            placement="bottom-end"
            gutter={6}
            value={(o) => o.id}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              if (option.value === currentShell()) return
              serverSync().updateConfig({ shell: option.value })
            }}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.reasoningSummaries.title")}
          description={language.t("settings.general.row.reasoningSummaries.description")}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.shellToolPartsExpanded.title")}
          description={language.t("settings.general.row.shellToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.editToolPartsExpanded.title")}
          description={language.t("settings.general.row.editToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRowV2>

        <Show when={mobile() && import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"}>
          <SettingsRowV2
            title={language.t("settings.general.row.mobileTitlebarBottom.title")}
            description={language.t("settings.general.row.mobileTitlebarBottom.description")}
          >
            <div data-action="settings-mobile-titlebar-bottom">
              <Switch
                checked={settings.general.mobileTitlebarPosition() === "bottom"}
                onChange={(checked) => settings.general.setMobileTitlebarPosition(checked ? "bottom" : "top")}
              />
            </div>
          </SettingsRowV2>
        </Show>
      </SettingsListV2>
    </div>
  )

  const AdvancedSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.advanced")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.showFileTree.title")}
          description={language.t("settings.general.row.showFileTree.description")}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showSearch.title")}
          description={language.t("settings.general.row.showSearch.description")}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showStatus.title")}
          description={language.t("settings.general.row.showStatus.description")}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showCustomAgents.title")}
          description={language.t("settings.general.row.showCustomAgents.description")}
        >
          <div data-action="settings-show-custom-agents">
            <Switch
              checked={settings.general.showCustomAgents()}
              onChange={(checked) => settings.general.setShowCustomAgents(checked)}
            />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const AppearanceSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.appearance")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.colorScheme.title")}
          description={language.t("settings.general.row.colorScheme.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-color-scheme"
            options={colorSchemeOptions()}
            current={colorSchemeOptions().find((o) => o.value === theme.colorScheme())}
            placement="bottom-end"
            gutter={6}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && theme.setColorScheme(option.value)}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.theme.title")}
          description={
            <>
              {language.t("settings.general.row.theme.description")}{" "}
              <Link class="settings-v2-link" href="https://opencode.ai/docs/themes/">
                {language.t("common.learnMore")}
              </Link>
            </>
          }
        >
          <SelectV2
            appearance="inline"
            data-action="settings-theme"
            options={themeOptions()}
            current={themeOptions().find((o) => o.id === theme.themeId())}
            placement="bottom-end"
            gutter={6}
            value={(o) => o.id}
            label={(o) => o.name}
            onSelect={(option) => {
              if (!option) return
              theme.setTheme(option.id)
            }}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.uiFont.title")}
          description={language.t("settings.general.row.uiFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextInputV2
              data-action="settings-ui-font"
              type="text"
              appearance="base"
              value={sans()}
              onInput={(event) => settings.appearance.setUIFont(event.currentTarget.value)}
              placeholder={sansDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label={language.t("settings.general.row.uiFont.title")}
              style={{ "font-family": sansFontFamily(settings.appearance.uiFont()) }}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.font.title")}
          description={language.t("settings.general.row.font.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextInputV2
              data-action="settings-code-font"
              type="text"
              appearance="base"
              value={mono()}
              onInput={(event) => settings.appearance.setFont(event.currentTarget.value)}
              placeholder={monoDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label={language.t("settings.general.row.font.title")}
              style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.terminalFont.title")}
          description={language.t("settings.general.row.terminalFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextInputV2
              data-action="settings-terminal-font"
              type="text"
              appearance="base"
              value={terminal()}
              onInput={(event) => settings.appearance.setTerminalFont(event.currentTarget.value)}
              placeholder={terminalDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label={language.t("settings.general.row.terminalFont.title")}
              style={{ "font-family": terminalFontFamily(settings.appearance.terminalFont()) }}
            />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const NotificationsSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.notifications")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.notifications.agent.title")}
          description={language.t("settings.general.notifications.agent.description")}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.notifications.permissions.title")}
          description={language.t("settings.general.notifications.permissions.description")}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.notifications.errors.title")}
          description={language.t("settings.general.notifications.errors.description")}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const SoundsSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.sounds")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.sounds.agent.title")}
          description={language.t("settings.general.sounds.agent.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-sounds-agent"
            {...soundSelectProps(
              () => settings.sounds.agentEnabled(),
              () => settings.sounds.agent(),
              (value) => settings.sounds.setAgentEnabled(value),
              (id) => settings.sounds.setAgent(id),
            )}
            placement="bottom-end"
            gutter={6}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.sounds.permissions.title")}
          description={language.t("settings.general.sounds.permissions.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-sounds-permissions"
            {...soundSelectProps(
              () => settings.sounds.permissionsEnabled(),
              () => settings.sounds.permissions(),
              (value) => settings.sounds.setPermissionsEnabled(value),
              (id) => settings.sounds.setPermissions(id),
            )}
            placement="bottom-end"
            gutter={6}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.sounds.errors.title")}
          description={language.t("settings.general.sounds.errors.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-sounds-errors"
            {...soundSelectProps(
              () => settings.sounds.errorsEnabled(),
              () => settings.sounds.errors(),
              (value) => settings.sounds.setErrorsEnabled(value),
              (id) => settings.sounds.setErrors(id),
            )}
            placement="bottom-end"
            gutter={6}
          />
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const VoiceSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.voice")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.voice.enabled.title")}
          description={language.t("settings.general.voice.enabled.description")}
        >
          <Switch checked={settings.voice.enabled()} onChange={settings.voice.setEnabled} />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.voice.autoSubmit.title")}
          description={language.t("settings.general.voice.autoSubmit.description")}
        >
          <Switch
            checked={settings.voice.autoSubmit()}
            disabled={!settings.voice.enabled()}
            onChange={settings.voice.setAutoSubmit}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.voice.personality.title")}
          description={language.t("settings.general.voice.personality.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-voice-personality"
            options={personalityModes}
            current={personalityModes.find((option) => option.value === settings.voice.personalityMode())}
            placement="bottom-end"
            gutter={6}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && settings.voice.setPersonalityMode(option.value)}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.voice.contextualCorrection.title")}
          description={language.t("settings.general.voice.contextualCorrection.description")}
        >
          <Switch
            checked={settings.voice.contextualCorrection()}
            disabled={!settings.voice.enabled()}
            onChange={settings.voice.setContextualCorrection}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.voice.confirmRisky.title")}
          description={language.t("settings.general.voice.confirmRisky.description")}
        >
          <Switch
            checked={settings.voice.confirmRiskyCommands()}
            disabled={!settings.voice.enabled()}
            onChange={settings.voice.setConfirmRiskyCommands}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.voice.dictionary.title")}
          description={language.t("settings.general.voice.dictionary.description")}
        >
          <ButtonV2
            data-action="settings-voice-dictionary"
            variant="neutral"
            onClick={() => void openVoiceDictionary()}
          >
            {language.t("settings.general.voice.dictionary.manage", {
              confirmed: settings.voice.dictionaryEntries().filter((entry) => entry.confirmed).length,
              pending: settings.voice.dictionaryEntries().filter((entry) => !entry.confirmed).length,
            })}
          </ButtonV2>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.voice.speakResponses.title")}
          description={language.t("settings.general.voice.speakResponses.description")}
        >
          <Switch
            checked={settings.voice.speakResponses()}
            disabled={!settings.voice.enabled()}
            onChange={settings.voice.setSpeakResponses}
          />
        </SettingsRowV2>

        <Show when={settings.voice.speakResponses()}>
          <SettingsRowV2
            title={language.t("settings.general.voice.provider.title")}
            description={language.t("settings.general.voice.provider.description")}
          >
            <SelectV2
              appearance="inline"
              data-action="settings-voice-provider"
              options={voiceProviders}
              current={voiceProviders.find((option) => option.value === settings.voice.ttsProvider())}
              placement="bottom-end"
              gutter={6}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && settings.voice.setTTSProvider(option.value)}
            />
          </SettingsRowV2>

          <Show
            when={settings.voice.ttsProvider() === "local"}
            fallback={
              <>
                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.endpoint.title")}
                  description={language.t("settings.general.voice.fish.endpoint.description")}
                >
                  <div class="grid w-full gap-2 sm:w-[520px]">
                    <TextInputV2
                      data-action="settings-voice-fish-endpoint"
                      appearance="base"
                      value={settings.voice.fishEndpoint()}
                      onInput={(event) => settings.voice.setFishEndpoint(event.currentTarget.value)}
                      placeholder="http://127.0.0.1:8080/v1/tts"
                      spellcheck={false}
                      autocomplete="off"
                      aria-label={language.t("settings.general.voice.fish.endpoint.title")}
                    />
                    <div class="flex flex-wrap items-center gap-2">
                      <ButtonV2
                        data-action="settings-voice-fish-status"
                        variant="ghost"
                        disabled={fishServerState().status === "checking"}
                        onClick={() => void checkFishServer()}
                      >
                        {fishServerState().status === "checking"
                          ? language.t("settings.general.voice.fish.status.checking")
                          : language.t("settings.general.voice.fish.status.check")}
                      </ButtonV2>
                      <Show when={fishServerState().status !== "idle" && fishServerState().status !== "checking"}>
                        <span
                          classList={{
                            "text-12-regular text-icon-success-base": fishServerState().status === "ready",
                            "text-12-regular text-icon-critical-base": fishServerState().status !== "ready",
                          }}
                        >
                          {fishServerState().status === "ready"
                            ? language.t("settings.general.voice.fish.status.ready", {
                                latency: fishServerState().latencyMs ?? 0,
                              })
                            : fishServerState().detail}
                        </span>
                      </Show>
                    </div>
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.latency.title")}
                  description={language.t("settings.general.voice.fish.latency.description")}
                >
                  <SelectV2
                    appearance="inline"
                    data-action="settings-voice-fish-latency"
                    options={fishLatencies}
                    current={fishLatencies.find((option) => option.value === settings.voice.fishLatency())}
                    placement="bottom-end"
                    gutter={6}
                    value={(option) => option.value}
                    label={(option) => option.label}
                    onSelect={(option) => option && settings.voice.setFishLatency(option.value)}
                  />
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.language.title")}
                  description={language.t("settings.general.voice.fish.language.description")}
                >
                  <SelectV2
                    appearance="inline"
                    data-action="settings-voice-fish-language"
                    options={fishLanguages}
                    current={fishLanguages.find((option) => option.value === settings.voice.fishLanguage())}
                    placement="bottom-end"
                    gutter={6}
                    value={(option) => option.value}
                    label={(option) => option.label}
                    onSelect={(option) => option && settings.voice.setFishLanguage(option.value)}
                  />
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.playbackRate.title")}
                  description={language.t("settings.general.voice.fish.playbackRate.description")}
                >
                  <div class="w-28">
                    <TextInputV2
                      data-action="settings-voice-fish-playback-rate"
                      type="number"
                      appearance="base"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={String(settings.voice.fishPlaybackRate())}
                      onChange={(event) => settings.voice.setFishPlaybackRate(event.currentTarget.valueAsNumber)}
                      aria-label={language.t("settings.general.voice.fish.playbackRate.title")}
                    />
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.volume.title")}
                  description={language.t("settings.general.voice.fish.volume.description")}
                >
                  <div class="w-28">
                    <TextInputV2
                      data-action="settings-voice-fish-volume"
                      type="number"
                      appearance="base"
                      min={0}
                      max={100}
                      step={5}
                      value={String(Math.round(settings.voice.fishVolume() * 100))}
                      onChange={(event) => settings.voice.setFishVolume(event.currentTarget.valueAsNumber / 100)}
                      aria-label={language.t("settings.general.voice.fish.volume.title")}
                    />
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.temperature.title")}
                  description={language.t("settings.general.voice.fish.temperature.description")}
                >
                  <div class="w-28">
                    <TextInputV2
                      data-action="settings-voice-fish-temperature"
                      type="number"
                      appearance="base"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={String(settings.voice.fishTemperature())}
                      onChange={(event) => settings.voice.setFishTemperature(event.currentTarget.valueAsNumber)}
                      aria-label={language.t("settings.general.voice.fish.temperature.title")}
                    />
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.topP.title")}
                  description={language.t("settings.general.voice.fish.topP.description")}
                >
                  <div class="w-28">
                    <TextInputV2
                      data-action="settings-voice-fish-top-p"
                      type="number"
                      appearance="base"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={String(settings.voice.fishTopP())}
                      onChange={(event) => settings.voice.setFishTopP(event.currentTarget.valueAsNumber)}
                      aria-label={language.t("settings.general.voice.fish.topP.title")}
                    />
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.repetitionPenalty.title")}
                  description={language.t("settings.general.voice.fish.repetitionPenalty.description")}
                >
                  <div class="w-28">
                    <TextInputV2
                      data-action="settings-voice-fish-repetition-penalty"
                      type="number"
                      appearance="base"
                      min={0.9}
                      max={2}
                      step={0.05}
                      value={String(settings.voice.fishRepetitionPenalty())}
                      onChange={(event) => settings.voice.setFishRepetitionPenalty(event.currentTarget.valueAsNumber)}
                      aria-label={language.t("settings.general.voice.fish.repetitionPenalty.title")}
                    />
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.seed.title")}
                  description={language.t("settings.general.voice.fish.seed.description")}
                >
                  <div class="w-36">
                    <TextInputV2
                      data-action="settings-voice-fish-seed"
                      type="number"
                      appearance="base"
                      value={settings.voice.fishSeed() === null ? "" : String(settings.voice.fishSeed())}
                      onChange={(event) =>
                        settings.voice.setFishSeed(event.currentTarget.value ? event.currentTarget.valueAsNumber : null)
                      }
                      placeholder={language.t("settings.general.voice.fish.seed.random")}
                      aria-label={language.t("settings.general.voice.fish.seed.title")}
                    />
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.chunkLength.title")}
                  description={language.t("settings.general.voice.fish.chunkLength.description")}
                >
                  <div class="w-28">
                    <TextInputV2
                      data-action="settings-voice-fish-chunk-length"
                      type="number"
                      appearance="base"
                      min={100}
                      max={1000}
                      step={50}
                      value={String(settings.voice.fishChunkLength())}
                      onChange={(event) => settings.voice.setFishChunkLength(event.currentTarget.valueAsNumber)}
                      aria-label={language.t("settings.general.voice.fish.chunkLength.title")}
                    />
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.maxNewTokens.title")}
                  description={language.t("settings.general.voice.fish.maxNewTokens.description")}
                >
                  <div class="w-28">
                    <TextInputV2
                      data-action="settings-voice-fish-max-new-tokens"
                      type="number"
                      appearance="base"
                      min={128}
                      max={4096}
                      step={128}
                      value={String(settings.voice.fishMaxNewTokens())}
                      onChange={(event) => settings.voice.setFishMaxNewTokens(event.currentTarget.valueAsNumber)}
                      aria-label={language.t("settings.general.voice.fish.maxNewTokens.title")}
                    />
                  </div>
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.normalize.title")}
                  description={language.t("settings.general.voice.fish.normalize.description")}
                >
                  <Switch checked={settings.voice.fishNormalize()} onChange={settings.voice.setFishNormalize} />
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.streaming.title")}
                  description={language.t("settings.general.voice.fish.streaming.description")}
                >
                  <Switch checked={settings.voice.fishStreaming()} onChange={settings.voice.setFishStreaming} />
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.memoryCache.title")}
                  description={language.t("settings.general.voice.fish.memoryCache.description")}
                >
                  <Switch checked={settings.voice.fishMemoryCache()} onChange={settings.voice.setFishMemoryCache} />
                </SettingsRowV2>

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.debug.title")}
                  description={
                    fishVoiceState() === "idle"
                      ? language.t("settings.general.voice.fish.debug.description")
                      : fishVoiceState() === "saving"
                        ? language.t("settings.general.voice.fish.clone.creating")
                        : fishVoiceState()
                  }
                >
                  <div class="grid w-full sm:w-[520px] gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <ButtonV2
                        data-action="settings-voice-fish-reference-choose"
                        variant="neutral"
                        disabled={fishDebugState() === "running"}
                        onClick={() => void chooseFishReference()}
                      >
                        {language.t("settings.general.voice.fish.debug.choose")}
                      </ButtonV2>
                      <ButtonV2
                        data-action="settings-voice-fish-reference-play"
                        variant="ghost"
                        disabled={!fishReferenceFile() || fishDebugState() === "running"}
                        onClick={() => void playFishReference()}
                      >
                        {language.t("settings.general.voice.fish.debug.playReference")}
                      </ButtonV2>
                    </div>
                    <div class="min-h-5 break-all text-12-regular text-text-weak">
                      <Show
                        when={fishReferenceFile()}
                        fallback={
                          fishSavedReference()
                            ? language.t("settings.general.voice.fish.debug.savedFile", {
                                name: fishSavedReference()!.filename,
                                size: (fishSavedReference()!.bytes / 1024 / 1024).toFixed(2),
                              })
                            : language.t("settings.general.voice.fish.debug.noFile")
                        }
                      >
                        {(file) =>
                          language.t("settings.general.voice.fish.debug.file", {
                            name: file().name,
                            type: fishContentType(file()),
                            size: (file().size / 1024 / 1024).toFixed(2),
                          })
                        }
                      </Show>
                    </div>
                    <TextInputV2
                      data-action="settings-voice-fish-clone-transcript"
                      appearance="base"
                      value={fishVoiceTranscript()}
                      onInput={(event) => setFishVoiceTranscript(event.currentTarget.value)}
                      placeholder={language.t("settings.general.voice.fish.clone.transcript")}
                      aria-label={language.t("settings.general.voice.fish.clone.transcript")}
                    />
                    <TextareaV2
                      data-action="settings-voice-fish-debug-text"
                      class="w-full"
                      rows={4}
                      value={fishDebugText()}
                      onInput={(event) => setFishDebugText(event.currentTarget.value)}
                      placeholder={language.t("settings.general.voice.fish.debug.text")}
                      aria-label={language.t("settings.general.voice.fish.debug.text")}
                    />
                    <div class="flex flex-wrap items-center gap-2">
                      <ButtonV2
                        data-action="settings-voice-fish-reference-save"
                        variant="ghost"
                        disabled={
                          fishDebugState() === "running" ||
                          !fishReferenceFile() ||
                          !fishVoiceTranscript().trim() ||
                          fishVoiceState() === "saving"
                        }
                        onClick={() => void saveFishReference()}
                      >
                        {language.t("settings.general.voice.fish.debug.saveReference")}
                      </ButtonV2>
                      <ButtonV2
                        data-action="settings-voice-fish-debug-play"
                        variant="neutral"
                        disabled={
                          fishDebugState() === "running" ||
                          !fishDebugText().trim() ||
                          (!fishReferenceFile() && !fishSavedReference()) ||
                          (Boolean(fishReferenceFile()) && !fishVoiceTranscript().trim())
                        }
                        onClick={() => void testFishVoice()}
                      >
                        {fishDebugState() === "running"
                          ? language.t("settings.general.voice.fish.debug.running")
                          : language.t("settings.general.voice.fish.debug.play")}
                      </ButtonV2>
                      <ButtonV2
                        data-action="settings-voice-fish-debug-clear"
                        variant="ghost"
                        disabled={fishDebugLog().length === 0 || fishDebugState() === "running"}
                        onClick={() => setFishDebugLog([])}
                      >
                        {language.t("settings.general.voice.fish.debug.clear")}
                      </ButtonV2>
                    </div>
                    <div
                      class="max-h-44 min-h-20 overflow-y-auto rounded-md border border-border-weak-base bg-surface-base px-3 py-2"
                      aria-live="polite"
                      aria-label={language.t("settings.general.voice.fish.debug.log")}
                    >
                      <Show
                        when={fishDebugLog().length > 0}
                        fallback={
                          <div class="text-11-regular text-text-weaker">
                            {language.t("settings.general.voice.fish.debug.empty")}
                          </div>
                        }
                      >
                        <div class="grid gap-1.5">
                          <For each={fishDebugLog()}>
                            {(entry) => (
                              <div class="flex items-start gap-2 font-mono text-11-regular">
                                <span class="shrink-0 text-text-weaker">{entry.at}</span>
                                <span
                                  classList={{
                                    "break-words text-text-weak": entry.kind === "info",
                                    "break-words text-icon-success-base": entry.kind === "success",
                                    "break-words text-icon-critical-base": entry.kind === "error",
                                  }}
                                >
                                  {entry.text}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </div>
                </SettingsRowV2>
              </>
            }
          >
            <SettingsRowV2
              title={language.t("settings.general.voice.ttsEndpoint.title")}
              description={language.t("settings.general.voice.ttsEndpoint.description")}
            >
              <div class="w-full sm:w-[320px]">
                <TextInputV2
                  data-action="settings-voice-tts-endpoint"
                  type="url"
                  appearance="base"
                  value={settings.voice.ttsEndpoint()}
                  onInput={(event) => settings.voice.setTTSEndpoint(event.currentTarget.value)}
                  placeholder="http://127.0.0.1:8880/v1/audio/speech"
                  spellcheck={false}
                  autocomplete="off"
                  aria-label={language.t("settings.general.voice.ttsEndpoint.title")}
                />
              </div>
            </SettingsRowV2>
          </Show>

          <Show when={settings.voice.ttsProvider() === "local"}>
            <SettingsRowV2
              title={language.t("settings.general.voice.mode.title")}
              description={language.t("settings.general.voice.mode.description")}
            >
              <SelectV2
                appearance="inline"
                data-action="settings-voice-tts-mode"
                options={voiceModes}
                current={voiceModes.find((option) => option.value === settings.voice.ttsMode())}
                placement="bottom-end"
                gutter={6}
                value={(option) => option.value}
                label={(option) => option.label}
                onSelect={(option) => option && settings.voice.setTTSMode(option.value)}
              />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.general.voice.ttsVoice.title")}
              description={language.t("settings.general.voice.ttsVoice.description")}
            >
              <SelectV2
                appearance="inline"
                data-action="settings-voice-tts-voice"
                options={voiceOptions()}
                current={
                  voiceOptions().find((option) => option.value === settings.voice.ttsVoice()) ?? voiceOptions()[0]
                }
                placement="bottom-end"
                gutter={6}
                value={(option) => option.value}
                label={(option) => option.label}
                onSelect={(option) => option && settings.voice.setTTSVoice(option.value)}
              />
            </SettingsRowV2>
          </Show>

          <Show when={settings.voice.ttsProvider() === "local"}>
            <SettingsRowV2
              title={language.t("settings.general.voice.test.title")}
              description={
                voiceTest() === "idle"
                  ? language.t("settings.general.voice.test.description")
                  : voiceTest() === "running"
                    ? language.t("settings.general.voice.test.running")
                    : voiceTest()
              }
            >
              <ButtonV2
                size="normal"
                variant="neutral"
                disabled={voiceTest() === "running"}
                onClick={() => void testVoice()}
              >
                {language.t("settings.general.voice.test.action")}
              </ButtonV2>
            </SettingsRowV2>
          </Show>
        </Show>

        <SettingsRowV2
          title={language.t("settings.general.voice.handsFree.title")}
          description={language.t("settings.general.voice.handsFree.description")}
        >
          <Switch
            checked={settings.voice.handsFree()}
            disabled={!settings.voice.enabled() || !settings.voice.autoSubmit()}
            onChange={settings.voice.setHandsFree}
          />
        </SettingsRowV2>

        <Show when={settings.voice.handsFree()}>
          <SettingsRowV2
            title={language.t("settings.general.voice.wakePhrase.title")}
            description={language.t("settings.general.voice.wakePhrase.description")}
          >
            <Switch
              checked={settings.voice.wakePhraseEnabled()}
              disabled={!settings.voice.enabled() || !settings.voice.autoSubmit()}
              onChange={settings.voice.setWakePhraseEnabled}
            />
          </SettingsRowV2>

          <Show when={settings.voice.wakePhraseEnabled()}>
            <SettingsRowV2
              title={language.t("settings.general.voice.wakePhrases.title")}
              description={language.t("settings.general.voice.wakePhrases.description")}
            >
              <div class="w-full sm:w-[320px]">
                <TextInputV2
                  data-action="settings-voice-wake-phrases"
                  appearance="base"
                  value={settings.voice.wakePhrases()}
                  onInput={(event) => settings.voice.setWakePhrases(event.currentTarget.value)}
                  placeholder="джарвіс, jarvis"
                  spellcheck={false}
                  autocomplete="off"
                  aria-label={language.t("settings.general.voice.wakePhrases.title")}
                />
              </div>
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.general.voice.wakeFollowup.title")}
              description={language.t("settings.general.voice.wakeFollowup.description")}
            >
              <div class="w-28">
                <TextInputV2
                  data-action="settings-voice-wake-followup"
                  type="number"
                  appearance="base"
                  min={5}
                  max={120}
                  value={String(settings.voice.wakeFollowupSeconds())}
                  onChange={(event) => settings.voice.setWakeFollowupSeconds(event.currentTarget.valueAsNumber)}
                  aria-label={language.t("settings.general.voice.wakeFollowup.title")}
                />
              </div>
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.general.voice.wakeOnLaunch.title")}
              description={language.t("settings.general.voice.wakeOnLaunch.description")}
            >
              <Switch checked={settings.voice.wakeOnLaunch()} onChange={settings.voice.setWakeOnLaunch} />
            </SettingsRowV2>
          </Show>
        </Show>

        <SettingsRowV2
          title={language.t("settings.general.voice.inspector.title")}
          description={language.t("settings.general.voice.inspector.description")}
        >
          <ButtonV2 size="normal" variant="neutral" onClick={() => void openVoiceInspector()}>
            {language.t("settings.general.voice.inspector.action")}
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  const UpdatesSection = () => (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.updates")}</h3>

      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.row.releaseNotes.title")}
          description={language.t("settings.general.row.releaseNotes.description")}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.updates.row.check.title")}
          description={language.t("settings.updates.row.check.description")}
        >
          <ButtonV2 size="normal" variant="neutral" disabled={!updater.action().run} onClick={updater.run}>
            {language.t(updater.action().label)}
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )

  // We can probably remove this, right?
  const DisplaySection = () => (
    <Show when={desktop()}>
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{language.t("settings.general.section.display")}</h3>

        <SettingsListV2>
          <SettingsRowV2
            title={language.t("settings.general.row.pinchZoom.title")}
            description={language.t("settings.general.row.pinchZoom.description")}
          >
            <div data-action="settings-pinch-zoom">
              <Switch checked={pinchZoom.latest} onChange={onPinchZoomChange} />
            </div>
          </SettingsRowV2>
        </SettingsListV2>
      </div>
    </Show>
  )

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.general")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <Show when={settings.general.layoutTransitionAvailable()}>
          <InterfaceSection />
        </Show>

        <Show when={settings.general.newInterfaceNoticeVisible()}>
          <InterfaceNoticeSection />
        </Show>

        <GeneralSection />

        <AppearanceSection />

        <NotificationsSection />

        <SoundsSection />

        <VoiceSection />

        <Show when={desktop()}>
          <UpdatesSection />
        </Show>

        <DisplaySection />

        <AdvancedSection />
      </div>
    </>
  )
}
