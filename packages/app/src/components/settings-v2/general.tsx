import { Component, For, Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform, type NemotronVoiceStatus } from "@/context/platform"
import { useUpdaterAction } from "../updater-action"
import { useSettings } from "@/context/settings"
import { detachFishVoicePreset } from "@/utils/agent-personalization"
import { ExternalLink } from "../external-link"
import { useServerSync } from "@/context/server-sync"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { LayoutRetirementNotice, LayoutTransitionToggle } from "./interface-transition"
import {
  createAppearanceSettingsController,
  createPermissionScopeController,
  createShellOptions,
  createShellSettingsController,
  createSoundSettingsController,
  soundOptions,
  type AppearanceSettingsController,
  type PermissionScopeController,
  type ShellSettingsController,
  type SoundSettingsController,
} from "./general-controllers"
import "./settings-v2.css"

const schemeOptions: ("system" | "light" | "dark")[] = ["system", "light", "dark"]
const fontSettings = {
  ui: {
    action: "settings-ui-font",
    title: "settings.general.row.uiFont.title",
    description: "settings.general.row.uiFont.description",
    font: "ui",
    input: "setUI",
  },
  code: {
    action: "settings-code-font",
    title: "settings.general.row.font.title",
    description: "settings.general.row.font.description",
    font: "code",
    input: "setCode",
  },
  terminal: {
    action: "settings-terminal-font",
    title: "settings.general.row.terminalFont.title",
    description: "settings.general.row.terminalFont.description",
    font: "terminal",
    input: "setTerminal",
  },
} as const
const soundSettings = {
  agent: {
    action: "settings-sounds-agent",
    title: "settings.general.sounds.agent.title",
    description: "settings.general.sounds.agent.description",
  },
  permissions: {
    action: "settings-sounds-permissions",
    title: "settings.general.sounds.permissions.title",
    description: "settings.general.sounds.permissions.description",
  },
  errors: {
    action: "settings-sounds-errors",
    title: "settings.general.sounds.errors.title",
    description: "settings.general.sounds.errors.description",
  },
} as const

const PermissionScopeSetting: Component<{ controller: PermissionScopeController }> = (props) => {
  const language = useLanguage()
  return (
    <SettingsRowV2
      title={language.t("command.permissions.autoaccept.enable")}
      description={language.t("toast.permissions.autoaccept.on.description")}
    >
      <div data-action="settings-auto-accept-permissions">
        <Switch
          checked={props.controller.accepting()}
          disabled={!props.controller.enabled()}
          onChange={props.controller.set}
        />
      </div>
    </SettingsRowV2>
  )
}

const ShellSetting: Component<{ controller: ShellSettingsController }> = (props) => {
  const language = useLanguage()
  const options = createMemo(() =>
    createShellOptions({
      shells: props.controller.shells(),
      current: props.controller.current(),
    }),
  )
  return (
    <SettingsRowV2
      title={language.t("settings.general.row.shell.title")}
      description={language.t("settings.general.row.shell.description")}
    >
      <SelectV2
        appearance="inline"
        data-action="settings-shell"
        options={options()}
        current={options().find((option) => option.value === props.controller.current()) ?? options()[0]}
        placement="bottom-end"
        gutter={6}
        value={(option) => option.id}
        label={(option) => {
          if (option.id === "auto") return language.t("settings.general.row.shell.autoDefault")
          if (!option.terminalOnly) return option.name
          return `${option.name} (${language.t("settings.general.row.shell.terminalOnly")})`
        }}
        onSelect={(option) => option && props.controller.select(option.value)}
      />
    </SettingsRowV2>
  )
}

