import { Button } from "@opencode-ai/ui/button"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform, type MicrophoneAccess } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { createLocalDuplexSpeech, type DuplexSpeechEvent } from "@/utils/duplex-speech"
import { createGaplessAudioPlayer } from "@/utils/gapless-audio-player"
import { createLocalSpeechStream } from "@/utils/streaming-tts"
import { showToast } from "@/utils/toast"
import { configuredWakePhrases, extractWakeCommand, routeWakeTranscript } from "@/utils/wake-phrase"
import {
  isDeliberateSpeechInterruption,
  isLikelySpeechEcho,
  speechText,
  streamingSpeechChunks,
  voiceLanguage,
} from "@/utils/voice-agent"

type VoiceAgentControlProps = {
  sessionID: Accessor<string | undefined>
  working: Accessor<boolean>
  onTranscript: (text: string) => void
  onSubmit: () => void
  onInterrupt: () => void
  appearance: "legacy" | "v2"
  onStatusChange?: (status: VoiceAgentStatus | undefined) => void
}

export type VoiceAgentStatus = {
  state: "listening" | "thinking" | "synthesizing" | "speaking"
  text: string
  diagnostics?: {
    microphone: number
    vad: "idle" | "speech" | "silence"
    phase: "ready" | "wake_detected" | "wake_ignored" | "speech_start" | "partial" | "final" | "discard"
    preRollMs?: number
    transcriptionMs?: number
    transcriptionCache?: "hit" | "miss"
    decodeCount?: number
    decodedAudioMs?: number
    committedAudioMs?: number
    ttsFirstChunkMs?: number
    firstSoundMs?: number
    ttsChunks?: number
    ttsBufferedMs?: number
    ttsUnderruns?: number
    echoReferencePercent?: number
    echoResidualPercent?: number
    echoCoherence?: number
    echoSuppressionDb?: number
    echoDelayMs?: number
    wakeRecognitionMs?: number
    wakeModel?: string
    wakeConfidence?: number
    endpointReason?: string
  }
}

const Microphone = (props: { active: boolean; level: number }) => (
  <span class="relative inline-flex size-5 items-center justify-center">
    <span
      class="absolute size-5 rounded-full bg-red-500 transition-[transform,opacity] duration-75"
      style={{
        opacity: props.active ? String(0.12 + props.level * 0.4) : "0",
        transform: `scale(${1 + props.level * 0.65})`,
      }}
    />
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="relative transition-transform duration-75"
      classList={{ "text-red-500": props.active }}
      style={{ transform: `scale(${1 + props.level * 0.16})` }}
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  </span>
)

