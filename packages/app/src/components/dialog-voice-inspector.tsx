import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { diagnosticLevelTrace, evaluateVoiceDiagnostics, type VoiceEvaluationPhase } from "@/utils/voice-evaluation"
import {
  compareVoiceRegression,
  runVoiceRegression,
  voiceRegressionHTML,
  type VoiceRegressionReport,
  type VoiceRegressionResult,
} from "@/utils/voice-regression"
import { showToast } from "@/utils/toast"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"

export function DialogVoiceInspector(props: { sessionID?: string }) {
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const sessionID = () => props.sessionID ?? "default"
  const [refresh, setRefresh] = createSignal(0)
  const [replaying, setReplaying] = createSignal(false)
  const [regressionRunning, setRegressionRunning] = createSignal(false)
  const [regressionProgress, setRegressionProgress] = createSignal(0)
  const [regressionReport, setRegressionReport] = createSignal<VoiceRegressionReport>()
  const [regressionBaseline, setRegressionBaseline] = createSignal<VoiceRegressionReport>()
  const [replayResult, setReplayResult] = createSignal<{
    file: string
    text: string
    diagnostics: Record<string, string | number>
  }>()
  const [timeline] = createResource(
    () => ({ sessionID: sessionID(), refresh: refresh(), available: Boolean(platform.getVoiceDiagnostics) }),
    (input) =>
      input.available ? platform.getVoiceDiagnostics!(input.sessionID) : Promise.resolve({ path: "", entries: [] }),
  )
  const evaluation = createMemo(() => evaluateVoiceDiagnostics(timeline()?.entries ?? []))
  const phaseLabel = (phase: VoiceEvaluationPhase) => language.t(`voice.inspector.phase.${phase}`)
  const regressionComparison = createMemo(() => {
    const report = regressionReport()
    if (!report) return
    return compareVoiceRegression(report, regressionBaseline())
  })

  const regressionKey = () =>
    `opencode.voice-regression.v1:${settings.voice.ttsEndpoint()}:${settings.voice.ttsModel()}:${settings.voice.ttsVoice()}`

  const runRegression = async () => {
    if (!platform.synthesizeLocalSpeech) return
    setRegressionRunning(true)
    setRegressionProgress(0)
    setRegressionBaseline(readBaseline(regressionKey()))
    const report = await runVoiceRegression({
      synthesize: async (text) => {
        const result = await platform.synthesizeLocalSpeech!({
          endpoint: settings.voice.ttsEndpoint(),
          model: settings.voice.ttsModel(),
          voice: settings.voice.ttsVoice(),
          mode: settings.voice.ttsMode(),
          text,
        })
        return { audio: result.audio, totalMs: result.metrics.totalMs }
      },
      transcribe: async (audio, locale) => {
        const url = new URL(settings.voice.ttsEndpoint())
        url.pathname = "/v1/audio/transcriptions/replay"
        url.search = new URLSearchParams({ language: locale }).toString()
        const started = performance.now()
        const response = await (platform.fetch ?? fetch)(url, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: audio,
        })
        if (!response.ok) throw new Error(await response.text())
        const result = (await response.json()) as { text: string }
        return { text: result.text, totalMs: performance.now() - started }
      },
      onResult: (result) => {
        setRegressionProgress((value) => value + 1)
        void platform.appendVoiceDiagnostic?.({
          sessionID: sessionID(),
          source: "replay",
          event: result.passed ? "regression_passed" : "regression_failed",
          text: result.actual,
          error: result.error,
          durationMs: result.totalMs,
          diagnostics: {
            scenario: result.scenario.id,
            language: result.scenario.language,
            wer: result.wordErrorRate,
            cer: result.characterErrorRate,
            tts_ms: result.ttsMs,
            stt_ms: result.sttMs,
          },
        })
      },
    }).catch((error: unknown) => {
      showToast({
        variant: "error",
        title: language.t("voice.inspector.regression.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
    setRegressionRunning(false)
    if (!report) return
    setRegressionReport(report)
    setRefresh((value) => value + 1)
  }

  const saveBaseline = () => {
    const report = regressionReport()
    if (!report) return
    localStorage.setItem(regressionKey(), JSON.stringify(report))
    setRegressionBaseline(report)
    showToast({ variant: "success", title: language.t("voice.inspector.regression.baseline.saved") })
  }

  const exportRegression = (format: "json" | "html") => {
    const report = regressionReport()
    if (!report) return
    const content =
      format === "json"
        ? JSON.stringify({ report, baseline: regressionBaseline() }, null, 2)
        : voiceRegressionHTML(report, regressionBaseline())
    const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/html" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `opencode-voice-regression-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const replay = async () => {
    if (!platform.openAttachmentPickerDialog) return
    setReplaying(true)
    await platform
      .openAttachmentPickerDialog(
        {
          title: language.t("voice.inspector.replay.pick"),
          extensions: ["wav"],
          accept: ["audio/wav"],
        },
        async (file) => {
          const url = new URL(settings.voice.ttsEndpoint())
          url.pathname = "/v1/audio/transcriptions/replay"
          url.search = new URLSearchParams({ language: document.documentElement.lang || navigator.language }).toString()
          const started = performance.now()
          const response = await (platform.fetch ?? fetch)(url, {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: file,
          })
          if (!response.ok) throw new Error(await response.text())
          const result = (await response.json()) as {
            text: string
            diagnostics: Record<string, string | number>
          }
          setReplayResult({ file: file.name, text: result.text, diagnostics: result.diagnostics })
          await platform.appendVoiceDiagnostic?.({
            sessionID: sessionID(),
            source: "replay",
            event: "completed",
            text: result.text,
            durationMs: performance.now() - started,
            diagnostics: result.diagnostics,
          })
          setRefresh((value) => value + 1)
        },
      )
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: language.t("voice.inspector.replay.failed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
    setReplaying(false)
  }

  const clear = async (all: boolean) => {
    const result = await platform.clearVoiceDiagnostics?.(all ? undefined : sessionID())
    if (!result) return
    setReplayResult()
    setRefresh((value) => value + 1)
    showToast({ variant: "success", title: language.t("voice.inspector.cleared", { count: result.files }) })
  }

  const exportLog = async () => {
    const path = await platform.exportVoiceDiagnostics?.(sessionID()).catch((error: unknown) => {
      showToast({
        variant: "error",
        title: language.t("voice.inspector.export.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
    if (!path) return
    await platform.revealPath?.(path)
    showToast({ variant: "success", title: language.t("voice.inspector.export.completed") })
  }

  return (
    <Dialog
      title={language.t("voice.inspector.title")}
      description={language.t("voice.inspector.description")}
      size="large"
      class="w-full max-w-[980px] mx-auto"
    >
      <div class="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6">
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => setRefresh((value) => value + 1)}>
            {language.t("voice.inspector.refresh")}
          </Button>
          <Button type="button" variant="secondary" disabled={replaying()} onClick={() => void replay()}>
            {replaying() ? language.t("voice.inspector.replay.running") : language.t("voice.inspector.replay.action")}
          </Button>
          <Button type="button" variant="secondary" disabled={regressionRunning()} onClick={() => void runRegression()}>
            {regressionRunning()
              ? language.t("voice.inspector.regression.running", { completed: regressionProgress(), total: 6 })
              : language.t("voice.inspector.regression.action")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!timeline()?.path}
            onClick={() => timeline()?.path && void platform.revealPath?.(timeline()!.path)}
          >
            {language.t("voice.inspector.reveal")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!timeline()?.entries.length}
            onClick={() => void exportLog()}
          >
            {language.t("voice.inspector.export.action")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void clear(false)}>
            {language.t("voice.inspector.clear.session")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void clear(true)}>
            {language.t("voice.inspector.clear.all")}
          </Button>
        </div>

        <Show when={replayResult()}>
          {(result) => (
            <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-raised-base p-3">
              <div class="text-12-medium text-text-strong">{result().file}</div>
              <div class="mt-1 whitespace-pre-wrap text-12-regular text-text-strong">{result().text || "—"}</div>
              <div class="mt-2 font-mono text-11-regular text-text-weak">{JSON.stringify(result().diagnostics)}</div>
            </div>
          )}
        </Show>

        <Show when={regressionReport()}>
          {(report) => (
            <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-raised-base p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div class="text-12-medium text-text-strong">{language.t("voice.inspector.regression.title")}</div>
                  <div class="mt-1 text-11-regular text-text-weak">
                    {language.t("voice.inspector.regression.summary", {
                      passed: report().passed,
                      failed: report().failed,
                      wer: Math.round(report().medianWordErrorRate * 100),
                      cer: Math.round(report().medianCharacterErrorRate * 100),
                      latency: Math.round(report().medianTotalMs),
                    })}
                  </div>
                  <Show when={regressionComparison()}>
                    {(comparison) => (
                      <div class="mt-1 text-11-regular text-text-weak">
                        {language.t("voice.inspector.regression.delta", {
                          passed: signed(comparison().passed),
                          wer: signed(Math.round(comparison().wordErrorRate * 100)),
                          cer: signed(Math.round(comparison().characterErrorRate * 100)),
                          latency: signed(Math.round(comparison().totalMs)),
                        })}
                      </div>
                    )}
                  </Show>
                </div>
                <div class="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={saveBaseline}>
                    {language.t("voice.inspector.regression.baseline.action")}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => exportRegression("json")}>
                    JSON
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => exportRegression("html")}>
                    HTML
                  </Button>
                </div>
              </div>
              <div class="mt-3 max-h-52 overflow-y-auto rounded border border-border-weak-base">
                <For each={report().results}>{(result) => <RegressionRow result={result} />}</For>
              </div>
            </div>
          )}
        </Show>

        <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-weak-base bg-surface-base p-3">
          <Show
            when={!timeline.loading && timeline()?.entries.length}
            fallback={
              <div class="p-6 text-center text-12-regular text-text-weak">
                {timeline.loading ? language.t("voice.inspector.loading") : language.t("voice.inspector.empty")}
              </div>
            }
          >
            <div class="flex flex-col gap-4">
              <section>
                <div class="mb-2 text-12-medium text-text-strong">{language.t("voice.inspector.summary.title")}</div>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <SummaryCard label={language.t("voice.inspector.summary.turns")} value={evaluation().turns.length} />
                  <SummaryCard label={language.t("voice.inspector.summary.completed")} value={evaluation().completed} />
                  <SummaryCard label={language.t("voice.inspector.summary.failed")} value={evaluation().failed} />
                  <SummaryCard
                    label={language.t("voice.inspector.summary.interrupted")}
                    value={evaluation().interrupted}
                  />
                  <SummaryCard
                    label={language.t("voice.inspector.summary.ignored")}
                    value={evaluation().backgroundIgnored}
                  />
                  <SummaryCard
                    label={language.t("voice.inspector.summary.bottleneck")}
                    value={evaluation().bottleneck ? phaseLabel(evaluation().bottleneck!) : "—"}
                  />
                </div>
                <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <For each={["wake", "stt", "model", "tts", "first_sound", "total"] as VoiceEvaluationPhase[]}>
                    {(phase) => (
                      <SummaryCard label={phaseLabel(phase)} value={formatDuration(evaluation().medians[phase])} />
                    )}
                  </For>
                </div>
              </section>

              <Show when={evaluation().turns.length}>
                <section>
                  <div class="mb-2 text-12-medium text-text-strong">{language.t("voice.inspector.turns.title")}</div>
                  <div class="flex flex-col gap-2">
                    <For each={evaluation().turns.slice(0, 20)}>
                      {(turn) => (
                        <div class="rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="min-w-0 truncate text-12-medium text-text-strong">{turn.text || "—"}</div>
                            <div
                              class={turn.error ? "text-11-regular text-error-base" : "text-11-regular text-text-weak"}
                            >
                              {turn.error
                                ? language.t("voice.inspector.turns.failed")
                                : turn.interrupted
                                  ? language.t("voice.inspector.turns.interrupted")
                                  : turn.completed
                                    ? language.t("voice.inspector.turns.completed")
                                    : language.t("voice.inspector.turns.pending")}
                            </div>
                          </div>
                          <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-6">
                            <For
                              each={["wake", "stt", "model", "tts", "first_sound", "total"] as VoiceEvaluationPhase[]}
                            >
                              {(phase) => (
                                <div class="flex items-center justify-between gap-2 text-11-regular">
                                  <span class="text-text-weak">{phaseLabel(phase)}</span>
                                  <span class="font-mono text-text-strong">{formatDuration(turn.phases[phase])}</span>
                                </div>
                              )}
                            </For>
                          </div>
                          <Show when={turn.error}>
                            <div class="mt-2 whitespace-pre-wrap text-11-regular text-error-base">{turn.error}</div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <section>
                <div class="mb-2 text-12-medium text-text-strong">{language.t("voice.inspector.events.title")}</div>
                <div class="rounded-md border border-border-weak-base">
                  <For each={[...(timeline()?.entries ?? [])].reverse()}>
                    {(entry) => {
                      const levels = diagnosticLevelTrace(entry)
                      return (
                        <div class="border-b border-border-weak-base px-3 py-2 last:border-b-0">
                          <div class="flex flex-wrap items-center gap-2 text-11-regular text-text-weak">
                            <span>{new Date(entry.timestamp).toLocaleTimeString(language.intl())}</span>
                            <span class="rounded bg-surface-raised-base px-1.5 py-0.5 font-mono">{entry.source}</span>
                            <span class="font-mono text-text-strong">{entry.event}</span>
                            <Show when={entry.turnID}>
                              <span class="font-mono">{entry.turnID!.slice(0, 8)}</span>
                            </Show>
                            <Show when={entry.durationMs !== undefined}>
                              <span>{Math.round(entry.durationMs!)} ms</span>
                            </Show>
                          </div>
                          <Show when={levels.length}>
                            <div class="mt-2">
                              <LevelWaveform values={levels} />
                            </div>
                          </Show>
                          <Show when={entry.text}>
                            <div class="mt-1 whitespace-pre-wrap text-12-regular text-text-strong">{entry.text}</div>
                          </Show>
                          <Show when={entry.error}>
                            <div class="mt-1 whitespace-pre-wrap text-12-regular text-error-base">{entry.error}</div>
                          </Show>
                          <Show when={entry.diagnostics && Object.keys(entry.diagnostics).length}>
                            <div class="mt-1 break-all font-mono text-11-regular text-text-weak">
                              {JSON.stringify(entry.diagnostics)}
                            </div>
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </section>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}

function SummaryCard(props: { label: string; value: string | number }) {
  return (
    <div class="rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-2">
      <div class="text-11-regular text-text-weak">{props.label}</div>
      <div class="mt-1 truncate text-13-medium text-text-strong">{props.value}</div>
    </div>
  )
}

function LevelWaveform(props: { values: number[] }) {
  const points = () =>
    props.values
      .map((value, index) => `${(index / Math.max(1, props.values.length - 1)) * 100},${24 - value * 22}`)
      .join(" ")
  return (
    <svg viewBox="0 0 100 26" preserveAspectRatio="none" class="h-12 w-full rounded bg-surface-base">
      <line x1="0" y1="24" x2="100" y2="24" stroke="currentColor" class="text-border-weak-base" />
      <polyline points={points()} fill="none" stroke="currentColor" stroke-width="1.25" class="text-icon-info-base" />
    </svg>
  )
}

function RegressionRow(props: { result: VoiceRegressionResult }) {
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-border-weak-base px-3 py-2 last:border-b-0">
      <div class="min-w-0">
        <div class="truncate text-11-medium text-text-strong">{props.result.scenario.name}</div>
        <div class="truncate text-11-regular text-text-weak">{props.result.actual || props.result.error || "—"}</div>
      </div>
      <div class={props.result.passed ? "text-11-medium text-icon-success-base" : "text-11-medium text-error-base"}>
        {props.result.passed ? "PASS" : "FAIL"}
      </div>
      <div class="font-mono text-11-regular text-text-weak">
        WER {Math.round(props.result.wordErrorRate * 100)}% · CER {Math.round(props.result.characterErrorRate * 100)}%
      </div>
      <div class="font-mono text-11-regular text-text-weak">{formatDuration(props.result.totalMs)}</div>
    </div>
  )
}

function formatDuration(value?: number) {
  if (value === undefined) return "—"
  if (value < 1_000) return `${Math.round(value)} ms`
  return `${(value / 1_000).toFixed(1)} s`
}

function readBaseline(key: string) {
  const value = localStorage.getItem(key)
  if (!value) return
  try {
    return JSON.parse(value) as VoiceRegressionReport
  } catch {
    localStorage.removeItem(key)
  }
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value}`
}
