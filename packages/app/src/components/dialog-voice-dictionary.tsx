import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import {
  removeVoiceDictionaryEntry,
  updateVoiceDictionaryEntry,
  upsertVoiceDictionaryEntry,
  voiceDictionaryScopeID,
  type VoiceDictionaryScope,
} from "@/utils/voice-dictionary"
import { createMemo, createSignal, For, Show } from "solid-js"

export function DialogVoiceDictionary(props: { project?: string; sessionID?: string }) {
  const language = useLanguage()
  const settings = useSettings()
  const entries = createMemo(() => settings.voice.dictionaryEntries())
  const [editing, setEditing] = createSignal<string>()
  const [correct, setCorrect] = createSignal("")
  const [variants, setVariants] = createSignal("")
  const [entryLanguage, setEntryLanguage] = createSignal(document.documentElement.lang || navigator.language || "auto")
  const [scope, setScope] = createSignal<VoiceDictionaryScope>(props.sessionID ? "session" : props.project ? "project" : "global")
  const [confidence, setConfidence] = createSignal(80)
  const [confirmed, setConfirmed] = createSignal(true)

  const reset = () => {
    setEditing()
    setCorrect("")
    setVariants("")
    setEntryLanguage(document.documentElement.lang || navigator.language || "auto")
    setScope(props.sessionID ? "session" : props.project ? "project" : "global")
    setConfidence(80)
    setConfirmed(true)
  }

  const save = (event: SubmitEvent) => {
    event.preventDefault()
    const values = variants()
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (!correct().trim() || !values.length) return
    const scopeID = voiceDictionaryScopeID(scope(), {
      language: entryLanguage(),
      project: props.project,
      sessionID: props.sessionID,
    })
    const id = editing()
    if (id) {
      settings.voice.setDictionaryEntries(
        updateVoiceDictionaryEntry(entries(), id, {
          correct: correct(),
          variants: values,
          language: entryLanguage(),
          scope: scope(),
          scopeID,
          confidence: confidence() / 100,
          confirmed: confirmed(),
        }),
      )
      reset()
      return
    }
    settings.voice.setDictionaryEntries(
      upsertVoiceDictionaryEntry(entries(), {
        correct: correct(),
        variants: values,
        language: entryLanguage(),
        scope: scope(),
        scopeID,
        confidence: confidence() / 100,
        confirmed: confirmed(),
      }),
    )
    reset()
  }

  return (
    <Dialog
      title={language.t("voice.dictionary.title")}
      description={language.t("voice.dictionary.description")}
      size="large"
      class="w-full max-w-[860px] mx-auto"
    >
      <div class="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6">
        <form class="grid shrink-0 grid-cols-1 gap-3 rounded-lg border border-border-weak-base p-4 md:grid-cols-2" onSubmit={save}>
          <TextField
            autofocus
            label={language.t("voice.dictionary.correct")}
            value={correct()}
            onChange={setCorrect}
            class="w-full"
          />
          <TextField
            label={language.t("voice.dictionary.variants")}
            value={variants()}
            onChange={setVariants}
            class="w-full"
          />
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            {language.t("voice.dictionary.language")}
            <input
              class="h-9 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular text-text-strong"
              value={entryLanguage()}
              onInput={(event) => setEntryLanguage(event.currentTarget.value)}
              placeholder="uk, en, auto"
            />
          </label>
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            {language.t("voice.dictionary.scope")}
            <select
              class="h-9 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular text-text-strong"
              value={scope()}
              onChange={(event) => setScope(event.currentTarget.value as VoiceDictionaryScope)}
            >
              <option value="global">{language.t("voice.dictionary.scope.global")}</option>
              <option value="project" disabled={!props.project}>{language.t("voice.dictionary.scope.project")}</option>
              <option value="session" disabled={!props.sessionID}>{language.t("voice.dictionary.scope.session")}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            {language.t("voice.dictionary.confidence", { value: confidence() })}
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={confidence()}
              onInput={(event) => setConfidence(Number(event.currentTarget.value))}
            />
          </label>
          <label class="flex items-center gap-2 self-end pb-1 text-13-regular text-text-base">
            <input type="checkbox" checked={confirmed()} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
            {language.t("voice.dictionary.confirmed")}
          </label>
          <div class="flex gap-2 md:col-span-2">
            <Button type="submit" variant="primary" disabled={!correct().trim() || !variants().trim()}>
              {editing() ? language.t("voice.dictionary.update") : language.t("voice.dictionary.add")}
            </Button>
            <Show when={editing()}>
              <Button type="button" variant="secondary" onClick={reset}>
                {language.t("common.cancel")}
              </Button>
            </Show>
          </div>
        </form>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <Show when={entries().length} fallback={<div class="py-10 text-center text-14-regular text-text-weak">{language.t("voice.dictionary.empty")}</div>}>
            <div class="flex flex-col gap-2">
              <For each={entries()}>
                {(entry) => (
                  <div class="rounded-lg border border-border-weak-base bg-surface-raised-base p-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-14-medium text-text-strong">{entry.correct}</div>
                        <div class="mt-1 break-words text-12-regular text-text-base">{entry.variants.join(" · ")}</div>
                        <div class="mt-2 flex flex-wrap gap-2 text-11-regular text-text-weak">
                          <span>{entry.language}</span>
                          <span>{language.t(`voice.dictionary.scope.${entry.scope}`)}</span>
                          <span>{Math.round(entry.confidence * 100)}%</span>
                          <span class={entry.confirmed ? "text-icon-success-base" : "text-icon-warning-base"}>
                            {language.t(entry.confirmed ? "voice.dictionary.status.confirmed" : "voice.dictionary.status.pending")}
                          </span>
                        </div>
                      </div>
                      <div class="flex shrink-0 flex-wrap gap-2">
                        <Show when={!entry.confirmed}>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => settings.voice.setDictionaryEntries(updateVoiceDictionaryEntry(entries(), entry.id, { confirmed: true }))}
                          >
                            {language.t("voice.dictionary.confirm")}
                          </Button>
                        </Show>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setEditing(entry.id)
                            setCorrect(entry.correct)
                            setVariants(entry.variants.join(", "))
                            setEntryLanguage(entry.language)
                            setScope(entry.scope)
                            setConfidence(Math.round(entry.confidence * 100))
                            setConfirmed(entry.confirmed)
                          }}
                        >
                          {language.t("common.edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => settings.voice.setDictionaryEntries(removeVoiceDictionaryEntry(entries(), entry.id))}
                        >
                          {language.t("common.delete")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
