import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import {
  agentPersonalizationInstruction,
  type AgentPersonalizationPreset,
  type AgentPersonalizationProfile,
  type AgentPersonalizationValues,
} from "@/utils/agent-personalization"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

type PersonalizationForm = AgentPersonalizationProfile & {
  presetName: string
}

export function SettingsPersonalizationV2() {
  const language = useLanguage()
  const settings = useSettings()

  const savedValues = (): AgentPersonalizationValues => ({
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
  const savedForm = (): PersonalizationForm => ({
    enabled: settings.personalization.enabled(),
    presetName: "",
    ...savedValues(),
  })
  const [form, setForm] = createStore(savedForm())
  const values = (): AgentPersonalizationValues => ({
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
  const profile = (): AgentPersonalizationProfile => ({ enabled: form.enabled, ...values() })
  const dirty = createMemo(
    () =>
      JSON.stringify(profile()) !== JSON.stringify({ enabled: settings.personalization.enabled(), ...savedValues() }),
  )
  const preview = createMemo(() => agentPersonalizationInstruction({ enabled: true, ...values() }))

  const setValues = (value: AgentPersonalizationValues) => {
    setForm({ enabled: form.enabled, presetName: form.presetName, ...value })
  }

  const persistValues = (value: AgentPersonalizationValues) => {
    settings.personalization.setAssistantName(value.assistantName)
    settings.personalization.setUserName(value.userName)
    settings.personalization.setAddressAs(value.addressAs)
    settings.personalization.setLanguage(value.language)
    settings.personalization.setTone(value.tone)
    settings.personalization.setDetail(value.detail)
    settings.personalization.setProactivity(value.proactivity)
    settings.personalization.setHumor(value.humor)
    settings.personalization.setCatchphrases(value.catchphrases)
    settings.personalization.setCustomInstructions(value.customInstructions)
  }

  const persistProfile = (value: AgentPersonalizationProfile) => {
    settings.personalization.setEnabled(value.enabled)
    persistValues(value)
  }

  const savePreset = () => {
    const name = form.presetName.trim().slice(0, 80)
    if (!name) return
    const now = Date.now()
    const preset: AgentPersonalizationPreset = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      ...values(),
    }
    settings.personalization.setPresets([preset, ...settings.personalization.presets()])
    settings.personalization.setActivePresetID(preset.id)
    persistValues(preset)
    setForm("presetName", "")
  }

  const activatePreset = (preset: AgentPersonalizationPreset) => {
    setValues(preset)
    persistValues(preset)
    settings.personalization.setActivePresetID(preset.id)
  }

  const updateActivePreset = () => {
    const id = settings.personalization.activePresetID()
    if (!id) return
    settings.personalization.setPresets(
      settings.personalization
        .presets()
        .map((preset) => (preset.id === id ? { ...preset, ...values(), updatedAt: Date.now() } : preset)),
    )
    persistValues(values())
  }

  const deletePreset = (id: string) => {
    settings.personalization.setPresets(settings.personalization.presets().filter((preset) => preset.id !== id))
    if (settings.personalization.activePresetID() !== id) return
    settings.personalization.setActivePresetID("")
  }

  const save = (event: SubmitEvent) => {
    event.preventDefault()
    persistProfile(profile())
    const id = settings.personalization.activePresetID()
    if (!id) return
    settings.personalization.setPresets(
      settings.personalization
        .presets()
        .map((preset) => (preset.id === id ? { ...preset, ...values(), updatedAt: Date.now() } : preset)),
    )
  }

  const cancel = () => setForm(savedForm())

  return (
    <form class="contents" onSubmit={save}>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("personalization.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-personalization-body">
        <p class="text-13-regular text-v2-text-text-muted">{language.t("personalization.description")}</p>

        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.general.row.personalization.title")}
              description={language.t("settings.general.row.personalization.description")}
            >
              <div data-action="settings-personalization-enabled">
                <Switch checked={form.enabled} onChange={(enabled) => setForm("enabled", enabled)} />
              </div>
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <section class="flex min-w-0 w-full flex-col gap-3 rounded-md border border-v2-border-border-base p-3">
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-v2-text-text-base">{language.t("personalization.presets.title")}</h3>
            <p class="text-12-regular text-v2-text-text-muted">{language.t("personalization.presets.description")}</p>
          </div>
          <div class="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <TextInputV2
              data-action="settings-personalization-preset-name"
              class="!w-full min-w-0"
              value={form.presetName}
              placeholder={language.t("personalization.presets.name.placeholder")}
              maxlength={80}
              onInput={(event) => setForm("presetName", event.currentTarget.value)}
            />
            <ButtonV2
              data-action="settings-personalization-preset-save"
              class="whitespace-nowrap"
              type="button"
              variant="contrast"
              disabled={!form.presetName.trim()}
              onClick={savePreset}
            >
              {language.t("personalization.presets.save")}
            </ButtonV2>
            <Show when={settings.personalization.activePresetID()}>
              <ButtonV2 class="whitespace-nowrap" type="button" variant="neutral" onClick={updateActivePreset}>
                {language.t("personalization.presets.update")}
              </ButtonV2>
            </Show>
          </div>
          <Show
            when={settings.personalization.presets().length}
            fallback={
              <p class="text-12-regular text-v2-text-text-muted">{language.t("personalization.presets.empty")}</p>
            }
          >
            <div class="flex flex-col gap-2">
              <For each={settings.personalization.presets()}>
                {(preset) => (
                  <div class="flex min-w-0 flex-col gap-2 rounded-md bg-v2-background-bg-subtle px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="truncate text-13-medium text-v2-text-text-base">{preset.name}</span>
                        <Show when={settings.personalization.activePresetID() === preset.id}>
                          <span class="rounded-full bg-v2-background-bg-subtle px-2 py-0.5 text-11-medium text-v2-text-text-base">
                            {language.t("personalization.presets.active")}
                          </span>
                        </Show>
                      </div>
                      <p class="truncate text-11-regular text-v2-text-text-muted">
                        {preset.assistantName || language.t("personalization.presets.unnamed")} · {preset.tone} ·{" "}
                        {preset.language}
                      </p>
                    </div>
                    <div class="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
                      <ButtonV2 type="button" variant="neutral" onClick={() => activatePreset(preset)}>
                        {language.t("personalization.presets.activate")}
                      </ButtonV2>
                      <ButtonV2 type="button" variant="neutral" onClick={() => deletePreset(preset.id)}>
                        {language.t("personalization.presets.delete")}
                      </ButtonV2>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <Field>
            <Field.Label>{language.t("personalization.assistantName")}</Field.Label>
            <TextInputV2
              data-action="settings-personalization-assistant-name"
              class="!w-full"
              value={form.assistantName}
              onInput={(event) => setForm("assistantName", event.currentTarget.value)}
              maxlength={80}
            />
          </Field>
          <Field>
            <Field.Label>{language.t("personalization.userName")}</Field.Label>
            <TextInputV2
              data-action="settings-personalization-user-name"
              class="!w-full"
              value={form.userName}
              onInput={(event) => setForm("userName", event.currentTarget.value)}
              maxlength={80}
            />
          </Field>
          <Field>
            <Field.Label>{language.t("personalization.addressAs")}</Field.Label>
            <TextInputV2
              class="!w-full"
              value={form.addressAs}
              onInput={(event) => setForm("addressAs", event.currentTarget.value)}
              maxlength={80}
            />
          </Field>
          <Field>
            <Field.Label>{language.t("personalization.language")}</Field.Label>
            <TextInputV2
              class="!w-full"
              value={form.language}
              placeholder="auto, uk, English"
              onInput={(event) => setForm("language", event.currentTarget.value)}
              maxlength={80}
            />
          </Field>
        </div>

        <div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
            {language.t("personalization.tone")}
            <select
              class="h-9 min-w-0 w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3"
              value={form.tone}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value !== "natural" && value !== "professional" && value !== "direct" && value !== "friendly")
                  return
                setForm("tone", value)
              }}
            >
              <option value="natural">{language.t("personalization.tone.natural")}</option>
              <option value="professional">{language.t("personalization.tone.professional")}</option>
              <option value="direct">{language.t("personalization.tone.direct")}</option>
              <option value="friendly">{language.t("personalization.tone.friendly")}</option>
            </select>
          </label>
          <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
            {language.t("personalization.detail")}
            <select
              class="h-9 min-w-0 w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3"
              value={form.detail}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value !== "brief" && value !== "balanced" && value !== "detailed") return
                setForm("detail", value)
              }}
            >
              <option value="brief">{language.t("personalization.detail.brief")}</option>
              <option value="balanced">{language.t("personalization.detail.balanced")}</option>
              <option value="detailed">{language.t("personalization.detail.detailed")}</option>
            </select>
          </label>
          <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
            {language.t("personalization.proactivity")}
            <select
              class="h-9 min-w-0 w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3"
              value={form.proactivity}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value !== "reactive" && value !== "balanced" && value !== "proactive") return
                setForm("proactivity", value)
              }}
            >
              <option value="reactive">{language.t("personalization.proactivity.reactive")}</option>
              <option value="balanced">{language.t("personalization.proactivity.balanced")}</option>
              <option value="proactive">{language.t("personalization.proactivity.proactive")}</option>
            </select>
          </label>
          <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
            {language.t("personalization.humor")}
            <select
              class="h-9 min-w-0 w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3"
              value={form.humor}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value !== "off" && value !== "subtle" && value !== "playful") return
                setForm("humor", value)
              }}
            >
              <option value="off">{language.t("personalization.humor.off")}</option>
              <option value="subtle">{language.t("personalization.humor.subtle")}</option>
              <option value="playful">{language.t("personalization.humor.playful")}</option>
            </select>
          </label>
        </div>

        <Field>
          <Field.Label>{language.t("personalization.catchphrases")}</Field.Label>
          <Field.Prefix>{language.t("personalization.catchphrases.description")}</Field.Prefix>
          <TextareaV2
            class="!w-full"
            rows={3}
            value={form.catchphrases}
            maxlength={2_000}
            placeholder={language.t("personalization.catchphrases.placeholder")}
            onInput={(event) => setForm("catchphrases", event.currentTarget.value)}
          />
        </Field>

        <Field>
          <Field.Label>{language.t("personalization.customInstructions")}</Field.Label>
          <Field.Prefix>{language.t("personalization.customInstructions.description")}</Field.Prefix>
          <TextareaV2
            class="!w-full"
            rows={5}
            value={form.customInstructions}
            maxlength={4_000}
            onInput={(event) => setForm("customInstructions", event.currentTarget.value)}
          />
        </Field>

        <details class="rounded-md border border-v2-border-border-base p-3">
          <summary class="cursor-pointer text-13-medium text-v2-text-text-base">
            {language.t("personalization.preview")}
          </summary>
          <pre class="mt-3 whitespace-pre-wrap break-words text-12-regular text-v2-text-text-muted">{preview()}</pre>
        </details>
      </div>

      <div class="settings-v2-personalization-footer">
        <ButtonV2
          data-action="settings-personalization-cancel"
          type="button"
          variant="neutral"
          disabled={!dirty()}
          onClick={cancel}
        >
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 data-action="settings-personalization-save" type="submit" variant="contrast" disabled={!dirty()}>
          {language.t("common.save")}
        </ButtonV2>
      </div>
    </form>
  )
}
