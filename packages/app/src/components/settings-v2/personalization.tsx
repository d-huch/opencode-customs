import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import {
  agentPersonalizationInstruction,
  type AgentFishVoice,
  type AgentLocalVoice,
  type AgentPersonalizationPreset,
  type AgentPersonalizationValues,
  type AgentVoice,
} from "@/utils/agent-personalization"

type VoiceKind = "none" | "local" | "fish" | "fish-new"
type PersonalizationForm = AgentPersonalizationValues & {
  name: string
  voice: AgentVoice | null
  voiceKind: VoiceKind
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

export function SettingsPersonalizationV2() {
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()

  const emptyValues = (): AgentPersonalizationValues => ({
    archetype: "natural",
    assistantName: settings.personalization.assistantName(),
    userName: settings.personalization.userName(),
    addressAs: settings.personalization.addressAs(),
    language: settings.personalization.language(),
    tone: settings.personalization.tone(),
    detail: settings.personalization.detail(),
    proactivity: settings.personalization.proactivity(),
    humor: settings.personalization.humor(),
    catchphrases: settings.personalization.catchphrases(),
    customInstructions: settings.personalization.customInstructions(),
  })
  const emptyForm = (): PersonalizationForm => ({
    name: language.t("personalization.editor.newName"),
    ...emptyValues(),
    voice: null,
    voiceKind: "none",
  })
  const [form, setForm] = createStore(emptyForm())
  const [selectedID, setSelectedID] = createSignal<string>()
  const [lastSelectedID, setLastSelectedID] = createSignal<string>()
  const [fishPresets, setFishPresets] = createSignal<FishVoicePreset[]>([])
  const [fishPresetsLoaded, setFishPresetsLoaded] = createSignal(false)
  const [fishFile, setFishFile] = createSignal<File>()
  const [fishName, setFishName] = createSignal("")
  const [fishTranscript, setFishTranscript] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [status, setStatus] = createSignal("")
  let initialized = false

  const values = (): AgentPersonalizationValues => ({
    archetype: form.archetype,
    assistantName: form.assistantName,
    userName: form.userName,
    addressAs: form.addressAs,
    language: form.language,
    tone: form.tone,
    detail: form.detail,
    proactivity: form.proactivity,
    humor: form.humor,
    catchphrases: form.catchphrases,
    customInstructions: form.customInstructions,
  })
  const selectedPreset = createMemo(() =>
    settings.personalization.presets().find((preset) => preset.id === selectedID()),
  )
  const missingFishVoice = createMemo(() => {
    const voice = form.voice
    if (!fishPresetsLoaded() || voice?.provider !== "fish-local") return false
    return !fishPresets().some((preset) => preset.id === voice.voicePresetID)
  })
  const serializableForm = () => ({ name: form.name, ...values(), voice: form.voice })
  const dirty = createMemo(() => {
    const preset = selectedPreset()
    const baseline = preset ? { name: preset.name, ...presetValues(preset), voice: preset.voice ?? null } : undefined
    return (
      JSON.stringify(serializableForm()) !== JSON.stringify(baseline) ||
      form.voiceKind === "fish-new" ||
      !!fishFile() ||
      !!fishName() ||
      !!fishTranscript()
    )
  })
  const preview = createMemo(() => agentPersonalizationInstruction({ enabled: true, ...values() }))

  const localVoice = (): AgentLocalVoice => ({
    provider: "local",
    endpoint: settings.voice.ttsEndpoint(),
    model: settings.voice.ttsModel(),
    mode: settings.voice.ttsMode(),
    voice: settings.voice.ttsVoice(),
    playbackRate: 1,
    volume: 1,
  })
  const fishVoice = (presetID: string): AgentFishVoice => ({
    provider: "fish-local",
    voicePresetID: presetID,
    endpoint: settings.voice.fishEndpoint(),
    latency: settings.voice.fishLatency(),
    language: settings.voice.fishLanguage(),
    playbackRate: settings.voice.fishPlaybackRate(),
    volume: settings.voice.fishVolume(),
    temperature: settings.voice.fishTemperature(),
    topP: settings.voice.fishTopP(),
    repetitionPenalty: settings.voice.fishRepetitionPenalty(),
    seed: settings.voice.fishSeed(),
    chunkLength: settings.voice.fishChunkLength(),
    normalize: settings.voice.fishNormalize(),
    streaming: settings.voice.fishStreaming(),
    useMemoryCache: settings.voice.fishMemoryCache(),
    maxNewTokens: settings.voice.fishMaxNewTokens(),
  })

  const clearPendingVoice = () => {
    setFishFile()
    setFishName("")
    setFishTranscript("")
  }
  const load = (preset: AgentPersonalizationPreset | undefined) => {
    setSelectedID(preset?.id)
    if (preset) setLastSelectedID(preset.id)
    setForm(
      preset
        ? {
            name: preset.name,
            ...presetValues(preset),
            voice: preset.voice ?? null,
            voiceKind: preset.voice?.provider === "local" ? "local" : preset.voice ? "fish" : "none",
          }
        : emptyForm(),
    )
    clearPendingVoice()
    setStatus("")
  }
  const refreshFishPresets = async () => {
    if (!platform.listFishAudioVoicePresets) {
      setFishPresetsLoaded(true)
      return
    }
    const presets = await platform.listFishAudioVoicePresets().catch(() => [])
    setFishPresets(presets)
    setFishPresetsLoaded(true)
  }

  createEffect(() => {
    const presets = settings.personalization.presets()
    if (initialized || !presets.length) return
    initialized = true
    const defaultID = settings.personalization.defaultPresetID()
    load(presets.find((preset) => preset.id === defaultID) ?? presets[0])
    void refreshFishPresets()
  })

  const selectVoiceKind = (kind: VoiceKind) => {
    setForm("voiceKind", kind)
    clearPendingVoice()
    if (kind === "none" || kind === "fish-new") {
      setForm("voice", null)
      return
    }
    if (kind === "local") {
      setForm("voice", localVoice())
      return
    }
    const preset = fishPresets()[0]
    setForm("voice", preset ? fishVoice(preset.id) : null)
  }
  const updateLocalVoice = (value: Partial<AgentLocalVoice>) => {
    if (form.voice?.provider !== "local") return
    setForm("voice", { ...form.voice, ...value })
  }
  const updateFishVoice = (value: Partial<AgentFishVoice>) => {
    if (form.voice?.provider !== "fish-local") return
    setForm("voice", { ...form.voice, ...value })
  }

  const chooseFishFile = async () => {
    if (!platform.openAttachmentPickerDialog) {
      setStatus(language.t("personalization.voice.unavailable"))
      return
    }
    await platform.openAttachmentPickerDialog(
      {
        title: language.t("personalization.voice.fish.choose"),
        extensions: ["wav", "mp3", "m4a", "mp4", "ogg", "oga", "flac", "aac"],
      },
      async (file) => {
        setFishFile(file)
        if (!fishName()) setFishName(file.name.replace(/\.[^.]+$/, ""))
        setStatus("")
      },
    )
  }

  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    const name = form.name.trim().slice(0, 80)
    if (!name) {
      setStatus(language.t("personalization.editor.nameRequired"))
      return
    }
    setSaving(true)
    setStatus("")
    let voice = form.voice
    if (form.voiceKind === "fish-new") {
      const file = fishFile()
      if (!file || !fishName().trim() || !fishTranscript().trim() || !platform.saveFishAudioVoicePreset) {
        setStatus(language.t("personalization.voice.fish.required"))
        setSaving(false)
        return
      }
      const preset = await platform
        .saveFishAudioVoicePreset({
          name: fishName(),
          activate: false,
          filename: file.name,
          contentType: fishContentType(file),
          audio: await file.arrayBuffer(),
          transcript: fishTranscript(),
        })
        .catch((error: unknown) => {
          setStatus(error instanceof Error ? error.message : String(error))
          return undefined
        })
      if (!preset) {
        setSaving(false)
        return
      }
      voice = fishVoice(preset.id)
    }
    const current = selectedPreset()
    const now = Date.now()
    const preset: AgentPersonalizationPreset = {
      id: current?.id ?? crypto.randomUUID(),
      name,
      ...values(),
      voice,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }
    settings.personalization.setPresets(
      current
        ? settings.personalization.presets().map((item) => (item.id === current.id ? preset : item))
        : [preset, ...settings.personalization.presets()],
    )
    if (!settings.personalization.defaultPresetID()) settings.personalization.setDefaultPresetID(preset.id)
    setSelectedID(preset.id)
    setLastSelectedID(preset.id)
    setForm({ ...form, name, voice, voiceKind: voice?.provider === "local" ? "local" : voice ? "fish" : "none" })
    clearPendingVoice()
    await refreshFishPresets()
    setStatus(language.t("personalization.editor.saved"))
    setSaving(false)
  }

  const duplicate = (preset: AgentPersonalizationPreset) => {
    const copy = {
      ...preset,
      id: crypto.randomUUID(),
      name: language.t("personalization.editor.copyName", { name: preset.name }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    settings.personalization.setPresets([copy, ...settings.personalization.presets()])
    load(copy)
  }
  const remove = (preset: AgentPersonalizationPreset) => {
    const remaining = settings.personalization.presets().filter((item) => item.id !== preset.id)
    settings.personalization.setPresets(remaining)
    if (settings.personalization.defaultPresetID() === preset.id) settings.personalization.setDefaultPresetID("")
    load(remaining[0])
  }
  const cancel = () => {
    const preset =
      selectedPreset() ??
      settings.personalization.presets().find((item) => item.id === lastSelectedID()) ??
      settings.personalization.presets()[0]
    load(preset)
  }

  const testVoice = async () => {
    const voice = form.voice
    if (!voice || !platform.synthesizeLocalSpeech) {
      setStatus(language.t("personalization.voice.unavailable"))
      return
    }
    setStatus(language.t("personalization.voice.testing"))
    const result = await platform
      .synthesizeLocalSpeech({
        provider: voice.provider,
        fishPresetID: voice.provider === "fish-local" ? voice.voicePresetID : undefined,
        endpoint: voice.endpoint,
        model: voice.provider === "local" ? voice.model : "",
        voice: voice.provider === "local" ? voice.voice : "",
        mode: voice.provider === "local" ? voice.mode : "quality",
        latency: voice.provider === "fish-local" ? voice.latency : undefined,
        language: voice.provider === "fish-local" ? voice.language : undefined,
        temperature: voice.provider === "fish-local" ? voice.temperature : undefined,
        topP: voice.provider === "fish-local" ? voice.topP : undefined,
        repetitionPenalty: voice.provider === "fish-local" ? voice.repetitionPenalty : undefined,
        seed: voice.provider === "fish-local" ? voice.seed : undefined,
        chunkLength: voice.provider === "fish-local" ? voice.chunkLength : undefined,
        normalize: voice.provider === "fish-local" ? voice.normalize : undefined,
        streaming: voice.provider === "fish-local" ? voice.streaming : undefined,
        useMemoryCache: voice.provider === "fish-local" ? voice.useMemoryCache : undefined,
        maxNewTokens: voice.provider === "fish-local" ? voice.maxNewTokens : undefined,
        text: language.t("settings.general.voice.test.phrase"),
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : String(error))
        return undefined
      })
    if (!result) return
    const url = URL.createObjectURL(result.audio)
    const audio = new Audio(url)
    audio.playbackRate = voice.playbackRate
    audio.volume = voice.volume
    audio.onended = () => URL.revokeObjectURL(url)
    audio.onerror = () => URL.revokeObjectURL(url)
    await audio.play()
    setStatus(language.t("personalization.voice.playing"))
  }

  const voiceKinds = [
    { value: "none" as const, label: language.t("personalization.voice.none") },
    { value: "local" as const, label: language.t("personalization.voice.local") },
    { value: "fish" as const, label: language.t("personalization.voice.fish.existing") },
    { value: "fish-new" as const, label: language.t("personalization.voice.fish.new") },
  ]

  return (
    <form class="contents" onSubmit={save}>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("personalization.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-personalization-body">
        <p class="text-13-regular text-v2-text-text-muted">{language.t("personalization.description")}</p>
        <div class="settings-v2-personalization-manager">
          <aside class="settings-v2-personality-list">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-14-medium text-v2-text-text-base">{language.t("personalization.presets.title")}</h3>
              <ButtonV2 type="button" variant="neutral" onClick={() => load(undefined)}>
                {language.t("personalization.editor.create")}
              </ButtonV2>
            </div>
            <Show
              when={settings.personalization.presets().length}
              fallback={
                <p class="text-12-regular text-v2-text-text-muted">{language.t("personalization.presets.empty")}</p>
              }
            >
              <For each={settings.personalization.presets()}>
                {(preset) => (
                  <button
                    type="button"
                    class="settings-v2-personality-card"
                    classList={{ "settings-v2-personality-card-selected": selectedID() === preset.id }}
                    onClick={() => load(preset)}
                  >
                    <span class="truncate text-13-medium">{preset.name}</span>
                    <span class="truncate text-11-regular text-v2-text-text-muted">
                      {preset.assistantName || language.t("personalization.presets.unnamed")} ·{" "}
                      {language.t(`personalization.archetype.${preset.archetype ?? "natural"}`)} ·{" "}
                      {preset.voice
                        ? language.t("personalization.chat.voice")
                        : language.t("personalization.chat.silent")}
                    </span>
                    <Show when={settings.personalization.defaultPresetID() === preset.id}>
                      <span class="text-11-medium text-v2-text-text-accent">
                        {language.t("personalization.editor.default")}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </aside>

          <main class="settings-v2-personality-editor">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-14-medium text-v2-text-text-base">{language.t("personalization.editor.title")}</h3>
              <Show when={selectedPreset()}>
                {(preset) => (
                  <div class="flex flex-wrap gap-2">
                    <ButtonV2
                      type="button"
                      variant="ghost"
                      onClick={() => settings.personalization.setDefaultPresetID(preset().id)}
                    >
                      {language.t("personalization.editor.setDefault")}
                    </ButtonV2>
                    <ButtonV2 type="button" variant="ghost" onClick={() => duplicate(preset())}>
                      {language.t("personalization.editor.duplicate")}
                    </ButtonV2>
                    <ButtonV2 type="button" variant="ghost" onClick={() => remove(preset())}>
                      {language.t("personalization.presets.delete")}
                    </ButtonV2>
                  </div>
                )}
              </Show>
            </div>

            <Field>
              <Field.Label>{language.t("personalization.editor.presetName")}</Field.Label>
              <TextInputV2
                data-action="settings-personalization-preset-name"
                class="!w-full"
                value={form.name}
                maxlength={80}
                onInput={(event) => setForm("name", event.currentTarget.value)}
              />
            </Field>

            <div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              <Field>
                <Field.Label>{language.t("personalization.assistantName")}</Field.Label>
                <TextInputV2
                  data-action="settings-personalization-assistant-name"
                  class="!w-full"
                  value={form.assistantName}
                  maxlength={80}
                  onInput={(event) => setForm("assistantName", event.currentTarget.value)}
                />
              </Field>
              <Field>
                <Field.Label>{language.t("personalization.userName")}</Field.Label>
                <TextInputV2
                  class="!w-full"
                  value={form.userName}
                  maxlength={80}
                  onInput={(event) => setForm("userName", event.currentTarget.value)}
                />
              </Field>
              <Field>
                <Field.Label>{language.t("personalization.addressAs")}</Field.Label>
                <TextInputV2
                  class="!w-full"
                  value={form.addressAs}
                  maxlength={80}
                  onInput={(event) => setForm("addressAs", event.currentTarget.value)}
                />
              </Field>
              <Field>
                <Field.Label>{language.t("personalization.language")}</Field.Label>
                <TextInputV2
                  class="!w-full"
                  value={form.language}
                  maxlength={80}
                  onInput={(event) => setForm("language", event.currentTarget.value)}
                />
              </Field>
            </div>

            <div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              <EnumSelect
                label={language.t("personalization.archetype")}
                description={language.t(`personalization.archetype.${form.archetype}.description`)}
                value={form.archetype}
                options={["natural", "military", "depressive", "clown", "jarvis", "mentor", "sarcastic"].map(
                  (value) => ({
                    value,
                    label: language.t(`personalization.archetype.${value}`),
                  }),
                )}
                onChange={(value) => setForm("archetype", value as typeof form.archetype)}
              />
              <EnumSelect
                label={language.t("personalization.tone")}
                value={form.tone}
                options={["natural", "professional", "direct", "friendly"].map((value) => ({
                  value,
                  label: language.t(`personalization.tone.${value}`),
                }))}
                onChange={(value) => setForm("tone", value as typeof form.tone)}
              />
              <EnumSelect
                label={language.t("personalization.detail")}
                value={form.detail}
                options={["brief", "balanced", "detailed"].map((value) => ({
                  value,
                  label: language.t(`personalization.detail.${value}`),
                }))}
                onChange={(value) => setForm("detail", value as typeof form.detail)}
              />
              <EnumSelect
                label={language.t("personalization.proactivity")}
                value={form.proactivity}
                options={["reactive", "balanced", "proactive"].map((value) => ({
                  value,
                  label: language.t(`personalization.proactivity.${value}`),
                }))}
                onChange={(value) => setForm("proactivity", value as typeof form.proactivity)}
              />
              <EnumSelect
                label={language.t("personalization.humor")}
                value={form.humor}
                options={["off", "subtle", "playful"].map((value) => ({
                  value,
                  label: language.t(`personalization.humor.${value}`),
                }))}
                onChange={(value) => setForm("humor", value as typeof form.humor)}
              />
            </div>

            <Field>
              <Field.Label>{language.t("personalization.catchphrases")}</Field.Label>
              <TextareaV2
                class="!w-full"
                rows={3}
                value={form.catchphrases}
                maxlength={2_000}
                onInput={(event) => setForm("catchphrases", event.currentTarget.value)}
              />
            </Field>
            <Field>
              <Field.Label>{language.t("personalization.customInstructions")}</Field.Label>
              <TextareaV2
                class="!w-full"
                rows={5}
                value={form.customInstructions}
                maxlength={4_000}
                onInput={(event) => setForm("customInstructions", event.currentTarget.value)}
              />
            </Field>

            <section class="settings-v2-personality-voice">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 class="text-14-medium text-v2-text-text-base">{language.t("personalization.voice.title")}</h3>
                  <p class="text-12-regular text-v2-text-text-muted">
                    {language.t("personalization.voice.description")}
                  </p>
                </div>
                <SelectV2
                  appearance="inline"
                  options={voiceKinds}
                  current={voiceKinds.find((option) => option.value === form.voiceKind)}
                  value={(option) => option.value}
                  label={(option) => option.label}
                  onSelect={(option) => option && selectVoiceKind(option.value)}
                />
              </div>

              <Show when={form.voiceKind === "fish"}>
                <SelectV2
                  appearance="base"
                  options={fishPresets()}
                  current={fishPresets().find(
                    (preset) => preset.id === (form.voice?.provider === "fish-local" ? form.voice.voicePresetID : ""),
                  )}
                  value={(preset) => preset.id}
                  label={(preset) => preset.name}
                  placeholder={language.t("personalization.voice.fish.select")}
                  onSelect={(preset) => preset && setForm("voice", fishVoice(preset.id))}
                />
                <Show when={missingFishVoice()}>
                  <p class="text-12-regular text-v2-text-text-muted">{language.t("personalization.voice.missing")}</p>
                </Show>
              </Show>

              <Show when={form.voiceKind === "fish-new"}>
                <div class="grid gap-3 rounded-md border border-v2-border-border-muted p-3">
                  <ButtonV2 type="button" variant="neutral" onClick={() => void chooseFishFile()}>
                    {fishFile()?.name ?? language.t("personalization.voice.fish.choose")}
                  </ButtonV2>
                  <TextInputV2
                    class="!w-full"
                    value={fishName()}
                    placeholder={language.t("personalization.voice.fish.name")}
                    onInput={(event) => setFishName(event.currentTarget.value)}
                  />
                  <TextareaV2
                    class="!w-full"
                    rows={3}
                    value={fishTranscript()}
                    placeholder={language.t("personalization.voice.fish.transcript")}
                    onInput={(event) => setFishTranscript(event.currentTarget.value)}
                  />
                </div>
              </Show>

              <Show when={form.voice && form.voiceKind !== "fish-new"}>
                <details class="rounded-md border border-v2-border-border-muted p-3">
                  <summary class="cursor-pointer text-13-medium text-v2-text-text-base">
                    {language.t("personalization.voice.advanced")}
                  </summary>
                  <Show when={form.voice?.provider === "local"}>
                    <LocalVoiceFields voice={form.voice as AgentLocalVoice} update={updateLocalVoice} />
                  </Show>
                  <Show when={form.voice?.provider === "fish-local"}>
                    <FishVoiceFields voice={form.voice as AgentFishVoice} update={updateFishVoice} />
                  </Show>
                </details>
                <ButtonV2 type="button" variant="neutral" onClick={() => void testVoice()}>
                  {language.t("personalization.voice.test")}
                </ButtonV2>
              </Show>
            </section>

            <details class="rounded-md border border-v2-border-border-base p-3">
              <summary class="cursor-pointer text-13-medium text-v2-text-text-base">
                {language.t("personalization.preview")}
              </summary>
              <pre class="mt-3 whitespace-pre-wrap break-words text-12-regular text-v2-text-text-muted">
                {preview()}
              </pre>
            </details>
            <Show when={status()}>
              <p class="text-12-regular text-v2-text-text-muted" aria-live="polite">
                {status()}
              </p>
            </Show>
          </main>
        </div>
      </div>

      <div class="settings-v2-personalization-footer">
        <ButtonV2
          data-action="settings-personalization-cancel"
          type="button"
          variant="neutral"
          disabled={!dirty() || saving()}
          onClick={cancel}
        >
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          data-action="settings-personalization-save"
          type="submit"
          variant="contrast"
          disabled={!dirty() || saving()}
        >
          {saving() ? language.t("personalization.editor.saving") : language.t("common.save")}
        </ButtonV2>
      </div>
    </form>
  )
}

function presetValues(preset: AgentPersonalizationPreset): AgentPersonalizationValues {
  return {
    archetype: preset.archetype ?? "natural",
    assistantName: preset.assistantName,
    userName: preset.userName,
    addressAs: preset.addressAs,
    language: preset.language,
    tone: preset.tone,
    detail: preset.detail,
    proactivity: preset.proactivity,
    humor: preset.humor,
    catchphrases: preset.catchphrases,
    customInstructions: preset.customInstructions,
  }
}

function fishContentType(file: File) {
  if (file.type) return file.type
  const extension = file.name.split(".").at(-1)?.toLowerCase()
  return (
    (
      {
        wav: "audio/wav",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        mp4: "audio/mp4",
        ogg: "audio/ogg",
        oga: "audio/ogg",
        flac: "audio/flac",
        aac: "audio/aac",
      } as Record<string, string>
    )[extension ?? ""] ?? "application/octet-stream"
  )
}

function EnumSelect(props: {
  label: string
  description?: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
      {props.label}
      <select
        class="h-9 min-w-0 w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3"
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.options.map((option) => (
          <option value={option.value}>{option.label}</option>
        ))}
      </select>
      <Show when={props.description}>
        <span class="text-11-regular text-v2-text-text-muted">{props.description}</span>
      </Show>
    </label>
  )
}

function LocalVoiceFields(props: { voice: AgentLocalVoice; update: (value: Partial<AgentLocalVoice>) => void }) {
  const language = useLanguage()
  return (
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <VoiceText
        label={language.t("settings.general.voice.ttsEndpoint.title")}
        value={props.voice.endpoint}
        update={(endpoint) => props.update({ endpoint })}
      />
      <VoiceText
        label={language.t("settings.general.voice.ttsModel.title")}
        value={props.voice.model}
        update={(model) => props.update({ model })}
      />
      <VoiceText
        label={language.t("settings.general.voice.ttsVoice.title")}
        value={props.voice.voice}
        update={(voice) => props.update({ voice })}
      />
      <VoiceEnum
        label={language.t("settings.general.voice.mode.title")}
        value={props.voice.mode}
        options={["quality", "fast"]}
        update={(mode) => props.update({ mode: mode as AgentLocalVoice["mode"] })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.playbackRate.title")}
        value={props.voice.playbackRate}
        min={0.5}
        max={2}
        step={0.05}
        update={(playbackRate) => props.update({ playbackRate })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.volume.title")}
        value={props.voice.volume}
        min={0}
        max={1}
        step={0.05}
        update={(volume) => props.update({ volume })}
      />
    </div>
  )
}

function FishVoiceFields(props: { voice: AgentFishVoice; update: (value: Partial<AgentFishVoice>) => void }) {
  const language = useLanguage()
  return (
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <VoiceText
        label={language.t("settings.general.voice.fish.endpoint.title")}
        value={props.voice.endpoint}
        update={(endpoint) => props.update({ endpoint })}
      />
      <VoiceEnum
        label={language.t("settings.general.voice.fish.latency.title")}
        value={props.voice.latency}
        options={["balanced", "normal"]}
        update={(latency) => props.update({ latency: latency as AgentFishVoice["latency"] })}
      />
      <VoiceEnum
        label={language.t("settings.general.voice.fish.language.title")}
        value={props.voice.language}
        options={["auto", "uk", "en", "mixed"]}
        update={(language) => props.update({ language: language as AgentFishVoice["language"] })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.playbackRate.title")}
        value={props.voice.playbackRate}
        min={0.5}
        max={2}
        step={0.05}
        update={(playbackRate) => props.update({ playbackRate })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.volume.title")}
        value={props.voice.volume}
        min={0}
        max={1}
        step={0.05}
        update={(volume) => props.update({ volume })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.temperature.title")}
        value={props.voice.temperature}
        min={0.1}
        max={1}
        step={0.05}
        update={(temperature) => props.update({ temperature })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.topP.title")}
        value={props.voice.topP}
        min={0.1}
        max={1}
        step={0.05}
        update={(topP) => props.update({ topP })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.repetitionPenalty.title")}
        value={props.voice.repetitionPenalty}
        min={0.9}
        max={2}
        step={0.05}
        update={(repetitionPenalty) => props.update({ repetitionPenalty })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.seed.title")}
        value={props.voice.seed ?? 0}
        step={1}
        update={(seed) => props.update({ seed })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.chunkLength.title")}
        value={props.voice.chunkLength}
        min={100}
        max={1000}
        step={10}
        update={(chunkLength) => props.update({ chunkLength })}
      />
      <VoiceNumber
        label={language.t("settings.general.voice.fish.maxNewTokens.title")}
        value={props.voice.maxNewTokens}
        min={128}
        max={4096}
        step={128}
        update={(maxNewTokens) => props.update({ maxNewTokens })}
      />
      <label class="flex items-center justify-between gap-3 text-12-regular">
        {language.t("settings.general.voice.fish.normalize.title")}
        <Switch checked={props.voice.normalize} onChange={(normalize) => props.update({ normalize })} />
      </label>
      <label class="flex items-center justify-between gap-3 text-12-regular">
        {language.t("settings.general.voice.fish.streaming.title")}
        <Switch checked={props.voice.streaming} onChange={(streaming) => props.update({ streaming })} />
      </label>
      <label class="flex items-center justify-between gap-3 text-12-regular">
        {language.t("settings.general.voice.fish.memoryCache.title")}
        <Switch checked={props.voice.useMemoryCache} onChange={(useMemoryCache) => props.update({ useMemoryCache })} />
      </label>
    </div>
  )
}

function VoiceText(props: { label: string; value: string; update: (value: string) => void }) {
  return (
    <Field>
      <Field.Label>{props.label}</Field.Label>
      <TextInputV2 class="!w-full" value={props.value} onInput={(event) => props.update(event.currentTarget.value)} />
    </Field>
  )
}

function VoiceNumber(props: {
  label: string
  value: number
  min?: number
  max?: number
  step: number
  update: (value: number) => void
}) {
  return (
    <Field>
      <Field.Label>{props.label}</Field.Label>
      <TextInputV2
        class="!w-full"
        type="number"
        value={String(props.value)}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(event) => props.update(event.currentTarget.valueAsNumber)}
      />
    </Field>
  )
}

function VoiceEnum(props: { label: string; value: string; options: string[]; update: (value: string) => void }) {
  return (
    <Field>
      <Field.Label>{props.label}</Field.Label>
      <select
        class="h-9 min-w-0 w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3"
        value={props.value}
        onChange={(event) => props.update(event.currentTarget.value)}
      >
        {props.options.map((option) => (
          <option value={option}>{option}</option>
        ))}
      </select>
    </Field>
  )
}