export function VoiceAgentControl(props: VoiceAgentControlProps) {
  const language = useLanguage()
  const settings = useSettings()
  const platform = usePlatform()
  const sync = useSync()
  const [state, setState] = createSignal<"idle" | "listening" | "thinking" | "synthesizing" | "speaking">("idle")
  const [microphoneLevel, setMicrophoneLevel] = createSignal(0)
  const [liveTranscript, setLiveTranscript] = createSignal("")
  const [waiting, setWaiting] = createSignal(false)
  const [wakeArmed, setWakeArmed] = createSignal(false)
  const [wakeActivated, setWakeActivated] = createSignal(false)
  const [voiceDiagnostics, setVoiceDiagnostics] = createSignal<NonNullable<VoiceAgentStatus["diagnostics"]>>({
    microphone: 0,
    vad: "idle",
    phase: "ready",
  })
  const microphonePercent = createMemo(() => Math.round(microphoneLevel() * 10) * 10)
  let handsFree = false
  let responseBeforeSubmit: string | undefined
  let responseTimer: ReturnType<typeof setTimeout> | undefined
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let wakeFollowupTimer: ReturnType<typeof setTimeout> | undefined
  let speechGeneration = 0
  let speechPlayer: ReturnType<typeof createGaplessAudioPlayer> | undefined
  let speechStartedAt: number | undefined
  let speechPlaybackStarted = false
  let speechStreamCancel: (() => void) | undefined
  let speechQueue: string[] = []
  let speechBuffer = ""
  let speechObserved = ""
  let speechMessageID: string | undefined
  let speechFinal = false
  let speechBusy = false
  let duplex: ReturnType<typeof createLocalDuplexSpeech> | undefined
  let duplexStarting: Promise<void> | undefined
  let bargeInActive = false
  let observedSessionID: string | undefined
  let observedAssistantID: string | undefined
  let passiveSpeechMessageID: string | undefined
  let microphoneAccess: MicrophoneAccess = "unknown"
  let wakeAutoStartScheduled = false
  let voiceTurnID: string | undefined
  let voiceTurnSubmittedAt: number | undefined
  let responseStartedForTurn = false
  let responseCompletedForTurn = false
  let microphoneTrace: number[] = []
  let lastEchoLogAt = 0
  const recordVoice = (
    source: "agent" | "stt" | "tts" | "ui",
    event: string,
    details: {
      state?: string
      text?: string
      error?: string
      durationMs?: number
      diagnostics?: Record<string, string | number | boolean | null | undefined>
    } = {},
  ) => {
    if (!platform.appendVoiceDiagnostic) return
    void platform
      .appendVoiceDiagnostic({
        sessionID: props.sessionID() ?? "default",
        turnID: voiceTurnID,
        source,
        event,
        generation: speechGeneration,
        ...details,
        text: details.text?.slice(0, 2_000),
      })
      .catch((error) => console.warn("[voice-agent] failed to persist diagnostic event", error))
  }

  let previousDiagnosticState: ReturnType<typeof state> | undefined
  createEffect(() => {
    const current = state()
    if (current === previousDiagnosticState) return
    previousDiagnosticState = current
    recordVoice("agent", "state_changed", { state: current })
  })

  createEffect(() => {
    if (state() === "listening" || state() === "speaking") return
    setMicrophoneLevel(0)
  })

  const latestAssistant = createMemo(() => {
    const sessionID = props.sessionID()
    if (!sessionID) return undefined
    const message = [...(sync().data.message[sessionID] ?? [])]
      .reverse()
      .find((item): item is Message & { role: "assistant" } => item.role === "assistant")
    if (!message) return undefined
    const text = (sync().data.part[message.id] ?? [])
      .filter((part): part is Part & { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
    return { id: message.id, text }
  })

  const usesWakePhrase = () =>
    handsFree &&
    settings.voice.wakePhraseEnabled() &&
    configuredWakePhrases(settings.voice.wakePhrases()).length > 0

  const updateDuplexWake = (enabled: boolean, armed: boolean) => {
    duplex?.setWake({
      enabled,
      armed,
      phrases: configuredWakePhrases(settings.voice.wakePhrases()),
    })
  }

  const armWakePhrase = () => {
    clearTimeout(wakeFollowupTimer)
    wakeFollowupTimer = undefined
    setWakeActivated(false)
    const enabled = usesWakePhrase()
    setWakeArmed(enabled)
    updateDuplexWake(enabled, enabled)
  }

  const openWakeFollowup = (activated = false) => {
    if (!usesWakePhrase()) return
    clearTimeout(wakeFollowupTimer)
    setWakeArmed(false)
    setWakeActivated(activated)
    updateDuplexWake(true, false)
    wakeFollowupTimer = setTimeout(armWakePhrase, settings.voice.wakeFollowupSeconds() * 1_000)
  }

  const clearWakePhrase = () => {
    clearTimeout(wakeFollowupTimer)
    wakeFollowupTimer = undefined
    setWakeArmed(false)
    setWakeActivated(false)
    updateDuplexWake(false, false)
  }

  const restart = () => {
    clearTimeout(restartTimer)
    if (!handsFree || !settings.voice.enabled()) {
      setState("idle")
      return
    }
    setState("idle")
    setLiveTranscript("")
    openWakeFollowup()
    restartTimer = setTimeout(() => void start(true), 250)
  }

  const stopSpeech = () => {
    speechStreamCancel?.()
    speechStreamCancel = undefined
    void platform.cancelLocalSpeech?.()
    speechPlayer?.cancel()
    speechPlayer = undefined
    speechStartedAt = undefined
    speechPlaybackStarted = false
  }

  const resetSpeechStream = () => {
    speechQueue = []
    speechBuffer = ""
    speechObserved = ""
    speechMessageID = undefined
    speechFinal = false
    speechBusy = false
    speechStartedAt = undefined
    speechPlaybackStarted = false
  }

  const failSpeech = (generation: number, error: unknown) => {
    if (generation !== speechGeneration) return
    stopSpeech()
    resetSpeechStream()
    setWaiting(false)
    responseBeforeSubmit = undefined
    clearTimeout(responseTimer)
    handsFree = false
    clearWakePhrase()
    setState("idle")
    recordVoice("tts", "error", {
      error: error instanceof Error ? error.message : String(error),
    })
    showToast({
      title: language.t("voice.error.tts.title"),
      description: language.t("voice.error.tts.description", {
        error:
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
            : String(error),
      }),
    })
  }

  const interrupt = () => {
    setWaiting(false)
    clearTimeout(responseTimer)
    clearTimeout(restartTimer)
    stopDuplex()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    clearWakePhrase()
    if (props.working()) props.onInterrupt()
    setState("idle")
  }

  const queueSpeech = (messageID: string, value: string, final: boolean) => {
    const text = speechText(value).slice(0, 6_000)
    if (speechMessageID !== messageID || !text.startsWith(speechObserved)) {
      speechGeneration += 1
      stopSpeech()
      resetSpeechStream()
      speechMessageID = messageID
      setVoiceDiagnostics((current) => ({
        ...current,
        ttsFirstChunkMs: undefined,
        firstSoundMs: undefined,
        ttsChunks: 0,
        ttsBufferedMs: 0,
        ttsUnderruns: 0,
      }))
    }
    speechBuffer = `${speechBuffer}${text.slice(speechObserved.length)}`
    speechObserved = text
    const next = streamingSpeechChunks(speechBuffer, final)
    speechQueue.push(...next.chunks)
    speechBuffer = next.remainder
    speechFinal = final
    void drainSpeech()
  }

  const ensureSpeechPlayer = (generation: number, text: string) => {
    if (speechPlayer) return speechPlayer
    try {
      speechPlayer = createGaplessAudioPlayer({
        context: duplex?.audioContext(),
        onReferenceNode: (node) => duplex?.setPlaybackReference(node),
        onStart: () => {
          if (generation !== speechGeneration) return
          speechPlaybackStarted = true
          setState("speaking")
          duplex?.setState("speaking", speechObserved)
          const firstSoundMs = performance.now() - (speechStartedAt ?? performance.now())
          setVoiceDiagnostics((current) => ({ ...current, firstSoundMs }))
          recordVoice("tts", "playback_started", { text, durationMs: firstSoundMs })
        },
        onBuffer: (ttsBufferedMs) => {
          if (generation !== speechGeneration) return
          setVoiceDiagnostics((current) => ({ ...current, ttsBufferedMs }))
        },
        onUnderrun: (ttsUnderruns) => {
          if (generation !== speechGeneration) return
          setVoiceDiagnostics((current) => ({ ...current, ttsUnderruns }))
          recordVoice("tts", "playback_underrun", { diagnostics: { count: ttsUnderruns } })
        },
      })
    } catch (error) {
      failSpeech(generation, error)
    }
    return speechPlayer
  }

  const drainSpeech = async () => {
    if (speechBusy) return
    const text = speechQueue.shift()
    if (!text) {
      if (!speechFinal) return
      if (!speechPlayer) {
        restart()
        return
      }
      const generation = speechGeneration
      speechBusy = true
      await speechPlayer
        .finish()
        .then(() => {
          if (generation !== speechGeneration) return
          speechPlayer = undefined
          speechBusy = false
          recordVoice("tts", "playback_completed", {
            durationMs: performance.now() - (speechStartedAt ?? performance.now()),
          })
          restart()
        })
        .catch((error: unknown) => failSpeech(generation, error))
      return
    }
    const generation = speechGeneration
    const synthesisStarted = performance.now()
    speechStartedAt ??= synthesisStarted
    speechBusy = true
    if (!speechPlaybackStarted) setState("synthesizing")
    recordVoice("tts", "synthesis_started", { text })
    let chunks = 0
    const stream = (() => {
      try {
        return createLocalSpeechStream({
          endpoint: settings.voice.ttsEndpoint(),
          model: settings.voice.ttsModel(),
          voice: settings.voice.ttsVoice(),
          mode: settings.voice.ttsMode(),
          text,
          onChunk: (chunk) => {
            if (generation !== speechGeneration) return
            chunks += 1
            const firstChunkMs = performance.now() - synthesisStarted
            setVoiceDiagnostics((current) => ({
              ...current,
              ttsFirstChunkMs: current.ttsFirstChunkMs ?? firstChunkMs,
              ttsChunks: chunks,
            }))
            recordVoice("tts", "stream_chunk_ready", {
              text: chunk.text,
              durationMs: firstChunkMs,
              diagnostics: {
                chunk: chunk.index,
                cache: chunk.cache,
                prepare_ms: chunk.prepareMs,
                synthesis_ms: chunk.synthesisMs,
                total_ms: chunk.totalMs,
              },
            })
            const player = ensureSpeechPlayer(generation, text)
            if (!player) return
            void player
              .enqueue(chunk.audio, chunk.sampleRate)
              .then(() => {
                if (generation !== speechGeneration) return
                recordVoice("tts", "playback_chunk_buffered", {
                  text: chunk.text,
                  diagnostics: { chunk: chunk.index },
                })
              })
              .catch((error: unknown) => failSpeech(generation, error))
          },
        })
      } catch (error) {
        failSpeech(generation, error)
      }
    })()
    if (!stream) return
    speechStreamCancel = stream.cancel
    const completed = await stream.done
      .catch((error: unknown) => {
        failSpeech(generation, error)
        return undefined
      })
    if (!completed || generation !== speechGeneration) return
    speechStreamCancel = undefined
    speechBusy = false
    recordVoice("tts", "stream_completed", {
      text,
      durationMs: performance.now() - synthesisStarted,
      diagnostics: { chunks: completed.chunks, stream_ms: completed.totalMs },
    })
    void drainSpeech()
  }

  const submitTranscript = (text: string) => {
    voiceTurnSubmittedAt = performance.now()
    responseStartedForTurn = false
    responseCompletedForTurn = false
    recordVoice("agent", "transcript_accepted", { text })
    setLiveTranscript("")
    props.onTranscript(text)
    if (!settings.voice.autoSubmit()) {
      setState("idle")
      return
    }
    responseBeforeSubmit = latestAssistant()?.id
    setWaiting(true)
    setState("thinking")
    duplex?.setState("paused")
    clearTimeout(responseTimer)
    responseTimer = setTimeout(() => {
      if (!waiting()) return
      setWaiting(false)
      handsFree = false
      clearWakePhrase()
      setState("idle")
      showToast({
        title: language.t("voice.error.timeout.title"),
        description: language.t("voice.error.timeout.description"),
      })
    }, 300_000)
    queueMicrotask(props.onSubmit)
  }

  const acceptTranscript = (text: string) => {
    if (!usesWakePhrase()) {
      submitTranscript(text)
      return
    }
    const wake = routeWakeTranscript(text, settings.voice.wakePhrases(), !wakeArmed())
    if (wake.action === "submit") {
      if (wake.activated) recordVoice("stt", "wake_activated", { text: wake.text })
      submitWakeCommand(wake.text)
      return
    }
    if (wake.action === "ignore") {
      setLiveTranscript("")
      recordVoice("stt", "wake_ignored", { text })
      duplex?.setState("listening")
      return
    }
    recordVoice("stt", "wake_activated")
    openWakeFollowup(true)
    setLiveTranscript("")
    duplex?.setState("listening")
  }

  function submitWakeCommand(text: string) {
    clearTimeout(wakeFollowupTimer)
    wakeFollowupTimer = undefined
    setWakeArmed(false)
    setWakeActivated(false)
    updateDuplexWake(true, false)
    submitTranscript(text)
  }

  createEffect(() => {
    const sessionID = props.sessionID()
    const current = latestAssistant()
    if (sessionID !== observedSessionID) {
      observedSessionID = sessionID
      observedAssistantID = current?.id
      passiveSpeechMessageID = undefined
      return
    }
    if (!current) return
    if (current.id !== observedAssistantID) {
      observedAssistantID = current.id
      if (!waiting()) passiveSpeechMessageID = current.id
    }
    if (waiting() && current.id !== responseBeforeSubmit && !responseStartedForTurn) {
      responseStartedForTurn = true
      recordVoice("agent", "response_started", {
        durationMs: voiceTurnSubmittedAt === undefined ? undefined : performance.now() - voiceTurnSubmittedAt,
      })
    }
    if (waiting() && current.id !== responseBeforeSubmit && !props.working() && !responseCompletedForTurn) {
      responseCompletedForTurn = true
      recordVoice("agent", "response_completed", {
        durationMs: voiceTurnSubmittedAt === undefined ? undefined : performance.now() - voiceTurnSubmittedAt,
      })
    }
    if (waiting() && current.id !== responseBeforeSubmit && settings.voice.speakResponses()) {
      queueSpeech(current.id, current.text, !props.working())
      if (props.working()) return
      setWaiting(false)
      clearTimeout(responseTimer)
      return
    }
    if (waiting() && current.id !== responseBeforeSubmit && !settings.voice.speakResponses() && !props.working()) {
      setWaiting(false)
      clearTimeout(responseTimer)
      restart()
      return
    }
    if (
      waiting() ||
      !settings.voice.speakResponses() ||
      props.working() ||
      passiveSpeechMessageID !== current.id ||
      !current.text
    )
      return
    passiveSpeechMessageID = undefined
    queueSpeech(current.id, current.text, true)
  })

  function performBargeIn() {
    if (state() !== "speaking" || bargeInActive) return
    console.info("[voice-agent] duplex STT detected a deliberate interruption")
    recordVoice("agent", "interrupted", { state: "speaking" })
    bargeInActive = true
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    if (props.working()) props.onInterrupt()
    handsFree = true
    setState("listening")
    duplex?.setState("listening")
  }

  function handleDuplexEvent(event: DuplexSpeechEvent) {
    if (event.type === "speech_start") microphoneTrace = []
    const closesUtterance = event.type === "final" || event.type === "discard" || event.type === "wake_ignored"
    const levelTrace = closesUtterance ? microphoneTrace.map((value) => value.toFixed(2)).join(",") : undefined
    const peak = closesUtterance && microphoneTrace.length ? Math.max(...microphoneTrace) : undefined
    recordVoice("stt", event.type, {
      state: event.mode,
      text: event.text,
      error: event.error,
      diagnostics: event.diagnostics || levelTrace
        ? {
            vad: event.diagnostics?.vad,
            audio_ms: event.diagnostics?.audio_ms,
            speech_ms: event.diagnostics?.speech_ms,
            silence_ms: event.diagnostics?.silence_ms,
            pre_roll_ms: event.diagnostics?.pre_roll_ms,
            transcription_ms: event.diagnostics?.transcription_ms,
            transcription_cache: event.diagnostics?.transcription_cache,
            incremental_decode: event.diagnostics?.incremental_decode,
            decode_count: event.diagnostics?.decode_count,
            decoded_audio_ms: event.diagnostics?.decoded_audio_ms,
            committed_audio_ms: event.diagnostics?.committed_audio_ms,
            transcript_stability: event.diagnostics?.transcript_stability,
            endpoint_reason: event.diagnostics?.endpoint_reason,
            wake_recognition_ms: event.diagnostics?.wake_recognition_ms,
            wake_model: event.diagnostics?.wake_model,
            wake_armed: event.diagnostics?.wake_armed,
            wake_confidence: event.confidence,
            level_trace: levelTrace,
            microphone_peak: peak,
          }
        : undefined,
    })
    if (closesUtterance) microphoneTrace = []
    if (event.type === "error") {
      failRecognition(new Error(event.error || "The local streaming STT backend failed."))
      return
    }
    const diagnostics = event.diagnostics
    setVoiceDiagnostics((current) => ({
      microphone: microphonePercent(),
      vad:
        event.type === "speech_start"
          ? "speech"
          : event.type === "discard" || event.type === "final" || event.type === "wake_ignored"
            ? "silence"
            : diagnostics?.vad ?? current.vad,
      phase:
        event.type === "wake_detected" ||
        event.type === "wake_ignored" ||
        event.type === "speech_start" ||
        event.type === "partial" ||
        event.type === "final" ||
        event.type === "discard"
          ? event.type
          : current.phase,
      preRollMs: diagnostics?.pre_roll_ms ?? event.pre_roll_ms ?? current.preRollMs,
      transcriptionMs: diagnostics?.transcription_ms ?? current.transcriptionMs,
      transcriptionCache: diagnostics?.transcription_cache ?? current.transcriptionCache,
      decodeCount: diagnostics?.decode_count ?? current.decodeCount,
      decodedAudioMs: diagnostics?.decoded_audio_ms ?? current.decodedAudioMs,
      committedAudioMs: diagnostics?.committed_audio_ms ?? current.committedAudioMs,
      wakeRecognitionMs: diagnostics?.wake_recognition_ms ?? current.wakeRecognitionMs,
      wakeModel: diagnostics?.wake_model ?? current.wakeModel,
      wakeConfidence: event.confidence ?? current.wakeConfidence,
      endpointReason:
        event.type === "speech_start" ? undefined : diagnostics?.endpoint_reason ?? current.endpointReason,
    }))
    const text = event.text?.trim() ?? ""
    if (event.type === "wake_ignored") {
      setLiveTranscript("")
      return
    }
    if (event.type === "wake_detected") {
      setLiveTranscript(text)
      if (event.command) return
      openWakeFollowup(true)
      setLiveTranscript("")
      duplex?.setState("listening")
      return
    }
    if ((event.type === "partial" || event.type === "final") && text) setLiveTranscript(text)
    if (event.mode !== "speaking" || (event.type !== "partial" && event.type !== "final")) {
      if (event.type === "final" && text && state() === "listening") {
        bargeInActive = false
        if (event.wake) {
          submitWakeCommand(text)
          return
        }
        acceptTranscript(text)
      }
      return
    }
    if (isLikelySpeechEcho(text, event.reference || speechObserved)) return
    if (wakeArmed() && !extractWakeCommand(text, settings.voice.wakePhrases()).matched) return
    if (!isDeliberateSpeechInterruption(text)) return
    performBargeIn()
    if (event.type !== "final") return
    bargeInActive = false
    acceptTranscript(text)
  }

  async function ensureDuplex() {
    if (duplexStarting) return duplexStarting
    duplex = createLocalDuplexSpeech({
      endpoint: settings.voice.ttsEndpoint(),
      language: voiceLanguage(document.documentElement.lang, navigator.language),
      wake: {
        enabled: usesWakePhrase(),
        armed: wakeArmed(),
        phrases: configuredWakePhrases(settings.voice.wakePhrases()),
      },
      onEvent: handleDuplexEvent,
      onLevel: (level) => {
        const normalized = Math.min(1, Math.max(0, level))
        setMicrophoneLevel(normalized)
        if (state() === "listening" || state() === "speaking") {
          microphoneTrace.push(normalized)
          if (microphoneTrace.length > 720) microphoneTrace = microphoneTrace.slice(-720)
        }
        const microphone = Math.round(normalized * 10) * 10
        setVoiceDiagnostics((current) => (current.microphone === microphone ? current : { ...current, microphone }))
      },
      onEcho: (diagnostics) => {
        setVoiceDiagnostics((current) => ({
          ...current,
          echoReferencePercent: Math.round(Math.min(1, (diagnostics.echo_reference_rms ?? 0) / 0.09) * 100),
          echoResidualPercent: Math.round(Math.min(1, (diagnostics.echo_residual_rms ?? 0) / 0.09) * 100),
          echoCoherence: Math.round((diagnostics.echo_coherence ?? 0) * 100),
          echoSuppressionDb: Math.round((diagnostics.echo_suppression_db ?? 0) * 10) / 10,
          echoDelayMs: Math.round(diagnostics.echo_delay_ms ?? 0),
        }))
        if (performance.now() - lastEchoLogAt < 1_000) return
        lastEchoLogAt = performance.now()
        recordVoice("stt", "echo_reference_compared", { diagnostics })
      },
      onError: failRecognition,
    })
    duplexStarting = duplex.start().catch((error: unknown) => {
      duplexStarting = undefined
      duplex = undefined
      throw error
    })
    return duplexStarting
  }

  function stopDuplex() {
    duplex?.stop()
    duplex = undefined
    duplexStarting = undefined
    bargeInActive = false
    setMicrophoneLevel(0)
    setVoiceDiagnostics({ microphone: 0, vad: "idle", phase: "ready" })
  }

  function failRecognition(error: unknown) {
    handsFree = false
    clearWakePhrase()
    stopDuplex()
    setState("idle")
    recordVoice("stt", "error", { error: error instanceof Error ? error.message : String(error) })
    showToast({
      title: language.t("voice.error.service.title"),
      description: language.t("voice.error.service.description", {
        error: error instanceof Error ? error.message : String(error),
      }),
    })
  }

  createEffect(() => {
    if (settings.voice.enabled()) return
    handsFree = false
    clearWakePhrase()
    setWaiting(false)
    clearTimeout(responseTimer)
    clearTimeout(restartTimer)
    stopDuplex()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    setState("idle")
  })

  async function start(preserveWake = false) {
    if (state() === "listening") {
      handsFree = false
      interrupt()
      return
    }
    if (state() === "thinking" || state() === "synthesizing") {
      handsFree = false
      interrupt()
      return
    }
    if (state() === "speaking") {
      interrupt()
      await start()
      return
    }
    microphoneAccess = (await platform.requestMicrophoneAccess?.().catch(() => "unknown")) ?? "unknown"
    recordVoice("ui", "microphone_access", { state: microphoneAccess })
    if (microphoneAccess === "denied" || microphoneAccess === "restricted") {
      showToast({
        title: language.t("voice.error.permission.title"),
        description: language.t("voice.error.permission.description", { error: microphoneAccess }),
        actions:
          platform.os === "macos"
            ? [
                {
                  label: language.t("voice.error.permission.settings"),
                  onClick: () =>
                    platform.openLink("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"),
                },
              ]
            : undefined,
      })
      return
    }
    clearTimeout(restartTimer)
    speechGeneration += 1
    voiceTurnID = crypto.randomUUID()
    voiceTurnSubmittedAt = undefined
    responseStartedForTurn = false
    responseCompletedForTurn = false
    microphoneTrace = []
    stopSpeech()
    handsFree = settings.voice.handsFree()
    if (!preserveWake) armWakePhrase()
    setLiveTranscript("")
    setVoiceDiagnostics({ microphone: 0, vad: "silence", phase: "ready" })
    setState("listening")
    recordVoice("agent", "listening_started", {
      diagnostics: { hands_free: handsFree, language: voiceLanguage(document.documentElement.lang, navigator.language) },
    })
    await ensureDuplex().catch(failRecognition)
    duplex?.setState("listening")
  }

  createEffect(() => {
    const enabled =
      settings.voice.enabled() &&
      settings.voice.autoSubmit() &&
      settings.voice.handsFree() &&
      settings.voice.wakePhraseEnabled() &&
      settings.voice.wakeOnLaunch()
    const working = props.working()
    if (!enabled) {
      wakeAutoStartScheduled = false
      return
    }
    if (working || wakeAutoStartScheduled || state() !== "idle") return
    wakeAutoStartScheduled = true
    queueMicrotask(() => void start())
  })

  onCleanup(() => {
    handsFree = false
    clearTimeout(responseTimer)
    clearTimeout(restartTimer)
    clearWakePhrase()
    stopDuplex()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    props.onStatusChange?.(undefined)
  })

  const label = () => language.t(`voice.action.${state()}`)
  const status = () => {
    const value = language.t(`voice.status.${state() as "listening" | "thinking" | "synthesizing" | "speaking"}`)
    const transcript = liveTranscript().trim()
    if (state() === "listening" && wakeArmed()) return language.t("voice.status.wake")
    if (state() === "listening" && wakeActivated() && !transcript) return language.t("voice.status.wakeActivated")
    if (!transcript || (state() !== "listening" && state() !== "speaking")) return value
    return `${value} “${transcript.slice(0, 80)}${transcript.length > 80 ? "…" : ""}”`
  }

  createEffect(() => {
    const current = state()
    if (current === "idle") {
      props.onStatusChange?.(undefined)
      return
    }
    props.onStatusChange?.({
      state: current,
      text: status(),
      diagnostics: current === "thinking" ? undefined : voiceDiagnostics(),
    })
  })

  return (
    <Show when={settings.voice.enabled()}>
      <Show
        when={props.appearance === "v2"}
        fallback={
          <Button
            data-action="voice-agent"
            type="button"
            variant="ghost"
            class="size-8 p-0"
            onClick={() => void start()}
            title={label()}
            aria-label={label()}
          >
            <Microphone active={state() !== "idle"} level={microphoneLevel()} />
          </Button>
        }
      >
        <IconButtonV2
          data-action="voice-agent"
          type="button"
          size="normal"
          variant={state() === "idle" ? "ghost" : "contrast"}
          icon={<Microphone active={state() !== "idle"} level={microphoneLevel()} />}
          onClick={() => void start()}
          title={label()}
          aria-label={label()}
        />
      </Show>
    </Show>
  )
}

export function VoiceAgentChatStatus(props: { status: VoiceAgentStatus | undefined }) {
  const language = useLanguage()
  const vadLabel = (value: NonNullable<VoiceAgentStatus["diagnostics"]>["vad"]) => {
    if (value === "speech") return language.t("voice.diagnostics.vad.speech")
    if (value === "silence") return language.t("voice.diagnostics.vad.silence")
    return language.t("voice.diagnostics.vad.idle")
  }
  const phaseLabel = (value: NonNullable<VoiceAgentStatus["diagnostics"]>["phase"]) => {
    if (value === "speech_start") return language.t("voice.diagnostics.phase.speechStart")
    if (value === "wake_detected") return language.t("voice.diagnostics.phase.wakeDetected")
    if (value === "wake_ignored") return language.t("voice.diagnostics.phase.wakeIgnored")
    if (value === "partial") return language.t("voice.diagnostics.phase.partial")
    if (value === "final") return language.t("voice.diagnostics.phase.final")
    if (value === "discard") return language.t("voice.diagnostics.phase.discard")
    return language.t("voice.diagnostics.phase.ready")
  }
  const endpointLabel = (value: string) => {
    if (value === "semantic_complete") return language.t("voice.diagnostics.endpoint.semantic")
    if (value === "semantic_grace_elapsed") return language.t("voice.diagnostics.endpoint.grace")
    if (value === "max_duration") return language.t("voice.diagnostics.endpoint.maximum")
    if (value === "noise_discarded") return language.t("voice.diagnostics.endpoint.noise")
    if (value === "endpoint_candidate") return language.t("voice.diagnostics.endpoint.candidate")
    if (value === "wake_candidate") return language.t("voice.diagnostics.endpoint.wakeCandidate")
    if (value === "wake_command") return language.t("voice.diagnostics.endpoint.wakeCommand")
    return value
  }
  return (
    <Show when={props.status}>
      {(status) => (
        <div
          data-component="voice-agent-chat-status"
          role="status"
          aria-live="polite"
          class="flex min-w-0 flex-col items-start gap-1 self-start px-3 py-1 text-13-regular text-text-weak"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span class="relative flex size-2 shrink-0">
              <span
                class="absolute inline-flex size-full animate-ping rounded-full opacity-35"
                classList={{
                  "bg-icon-info-base": status().state === "listening",
                  "bg-icon-warning-base": status().state === "thinking" || status().state === "synthesizing",
                  "bg-icon-success-base": status().state === "speaking",
                }}
              />
              <span
                class="relative inline-flex size-2 rounded-full"
                classList={{
                  "bg-icon-info-base": status().state === "listening",
                  "bg-icon-warning-base": status().state === "thinking" || status().state === "synthesizing",
                  "bg-icon-success-base": status().state === "speaking",
                }}
              />
            </span>
            <span class="min-w-0 truncate">{status().text}</span>
          </div>
          <Show when={status().diagnostics}>
            {(diagnostics) => (
              <div class="flex flex-wrap gap-x-3 gap-y-0.5 pl-4 text-11-regular text-text-weaker">
                <span>{language.t("voice.diagnostics.microphone")} {diagnostics().microphone}%</span>
                <span>VAD {vadLabel(diagnostics().vad)}</span>
                <span>STT {phaseLabel(diagnostics().phase)}</span>
                <Show when={diagnostics().preRollMs}>
                  {(value) => <span>{language.t("voice.diagnostics.preRoll")} {value()} ms</span>}
                </Show>
                <Show when={diagnostics().transcriptionMs !== undefined}>
                  <span>{language.t("voice.diagnostics.latency")} {diagnostics().transcriptionMs} ms</span>
                </Show>
                <Show when={diagnostics().transcriptionCache}>
                  {(value) => <span>{language.t("voice.diagnostics.cache")} {value()}</span>}
                </Show>
                <Show when={diagnostics().decodeCount !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.incremental")} {diagnostics().decodeCount}
                    {diagnostics().decodedAudioMs !== undefined ? ` · ${diagnostics().decodedAudioMs} ms` : ""}
                    {diagnostics().committedAudioMs !== undefined ? ` → ${diagnostics().committedAudioMs} ms` : ""}
                  </span>
                </Show>
                <Show when={diagnostics().ttsFirstChunkMs !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.firstChunk")} {Math.round(diagnostics().ttsFirstChunkMs!)} ms
                    {diagnostics().ttsChunks !== undefined ? ` · ${diagnostics().ttsChunks}` : ""}
                  </span>
                </Show>
                <Show when={diagnostics().firstSoundMs !== undefined}>
                  <span>{language.t("voice.diagnostics.firstSound")} {Math.round(diagnostics().firstSoundMs!)} ms</span>
                </Show>
                <Show when={diagnostics().ttsBufferedMs !== undefined}>
                  <span>{language.t("voice.diagnostics.buffered")} {Math.round(diagnostics().ttsBufferedMs!)} ms</span>
                </Show>
                <Show when={diagnostics().ttsUnderruns !== undefined}>
                  <span>{language.t("voice.diagnostics.underruns")} {diagnostics().ttsUnderruns}</span>
                </Show>
                <Show when={diagnostics().echoReferencePercent !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.echo")} {diagnostics().echoReferencePercent}% → {diagnostics().echoResidualPercent}%
                    {diagnostics().echoCoherence !== undefined ? ` · ${diagnostics().echoCoherence}%` : ""}
                    {diagnostics().echoSuppressionDb !== undefined ? ` · ${diagnostics().echoSuppressionDb} dB` : ""}
                    {diagnostics().echoDelayMs !== undefined ? ` · ${diagnostics().echoDelayMs} ms` : ""}
                  </span>
                </Show>
                <Show when={diagnostics().wakeRecognitionMs !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.wake")} {diagnostics().wakeModel ?? "—"} ·{" "}
                    {diagnostics().wakeRecognitionMs} ms
                    {diagnostics().wakeConfidence !== undefined
                      ? ` · ${Math.round(diagnostics().wakeConfidence! * 100)}%`
                      : ""}
                  </span>
                </Show>
                <Show when={diagnostics().endpointReason}>
                  {(value) => <span>{language.t("voice.diagnostics.endpoint")} {endpointLabel(value())}</span>}
                </Show>
              </div>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}