const AppearanceSection: Component<{ controller: AppearanceSettingsController }> = (props) => {
  const language = useLanguage()
  return (
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
            options={schemeOptions}
            current={schemeOptions.find((option) => option === props.controller.scheme.current())}
            placement="bottom-end"
            gutter={6}
            label={(option) => {
              if (option === "system") return language.t("theme.scheme.system")
              if (option === "light") return language.t("theme.scheme.light")
              return language.t("theme.scheme.dark")
            }}
            onSelect={(option) => option && props.controller.scheme.select(option)}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.theme.title")}
          description={
            <>
              {language.t("settings.general.row.theme.description")}{" "}
              <ExternalLink class="settings-v2-link" href="https://opencode.ai/docs/themes/">
                {language.t("common.learnMore")}
              </ExternalLink>
            </>
          }
        >
          <SelectV2
            appearance="inline"
            data-action="settings-theme"
            options={props.controller.theme.options()}
            current={props.controller.theme.current()}
            placement="bottom-end"
            gutter={6}
            value={(option) => option.id}
            label={(option) => option.name}
            onSelect={props.controller.theme.select}
          />
        </SettingsRowV2>

        <FontSetting kind="ui" fonts={props.controller.fonts} />
        <FontSetting kind="code" fonts={props.controller.fonts} />
        <FontSetting kind="terminal" fonts={props.controller.fonts} />
      </SettingsListV2>
    </div>
  )
}

const FontSetting: Component<{
  kind: "ui" | "code" | "terminal"
  fonts: AppearanceSettingsController["fonts"]
}> = (props) => {
  const language = useLanguage()
  const config = () => fontSettings[props.kind]
  return (
    <SettingsRowV2 title={language.t(config().title)} description={language.t(config().description)}>
      <div class="w-full sm:w-[220px]">
        <TextInputV2
          data-action={config().action}
          type="text"
          appearance="base"
          value={props.fonts[config().font]().value}
          onInput={(event) => props.fonts[config().input](event.currentTarget.value)}
          placeholder={props.fonts[config().font]().placeholder}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          aria-label={language.t(config().title)}
          style={{ "font-family": props.fonts[config().font]().family }}
        />
      </div>
    </SettingsRowV2>
  )
}

type FishVoicePreset = {
  id: string
  name: string
  filename: string
  contentType: string
  transcript: string
  bytes: number
  createdAt: string
  active: boolean
}

const SoundsSection: Component<{ controller: SoundSettingsController }> = (props) => {
  const language = useLanguage()
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.sounds")}</h3>
      <SettingsListV2>
        <SoundSetting kind="agent" channel={props.controller.agent} />
        <SoundSetting kind="permissions" channel={props.controller.permissions} />
        <SoundSetting kind="errors" channel={props.controller.errors} />
      </SettingsListV2>
    </div>
  )
}

const SoundSetting: Component<{
  kind: "agent" | "permissions" | "errors"
  channel: SoundSettingsController["agent"]
}> = (props) => {
  const language = useLanguage()
  const config = () => soundSettings[props.kind]
  return (
    <SettingsRowV2 title={language.t(config().title)} description={language.t(config().description)}>
      <SelectV2
        appearance="inline"
        data-action={config().action}
        options={soundOptions}
        current={props.channel.current()}
        value={(option) => option.id}
        label={(option) => language.t(option.label)}
        onHighlight={props.channel.highlight}
        onSelect={props.channel.select}
        placement="bottom-end"
        gutter={6}
      />
    </SettingsRowV2>
  )
}

const LanguageSetting = () => {
  const language = useLanguage()
  const options = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )
  return (
    <SettingsRowV2
      title={language.t("settings.general.row.language.title")}
      description={language.t("settings.general.row.language.description")}
    >
      <SelectV2
        appearance="inline"
        data-action="settings-language"
        options={options()}
        placement="bottom-end"
        gutter={6}
        current={options().find((option) => option.value === language.locale())}
        value={(option) => option.value}
        label={(option) => option.label}
        onSelect={(option) => option && language.setLocale(option.value)}
      />
    </SettingsRowV2>
  )
}

