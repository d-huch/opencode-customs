import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { createResource, createSignal, For, Show } from "solid-js"

export function DialogTurnInspector(props: { sessionID: string }) {
  const sdk = useSDK()
  const language = useLanguage()
  const [refresh, setRefresh] = createSignal(0)
  const [inspection] = createResource(
    () => ({ context: sdk(), sessionID: props.sessionID, refresh: refresh() }),
    async (input) => {
      const result = await input.context.client.session.inspect({ sessionID: input.sessionID })
      if (result.error) throw result.error
      return result.data
    },
  )
  const duration = () => {
    const value = inspection()?.durationMs
    if (typeof value !== "number") return language.t("turnInspector.running")
    return new Intl.NumberFormat(language.intl(), { maximumFractionDigits: 1 }).format(value / 1000) + " s"
  }
  const milliseconds = (input: unknown) => {
    if (typeof input !== "number" || !Number.isFinite(input)) return "—"
    if (input < 1000) return `${Math.round(input)} ms`
    return `${new Intl.NumberFormat(language.intl(), { maximumFractionDigits: 2 }).format(input / 1000)} s`
  }
  const phaseLabel = (phase: string) => language.t(`turnInspector.phase.${phase}` as Parameters<typeof language.t>[0])
  const cacheLabel = (cache: string) => language.t(`turnInspector.cache.${cache}` as Parameters<typeof language.t>[0])
  const phaseRange = () => {
    const values = inspection()?.latency.phases.flatMap((phase) => [
      ...(phase.startedAt ? [new Date(phase.startedAt).getTime()] : []),
      ...(phase.completedAt ? [new Date(phase.completedAt).getTime()] : []),
    ])
    if (!values?.length) return
    return { start: Math.min(...values), end: Math.max(...values) }
  }
  const phaseStyle = (phase: { startedAt?: string; completedAt?: string; durationMs?: unknown }) => {
    const range = phaseRange()
    if (!range || !phase.startedAt)
      return {
        "margin-left": "0%",
        width: typeof phase.durationMs === "number" && phase.durationMs > 0 ? "100%" : "2%",
      }
    const span = Math.max(1, range.end - range.start)
    const start = new Date(phase.startedAt).getTime()
    const end = phase.completedAt ? new Date(phase.completedAt).getTime() : range.end
    return {
      "margin-left": `${Math.max(0, Math.min(100, ((start - range.start) / span) * 100))}%`,
      width: `${Math.max(1.5, Math.min(100, ((Math.max(start, end) - start) / span) * 100))}%`,
    }
  }

  return (
    <Dialog
      title={language.t("turnInspector.title")}
      description={language.t("turnInspector.description")}
      size="large"
      class="w-full max-w-[980px] mx-auto"
    >
      <div class="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6">
        <div class="flex shrink-0 items-center justify-between gap-3">
          <Show when={inspection()}>
            {(value) => (
              <div class="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-12-regular text-text-weak">
                <span>
                  {language.t("turnInspector.duration")}: {duration()}
                </span>
                <span>
                  {language.t("turnInspector.modelRequests")}: {value().stats.modelRequests}
                </span>
                <span>
                  {language.t("turnInspector.toolCalls")}: {value().stats.toolCalls}
                </span>
                <span>
                  {language.t("turnInspector.errors")}: {value().stats.errors}
                </span>
              </div>
            )}
          </Show>
          <Button
            type="button"
            variant="secondary"
            class="h-8 shrink-0 px-3"
            disabled={inspection.loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {language.t("turnInspector.refresh")}
          </Button>
        </div>

        <Show
          when={!inspection.error}
          fallback={
            <div class="rounded-md border border-error-base bg-error-weak p-3 text-12-regular text-text-strong">
              {inspection.error instanceof Error ? inspection.error.message : String(inspection.error)}
            </div>
          }
        >
          <Show
            when={!inspection.loading && inspection()}
            fallback={
              <div class="py-8 text-center text-12-regular text-text-weak">{language.t("turnInspector.loading")}</div>
            }
          >
            {(value) => (
              <div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <div class="rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                    <div class="text-11-regular text-text-weak">{language.t("turnInspector.blocker")}</div>
                    <div class="mt-1 truncate text-12-medium text-text-strong">
                      {value().latency.blocker ? phaseLabel(value().latency.blocker!.phase) : "—"}
                    </div>
                    <div class="mt-1 text-11-regular text-text-weaker">
                      {milliseconds(value().latency.blocker?.durationMs)}
                    </div>
                  </div>
                  <div class="rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                    <div class="text-11-regular text-text-weak">{language.t("turnInspector.criticalPath")}</div>
                    <div class="mt-1 text-12-medium text-text-strong">
                      {milliseconds(value().latency.criticalPathMs)}
                    </div>
                  </div>
                  <div class="rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                    <div class="text-11-regular text-text-weak">{language.t("turnInspector.parallelSavings")}</div>
                    <div class="mt-1 text-12-medium text-text-strong">
                      {milliseconds(value().latency.parallelSavingsMs)}
                    </div>
                  </div>
                  <div class="rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                    <div class="text-11-regular text-text-weak">{language.t("turnInspector.potentialSavings")}</div>
                    <div class="mt-1 text-12-medium text-text-strong">
                      {milliseconds(value().latency.potentialSavingsMs)}
                    </div>
                    <div class="mt-1 text-10-regular text-text-weaker">{language.t("turnInspector.upperBound")}</div>
                  </div>
                </div>

                <Show when={value().latency.model}>
                  {(model) => (
                    <div class="flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-border-weak-base px-3 py-2 text-11-regular">
                      <span>
                        <span class="text-text-weaker">{language.t("turnInspector.model")}:</span>{" "}
                        <span class="text-text-strong">
                          {model().providerID}/{model().modelID}
                        </span>
                      </span>
                      <span>
                        <span class="text-text-weaker">{language.t("turnInspector.context")}:</span>{" "}
                        <span class="text-text-strong">{model().context?.toLocaleString(language.intl()) ?? "—"}</span>
                      </span>
                      <span>
                        <span class="text-text-weaker">{language.t("turnInspector.reasoning")}:</span>{" "}
                        <span class="text-text-strong">{model().reasoningEffort ?? "none"}</span>
                      </span>
                      <span>
                        <span class="text-text-weaker">{language.t("turnInspector.providerCache")}:</span>{" "}
                        <span class="text-text-strong">{cacheLabel(value().latency.providerCache)}</span>
                      </span>
                      <span>
                        <span class="text-text-weaker">{language.t("turnInspector.cacheReuse")}:</span>{" "}
                        <span class="text-text-strong">
                          {value().latency.promptCache.reusePercent}% ·{" "}
                          {value().latency.promptCache.readTokens.toLocaleString(language.intl())}{" "}
                          {language.t("turnInspector.tokensRead")} ·{" "}
                          {value().latency.promptCache.writeTokens.toLocaleString(language.intl())}{" "}
                          {language.t("turnInspector.tokensWritten")}
                        </span>
                      </span>
                      <Show when={value().latency.promptCache.prefixPreserved !== undefined}>
                        <span>
                          <span class="text-text-weaker">{language.t("turnInspector.stablePrefix")}:</span>{" "}
                          <span
                            class={
                              value().latency.promptCache.prefixPreserved
                                ? "text-icon-success-base"
                                : "text-icon-critical-base"
                            }
                          >
                            {value().latency.promptCache.prefixPreserved
                              ? language.t("turnInspector.preserved")
                              : language.t("turnInspector.changed")}
                          </span>
                        </span>
                      </Show>
                      <Show when={value().latency.promptCache.compactionPreserved !== undefined}>
                        <span>
                          <span class="text-text-weaker">{language.t("turnInspector.compactionCache")}:</span>{" "}
                          <span
                            class={
                              value().latency.promptCache.compactionPreserved
                                ? "text-icon-success-base"
                                : "text-icon-critical-base"
                            }
                          >
                            {value().latency.promptCache.compactionPreserved
                              ? language.t("turnInspector.preserved")
                              : language.t("turnInspector.changed")}
                          </span>
                        </span>
                      </Show>
                    </div>
                  )}
                </Show>

                <Show when={value().context}>
                  {(context) => (
                    <div class="rounded-md border border-border-weak-base">
                      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border-weak-base px-3 py-2">
                        <div>
                          <div class="text-12-medium text-text-strong">{language.t("turnInspector.promptPreview")}</div>
                          <div class="text-10-regular text-text-weaker">
                            {context().tokens.toLocaleString(language.intl())} /{" "}
                            {context().limit.toLocaleString(language.intl())} · {context().usage}%
                            {context().compressed ? ` · ${language.t("turnInspector.contextFitted")}` : ""}
                          </div>
                          <div class="text-10-regular text-text-weaker">
                            {language.t("turnInspector.cacheablePrefix")}:{" "}
                            {context().cache.prefixTokens.toLocaleString(language.intl())} ·{" "}
                            {language.t("turnInspector.dynamicTail")}:{" "}
                            {context().cache.dynamicTokens.toLocaleString(language.intl())}
                          </div>
                        </div>
                        <div class="text-10-regular text-text-weaker">{language.t("turnInspector.redacted")}</div>
                      </div>
                      <div class="divide-y divide-border-weak-base">
                        <For each={context().fragments}>
                          {(fragment) => (
                            <details class="group px-3 py-2">
                              <summary class="flex cursor-pointer list-none items-center justify-between gap-3">
                                <div class="min-w-0">
                                  <div class="truncate text-11-medium text-text-strong">
                                    {language.t(
                                      `turnInspector.contextSource.${fragment.source}` as Parameters<
                                        typeof language.t
                                      >[0],
                                    )}
                                  </div>
                                  <div class="truncate text-10-regular text-text-weaker">
                                    {fragment.provenance.join(" · ") || "—"}
                                  </div>
                                </div>
                                <div class="shrink-0 text-right text-10-regular text-text-weak">
                                  <div>
                                    {fragment.tokens.toLocaleString(language.intl())} /{" "}
                                    {fragment.budget.toLocaleString(language.intl())}
                                  </div>
                                  <Show when={fragment.truncated || Number(fragment.deduplicated) > 0}>
                                    <div class="text-icon-warning-base">
                                      {fragment.truncated ? language.t("turnInspector.truncated") : ""}
                                      {fragment.truncated && Number(fragment.deduplicated) > 0 ? " · " : ""}
                                      {Number(fragment.deduplicated) > 0
                                        ? `${language.t("turnInspector.deduplicated")}: ${fragment.deduplicated}`
                                        : ""}
                                    </div>
                                  </Show>
                                </div>
                              </summary>
                              <pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-raised-base p-2 font-mono text-10-regular text-text-weak">
                                {fragment.preview || language.t("turnInspector.notIncluded")}
                              </pre>
                            </details>
                          )}
                        </For>
                      </div>
                      <details class="border-t border-border-weak-base px-3 py-2">
                        <summary class="cursor-pointer text-11-medium text-text-strong">
                          {language.t("turnInspector.toolSchemas")} ·{" "}
                          {context().tools.filter((tool) => tool.included).length}/{context().tools.length}
                        </summary>
                        <div class="mt-2 grid gap-1 sm:grid-cols-2">
                          <For each={context().tools}>
                            {(tool) => (
                              <div class="flex items-center justify-between gap-2 rounded bg-surface-raised-base px-2 py-1 text-10-regular">
                                <span class={tool.included ? "text-text-strong" : "text-text-weaker"}>{tool.name}</span>
                                <span class="text-text-weaker">
                                  {tool.tokens.toLocaleString(language.intl())}
                                  {tool.required ? ` · ${language.t("turnInspector.required")}` : ""}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </details>
                    </div>
                  )}
                </Show>

                <div class="rounded-md border border-border-weak-base p-3">
                  <div class="mb-3 flex items-center justify-between gap-3">
                    <div class="text-12-medium text-text-strong">{language.t("turnInspector.timeline")}</div>
                    <div class="text-10-regular text-text-weaker">{language.t("turnInspector.timelineNote")}</div>
                  </div>
                  <div class="space-y-2">
                    <For each={value().latency.phases}>
                      {(phase) => (
                        <div class="grid grid-cols-[150px_minmax(0,1fr)_72px_74px] items-center gap-2">
                          <div class="min-w-0">
                            <div class="truncate text-11-medium text-text-strong">{phaseLabel(phase.phase)}</div>
                            <Show when={phase.detail}>
                              <div class="truncate text-10-regular text-text-weaker">{phase.detail}</div>
                            </Show>
                          </div>
                          <div class="relative h-5 overflow-hidden rounded bg-surface-raised-base">
                            <div
                              classList={{
                                "absolute h-full rounded": true,
                                "bg-icon-success-base": phase.status === "completed",
                                "bg-icon-warning-base": phase.status === "running" || phase.status === "timed_out",
                                "bg-icon-critical-base": phase.status === "failed" || phase.status === "cancelled",
                                "bg-border-strong-base": phase.status === "skipped",
                              }}
                              style={phaseStyle(phase)}
                            />
                          </div>
                          <div class="text-right text-10-regular text-text-weak">{milliseconds(phase.durationMs)}</div>
                          <div
                            classList={{
                              "rounded px-1.5 py-0.5 text-center text-10-medium": true,
                              "bg-surface-raised-base text-text-strong": phase.cache === "hit",
                              "bg-surface-raised-base text-text-weak": phase.cache === "miss",
                              "bg-surface-raised-base text-text-weaker":
                                phase.cache === "bypass" || phase.cache === "unknown",
                            }}
                          >
                            {cacheLabel(phase.cache)}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show when={value().latency.parallel.length > 0}>
                    <div class="mt-3 border-t border-border-weak-base pt-3">
                      <div class="mb-2 text-11-medium text-text-strong">{language.t("turnInspector.parallel")}</div>
                      <For each={value().latency.parallel}>
                        {(item) => (
                          <div class="text-10-regular text-text-weak">
                            {item.phases.map(phaseLabel).join(" + ")} · {milliseconds(item.overlapMs)}
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <div class="rounded-md border border-border-weak-base">
                  <div class="border-b border-border-weak-base px-3 py-2 text-12-medium text-text-strong">
                    {language.t("turnInspector.events")}
                  </div>
                  <Show
                    when={value().events.length > 0}
                    fallback={<div class="p-4 text-12-regular text-text-weak">{language.t("turnInspector.empty")}</div>}
                  >
                    <For each={value().events}>
                      {(event) => (
                        <div class="flex gap-3 border-b border-border-weak-base px-3 py-2 last:border-b-0">
                          <div
                            classList={{
                              "mt-1 h-2 w-2 shrink-0 rounded-full": true,
                              "bg-icon-critical-base": event.status === "error",
                              "bg-icon-success-base": event.status !== "error",
                            }}
                          />
                          <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-baseline justify-between gap-2">
                              <div class="text-12-medium text-text-strong">
                                {language.t(`turnInspector.stage.${event.stage}` as Parameters<typeof language.t>[0])}
                                <span class="ml-2 font-mono text-11-regular text-text-weak">{event.type}</span>
                              </div>
                              <div class="shrink-0 text-11-regular text-text-weaker">
                                {new Date(event.timestamp).toLocaleTimeString(language.intl())}
                              </div>
                            </div>
                            <Show when={event.detail}>
                              <div class="mt-1 break-words text-11-regular text-text-weak">{event.detail}</div>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </Show>
      </div>
    </Dialog>
  )
}
