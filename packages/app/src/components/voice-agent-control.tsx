import { Button } from "@opencode-ai/ui/button"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform, type MicrophoneAccess } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { createLocalDuplexSpeech, type DuplexSpeechEvent } from "@/utils/duplex-speech"
import { createGaplessAudioPlayer } from "@/utils/gapless-audio-player"
import { createLocalSpeechStream } from "@/utils/streaming-tts"
import { showToast } from "@/utils/toast"
import {
  createVoiceSessionOrchestrator,
  isCurrentVoiceEvent,
  isVoiceResponse,
  shouldRecoverVoiceTurn,
  type VoiceSessionState,
  type VoiceTurn,
} from "@/utils/voice-session-orchestrator"
import { configuredWakePhrases, extractWakeCommand, routeWakeTranscript } from "@/utils/wake-phrase"
import {
  isDeliberateSpeechInterruption,
  isLikelySpeechEcho,
  speechText,
  streamingSpeechChunks,
  voiceLanguage,
} from "@/utils/voice-agent"
import { inspectVoiceWatchdog } from "@/utils/voice-watchdog"
import { stageVoiceRequestContext } from "@/utils/voice-request-context"
import {
  assessVoiceTranscript,
  voicePersonalityInstruction,
  type VoiceIntent,
  type VoiceUnderstandingDecision,
  type VoiceUnderstandingReason,
} from "@/utils/voice-understanding"
import { upsertVoiceDictionaryEntry } from "@/utils/voice-dictionary"

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
  state: Exclude<VoiceSessionState, "idle">
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
    finalConfidence?: number
    languageProbability?: number
    intent?: VoiceIntent
    understandingDecision?: VoiceUnderstandingDecision
    understandingReason?: VoiceUnderstandingReason
  }
}