export const SettingsGeneralV2: Component<{
  sessionID?: string
  section?: "general" | "voice"
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const settings = useSettings()
  const serverSync = useServerSync()
  const mobile = createMediaQuery("(max-width: 767px)")
  const updater = useUpdaterAction()
  const [voiceTest, setVoiceTest] = createSignal<"idle" | "running" | string>("idle")
  const [nemotronStatus, setNemotronStatus] = createSignal<NemotronVoiceStatus>()
  const [nemotronAction, setNemotronAction] = createSignal<"idle" | "installing" | "starting" | "stopping" | "testing">("idle")
  const [nemotronError, setNemotronError] = createSignal("")
  const [fishVoiceTranscript, setFishVoiceTranscript] = createSignal("")
  const [fishVoiceState, setFishVoiceState] = createSignal<"idle" | "saving" | string>("idle")
  const [fishReferenceFile, setFishReferenceFile] = createSignal<File>()
  const [fishPresetName, setFishPresetName] = createSignal("")
  const [fishVoicePresets, setFishVoicePresets] = createSignal<FishVoicePreset[]>([])
  const [fishPresetState, setFishPresetState] = createSignal<"idle" | "saving" | "activating" | "deleting">("idle")
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
  const voiceEngines = [
    { value: "cascade" as const, label: language.t("settings.general.voice.engine.cascade") },
    { value: "nemotron" as const, label: language.t("settings.general.voice.engine.nemotron") },
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

  const runNemotronAction = async (action: "install" | "start" | "stop" | "test") => {
    const operation =
      action === "install"
        ? platform.installNemotronVoice
        : action === "stop"
          ? platform.stopNemotronVoice
          : platform.startNemotronVoice
    if (!operation) return
    setNemotronAction(action === "install" ? "installing" : action === "stop" ? "stopping" : action === "test" ? "testing" : "starting")
    setNemotronError("")
    await operation().then(
      (status) => {
        if (status) setNemotronStatus(status)
      },
      (error: unknown) => setNemotronError(error instanceof Error ? error.message : String(error)),
    )
    setNemotronAction("idle")
  }

  const selectVoiceEngine = async (engine: "cascade" | "nemotron") => {
    if (!platform.configureNemotronVoice) {
      settings.voice.setEngine(engine)
      return
    }
    setNemotronError("")
    await platform.configureNemotronVoice({ engine }).then(
      (status) => {
        settings.voice.setEngine(engine)
        setNemotronStatus(status)
      },
      (error: unknown) => setNemotronError(error instanceof Error ? error.message : String(error)),
    )
  }

  onMount(() => {
    void platform.configureNemotronVoice?.({ engine: settings.voice.engine() }).then(setNemotronStatus, () => undefined)
    const unsubscribe = platform.onNemotronVoiceEvent?.((event) => {
      if (event.type === "status") setNemotronStatus(event.status)
      if (event.type === "error") setNemotronError(event.error)
    })
    onCleanup(() => unsubscribe?.())
  })

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

  const refreshFishVoicePresets = async () => {
    if (!platform.listFishAudioVoicePresets) return
    setFishVoicePresets(await platform.listFishAudioVoicePresets())
  }

  onMount(() => {
    if (props.section !== "voice") return
    void platform.getFishAudioLocalReference?.().then((reference) => {
      setFishSavedReference(reference)
      if (reference) setFishVoiceTranscript(reference.transcript)
    })
    void refreshFishVoicePresets()
    if (settings.voice.ttsProvider() === "fish-local") void checkFishServer()
  })
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
          settings.voice.ttsProvider() === "fish-local" ? settings.voice.fishEndpoint() : settings.voice.ttsEndpoint(),
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

  const saveFishPreset = async () => {
    const file = fishReferenceFile()
    if (!platform.saveFishAudioVoicePreset) {
      addFishDebug(language.t("settings.general.voice.fish.presets.unavailable"), "error")
      return
    }
    if (!fishPresetName().trim()) {
      addFishDebug(language.t("settings.general.voice.fish.presets.missingName"), "error")
      return
    }
    if (!file || !fishVoiceTranscript().trim()) {
      addFishDebug(language.t("settings.general.voice.fish.debug.missingReference"), "error")
      return
    }
    setFishPresetState("saving")
    const result = await platform
      .saveFishAudioVoicePreset({
        name: fishPresetName(),
        filename: file.name,
        contentType: fishContentType(file),
        audio: await file.arrayBuffer(),
        transcript: fishVoiceTranscript(),
      })
      .then(
        (preset) => {
          setFishSavedReference(preset)
          setFishPresetName("")
          setFishReferenceFile()
          addFishDebug(language.t("settings.general.voice.fish.presets.saved"), "success")
          return preset
        },
        (error: unknown) => {
          addFishDebug(error instanceof Error ? error.message : String(error), "error")
          return undefined
        },
      )
    await refreshFishVoicePresets()
    setFishPresetState("idle")
    return result
  }

  const activateFishPreset = async (id: string) => {
    if (!platform.activateFishAudioVoicePreset) return
    setFishPresetState("activating")
    await platform.activateFishAudioVoicePreset(id).then(
      (preset) => {
        setFishSavedReference(preset)
        setFishVoiceTranscript(preset.transcript)
        setFishReferenceFile()
        addFishDebug(language.t("settings.general.voice.fish.presets.activated"), "success")
      },
      (error: unknown) => addFishDebug(error instanceof Error ? error.message : String(error), "error"),
    )
    await refreshFishVoicePresets()
    setFishPresetState("idle")
  }

  const deleteFishPreset = async (preset: FishVoicePreset) => {
    if (!platform.deleteFishAudioVoicePreset) return
    setFishPresetState("deleting")
    await platform.deleteFishAudioVoicePreset(preset.id).then(
      () => {
        if (preset.active) setFishSavedReference()
        settings.personalization.setPresets(detachFishVoicePreset(settings.personalization.presets(), preset.id))
        addFishDebug(language.t("settings.general.voice.fish.presets.deleted"), "success")
      },
      (error: unknown) => addFishDebug(error instanceof Error ? error.message : String(error), "error"),
    )
    await refreshFishVoicePresets()
    setFishPresetState("idle")
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
  const permissionScope = createPermissionScopeController(() => props.sessionID)
  const shell = createShellSettingsController()
  const appearance = createAppearanceSettingsController()
  const sounds = createSoundSettingsController()
  const desktop = createMemo(() => platform.platform === "desktop")

  const [pinchZoom, { mutate: setPinchZoom }] = createResource(
    () => desktop() && "getPinchZoomEnabled" in platform,
    () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  const onPinchZoomChange = (checked: boolean) => {
    setPinchZoom(checked)
    const update = platform.setPinchZoomEnabled?.(checked)
    if (!update) return
    void update.catch(() => setPinchZoom(!checked))
  }

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
      onDismiss={() => settings.general.dismissNewInterfaceNotice()}
    />
  )

  const GeneralSection = () => (
    <div class="settings-v2-section">
      <SettingsListV2>
        <LanguageSetting />

        <PermissionScopeSetting controller={permissionScope} />

        <ShellSetting controller={shell} />

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
          title={language.t("settings.general.voice.engine.title")}
          description={language.t("settings.general.voice.engine.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-voice-engine"
            options={voiceEngines}
            current={voiceEngines.find((option) => option.value === settings.voice.engine())}
            placement="bottom-end"
            gutter={6}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && void selectVoiceEngine(option.value)}
          />
        </SettingsRowV2>

        <Show when={settings.voice.engine() === "nemotron"}>
          <SettingsRowV2
            title={language.t("settings.general.voice.nemotron.runtime.title")}
            description={language.t("settings.general.voice.nemotron.runtime.description")}
          >
            <div class="flex max-w-[620px] flex-col items-end gap-2">
              <div class="flex flex-wrap justify-end gap-2">
                <ButtonV2
                  data-action="settings-nemotron-install"
                  variant="neutral"
                  disabled={nemotronAction() !== "idle" || nemotronStatus()?.phase === "busy"}
                  onClick={() => void runNemotronAction("install")}
                >
                  {language.t("settings.general.voice.nemotron.install")}
                </ButtonV2>
                <ButtonV2
                  data-action="settings-nemotron-start"
                  variant="neutral"
                  disabled={nemotronAction() !== "idle" || nemotronStatus()?.phase === "busy"}
                  onClick={() => void runNemotronAction("start")}
                >
                  {language.t("settings.general.voice.nemotron.start")}
                </ButtonV2>
                <ButtonV2
                  data-action="settings-nemotron-stop"
                  variant="ghost"
                  disabled={nemotronAction() !== "idle" || nemotronStatus()?.phase === "busy"}
                  onClick={() => void runNemotronAction("stop")}
                >
                  {language.t("settings.general.voice.nemotron.stop")}
                </ButtonV2>
                <ButtonV2
                  data-action="settings-nemotron-test"
                  variant="ghost"
                  disabled={nemotronAction() !== "idle" || nemotronStatus()?.phase === "busy"}
                  onClick={() => void runNemotronAction("test")}
                >
                  {language.t("settings.general.voice.nemotron.test")}
                </ButtonV2>
              </div>
              <span class="text-12-regular text-text-weak">
                {nemotronStatus()?.model ?? language.t("settings.general.voice.nemotron.modelMissing")} · {nemotronStatus()?.phase ?? "missing"} · 16 kHz → 22.05 kHz
              </span>
              <Show when={nemotronStatus()?.loadMs !== undefined || nemotronStatus()?.generationMs !== undefined}>
                <span class="text-12-regular text-text-weak">
                  load {nemotronStatus()?.loadMs ?? "—"} ms · transcript {nemotronStatus()?.transcriptLatencyMs ?? "—"} ms · text {nemotronStatus()?.firstTextMs ?? "—"} ms · audio {nemotronStatus()?.firstAudioMs ?? "—"} ms · RTF {nemotronStatus()?.realTimeFactor?.toFixed(2) ?? "—"} · dropped {nemotronStatus()?.droppedChunks ?? 0}
                </span>
              </Show>
              <Show when={nemotronStatus()?.incompleteDownload}>
                <span class="text-12-regular text-icon-warning-base">{language.t("settings.general.voice.nemotron.incomplete")}</span>
              </Show>
              <Show when={nemotronError() || nemotronStatus()?.message}>
                <span class="text-12-regular text-icon-critical-base">{nemotronError() || nemotronStatus()?.message}</span>
              </Show>
            </div>
          </SettingsRowV2>
          <SettingsRowV2
            title={language.t("settings.general.voice.nemotron.notice.title")}
            description={language.t("settings.general.voice.nemotron.notice.description")}
          >
            <span class="text-12-regular text-icon-warning-base">Experimental</span>
          </SettingsRowV2>
        </Show>

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
            disabled={!settings.voice.enabled() || !settings.voice.listeningEnabled()}
            onChange={settings.voice.setAutoSubmit}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.voice.listening.title")}
          description={language.t("settings.general.voice.listening.description")}
        >
          <Switch
            checked={settings.voice.enabled() && settings.voice.listeningEnabled()}
            onChange={settings.voice.setListeningEnabled}
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
            disabled={!settings.voice.enabled() || !settings.voice.listeningEnabled()}
            onChange={settings.voice.setContextualCorrection}
          />
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.voice.confirmRisky.title")}
          description={language.t("settings.general.voice.confirmRisky.description")}
        >
          <Switch
            checked={settings.voice.confirmRiskyCommands()}
            disabled={!settings.voice.enabled() || !settings.voice.listeningEnabled()}
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
            disabled={!settings.voice.enabled() || !settings.voice.listeningEnabled()}
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

        <Show when={settings.voice.speakResponses() && settings.voice.engine() === "cascade"}>
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
                    <TextInputV2
                      data-action="settings-voice-fish-preset-name"
                      appearance="base"
                      value={fishPresetName()}
                      onInput={(event) => setFishPresetName(event.currentTarget.value)}
                      placeholder={language.t("settings.general.voice.fish.presets.name")}
                      aria-label={language.t("settings.general.voice.fish.presets.name")}
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
                        data-action="settings-voice-fish-preset-save"
                        variant="neutral"
                        disabled={
                          fishDebugState() === "running" ||
                          fishPresetState() !== "idle" ||
                          !fishPresetName().trim() ||
                          !fishReferenceFile() ||
                          !fishVoiceTranscript().trim()
                        }
                        onClick={() => void saveFishPreset()}
                      >
                        {fishPresetState() === "saving"
                          ? language.t("settings.general.voice.fish.presets.saving")
                          : language.t("settings.general.voice.fish.presets.save")}
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

                <SettingsRowV2
                  title={language.t("settings.general.voice.fish.presets.title")}
                  description={language.t("settings.general.voice.fish.presets.description")}
                >
                  <div class="grid w-full sm:w-[520px] gap-2">
                    <Show
                      when={fishVoicePresets().length > 0}
                      fallback={
                        <div class="text-13-regular text-text-weak">
                          {language.t("settings.general.voice.fish.presets.empty")}
                        </div>
                      }
                    >
                      <For each={fishVoicePresets()}>
                        {(preset) => (
                          <div class="grid gap-2 rounded-md border border-border-weak-base bg-surface-base px-3 py-3">
                            <div class="flex items-center justify-between gap-3">
                              <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                  <span class="truncate text-14-regular text-text-strong">{preset.name}</span>
                                  <Show when={preset.active}>
                                    <span class="text-11-medium text-icon-success-base">
                                      {language.t("settings.general.voice.fish.presets.active")}
                                    </span>
                                  </Show>
                                </div>
                                <div class="truncate text-11-regular text-text-weaker">
                                  {preset.filename} · {(preset.bytes / 1024 / 1024).toFixed(2)} MB
                                </div>
                              </div>
                              <div class="flex shrink-0 items-center gap-1">
                                <ButtonV2
                                  data-action="settings-voice-fish-preset-activate"
                                  variant="ghost"
                                  disabled={preset.active || fishPresetState() !== "idle"}
                                  onClick={() => void activateFishPreset(preset.id)}
                                >
                                  {language.t("settings.general.voice.fish.presets.activate")}
                                </ButtonV2>
                                <ButtonV2
                                  data-action="settings-voice-fish-preset-delete"
                                  variant="ghost"
                                  disabled={fishPresetState() !== "idle"}
                                  onClick={() => void deleteFishPreset(preset)}
                                >
                                  {language.t("settings.general.voice.fish.presets.delete")}
                                </ButtonV2>
                              </div>
                            </div>
                            <div class="line-clamp-2 text-12-regular text-text-weak">{preset.transcript}</div>
                          </div>
                        )}
                      </For>
                    </Show>
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
            disabled={!settings.voice.enabled() || !settings.voice.listeningEnabled() || !settings.voice.autoSubmit()}
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
              disabled={!settings.voice.enabled() || !settings.voice.listeningEnabled() || !settings.voice.autoSubmit()}
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
          <ButtonV2 size="normal" variant="neutral" disabled={!updater.action().run} onClick={() => updater.run()}>
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

  if (props.section === "voice") {
    return (
      <>
        <div class="settings-v2-tab-header">
          <h2 class="settings-v2-tab-title">{language.t("settings.tab.voice")}</h2>
        </div>

        <div class="settings-v2-tab-body">
          <VoiceSection />
        </div>
      </>
    )
  }

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

        <AppearanceSection controller={appearance} />

        <NotificationsSection />

        <SoundsSection controller={sounds} />

        <Show when={desktop()}>
          <UpdatesSection />
        </Show>

        <DisplaySection />

        <AdvancedSection />
      </div>
    </>
  )
}

export const SettingsVoiceV2: Component<{
  sessionID?: string
}> = (props) => <SettingsGeneralV2 sessionID={props.sessionID} section="voice" />
