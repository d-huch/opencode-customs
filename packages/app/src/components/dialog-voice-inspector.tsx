import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { diagnosticLevelTrace, evaluateVoiceDiagnostics, type VoiceEvaluationPhase } from "@/utils/voice-evaluation"
import {
  compareDuplexRegression,
  duplexRegressionHTML,
  evaluateDuplexRegression,
  type DuplexRegressionRawReport,
  type DuplexRegressionReport,
  type DuplexRegressionResult,
} from "@/utils/voice-duplex-regression"
import {
  compareVoiceRegression,
  runVoiceRegression,
  voiceRegressionHTML,
  type VoiceRegressionReport,
  type VoiceRegressionResult,
} from "@/utils/voice-regression"
import {
  runVoiceTurnRegression,
  voiceTurnRegressionHTML,
  type VoiceTurnRegressionReport,
  type VoiceTurnRegressionResult,
} from "@/utils/voice-turn-regression"
import {
  runVoiceSoakRegression,
  voiceSoakRegressionHTML,
  type VoiceSoakBatchResult,
  type VoiceSoakRegressionReport,
} from "@/utils/voice-soak-regression"
import { showToast } from "@/utils/toast"
import { upsertVoiceDictionaryEntry, voiceDictionaryCandidateFromCorrection } from "@/utils/voice-dictionary"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"

