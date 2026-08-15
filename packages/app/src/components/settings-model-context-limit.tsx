import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { MAX_CONTEXT_LIMIT, minimumContextLimit, parseContextLimit } from "./settings-model-context-limit-value"

export function SettingsModelContextLimit(props: {
  providerID: string
  modelID: string
  context: number
  input?: number
  output: number
  variant?: "default" | "v2" | "runtime"
  scope?: "model" | "chat"
}) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const [draft, setDraft] = createSignal(String(props.context))
  const [saving, setSaving] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const value = createMemo(() => parseContextLimit(draft(), props.output))
  const inputID = () => `context-${props.scope ?? "model"}-${props.providerID}-${props.modelID}`

  createEffect(() => {
    if (dirty()) return
    setDraft(String(props.context))
  })

  const save = async () => {
    const context = value()
    if (!context || saving()) return
    setSaving(true)
    const input = props.input ? Math.min(props.input, Math.max(1, context - props.output)) : undefined
    const model =
      props.scope === "chat" ? { chat_context: context } : { limit: { context, input, output: props.output } }
    await serverSync()
      .updateConfig({
        provider: {
          [props.providerID]: {
            models: {
              [props.modelID]: model,
            },
          },
        },
      })
      .then(() => {
        setDirty(false)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t(
            props.scope === "chat" ? "settings.models.chatContext.saved" : "settings.models.context.saved",
          ),
          description: language.t(
            props.scope === "chat"
              ? "settings.models.chatContext.saved.description"
              : "settings.models.context.saved.description",
            {
              limit: context.toLocaleString(language.intl()),
            },
          ),
        })
      })
      .catch((error: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setSaving(false))
  }

  return (
    <div
      classList={{
        "flex flex-col gap-1.5": true,
        "min-w-[240px]": props.variant !== "runtime",
      }}
    >
      <div class="flex items-center justify-end gap-2">
        <Show when={props.variant !== "runtime"}>
          <label
            for={inputID()}
            class={
              props.variant === "v2" ? "text-12-regular text-v2-text-text-muted" : "text-12-regular text-text-weak"
            }
          >
            {language.t(props.scope === "chat" ? "settings.models.chatContext.label" : "settings.models.context.label")}
          </label>
        </Show>
        <input
          id={inputID()}
          type="number"
          min={minimumContextLimit(props.output)}
          max={MAX_CONTEXT_LIMIT}
          step="1024"
          value={draft()}
          onInput={(event) => {
            setDraft(event.currentTarget.value)
            setDirty(true)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            void save()
          }}
          class={
            props.variant === "v2"
              ? "h-8 w-28 rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-right text-13-regular tabular-nums text-v2-text-text-base outline-none focus:border-v2-border-border-strong"
              : props.variant === "runtime"
                ? "h-6 w-20 rounded-md border border-border-weak-base bg-surface-base px-1.5 text-right text-10-regular tabular-nums text-text-base outline-none focus:border-border-focus"
                : "h-8 w-28 rounded-md border border-border-weak-base bg-surface-base px-2 text-right text-13-regular tabular-nums text-text-strong outline-none focus:border-border-focus"
          }
          aria-label={
            props.variant === "runtime"
              ? language.t(
                  props.scope === "chat" ? "settings.models.chatContext.label" : "settings.models.context.label",
                )
              : undefined
          }
          aria-invalid={dirty() && !value()}
        />
        <Show when={props.variant !== "runtime" || dirty()}>
          <button
            type="button"
            class={
              props.variant === "v2"
                ? "h-8 rounded-md bg-v2-background-bg-interactive-base px-3 text-12-medium text-v2-text-text-base hover:bg-v2-background-bg-interactive-hover disabled:opacity-50"
                : props.variant === "runtime"
                  ? "h-6 rounded-md bg-surface-base px-2 text-10-medium text-text-base hover:bg-surface-raised-base-hover disabled:opacity-50"
                  : "h-8 rounded-md bg-surface-raised-base px-3 text-12-medium text-text-strong hover:bg-surface-raised-base-hover disabled:opacity-50"
            }
            disabled={!dirty() || !value() || saving()}
            onClick={() => void save()}
          >
            {saving() ? language.t("common.saving") : language.t("common.save")}
          </button>
        </Show>
      </div>
      <Show when={dirty() && !value()}>
        <span class="text-right text-11-regular text-text-danger-base">
          {language.t("settings.models.context.invalid", {
            min: minimumContextLimit(props.output).toLocaleString(language.intl()),
            max: MAX_CONTEXT_LIMIT.toLocaleString(language.intl()),
          })}
        </span>
      </Show>
    </div>
  )
}
