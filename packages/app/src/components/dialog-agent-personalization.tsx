import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import {
  agentPersonalizationInstruction,
  type AgentDetail,
  type AgentHumor,
  type AgentProactivity,
  type AgentTone,
} from "@/utils/agent-personalization"

export function DialogAgentPersonalization() {
  const dialog = useDialog()
  const language = useLanguage()
  const settings = useSettings()
  const [assistantName, setAssistantName] = createSignal(settings.personalization.assistantName())
  const [userName, setUserName] = createSignal(settings.personalization.userName())
  const [addressAs, setAddressAs] = createSignal(settings.personalization.addressAs())
  const [preferredLanguage, setPreferredLanguage] = createSignal(settings.personalization.language())
  const [tone, setTone] = createSignal(settings.personalization.tone())
  const [detail, setDetail] = createSignal(settings.personalization.detail())
  const [proactivity, setProactivity] = createSignal(settings.personalization.proactivity())
  const [humor, setHumor] = createSignal(settings.personalization.humor())
  const [catchphrases, setCatchphrases] = createSignal(settings.personalization.catchphrases())
  const [customInstructions, setCustomInstructions] = createSignal(settings.personalization.customInstructions())
  const preview = createMemo(() =>
    agentPersonalizationInstruction({
      enabled: true,
      assistantName: assistantName(),
      userName: userName(),
      addressAs: addressAs(),
      language: preferredLanguage(),
      tone: tone(),
      detail: detail(),
      proactivity: proactivity(),
      humor: humor(),
      catchphrases: catchphrases(),
      customInstructions: customInstructions(),
    }),
  )

  const save = (event: SubmitEvent) => {
    event.preventDefault()
    settings.personalization.setAssistantName(assistantName())
    settings.personalization.setUserName(userName())
    settings.personalization.setAddressAs(addressAs())
    settings.personalization.setLanguage(preferredLanguage())
    settings.personalization.setTone(tone())
    settings.personalization.setDetail(detail())
    settings.personalization.setProactivity(proactivity())
    settings.personalization.setHumor(humor())
    settings.personalization.setCatchphrases(catchphrases())
    settings.personalization.setCustomInstructions(customInstructions())
    dialog.close()
  }

  return (
    <Dialog size="large">
      <form class="contents" onSubmit={save}>
        <DialogHeader>
          <DialogTitle>{language.t("personalization.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex max-h-[min(700px,calc(100vh-140px))] min-h-0 w-full flex-col gap-5 overflow-y-auto px-4 py-4">
          <p class="text-13-regular text-v2-text-text-muted">{language.t("personalization.description")}</p>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Field.Label>{language.t("personalization.assistantName")}</Field.Label>
              <TextInputV2
                class="!w-full"
                value={assistantName()}
                onInput={(event) => setAssistantName(event.currentTarget.value)}
                maxlength={80}
              />
            </Field>
            <Field>
              <Field.Label>{language.t("personalization.userName")}</Field.Label>
              <TextInputV2
                class="!w-full"
                value={userName()}
                onInput={(event) => setUserName(event.currentTarget.value)}
                maxlength={80}
              />
            </Field>
            <Field>
              <Field.Label>{language.t("personalization.addressAs")}</Field.Label>
              <TextInputV2
                class="!w-full"
                value={addressAs()}
                onInput={(event) => setAddressAs(event.currentTarget.value)}
                maxlength={80}
              />
            </Field>
            <Field>
              <Field.Label>{language.t("personalization.language")}</Field.Label>
              <TextInputV2
                class="!w-full"
                value={preferredLanguage()}
                placeholder="auto, uk, English"
                onInput={(event) => setPreferredLanguage(event.currentTarget.value)}
                maxlength={80}
              />
            </Field>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
              {language.t("personalization.tone")}
              <select class="h-9 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3" value={tone()} onChange={(event) => setTone(event.currentTarget.value as AgentTone)}>
                <option value="natural">{language.t("personalization.tone.natural")}</option>
                <option value="professional">{language.t("personalization.tone.professional")}</option>
                <option value="direct">{language.t("personalization.tone.direct")}</option>
                <option value="friendly">{language.t("personalization.tone.friendly")}</option>
              </select>
            </label>
            <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
              {language.t("personalization.detail")}
              <select class="h-9 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3" value={detail()} onChange={(event) => setDetail(event.currentTarget.value as AgentDetail)}>
                <option value="brief">{language.t("personalization.detail.brief")}</option>
                <option value="balanced">{language.t("personalization.detail.balanced")}</option>
                <option value="detailed">{language.t("personalization.detail.detailed")}</option>
              </select>
            </label>
            <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
              {language.t("personalization.proactivity")}
              <select class="h-9 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3" value={proactivity()} onChange={(event) => setProactivity(event.currentTarget.value as AgentProactivity)}>
                <option value="reactive">{language.t("personalization.proactivity.reactive")}</option>
                <option value="balanced">{language.t("personalization.proactivity.balanced")}</option>
                <option value="proactive">{language.t("personalization.proactivity.proactive")}</option>
              </select>
            </label>
            <label class="flex flex-col gap-2 text-13-medium text-v2-text-text-base">
              {language.t("personalization.humor")}
              <select class="h-9 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3" value={humor()} onChange={(event) => setHumor(event.currentTarget.value as AgentHumor)}>
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
              value={catchphrases()}
              maxlength={2_000}
              placeholder={language.t("personalization.catchphrases.placeholder")}
              onInput={(event) => setCatchphrases(event.currentTarget.value)}
            />
          </Field>

          <Field>
            <Field.Label>{language.t("personalization.customInstructions")}</Field.Label>
            <Field.Prefix>{language.t("personalization.customInstructions.description")}</Field.Prefix>
            <TextareaV2
              class="!w-full"
              rows={5}
              value={customInstructions()}
              maxlength={4_000}
              onInput={(event) => setCustomInstructions(event.currentTarget.value)}
            />
          </Field>

          <details class="rounded-md border border-v2-border-border-base p-3">
            <summary class="cursor-pointer text-13-medium text-v2-text-text-base">{language.t("personalization.preview")}</summary>
            <pre class="mt-3 whitespace-pre-wrap break-words text-12-regular text-v2-text-text-muted">{preview()}</pre>
          </details>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 type="button" variant="neutral" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 type="submit" variant="contrast">
            {language.t("common.save")}
          </ButtonV2>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