type VoiceReliabilityReport = {
  created_at: string
  cycles: number
  passed: number
  failed: number
  recovered_faults: number
  total_ms: number
  resources: {
    rss_delta_bytes: number
    steady_state_rss_delta_bytes: number
    threads_delta: number
    steady_state_threads_delta: number
    file_descriptors_delta: number
  }
  results: {
    cycle: number
    fault?: string
    recovered: boolean
    passed: boolean
    duration_ms: number
    error?: string
    report?: DuplexRegressionRawReport
  }[]
}

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
  const [duplexRunning, setDuplexRunning] = createSignal(false)
  const [duplexReport, setDuplexReport] = createSignal<DuplexRegressionReport>()
  const [duplexBaseline, setDuplexBaseline] = createSignal<DuplexRegressionReport>()
  const [reliabilityRunning, setReliabilityRunning] = createSignal(false)
  const [reliabilityReport, setReliabilityReport] = createSignal<VoiceReliabilityReport>()
  const [turnReport, setTurnReport] = createSignal<VoiceTurnRegressionReport>()
  const [soakRunning, setSoakRunning] = createSignal(false)
  const [soakReport, setSoakReport] = createSignal<VoiceSoakRegressionReport>()
  const [replayResult, setReplayResult] = createSignal<{
    file: string
    text: string
    diagnostics: Record<string, string | number>
  }>()
  const [editingTurn, setEditingTurn] = createSignal<string>()
  const [correction, setCorrection] = createSignal("")
  const [workingTurn, setWorkingTurn] = createSignal<string>()
  let playing: HTMLAudioElement | undefined
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
  const duplexComparison = createMemo(() => {
    const report = duplexReport()
    if (!report) return
    return compareDuplexRegression(report, duplexBaseline())
  })

  const regressionKey = () =>
    `opencode.voice-regression.v1:${settings.voice.ttsEndpoint()}:${settings.voice.ttsModel()}:${settings.voice.ttsVoice()}`

  const duplexKey = () =>
    `opencode.voice-duplex-regression.v1:${settings.voice.ttsEndpoint()}:${settings.voice.ttsMode()}:${settings.voice.ttsVoice()}`

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

  const runDuplexRegression = async () => {
    setDuplexRunning(true)
    setDuplexBaseline(readDuplexBaseline(duplexKey()))
    const report = await (async () => {
      const url = new URL(settings.voice.ttsEndpoint())
      url.pathname = "/v1/audio/duplex/regression"
      url.search = ""
      const response = await (platform.fetch ?? fetch)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: settings.voice.ttsVoice(),
          mode: settings.voice.ttsMode(),
          language: document.documentElement.lang || navigator.language,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      return evaluateDuplexRegression((await response.json()) as DuplexRegressionRawReport)
    })().catch((error: unknown) => {
      showToast({
        variant: "error",
        title: language.t("voice.inspector.duplex.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
    setDuplexRunning(false)
    if (!report) return
    setDuplexReport(report)
    report.results.forEach((result) => {
      void platform.appendVoiceDiagnostic?.({
        sessionID: sessionID(),
        source: "replay",
        event: result.passed ? "duplex_regression_passed" : "duplex_regression_failed",
        text: result.transcript,
        error: result.error,
        durationMs: result.latencyMs,
        diagnostics: { scenario: result.id, suite: "live_duplex" },
      })
    })
    setRefresh((value) => value + 1)
  }

  const saveDuplexBaseline = () => {
    const report = duplexReport()
    if (!report) return
    localStorage.setItem(duplexKey(), JSON.stringify(report))
    setDuplexBaseline(report)
    showToast({ variant: "success", title: language.t("voice.inspector.duplex.baseline.saved") })
  }

  const exportDuplexRegression = (format: "json" | "html") => {
    const report = duplexReport()
    if (!report) return
    const content =
      format === "json"
        ? JSON.stringify({ report, baseline: duplexBaseline() }, null, 2)
        : duplexRegressionHTML(report, duplexBaseline())
    const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/html" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `opencode-live-duplex-regression-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const runReliabilityRegression = async () => {
    setReliabilityRunning(true)
    const report = await (async () => {
      const url = new URL(settings.voice.ttsEndpoint())
      url.pathname = "/v1/audio/duplex/reliability"
      url.search = ""
      const response = await (platform.fetch ?? fetch)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: settings.voice.ttsVoice(),
          mode: settings.voice.ttsMode(),
          language: document.documentElement.lang || navigator.language,
          cycles: 5,
          inject_faults: true,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      const report = (await response.json()) as VoiceReliabilityReport
      const results = report.results.map((result) => ({
        ...result,
        passed: result.passed && (!result.report || evaluateDuplexRegression(result.report).failed === 0),
      }))
      return {
        ...report,
        results,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
      }
    })().catch((error: unknown) => {
      showToast({
        variant: "error",
        title: language.t("voice.inspector.reliability.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
    setReliabilityRunning(false)
    if (!report) return
    setReliabilityReport(report)
    report.results.forEach((result) => {
      const semantic = result.report ? evaluateDuplexRegression(result.report) : undefined
      const passed = result.passed && (semantic?.failed ?? 0) === 0
      void platform.appendVoiceDiagnostic?.({
        sessionID: sessionID(),
        source: "replay",
        event: passed ? "voice_reliability_cycle_passed" : "voice_reliability_cycle_failed",
        error: result.error,
        durationMs: result.duration_ms,
        diagnostics: {
          suite: "real_audio_reliability",
          cycle: result.cycle,
          fault: result.fault,
          recovered: result.recovered,
          scenario_failures: semantic?.failed,
        },
      })
    })
    setRefresh((value) => value + 1)
  }

  const exportReliabilityRegression = () => {
    const report = reliabilityReport()
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `opencode-real-audio-reliability-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const runTurnRecoveryRegression = () => {
    const report = runVoiceTurnRegression()
    setTurnReport(report)
    report.results.forEach((result) => {
      void platform.appendVoiceDiagnostic?.({
        sessionID: sessionID(),
        source: "agent",
        event: result.passed ? "turn_regression_passed" : "turn_regression_failed",
        error: result.error,
        diagnostics: {
          scenario: result.id,
          suite: "turn_recovery",
          transitions: result.events.length,
        },
      })
    })
    setRefresh((value) => value + 1)
  }

  const exportTurnRegression = (format: "json" | "html") => {
    const report = turnReport()
    if (!report) return
    const content = format === "json" ? JSON.stringify(report, null, 2) : voiceTurnRegressionHTML(report)
    const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/html" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `opencode-voice-turn-recovery-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const runSoakRegression = async () => {
    setSoakRunning(true)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const report = runVoiceSoakRegression()
    setSoakReport(report)
    setSoakRunning(false)
    void platform.appendVoiceDiagnostic?.({
      sessionID: sessionID(),
      source: "agent",
      event: report.failed ? "soak_regression_failed" : "soak_regression_passed",
      error: report.failed
        ? report.batches
            .flatMap((batch) => batch.errors)
            .slice(0, 3)
            .join(" · ")
        : undefined,
      diagnostics: {
        suite: "soak_chaos",
        seed: report.seed,
        turns: report.turns,
        passed: report.passed,
        failed: report.failed,
        state_leaks: report.stateLeaks,
        stale_rejected: report.staleCallbacksRejected,
        duplicates_rejected: report.duplicateFinalsRejected,
        responses_rejected: report.unrelatedResponsesRejected,
        final_generation: report.finalGeneration,
      },
    })
    setRefresh((value) => value + 1)
  }

  const exportSoakRegression = (format: "json" | "html") => {
    const report = soakReport()
    if (!report) return
    const content = format === "json" ? JSON.stringify(report, null, 2) : voiceSoakRegressionHTML(report)
    const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/html" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `opencode-voice-soak-chaos-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`
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

  const readTurnAudio = (turnID: string) =>
    platform.getVoiceTurnAudio ? platform.getVoiceTurnAudio(sessionID(), turnID) : Promise.resolve(undefined)

  const playTurn = async (turnID: string) => {
    setWorkingTurn(turnID)
    const result = await readTurnAudio(turnID).catch(() => undefined)
    setWorkingTurn()
    if (!result) {
      showToast({ variant: "error", title: language.t("voice.inspector.turn.audio.missing") })
      return
    }
    playing?.pause()
    const url = URL.createObjectURL(new Blob([result.audio], { type: result.contentType }))
    playing = new Audio(url)
    playing.onended = () => URL.revokeObjectURL(url)
    playing.onerror = () => URL.revokeObjectURL(url)
    await playing.play()
  }

  const saveCorrection = async (turnID: string) => {
    const text = correction().trim()
    if (!text) return
    const turn = evaluation().turns.find((item) => item.id === turnID)
    const heard = turn?.finalTranscript?.trim()
    setWorkingTurn(turnID)
    await platform.appendVoiceDiagnostic?.({
      sessionID: sessionID(),
      turnID,
      source: "ui",
      event: "manual_correction",
      text,
      diagnostics: { reason: "voice_inspector_user_correction" },
    })
    const candidate = heard
      ? voiceDictionaryCandidateFromCorrection(heard, text, {
          language: document.documentElement.lang || navigator.language,
          scope: "session",
          scopeID: sessionID(),
          confidence: 1,
          confirmed: true,
        })
      : undefined
    if (candidate) {
      settings.voice.setDictionaryEntries(
        upsertVoiceDictionaryEntry(settings.voice.dictionaryEntries(), candidate),
      )
    }
    setWorkingTurn()
    setEditingTurn()
    setCorrection("")
    setRefresh((value) => value + 1)
  }

  const recognizeTurnAgain = async (turnID: string) => {
    setWorkingTurn(turnID)
    const audio = await readTurnAudio(turnID).catch(() => undefined)
    if (!audio) {
      setWorkingTurn()
      showToast({ variant: "error", title: language.t("voice.inspector.turn.audio.missing") })
      return
    }
    const url = new URL(settings.voice.ttsEndpoint())
    url.pathname = "/v1/audio/transcriptions/replay"
    url.search = new URLSearchParams({ language: document.documentElement.lang || navigator.language }).toString()
    const started = performance.now()
    const response = await (platform.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": audio.contentType },
      body: new Blob([audio.audio], { type: audio.contentType }),
    }).catch(
      (error: unknown) =>
        new Response(error instanceof Error ? error.message : String(error), { status: 599, statusText: "STT unavailable" }),
    )
    if (!response.ok) {
      setWorkingTurn()
      showToast({ variant: "error", title: language.t("voice.inspector.turn.redecode.failed"), description: await response.text() })
      return
    }
    const result = (await response.json()) as { text: string; diagnostics?: Record<string, string | number | boolean> }
    await platform.appendVoiceDiagnostic?.({
      sessionID: sessionID(),
      turnID,
      source: "replay",
      event: "turn_redecoded",
      text: result.text,
      durationMs: performance.now() - started,
      diagnostics: result.diagnostics,
    })
    setWorkingTurn()
    setRefresh((value) => value + 1)
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
            disabled={duplexRunning()}
            onClick={() => void runDuplexRegression()}
          >
            {duplexRunning()
              ? language.t("voice.inspector.duplex.running")
              : language.t("voice.inspector.duplex.action")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={reliabilityRunning()}
            onClick={() => void runReliabilityRegression()}
          >
            {reliabilityRunning()
              ? language.t("voice.inspector.reliability.running")
              : language.t("voice.inspector.reliability.action")}
          </Button>
          <Button type="button" variant="secondary" onClick={runTurnRecoveryRegression}>
            {language.t("voice.inspector.turnRegression.action")}
          </Button>
          <Button type="button" variant="secondary" disabled={soakRunning()} onClick={() => void runSoakRegression()}>
            {soakRunning() ? language.t("voice.inspector.soak.running") : language.t("voice.inspector.soak.action")}
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

        <div class="flex max-h-[45%] shrink-0 flex-col gap-4 overflow-y-auto">
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

          <Show when={duplexReport()}>
            {(report) => (
              <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="text-12-medium text-text-strong">{language.t("voice.inspector.duplex.title")}</div>
                    <div class="mt-1 text-11-regular text-text-weak">
                      {language.t("voice.inspector.duplex.summary", {
                        passed: report().passed,
                        failed: report().failed,
                        falseBarge: report().falseBargeIns,
                        missedBarge: report().missedBargeIns,
                        falseWake: report().falseWakes,
                        missedWake: report().missedWakes,
                        latency: Math.round(report().medianEndpointMs),
                      })}
                    </div>
                    <Show when={duplexComparison()}>
                      {(comparison) => (
                        <div class="mt-1 text-11-regular text-text-weak">
                          {language.t("voice.inspector.duplex.delta", {
                            passed: signed(comparison().passed),
                            falseBarge: signed(comparison().falseBargeIns),
                            missedBarge: signed(comparison().missedBargeIns),
                            falseWake: signed(comparison().falseWakes),
                            missedWake: signed(comparison().missedWakes),
                            latency: signed(Math.round(comparison().endpointMs)),
                          })}
                        </div>
                      )}
                    </Show>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={saveDuplexBaseline}>
                      {language.t("voice.inspector.duplex.baseline.action")}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => exportDuplexRegression("json")}>
                      JSON
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => exportDuplexRegression("html")}>
                      HTML
                    </Button>
                  </div>
                </div>
                <div class="mt-3 max-h-52 overflow-y-auto rounded border border-border-weak-base">
                  <For each={report().results}>{(result) => <DuplexRegressionRow result={result} />}</For>
                </div>
              </div>
            )}
          </Show>

          <Show when={reliabilityReport()}>
            {(report) => (
              <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="text-12-medium text-text-strong">
                      {language.t("voice.inspector.reliability.title")}
                    </div>
                    <div class="mt-1 text-11-regular text-text-weak">
                      {language.t("voice.inspector.reliability.summary", {
                        passed: report().passed,
                        cycles: report().cycles,
                        failed: report().failed,
                        recovered: report().recovered_faults,
                        seconds: Math.round(report().total_ms / 1_000),
                        memory: (report().resources.steady_state_rss_delta_bytes / 1024 / 1024).toFixed(1),
                      })}
                    </div>
                    <div class="mt-1 font-mono text-11-regular text-text-weak">
                      warmup RSS {(report().resources.rss_delta_bytes / 1024 / 1024).toFixed(1)} MB · steady threads {signed(report().resources.steady_state_threads_delta)} · fds {signed(report().resources.file_descriptors_delta)}
                    </div>
                  </div>
                  <Button type="button" variant="secondary" onClick={exportReliabilityRegression}>
                    JSON
                  </Button>
                </div>
                <div class="mt-3 max-h-52 overflow-y-auto rounded border border-border-weak-base">
                  <For each={report().results}>
                    {(result) => (
                      <div class="flex items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2 last:border-b-0">
                        <div class="min-w-0 text-11-regular text-text-strong">
                          #{result.cycle} · {result.fault || "normal"}
                          <Show when={result.recovered}> · recovered</Show>
                          <Show when={result.error}> · {result.error}</Show>
                        </div>
                        <div class={result.passed ? "text-11-regular text-success-base" : "text-11-regular text-error-base"}>
                          {result.passed ? "PASS" : "FAIL"} · {result.duration_ms} ms
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </Show>

          <Show when={turnReport()}>
            {(report) => (
              <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="text-12-medium text-text-strong">
                      {language.t("voice.inspector.turnRegression.title")}
                    </div>
                    <div class="mt-1 text-11-regular text-text-weak">
                      {language.t("voice.inspector.turnRegression.summary", {
                        passed: report().passed,
                        failed: report().failed,
                        stale: report().staleCallbacksRejected,
                        duplicates: report().duplicateFinalsRejected,
                        responses: report().unrelatedResponsesRejected,
                        recovered: report().recoveredToIdle,
                      })}
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => exportTurnRegression("json")}>
                      JSON
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => exportTurnRegression("html")}>
                      HTML
                    </Button>
                  </div>
                </div>
                <div class="mt-3 max-h-52 overflow-y-auto rounded border border-border-weak-base">
                  <For each={report().results}>{(result) => <TurnRegressionRow result={result} />}</For>
                </div>
              </div>
            )}
          </Show>

          <Show when={soakReport()}>
            {(report) => (
              <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-raised-base p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="text-12-medium text-text-strong">{language.t("voice.inspector.soak.title")}</div>
                    <div class="mt-1 text-11-regular text-text-weak">
                      {language.t("voice.inspector.soak.summary", {
                        passed: report().passed,
                        turns: report().turns,
                        failed: report().failed,
                        stale: report().staleCallbacksRejected,
                        duplicates: report().duplicateFinalsRejected,
                        recovered: report().recoveredTurns,
                        leaks: report().stateLeaks,
                      })}
                    </div>
                    <div class="mt-1 font-mono text-11-regular text-text-weak">
                      seed {report().seed} · generation {report().finalGeneration} · {report().finalState}
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => exportSoakRegression("json")}>
                      JSON
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => exportSoakRegression("html")}>
                      HTML
                    </Button>
                  </div>
                </div>
                <div class="mt-3 max-h-52 overflow-y-auto rounded border border-border-weak-base">
                  <For each={report().batches}>{(batch) => <SoakBatchRow batch={batch} />}</For>
                </div>
              </div>
            )}
          </Show>
        </div>

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
                          <div class="mt-3 grid gap-2 rounded border border-border-weak-base bg-surface-base p-2 text-11-regular sm:grid-cols-2">
                            <DiagnosticValue label={language.t("voice.inspector.turn.preview")} value={turn.preview} />
                            <DiagnosticValue
                              label={language.t("voice.inspector.turn.final")}
                              value={turn.correctedTranscript ?? turn.finalTranscript}
                            />
                            <DiagnosticValue
                              label={language.t("voice.inspector.turn.confidence")}
                              value={turn.confidence === undefined ? undefined : `${Math.round(turn.confidence * 100)}%`}
                            />
                            <DiagnosticValue
                              label={language.t("voice.inspector.turn.reason")}
                              value={[turn.sendReason, turn.endpointReason].filter(Boolean).join(" · ")}
                            />
                            <DiagnosticValue
                              label={language.t("voice.inspector.turn.vad")}
                              value={[
                                turn.audioMs === undefined ? undefined : `audio ${Math.round(turn.audioMs)} ms`,
                                turn.speechMs === undefined ? undefined : `speech ${Math.round(turn.speechMs)} ms`,
                                turn.silenceMs === undefined ? undefined : `silence ${Math.round(turn.silenceMs)} ms`,
                                turn.preRollMs === undefined ? undefined : `pre-roll ${Math.round(turn.preRollMs)} ms`,
                                turn.transcriptionMs === undefined ? undefined : `STT ${Math.round(turn.transcriptionMs)} ms`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            />
                            <DiagnosticValue
                              label={language.t("voice.inspector.turn.corrections")}
                              value={turn.corrections.join(" · ") || turn.correctedTranscript}
                            />
                          </div>
                          <Show when={editingTurn() === turn.id}>
                            <div class="mt-2 flex items-end gap-2">
                              <div class="min-w-0 flex-1">
                                <TextField
                                  autofocus
                                  hideLabel
                                  label={language.t("voice.inspector.turn.correction.placeholder")}
                                  value={correction()}
                                  onChange={setCorrection}
                                  class="w-full"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="primary"
                                disabled={workingTurn() === turn.id || !correction().trim()}
                                onClick={() => void saveCorrection(turn.id)}
                              >
                                {language.t("voice.inspector.turn.correction.save")}
                              </Button>
                            </div>
                          </Show>
                          <div class="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={!turn.hasAudio || workingTurn() === turn.id}
                              onClick={() => void playTurn(turn.id)}
                            >
                              {language.t("voice.inspector.turn.play")}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setEditingTurn(turn.id)
                                setCorrection(turn.correctedTranscript ?? turn.finalTranscript ?? turn.text ?? "")
                              }}
                            >
                              {language.t("voice.inspector.turn.correct")}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={!turn.hasAudio || workingTurn() === turn.id}
                              onClick={() => void recognizeTurnAgain(turn.id)}
                            >
                              {workingTurn() === turn.id
                                ? language.t("voice.inspector.turn.redecode.running")
                                : language.t("voice.inspector.turn.redecode")}
                            </Button>
                          </div>
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

function DiagnosticValue(props: { label: string; value?: string }) {
  return (
    <div class="min-w-0">
      <div class="text-text-weak">{props.label}</div>
      <div class="mt-0.5 break-words text-text-strong">{props.value || "—"}</div>
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

function DuplexRegressionRow(props: { result: DuplexRegressionResult }) {
  const language = useLanguage()
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border-weak-base px-3 py-2 last:border-b-0">
      <div class="min-w-0">
        <div class="truncate text-11-medium text-text-strong">
          {language.t(`voice.inspector.duplex.scenario.${props.result.id}`)}
        </div>
        <div class="truncate text-11-regular text-text-weak">
          {props.result.transcript || props.result.error || "—"}
        </div>
      </div>
      <div class={props.result.passed ? "text-11-medium text-icon-success-base" : "text-11-medium text-error-base"}>
        {props.result.passed ? "PASS" : "FAIL"}
      </div>
      <div class="font-mono text-11-regular text-text-weak">{formatDuration(props.result.latencyMs)}</div>
    </div>
  )
}

function TurnRegressionRow(props: { result: VoiceTurnRegressionResult }) {
  const language = useLanguage()
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border-weak-base px-3 py-2 last:border-b-0">
      <div class="min-w-0">
        <div class="truncate text-11-medium text-text-strong">
          {language.t(`voice.inspector.turnRegression.scenario.${props.result.id}`)}
        </div>
        <div class="truncate font-mono text-11-regular text-text-weak">
          {props.result.error || props.result.events.join(" → ") || "—"}
        </div>
      </div>
      <div class={props.result.passed ? "text-11-medium text-icon-success-base" : "text-11-medium text-error-base"}>
        {props.result.passed ? "PASS" : "FAIL"}
      </div>
    </div>
  )
}

function SoakBatchRow(props: { batch: VoiceSoakBatchResult }) {
  return (
    <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-weak-base px-3 py-2 last:border-b-0">
      <div class="font-mono text-11-medium text-text-strong">#{props.batch.batch}</div>
      <div class="min-w-0 truncate font-mono text-11-regular text-text-weak">
        {props.batch.errors.join(" · ") || `${props.batch.turns} turns · ${props.batch.stateLeaks} leaks`}
      </div>
      <div class={props.batch.failed ? "text-11-medium text-error-base" : "text-11-medium text-icon-success-base"}>
        {props.batch.failed ? `${props.batch.failed} FAIL` : `${props.batch.passed} PASS`}
      </div>
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

function readDuplexBaseline(key: string) {
  const value = localStorage.getItem(key)
  if (!value) return
  try {
    return JSON.parse(value) as DuplexRegressionReport
  } catch {
    localStorage.removeItem(key)
  }
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value}`
}