const BARGE_IN_MIN_SPEECH_MS = 480

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
  const local = useLocal()
  const platform = usePlatform()
  const sdk = useSDK()
  const sync = useSync()
  const [state, setState] = createSignal<VoiceSessionState>("idle")
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
  const personalityVoice = createMemo(() => local.personality.current()?.voice)
  const canSpeak = createMemo(() => settings.voice.enabled() && settings.voice.speakResponses() && !!personalityVoice())
  let handsFree = false
  let responseParentID: string | undefined
  let submittedAt: number | undefined
  let submittedTranscript = ""
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
  let recoveredSessionID: string | undefined
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

  const orchestrator = createVoiceSessionOrchestrator({
    onTransition: (transition) => {
      voiceTurnID = transition.turn?.id
      setState(transition.to)
      recordVoice("agent", "turn_checkpoint", {
        state: transition.to,
        diagnostics: {
          from: transition.from,
          reason: transition.reason,
          turn_generation: transition.turn?.generation,
        },
      })
      if (transition.to === "idle") voiceTurnID = undefined
    },
  })

  const activeTurn = () => orchestrator.snapshot().turn
  const move = (next: VoiceSessionState, reason: string, turn = activeTurn()) =>
    orchestrator.transition(turn, next, reason)

  let previousDiagnosticState: ReturnType<typeof state> | undefined
  createEffect(() => {
    const current = state()
    if (current === previousDiagnosticState) return
    previousDiagnosticState = current
    recordVoice("agent", "state_changed", { state: current })
  })

  createEffect(() => {
    if (state() === "listening" || state() === "transcribing" || state() === "speaking") return
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
      .filter(
        (part): part is Part & { type: "text"; text: string } =>
          part.type === "text" && !part.synthetic && !part.ignored,
      )
      .map((part) => part.text)
      .join("\n")
      .trim()
    return { id: message.id, parentID: message.parentID, text }
  })

  const recentConversation = () => {
    const sessionID = props.sessionID()
    if (!sessionID) return ""
    return (sync().data.message[sessionID] ?? [])
      .slice(-8)
      .flatMap((message) =>
        (sync().data.part[message.id] ?? [])
          .filter(
            (part): part is Part & { type: "text"; text: string } =>
              part.type === "text" && !part.synthetic && !part.ignored,
          )
          .map((part) => part.text.trim()),
      )
      .filter(Boolean)
      .join("\n")
      .slice(-4_000)
  }

  createEffect(() => {
    const sessionID = props.sessionID()
    if (!sessionID || !waiting() || responseParentID || submittedAt === undefined) return
    const message = [...(sync().data.message[sessionID] ?? [])]
      .reverse()
      .find((item) => item.role === "user" && item.time.created >= submittedAt! - 1_000)
    if (!message) return
    const text = (sync().data.part[message.id] ?? [])
      .filter((part): part is Part & { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (submittedTranscript && !text.includes(submittedTranscript)) return
    responseParentID = message.id
    recordVoice("agent", "request_correlated", { diagnostics: { parent_id: message.id } })
  })

  const usesWakePhrase = () =>
    handsFree && settings.voice.wakePhraseEnabled() && configuredWakePhrases(settings.voice.wakePhrases()).length > 0

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
      orchestrator.cancel("conversation_complete")
      return
    }
    orchestrator.cancel("conversation_complete")
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
    recordVoice("tts", "error", {
      error: error instanceof Error ? error.message : String(error),
    })
    stopSpeech()
    resetSpeechStream()
    setWaiting(false)
    setLiveTranscript("")
    clearTimeout(responseTimer)
    handsFree = false
    clearWakePhrase()
    orchestrator.cancel("tts_error")
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

  const interrupt = (reason: string) => {
    setWaiting(false)
    setLiveTranscript("")
    clearTimeout(responseTimer)
    clearTimeout(restartTimer)
    stopDuplex()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    clearWakePhrase()
    if (props.working()) props.onInterrupt()
    orchestrator.cancel(reason)
  }

  const watchdogTimer = setInterval(() => {
    const issue = inspectVoiceWatchdog(orchestrator.snapshot())
    if (!issue) return
    recordVoice("agent", "watchdog_timeout", {
      state: issue.state,
      durationMs: issue.elapsedMs,
      diagnostics: { limit_ms: issue.limitMs },
    })
    interrupt("watchdog_timeout")
    showToast({
      variant: "error",
      title: language.t("voice.error.watchdog.title"),
      description: language.t("voice.error.watchdog.description", {
        state: language.t(`voice.status.${issue.state}`),
        seconds: Math.round(issue.elapsedMs / 1_000),
      }),
    })
  }, 2_000)

  const queueSpeech = (messageID: string, value: string, final: boolean) => {
    if (!activeTurn()) {
      const turn = orchestrator.begin("passive_response")
      move("thinking", "passive_response_ready", turn)
    }
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
        playbackRate: personalityVoice()?.playbackRate ?? 1,
        volume: personalityVoice()?.volume ?? 1,
        onReferenceNode: (node) => duplex?.setPlaybackReference(node),
        onStart: () => {
          if (generation !== speechGeneration) return
          speechPlaybackStarted = true
          move("speaking", "tts_playback_started")
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
    if (!speechPlaybackStarted) move("synthesizing", "tts_synthesis_started")
    recordVoice("tts", "synthesis_started", { text })
    const sessionID = props.sessionID()
    if (sessionID && (await platform.routeAvatarSpeech?.(sessionID, text).catch(() => false))) {
      speechBusy = false
      recordVoice("tts", "playback_completed", { diagnostics: { routedToQuest: true } })
      void drainSpeech()
      return
    }
    const voice = personalityVoice()
    if (!voice) {
      speechBusy = false
      restart()
      return
    }
    if (voice.provider === "fish-local") {
      if (!platform.synthesizeLocalSpeech) {
        failSpeech(generation, new Error(language.t("voice.error.unsupported.description")))
        return
      }
      speechStreamCancel = () => void platform.cancelLocalSpeech?.()
      const result = await platform
        .synthesizeLocalSpeech({
          provider: "fish-local",
          fishPresetID: voice.voicePresetID,
          endpoint: voice.endpoint,
          model: "",
          voice: "",
          mode: "quality",
          latency: voice.latency,
          language: voice.language,
          temperature: voice.temperature,
          topP: voice.topP,
          repetitionPenalty: voice.repetitionPenalty,
          seed: voice.seed,
          chunkLength: voice.chunkLength,
          normalize: voice.normalize,
          streaming: voice.streaming,
          useMemoryCache: voice.useMemoryCache,
          maxNewTokens: voice.maxNewTokens,
          text,
        })
        .catch((error: unknown) => {
          failSpeech(generation, error)
          return undefined
        })
      if (!result || generation !== speechGeneration) return
      const decodeContext = duplex?.audioContext() ?? new AudioContext({ latencyHint: "interactive" })
      const decoded = await decodeContext.decodeAudioData(await result.audio.arrayBuffer()).catch((error: unknown) => {
        failSpeech(generation, error)
        return undefined
      })
      if (!decoded || generation !== speechGeneration) return
      const pcm = new Int16Array(decoded.length)
      decoded.getChannelData(0).forEach((sample, index) => {
        pcm[index] = Math.max(-1, Math.min(1, sample)) * 0x7fff
      })
      if (!duplex) void decodeContext.close()
      const firstChunkMs = performance.now() - synthesisStarted
      setVoiceDiagnostics((current) => ({
        ...current,
        ttsFirstChunkMs: current.ttsFirstChunkMs ?? firstChunkMs,
        ttsChunks: 1,
      }))
      recordVoice("tts", "stream_chunk_ready", {
        text,
        durationMs: firstChunkMs,
        diagnostics: {
          chunk: 0,
          cache: result.metrics.cache,
          synthesis_ms: result.metrics.synthesisMs,
          total_ms: result.metrics.totalMs,
        },
      })
      const player = ensureSpeechPlayer(generation, text)
      if (!player) return
      const buffered = await player.enqueue(pcm, decoded.sampleRate).then(
        () => true,
        (error: unknown) => {
          failSpeech(generation, error)
          return false
        },
      )
      if (!buffered || generation !== speechGeneration) return
      speechStreamCancel = undefined
      speechBusy = false
      recordVoice("tts", "stream_completed", {
        text,
        durationMs: performance.now() - synthesisStarted,
        diagnostics: {
          chunks: 1,
          stream_ms: result.metrics.totalMs,
          provider: "fish-local",
          model: "server-selected",
        },
      })
      void drainSpeech()
      return
    }
    let chunks = 0
    const stream = (() => {
      try {
        return createLocalSpeechStream({
          endpoint: voice.endpoint,
          model: voice.model,
          voice: voice.voice,
          mode: voice.mode,
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
    const completed = await stream.done.catch((error: unknown) => {
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

  const submitTranscript = (raw: string, turn = activeTurn(), diagnostics?: DuplexSpeechEvent["diagnostics"]) => {
    if (!turn || !orchestrator.isCurrent(turn)) return
    const assessment = assessVoiceTranscript({
      text: raw,
      confidence: diagnostics?.final_confidence,
      averageLogProbability: diagnostics?.average_log_probability,
      noSpeechProbability: diagnostics?.no_speech_probability,
      languageProbability: diagnostics?.language_probability,
      alternatives: diagnostics?.alternatives,
      dictionary: settings.voice.dictionaryEntries(),
      dictionaryContext: {
        language: document.documentElement.lang || navigator.language,
        project: sdk().directory,
        sessionID: props.sessionID(),
      },
      contextualCorrection: settings.voice.contextualCorrection(),
      confirmRiskyCommands: settings.voice.confirmRiskyCommands(),
      recentContext: recentConversation(),
    })
    setVoiceDiagnostics((current) => ({
      ...current,
      finalConfidence: diagnostics?.final_confidence,
      languageProbability: diagnostics?.language_probability,
      intent: assessment.intent,
      understandingDecision: assessment.decision,
      understandingReason: assessment.reason,
    }))
    recordVoice("agent", "transcript_assessed", {
      text: assessment.text,
      diagnostics: {
        original: assessment.original,
        intent: assessment.intent,
        decision: assessment.decision,
        reason: assessment.reason,
        corrections: assessment.appliedCorrections.join(", "),
        final_confidence: diagnostics?.final_confidence,
      },
    })
    if (assessment.decision === "learned" && assessment.learned) {
      const learnedScope = props.sessionID() ? "session" : "project"
      settings.voice.setDictionaryEntries(
        upsertVoiceDictionaryEntry(settings.voice.dictionaryEntries(), {
          correct: assessment.learned.replacement,
          variants: [assessment.learned.heard],
          language: document.documentElement.lang || navigator.language,
          scope: learnedScope,
          scopeID: props.sessionID() ?? sdk().directory,
          confidence: diagnostics?.final_confidence ?? 0.8,
          confirmed: false,
        }),
      )
      setLiveTranscript("")
      orchestrator.cancel("voice_correction_learned")
      showToast({
        title: language.t("voice.understanding.learned.title"),
        description: language.t("voice.understanding.learned.description", assessment.learned),
      })
      if (handsFree) restartTimer = setTimeout(() => void start(true), 250)
      return
    }
    if (assessment.decision === "review") {
      setLiveTranscript("")
      props.onTranscript(assessment.text)
      duplex?.setState("paused")
      handsFree = false
      orchestrator.cancel(`voice_review_${assessment.reason}`)
      showToast({
        title: language.t(`voice.understanding.review.${assessment.reason}.title`),
        description: language.t(`voice.understanding.review.${assessment.reason}.description`),
      })
      return
    }
    const text = assessment.text
    if (!orchestrator.acceptTranscript(turn, text)) {
      recordVoice("agent", "duplicate_transcript_ignored", { text })
      return
    }
    voiceTurnSubmittedAt = performance.now()
    submittedAt = Date.now()
    submittedTranscript = text.trim()
    responseParentID = undefined
    responseStartedForTurn = false
    responseCompletedForTurn = false
    recordVoice("agent", "transcript_accepted", { text })
    stageVoiceRequestContext(
      text,
      voicePersonalityInstruction({
        mode: settings.voice.personalityMode(),
        intent: assessment.intent,
        language: document.documentElement.lang || navigator.language,
      }),
    )
    setLiveTranscript("")
    props.onTranscript(text)
    if (!settings.voice.autoSubmit()) {
      orchestrator.cancel("manual_submit_required")
      return
    }
    setWaiting(true)
    move("thinking", "transcript_submitted", turn)
    duplex?.setState("paused")
    clearTimeout(responseTimer)
    responseTimer = setTimeout(() => {
      if (!waiting()) return
      setWaiting(false)
      setLiveTranscript("")
      handsFree = false
      clearWakePhrase()
      orchestrator.cancel("response_timeout")
      showToast({
        title: language.t("voice.error.timeout.title"),
        description: language.t("voice.error.timeout.description"),
      })
    }, 300_000)
    queueMicrotask(props.onSubmit)
  }

  const acceptTranscript = (text: string, turn = activeTurn(), diagnostics?: DuplexSpeechEvent["diagnostics"]) => {
    if (!turn || !orchestrator.isCurrent(turn)) return
    if (!usesWakePhrase()) {
      submitTranscript(text, turn, diagnostics)
      return
    }
    const wake = routeWakeTranscript(text, settings.voice.wakePhrases(), !wakeArmed())
    if (wake.action === "submit") {
      if (wake.activated) recordVoice("stt", "wake_activated", { text: wake.text })
      submitWakeCommand(wake.text, diagnostics)
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

  function submitWakeCommand(text: string, diagnostics?: DuplexSpeechEvent["diagnostics"]) {
    clearTimeout(wakeFollowupTimer)
    wakeFollowupTimer = undefined
    setWakeArmed(false)
    setWakeActivated(false)
    updateDuplexWake(true, false)
    submitTranscript(text, activeTurn(), diagnostics)
  }

  createEffect(() => {
    const sessionID = props.sessionID()
    if (!sessionID || recoveredSessionID === sessionID || !platform.getVoiceDiagnostics) return
    recoveredSessionID = sessionID
    void platform.getVoiceDiagnostics(sessionID).then(({ entries }) => {
      if (props.sessionID() !== sessionID) return
      const last = [...entries].reverse().find((entry) => entry.event === "turn_checkpoint")
      if (!last || !shouldRecoverVoiceTurn(last.state)) return
      return platform.appendVoiceDiagnostic?.({
        sessionID,
        turnID: last.turnID,
        source: "agent",
        event: "turn_recovered_to_idle",
        state: "idle",
        generation: last.generation,
        diagnostics: { previous_state: last.state, reason: "renderer_recovery" },
      })
    })
  })

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
    const belongsToTurn = waiting() && isVoiceResponse(current.parentID, responseParentID)
    if (belongsToTurn && !responseStartedForTurn) {
      responseStartedForTurn = true
      recordVoice("agent", "response_started", {
        durationMs: voiceTurnSubmittedAt === undefined ? undefined : performance.now() - voiceTurnSubmittedAt,
      })
    }
    if (belongsToTurn && !props.working() && !responseCompletedForTurn) {
      responseCompletedForTurn = true
      recordVoice("agent", "response_completed", {
        durationMs: voiceTurnSubmittedAt === undefined ? undefined : performance.now() - voiceTurnSubmittedAt,
      })
    }
    if (belongsToTurn && canSpeak()) {
      queueSpeech(current.id, current.text, !props.working())
      if (props.working()) return
      setWaiting(false)
      clearTimeout(responseTimer)
      return
    }
    if (belongsToTurn && !canSpeak() && !props.working()) {
      setWaiting(false)
      clearTimeout(responseTimer)
      restart()
      return
    }
    if (waiting() || !canSpeak() || props.working() || passiveSpeechMessageID !== current.id || !current.text) return
    passiveSpeechMessageID = undefined
    queueSpeech(current.id, current.text, true)
  })

  function performBargeIn() {
    if (state() !== "speaking" || bargeInActive) return
    console.info("[voice-agent] duplex STT detected a deliberate interruption")
    recordVoice("agent", "interrupted", { state: "speaking" })
    bargeInActive = true
    speechGeneration += 1
    setLiveTranscript("")
    stopSpeech()
    resetSpeechStream()
    if (props.working()) props.onInterrupt()
    handsFree = true
    move("interrupted", "barge_in_detected")
    move("listening", "barge_in_listening")
    duplex?.setState("listening")
  }

  function handleDuplexEvent(event: DuplexSpeechEvent) {
    const turn = activeTurn()
    if (!turn || !orchestrator.isCurrent(turn)) {
      recordVoice("stt", "stale_event_ignored", { state: event.mode, text: event.text })
      return
    }
    if (!isCurrentVoiceEvent(turn, event)) {
      recordVoice("stt", "stale_event_ignored", {
        state: event.mode,
        text: event.text,
        diagnostics: { event_turn: event.turn_id, event_generation: event.turn_generation },
      })
      return
    }
    if (event.type === "speech_start") microphoneTrace = []
    const closesUtterance = event.type === "final" || event.type === "discard" || event.type === "wake_ignored"
    const levelTrace = closesUtterance ? microphoneTrace.map((value) => value.toFixed(2)).join(",") : undefined
    const peak = closesUtterance && microphoneTrace.length ? Math.max(...microphoneTrace) : undefined
    recordVoice("stt", event.type, {
      state: event.mode,
      text: event.text,
      error: event.error,
      diagnostics:
        event.diagnostics || levelTrace
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
              partial_count: event.diagnostics?.partial_count,
              frame_rms: event.diagnostics?.frame_rms,
              peak_rms: event.diagnostics?.peak_rms,
              min_rms: event.diagnostics?.min_rms,
              recognition_model: event.diagnostics?.recognition_model,
              transcript_stability: event.diagnostics?.transcript_stability,
              endpoint_reason: event.diagnostics?.endpoint_reason,
              wake_recognition_ms: event.diagnostics?.wake_recognition_ms,
              wake_model: event.diagnostics?.wake_model,
              wake_armed: event.diagnostics?.wake_armed,
              final_confidence: event.diagnostics?.final_confidence,
              average_log_probability: event.diagnostics?.average_log_probability,
              no_speech_probability: event.diagnostics?.no_speech_probability,
              language_probability: event.diagnostics?.language_probability,
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
    if (event.type === "speech_start" && state() === "listening") move("transcribing", "speech_start", turn)
    if (event.type === "discard") setLiveTranscript("")
    if ((event.type === "discard" || event.type === "wake_ignored") && state() === "transcribing") {
      move("listening", event.type, turn)
    }
    const diagnostics = event.diagnostics
    setVoiceDiagnostics((current) => ({
      microphone: microphonePercent(),
      vad:
        event.type === "speech_start"
          ? "speech"
          : event.type === "discard" || event.type === "final" || event.type === "wake_ignored"
            ? "silence"
            : (diagnostics?.vad ?? current.vad),
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
        event.type === "speech_start" ? undefined : (diagnostics?.endpoint_reason ?? current.endpointReason),
      finalConfidence: diagnostics?.final_confidence ?? current.finalConfidence,
      languageProbability: diagnostics?.language_probability ?? current.languageProbability,
    }))
    const text = event.text?.trim() ?? ""
    if (event.type === "wake_ignored") {
      setLiveTranscript("")
      return
    }
    if (event.type === "wake_detected") {
      if (event.command) return
      openWakeFollowup(true)
      setLiveTranscript("")
      duplex?.setState("listening")
      return
    }
    if (event.mode !== "speaking" || (event.type !== "partial" && event.type !== "final")) {
      if (event.type === "final" && text && (state() === "listening" || state() === "transcribing")) {
        bargeInActive = false
        if (event.wake) {
          submitWakeCommand(text, diagnostics)
          return
        }
        acceptTranscript(text, turn, diagnostics)
      }
      return
    }
    if (isLikelySpeechEcho(text, event.reference || speechObserved)) return
    if (wakeArmed() && !extractWakeCommand(text, settings.voice.wakePhrases()).matched) return
    if ((event.diagnostics?.speech_ms ?? 0) < BARGE_IN_MIN_SPEECH_MS) return
    if (!isDeliberateSpeechInterruption(text)) return
    performBargeIn()
    if (event.type !== "final") return
    bargeInActive = false
    acceptTranscript(text, turn, diagnostics)
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
      turn: activeTurn(),
      onEvent: handleDuplexEvent,
      onLevel: (level) => {
        const normalized = Math.min(1, Math.max(0, level))
        setMicrophoneLevel(normalized)
        if (state() === "listening" || state() === "transcribing" || state() === "speaking") {
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
        recordVoice("stt", "echo_reference_compared", {
          diagnostics: {
            ...diagnostics,
            alternatives: diagnostics.alternatives ? JSON.stringify(diagnostics.alternatives) : undefined,
          },
        })
      },
      onUtteranceAudio: (audio) => {
        if (!platform.storeVoiceTurnAudio) return
        const sessionID = props.sessionID() ?? "default"
        void platform
          .storeVoiceTurnAudio({ sessionID, turnID: audio.turnID, pcm: audio.pcm, sampleRate: audio.sampleRate })
          .then((result) =>
            platform.appendVoiceDiagnostic?.({
              sessionID,
              turnID: audio.turnID,
              source: "stt",
              event: "audio_saved",
              generation: audio.turnGeneration,
              durationMs: result.durationMs,
              diagnostics: {
                path: result.path,
                bytes: result.bytes,
                sample_rate: result.sampleRate,
                terminal_event: audio.terminalEvent,
              },
            }),
          )
          .catch((error) => console.warn("[voice-agent] failed to persist turn audio", error))
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
    setLiveTranscript("")
    clearWakePhrase()
    stopDuplex()
    recordVoice("stt", "error", { error: error instanceof Error ? error.message : String(error) })
    orchestrator.cancel("recognition_error")
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
    setLiveTranscript("")
    orchestrator.cancel("voice_disabled")
  })

  async function start(preserveWake = false) {
    if (preserveWake && state() !== "idle") return
    if (state() === "listening" || state() === "transcribing" || state() === "interrupted") {
      handsFree = false
      interrupt("user_interrupt")
      return
    }
    if (state() === "thinking" || state() === "synthesizing") {
      handsFree = false
      interrupt("user_interrupt")
      return
    }
    if (state() === "speaking") {
      interrupt("user_interrupt")
      await start()
      return
    }
    const turn = orchestrator.begin(preserveWake ? "hands_free_restart" : "microphone_start")
    microphoneAccess = (await platform.requestMicrophoneAccess?.().catch(() => "unknown")) ?? "unknown"
    if (!orchestrator.isCurrent(turn)) return
    recordVoice("ui", "microphone_access", { state: microphoneAccess })
    if (microphoneAccess === "denied" || microphoneAccess === "restricted") {
      setLiveTranscript("")
      orchestrator.cancel("microphone_denied")
      showToast({
        title: language.t("voice.error.permission.title"),
        description: language.t("voice.error.permission.description", { error: microphoneAccess }),
        actions:
          platform.os === "macos"
            ? [
                {
                  label: language.t("voice.error.permission.settings"),
                  onClick: () =>
                    platform.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"),
                },
              ]
            : undefined,
      })
      return
    }
    clearTimeout(restartTimer)
    speechGeneration += 1
    voiceTurnSubmittedAt = undefined
    responseParentID = undefined
    submittedAt = undefined
    submittedTranscript = ""
    responseStartedForTurn = false
    responseCompletedForTurn = false
    microphoneTrace = []
    stopSpeech()
    handsFree = settings.voice.handsFree()
    if (!preserveWake) armWakePhrase()
    setLiveTranscript("")
    setVoiceDiagnostics({ microphone: 0, vad: "silence", phase: "ready" })
    recordVoice("agent", "listening_started", {
      diagnostics: {
        hands_free: handsFree,
        language: voiceLanguage(document.documentElement.lang, navigator.language),
      },
    })
    await ensureDuplex().catch(failRecognition)
    if (!orchestrator.isCurrent(turn)) return
    duplex?.setTurn(turn)
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
    queueMicrotask(() => void start(true))
  })

  onCleanup(() => {
    handsFree = false
    clearTimeout(responseTimer)
    clearTimeout(restartTimer)
    clearInterval(watchdogTimer)
    clearWakePhrase()
    stopDuplex()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    setLiveTranscript("")
    orchestrator.cancel("component_cleanup")
    props.onStatusChange?.(undefined)
  })

  const label = () => language.t(`voice.action.${state()}`)
  const status = () => {
    const value = language.t(
      `voice.status.${state() as "listening" | "transcribing" | "thinking" | "synthesizing" | "speaking" | "interrupted"}`,
    )
    const transcript = liveTranscript().trim()
    if (state() === "listening" && wakeArmed()) return language.t("voice.status.wake")
    if (state() === "listening" && wakeActivated() && !transcript) return language.t("voice.status.wakeActivated")
    if (!transcript || (state() !== "listening" && state() !== "transcribing" && state() !== "speaking")) return value
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
                  "bg-icon-info-base": status().state === "listening" || status().state === "transcribing",
                  "bg-icon-warning-base":
                    status().state === "thinking" ||
                    status().state === "synthesizing" ||
                    status().state === "interrupted",
                  "bg-icon-success-base": status().state === "speaking",
                }}
              />
              <span
                class="relative inline-flex size-2 rounded-full"
                classList={{
                  "bg-icon-info-base": status().state === "listening" || status().state === "transcribing",
                  "bg-icon-warning-base":
                    status().state === "thinking" ||
                    status().state === "synthesizing" ||
                    status().state === "interrupted",
                  "bg-icon-success-base": status().state === "speaking",
                }}
              />
            </span>
            <span class="min-w-0 truncate">{status().text}</span>
          </div>
          <Show when={status().diagnostics}>
            {(diagnostics) => (
              <div class="flex flex-wrap gap-x-3 gap-y-0.5 pl-4 text-11-regular text-text-weaker">
                <span>
                  {language.t("voice.diagnostics.microphone")} {diagnostics().microphone}%
                </span>
                <span>VAD {vadLabel(diagnostics().vad)}</span>
                <span>STT {phaseLabel(diagnostics().phase)}</span>
                <Show when={diagnostics().preRollMs}>
                  {(value) => (
                    <span>
                      {language.t("voice.diagnostics.preRoll")} {value()} ms
                    </span>
                  )}
                </Show>
                <Show when={diagnostics().transcriptionMs !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.latency")} {diagnostics().transcriptionMs} ms
                  </span>
                </Show>
                <Show when={diagnostics().transcriptionCache}>
                  {(value) => (
                    <span>
                      {language.t("voice.diagnostics.cache")} {value()}
                    </span>
                  )}
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
                  <span>
                    {language.t("voice.diagnostics.firstSound")} {Math.round(diagnostics().firstSoundMs!)} ms
                  </span>
                </Show>
                <Show when={diagnostics().ttsBufferedMs !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.buffered")} {Math.round(diagnostics().ttsBufferedMs!)} ms
                  </span>
                </Show>
                <Show when={diagnostics().ttsUnderruns !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.underruns")} {diagnostics().ttsUnderruns}
                  </span>
                </Show>
                <Show when={diagnostics().echoReferencePercent !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.echo")} {diagnostics().echoReferencePercent}% →{" "}
                    {diagnostics().echoResidualPercent}%
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
                  {(value) => (
                    <span>
                      {language.t("voice.diagnostics.endpoint")} {endpointLabel(value())}
                    </span>
                  )}
                </Show>
                <Show when={diagnostics().finalConfidence !== undefined}>
                  <span>
                    {language.t("voice.diagnostics.confidence")} {Math.round(diagnostics().finalConfidence! * 100)}%
                  </span>
                </Show>
                <Show when={diagnostics().intent}>
                  {(value) => (
                    <span>
                      {language.t("voice.diagnostics.intent")} {value()}
                    </span>
                  )}
                </Show>
                <Show when={diagnostics().understandingDecision}>
                  {(value) => (
                    <span>
                      {language.t("voice.diagnostics.admission")} {value()}
                    </span>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}
