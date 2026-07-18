import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { MAX_CONTEXT_LIMIT, parseContextLimit } from "./settings-model-context-limit-value"

export function SettingsModelContextLimit(props: {
  providerID: string
  modelID: string
  context: number
  input?: number
  output: number
  variant?: "default" | "v2"
}) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const [draft, setDraft] = createSignal(String(props.context))
  const [saving, setSaving] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const value = createMemo(() => parseContextLimit(draft(), props.output))

  createEffect(() => {
    if (dirty()) return
    setDraft(String(props.context))
  })

  const save = async () => {
    const context = value()
    if (!context || saving()) return
    setSaving(true)
    const input = props.input ? Math.min(props.input, Math.max(1, context - props.output)) : undefined
    await serverSync()
      .updateConfig({
        provider: {
          [props.providerID]: {
            models: {
              [props.modelID]: {
                limit: { context, input, output: props.output },
              },
            },
          },
        },
      })
      .then(() => {
        setDirty(false)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.models.context.saved"),
          description: language.t("settings.models.context.saved.description", {
            limit: context.toLocaleString(language.intl()),
          }),
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
    <div class="flex min-w-[240px] flex-col gap-1.5">
      <div class="flex items-center justify-end gap-2">
        <label
          for={`context-${props.providerID}-${props.modelID}`}
          class={props.variant === "v2" ? "text-12-regular text-v2-text-text-muted" : "text-12-regular text-text-weak"}
        >
          {language.t("settings.models.context.label")}
        </label>
        <input
          id={`context-${props.providerID}-${props.modelID}`}
          type="number"
          min={props.output + 1}
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
              : "h-8 w-28 rounded-md border border-border-weak-base bg-surface-base px-2 text-right text-13-regular tabular-nums text-text-strong outline-none focus:border-border-focus"
          }
          aria-invalid={dirty() && !value()}
        />
        <button
          type="button"
          class={
            props.variant === "v2"
              ? "h-8 rounded-md bg-v2-background-bg-interactive-base px-3 text-12-medium text-v2-text-text-base hover:bg-v2-background-bg-interactive-hover disabled:opacity-50"
              : "h-8 rounded-md bg-surface-raised-base px-3 text-12-medium text-text-strong hover:bg-surface-raised-base-hover disabled:opacity-50"
          }
          disabled={!dirty() || !value() || saving()}
          onClick={() => void save()}
        >
          {saving() ? language.t("common.saving") : language.t("common.save")}
        </button>
      </div>
      <Show when={dirty() && !value()}>
        <span class="text-right text-11-regular text-text-danger-base">
          {language.t("settings.models.context.invalid", {
            min: (props.output + 1).toLocaleString(language.intl()),
            max: MAX_CONTEXT_LIMIT.toLocaleString(language.intl()),
          })}
        </span>
      </Show>
    </div>
  )
}
