export type DuplexSpeechMode = "paused" | "listening" | "speaking"

export type DuplexSpeechDiagnostics = {
  vad?: "speech" | "silence"
  audio_ms?: number
  speech_ms?: number
  silence_ms?: number
  pre_roll_ms?: number
  transcription_ms?: number
  transcript_stability?: number
  endpoint_reason?: string
  wake_recognition_ms?: number
  wake_model?: string
  wake_armed?: boolean
}

export type DuplexSpeechEvent = {
  type:
    | "ready"
    | "configured"
    | "state"
    | "wake_state"
    | "wake_detected"
    | "wake_ignored"
    | "speech_start"
    | "partial"
    | "final"
    | "discard"
    | "error"
  text?: string
  error?: string
  mode?: DuplexSpeechMode
  reference?: string
  generation?: number
  ready?: boolean
  pre_roll_ms?: number
  phrase?: string
  confidence?: number
  command?: boolean
  wake?: boolean
  wake_enabled?: boolean
  wake_armed?: boolean
  diagnostics?: DuplexSpeechDiagnostics
}

type DuplexWakeConfig = {
  enabled: boolean
  armed: boolean
  phrases: string[]
}

type DuplexSpeechOptions = {
  endpoint: string
  language: string
  onEvent: (event: DuplexSpeechEvent) => void
  onLevel: (level: number) => void
  onError: (error: Error) => void
  wake?: DuplexWakeConfig
}

export function localSTTWebSocketURL(endpoint: string) {
  const url = new URL(endpoint)
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Local STT endpoint must use localhost, 127.0.0.1, or ::1.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local STT endpoint must use HTTP or HTTPS.")
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/v1/audio/transcriptions/stream"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export function resamplePCM16(input: Float32Array, sourceRate: number, targetRate = 16_000) {
  if (sourceRate <= 0 || targetRate <= 0) throw new Error("Audio sample rates must be positive.")
  const length = Math.max(1, Math.round((input.length * targetRate) / sourceRate))
  const output = new Int16Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = (index * (input.length - 1)) / Math.max(1, length - 1)
    const left = Math.floor(position)
    const right = Math.min(input.length - 1, left + 1)
    const sample = input[left]! + (input[right]! - input[left]!) * (position - left)
    output[index] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767)
  }
  return output
}

export function createLocalDuplexSpeech(options: DuplexSpeechOptions) {
  let socket: WebSocket | undefined
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let sink: GainNode | undefined
  let mode: DuplexSpeechMode = "paused"
  let reference = ""
  let ready: Promise<void> | undefined
  let wake = options.wake ?? { enabled: false, armed: false, phrases: [] }
  const preRoll: Int16Array[] = []
  let preRollSamples = 0

  const sendState = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: "state", mode, reference }))
  }


  const sendWake = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: "wake", ...wake }))
  }

  const stop = () => {
    processor?.disconnect()
    source?.disconnect()
    sink?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close(1000)
    if (context) void context.close()
    socket = undefined
    stream = undefined
    context = undefined
    source = undefined
    processor = undefined
    sink = undefined
    ready = undefined
    preRoll.length = 0
    preRollSamples = 0
    options.onLevel(0)
  }

  const start = () => {
    if (ready) return ready
    ready = (async () => {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      context = new AudioContext({ latencyHint: "interactive" })
      await context.resume()
      source = context.createMediaStreamSource(stream)
      processor = context.createScriptProcessor(2048, 1, 1)
      sink = context.createGain()
      sink.gain.value = 0
      source.connect(processor)
      processor.connect(sink)
      sink.connect(context.destination)

      socket = new WebSocket(localSTTWebSocketURL(options.endpoint))
      socket.binaryType = "arraybuffer"
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0)
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
        options.onLevel(Math.min(1, rms / 0.09))
        const pcm = resamplePCM16(samples, context?.sampleRate ?? 48_000)
        preRoll.push(pcm)
        preRollSamples += pcm.length
        while (preRollSamples > 24_000 && preRoll.length > 1) preRollSamples -= preRoll.shift()!.length
        if (socket?.readyState === WebSocket.OPEN) socket.send(pcm)
      }

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Local streaming STT did not become ready within 15 seconds.")), 15_000)
        if (!socket) return reject(new Error("Local streaming STT socket was not created."))
        socket.onopen = () => {
          socket?.send(
            JSON.stringify({
              type: "configure",
              language: options.language,
              sample_rate: 16_000,
              wake_enabled: wake.enabled,
              wake_armed: wake.armed,
              wake_phrases: wake.phrases,
            }),
          )
          preRoll.forEach((chunk) => socket?.send(chunk))
          sendState()
        }
        socket.onmessage = (message) => {
          if (typeof message.data !== "string") return
          const event = JSON.parse(message.data) as DuplexSpeechEvent
          options.onEvent(event)
          if (event.type !== "ready") return
          if (event.ready === false) {
            clearTimeout(timeout)
            reject(new Error(event.error || "The local STT model is unavailable."))
            return
          }
          clearTimeout(timeout)
          resolve()
        }
        socket.onerror = () => {
          clearTimeout(timeout)
          reject(new Error("Could not connect to the local streaming STT backend."))
        }
        socket.onclose = (event) => {
          if (event.code === 1000) return
          options.onError(new Error(`Local streaming STT disconnected (${event.code}).`))
        }
      })
    })().catch((error: unknown) => {
      stop()
      throw error
    })
    return ready
  }

  return {
    start,
    stop,
    setState(next: DuplexSpeechMode, spoken = "") {
      mode = next
      reference = spoken
      sendState()
    },
    setWake(next: DuplexWakeConfig) {
      wake = {
        enabled: next.enabled,
        armed: next.enabled && next.armed,
        phrases: next.phrases.map((item) => item.trim()).filter(Boolean).slice(0, 8),
      }
      sendWake()
    },
    flush() {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "flush" }))
    },
  }
}
