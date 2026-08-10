import { Button } from "@opencode-ai/ui/button"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform, type MicrophoneAccess, type SpeechRecognitionEvent } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { getSpeechRecognitionCtor } from "@/utils/runtime-adapters"
import { showToast } from "@/utils/toast"
import { bargeInLevelThreshold, speechText, streamingSpeechChunks, voiceLanguage } from "@/utils/voice-agent"

type RecognitionResult = {
  isFinal: boolean
  readonly length: number
  [index: number]: { transcript: string } | undefined
}

type RecognitionEvent = {
  readonly resultIndex: number
  readonly results: {
    readonly length: number
    [index: number]: RecognitionResult | undefined
  }
}

type RecognitionErrorEvent = {
  error: string
}

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

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
  const synthesizeSpeech = (text: string) => {
    if (!platform.synthesizeLocalSpeech) {
      return Promise.reject(new Error("The local TTS bridge is unavailable in this application build."))
    }
    return platform.synthesizeLocalSpeech({
      endpoint: settings.voice.ttsEndpoint(),
      model: settings.voice.ttsModel(),
      voice: settings.voice.ttsVoice(),
      mode: settings.voice.ttsMode(),
      text,
    })
  }
  const [state, setState] = createSignal<"idle" | "listening" | "thinking" | "synthesizing" | "speaking">("idle")
  const [microphoneLevel, setMicrophoneLevel] = createSignal(0)
  const [liveTranscript, setLiveTranscript] = createSignal("")
  const [waiting, setWaiting] = createSignal(false)
  let recognition: Recognition | undefined
  let handsFree = false
  let responseBeforeSubmit: string | undefined
  let responseTimer: ReturnType<typeof setTimeout> | undefined
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let recognitionTimer: ReturnType<typeof setTimeout> | undefined
  let speechGeneration = 0
  let speechAudio: HTMLAudioElement | undefined
  let speechAudioURL: string | undefined
  let speechQueue: string[] = []
  let speechBuffer = ""
  let speechObserved = ""
  let speechMessageID: string | undefined
  let speechFinal = false
  let speechBusy = false
  let speechPrefetch:
    | {
        generation: number
        text: string
        result: ReturnType<typeof synthesizeSpeech>
      }
    | undefined
  let nativeGeneration = 0
  let recognitionPurpose: "input" | undefined
  let bargeArmedAt = 0
  let bargeMonitorGeneration = 0
  let bargeStream: MediaStream | undefined
  let bargeContext: AudioContext | undefined
  let bargeFrame: number | undefined
  let observedSessionID: string | undefined
  let observedAssistantID: string | undefined
  let passiveSpeechMessageID: string | undefined
  let microphoneAccess: MicrophoneAccess = "unknown"
  const unsubscribeLevel = platform.onSpeechRecognitionLevel?.((level) => {
    setMicrophoneLevel(Math.min(1, Math.max(0, level)))
  })
  const unsubscribeRecognition = platform.onSpeechRecognitionEvent?.(handleRecognitionEvent)

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

  const restart = () => {
    clearTimeout(restartTimer)
    if (!handsFree || !settings.voice.enabled()) {
      setState("idle")
      return
    }
    setState("idle")
    setLiveTranscript("")
    restartTimer = setTimeout(start, 250)
  }

  const stopSpeech = () => {
    stopBargeInMonitor()
    void platform.cancelLocalSpeech?.()
    if (speechAudio) {
      speechAudio.onplay = null
      speechAudio.onended = null
      speechAudio.onerror = null
      speechAudio.pause()
      speechAudio.removeAttribute("src")
      speechAudio.load()
      speechAudio = undefined
    }
    if (!speechAudioURL) return
    URL.revokeObjectURL(speechAudioURL)
    speechAudioURL = undefined
  }

  const resetSpeechStream = () => {
    speechQueue = []
    speechBuffer = ""
    speechObserved = ""
    speechMessageID = undefined
    speechFinal = false
    speechBusy = false
    speechPrefetch = undefined
  }

  const failSpeech = (generation: number, error: unknown) => {
    if (generation !== speechGeneration) return
    stopSpeech()
    resetSpeechStream()
    setWaiting(false)
    responseBeforeSubmit = undefined
    clearTimeout(responseTimer)
    handsFree = false
    setState("idle")
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
    clearTimeout(recognitionTimer)
    nativeGeneration += 1
    recognitionPurpose = undefined
    void platform.stopSpeechRecognition?.()
    stopRecognition()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
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
    }
    speechBuffer = `${speechBuffer}${text.slice(speechObserved.length)}`
    speechObserved = text
    const next = streamingSpeechChunks(speechBuffer, final)
    speechQueue.push(...next.chunks)
    speechBuffer = next.remainder
    speechFinal = final
    if (speechBusy) prefetchSpeech()
    void drainSpeech()
  }

  const prefetchSpeech = () => {
    if (!speechBusy || speechPrefetch || !platform.synthesizeLocalSpeech) return
    const text = speechQueue[0]
    if (!text) return
    const result = synthesizeSpeech(text)
    void result.catch(() => undefined)
    speechPrefetch = {
      generation: speechGeneration,
      text,
      result,
    }
  }

  const drainSpeech = async () => {
    if (speechBusy) return
    const text = speechQueue.shift()
    if (!text) {
      if (speechFinal) restart()
      else setState("thinking")
      return
    }
    const generation = speechGeneration
    speechBusy = true
    setState("synthesizing")
    if (!platform.synthesizeLocalSpeech) {
      failSpeech(generation, new Error("The local TTS bridge is unavailable in this application build."))
      return
    }
    const prefetched =
      speechPrefetch?.generation === generation && speechPrefetch.text === text ? speechPrefetch.result : undefined
    speechPrefetch = undefined
    const audioBlob = await (prefetched ?? synthesizeSpeech(text))
      .catch((error: unknown) => {
        failSpeech(generation, error)
        return undefined
      })
    if (!audioBlob || generation !== speechGeneration) return
    speechAudioURL = URL.createObjectURL(audioBlob.audio)
    speechAudio = new Audio(speechAudioURL)
    speechAudio.onplay = () => {
      setState("speaking")
      bargeArmedAt = Date.now() + 500
      void startBargeIn()
      prefetchSpeech()
      console.info("[voice-agent] audio playback started", { generation, textLength: text.length })
    }
    speechAudio.onended = () => {
      if (generation !== speechGeneration) return
      nativeGeneration += 1
      recognitionPurpose = undefined
      void platform.stopSpeechRecognition?.()
      stopSpeech()
      speechBusy = false
      console.info("[voice-agent] audio playback completed", { generation })
      void drainSpeech()
    }
    speechAudio.onerror = () => {
      console.error("[voice-agent] audio playback failed", { generation, error: speechAudio?.error })
      failSpeech(generation, new Error("The generated audio could not be played."))
    }
    await speechAudio.play().catch((error: unknown) => failSpeech(generation, error))
  }

  const acceptTranscript = (text: string) => {
    setLiveTranscript("")
    props.onTranscript(text)
    if (!settings.voice.autoSubmit()) {
      setState("idle")
      return
    }
    responseBeforeSubmit = latestAssistant()?.id
    setWaiting(true)
    setState("thinking")
    recognition?.stop()
    clearTimeout(responseTimer)
    responseTimer = setTimeout(() => {
      if (!waiting()) return
      setWaiting(false)
      handsFree = false
      setState("idle")
      showToast({
        title: language.t("voice.error.timeout.title"),
        description: language.t("voice.error.timeout.description"),
      })
    }, 300_000)
    queueMicrotask(props.onSubmit)
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

  function handleRecognitionEvent(event: SpeechRecognitionEvent) {
    if (event.text && recognitionPurpose === "input") setLiveTranscript(event.text)
  }

  function performBargeIn() {
    if (state() !== "speaking") return
    console.info("[voice-agent] barge-in detected; stopping playback before recognition")
    nativeGeneration += 1
    recognitionPurpose = undefined
    void platform.stopSpeechRecognition?.()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    if (props.working()) props.onInterrupt()
    handsFree = true
    setLiveTranscript("")
    setState("idle")
    restartTimer = setTimeout(() => void start(), 80)
  }

  async function startBargeIn() {
    if (!handsFree || state() !== "speaking" || !navigator.mediaDevices?.getUserMedia) return
    stopBargeInMonitor()
    const generation = ++bargeMonitorGeneration
    const stream = await navigator.mediaDevices
      .getUserMedia({
        audio: {
          autoGainControl: false,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      .catch((error: unknown) => {
        console.warn("[voice-agent] echo-cancelled barge-in monitor is unavailable", error)
        return undefined
      })
    if (!stream) return
    if (generation !== bargeMonitorGeneration || state() !== "speaking") {
      stream.getTracks().forEach((track) => track.stop())
      return
    }

    const context = new AudioContext({ latencyHint: "interactive" })
    await context.resume().catch((error: unknown) => {
      console.warn("[voice-agent] could not start the barge-in audio monitor", error)
    })
    if (context.state !== "running") {
      stream.getTracks().forEach((track) => track.stop())
      void context.close()
      return
    }
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.15
    context.createMediaStreamSource(stream).connect(analyser)
    bargeStream = stream
    bargeContext = context
    const samples = new Float32Array(analyser.fftSize)
    let noiseFloor = 0.004
    let voiceStartedAt = 0

    const monitor = () => {
      if (generation !== bargeMonitorGeneration || state() !== "speaking") return
      analyser.getFloatTimeDomainData(samples)
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
      setMicrophoneLevel(Math.min(1, rms / 0.09))
      const now = performance.now()
      const armed = Date.now() >= bargeArmedAt
      const threshold = bargeInLevelThreshold(noiseFloor)
      if (!armed || rms < threshold) {
        voiceStartedAt = 0
        noiseFloor = noiseFloor * 0.94 + Math.min(rms, 0.018) * 0.06
      }
      if (armed && rms >= threshold) {
        voiceStartedAt ||= now
        if (now - voiceStartedAt >= 180) {
          performBargeIn()
          return
        }
      }
      bargeFrame = requestAnimationFrame(monitor)
    }
    bargeFrame = requestAnimationFrame(monitor)
  }

  function stopBargeInMonitor() {
    bargeMonitorGeneration += 1
    if (bargeFrame !== undefined) cancelAnimationFrame(bargeFrame)
    bargeFrame = undefined
    bargeStream?.getTracks().forEach((track) => track.stop())
    bargeStream = undefined
    if (bargeContext) void bargeContext.close()
    bargeContext = undefined
  }

  createEffect(() => {
    if (settings.voice.enabled()) return
    handsFree = false
    setWaiting(false)
    clearTimeout(responseTimer)
    clearTimeout(restartTimer)
    clearTimeout(recognitionTimer)
    nativeGeneration += 1
    recognitionPurpose = undefined
    void platform.stopSpeechRecognition?.()
    stopRecognition()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    setState("idle")
  })

  async function start() {
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
    stopSpeech()
    handsFree = settings.voice.handsFree()
    stopRecognition()
    if (platform.recognizeSpeech) {
      const generation = ++nativeGeneration
      recognitionPurpose = "input"
      setLiveTranscript("")
      setState("listening")
      const native = platform.recognizeSpeech(voiceLanguage(document.documentElement.lang, navigator.language))
      const timeout = new Promise<string>((_resolve, reject) => {
        recognitionTimer = setTimeout(() => {
          void platform.stopSpeechRecognition?.()
          reject(new Error(language.t("voice.error.listenTimeout.description")))
        }, 20_000)
      })
      const text = await Promise.race([native, timeout])
        .catch((error: unknown) => {
          if (generation !== nativeGeneration) return ""
          handsFree = false
          setState("idle")
          showToast({
            title: language.t("voice.error.service.title"),
            description: language.t("voice.error.service.description", {
              error:
                error instanceof Error
                  ? error.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
                  : String(error),
            }),
          })
          return ""
        })
      clearTimeout(recognitionTimer)
      if (generation !== nativeGeneration) return
      nativeGeneration += 1
      recognitionPurpose = undefined
      if (!text.trim()) {
        if (handsFree) {
          restart()
          return
        }
        setState("idle")
        showToast({
          title: language.t("voice.error.noSpeech.title"),
          description: language.t("voice.error.noSpeech.description"),
        })
        return
      }
      acceptTranscript(text.trim())
      return
    }
    const Recognition = getSpeechRecognitionCtor<Recognition>(window)
    if (!Recognition) {
      showToast({
        title: language.t("voice.error.unsupported.title"),
        description: language.t("voice.error.unsupported.description"),
      })
      return
    }
    recognition = new Recognition()
    recognition.lang = voiceLanguage(document.documentElement.lang, navigator.language)
    recognition.continuous = false
    recognition.interimResults = true
    recognition.onstart = () => setState("listening")
    recognition.onresult = (event) => {
      const results = Array.from(
        { length: event.results.length - event.resultIndex },
        (_, index) => event.results[event.resultIndex + index],
      )
      setLiveTranscript(
        results
          .map((result) => result?.[0]?.transcript.trim() ?? "")
          .filter(Boolean)
          .join(" "),
      )
      const text = results
        .filter((result): result is RecognitionResult => !!result?.isFinal)
        .map((result) => result[0]?.transcript.trim() ?? "")
        .filter(Boolean)
        .join(" ")
      if (!text) return
      acceptTranscript(text)
    }
    recognition.onerror = (event) => {
      handsFree = false
      setState("idle")
      const serviceDenied =
        microphoneAccess === "granted" && (event.error === "not-allowed" || event.error === "service-not-allowed")
      showToast({
        title: language.t(serviceDenied ? "voice.error.service.title" : "voice.error.permission.title"),
        description: language.t(
          serviceDenied ? "voice.error.service.description" : "voice.error.permission.description",
          { error: event.error },
        ),
      })
    }
    recognition.onend = () => {
      if (waiting() || state() === "speaking") return
      setState("idle")
    }
    recognition.start()
  }

  function stopRecognition() {
    if (!recognition) return
    recognition.onstart = null
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.abort()
    recognition = undefined
  }

  onCleanup(() => {
    handsFree = false
    clearTimeout(responseTimer)
    clearTimeout(restartTimer)
    clearTimeout(recognitionTimer)
    unsubscribeLevel?.()
    unsubscribeRecognition?.()
    nativeGeneration += 1
    recognitionPurpose = undefined
    void platform.stopSpeechRecognition?.()
    stopRecognition()
    speechGeneration += 1
    stopSpeech()
    resetSpeechStream()
    props.onStatusChange?.(undefined)
  })

  const label = () => language.t(`voice.action.${state()}`)
  const status = () => {
    const value = language.t(`voice.status.${state() as "listening" | "thinking" | "synthesizing" | "speaking"}`)
    const transcript = liveTranscript().trim()
    if (!transcript || (state() !== "listening" && state() !== "speaking")) return value
    return `${value} “${transcript.slice(0, 80)}${transcript.length > 80 ? "…" : ""}”`
  }

  createEffect(() => {
    const current = state()
    if (current === "idle") {
      props.onStatusChange?.(undefined)
      return
    }
    props.onStatusChange?.({ state: current, text: status() })
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
  return (
    <Show when={props.status}>
      {(status) => (
        <div
          data-component="voice-agent-chat-status"
          role="status"
          aria-live="polite"
          class="flex min-w-0 items-center gap-2 self-start px-3 py-1 text-13-regular text-text-weak"
        >
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
      )}
    </Show>
  )
}
