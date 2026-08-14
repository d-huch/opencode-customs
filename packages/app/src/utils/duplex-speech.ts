export type DuplexSpeechMode = "paused" | "listening" | "speaking"

export type DuplexSpeechDiagnostics = {
  vad?: "speech" | "silence"
  audio_ms?: number
  speech_ms?: number
  silence_ms?: number
  pre_roll_ms?: number
  transcription_ms?: number
  transcription_cache?: "hit" | "miss"
  incremental_decode?: boolean
  decode_count?: number
  decoded_audio_ms?: number
  committed_audio_ms?: number
  partial_count?: number
  frame_rms?: number
  peak_rms?: number
  min_rms?: number
  recognition_model?: string
  transcript_stability?: number
  endpoint_reason?: string
  wake_recognition_ms?: number
  wake_model?: string
  wake_armed?: boolean
  final_confidence?: number
  average_log_probability?: number
  no_speech_probability?: number
  language_probability?: number
  alternatives?: { text: string; confidence?: number }[]
  echo_input_rms?: number
  echo_reference_rms?: number
  echo_residual_rms?: number
  echo_coherence?: number
  echo_suppression_db?: number
  echo_delay_ms?: number
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
  turn_id?: string
  turn_generation?: number
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
  onEcho?: (diagnostics: DuplexSpeechDiagnostics) => void
  onUtteranceAudio?: (input: {
    turnID: string
    turnGeneration?: number
    pcm: ArrayBuffer
    sampleRate: number
    terminalEvent: "final" | "discard" | "wake_ignored"
  }) => void
  onError: (error: Error) => void
  wake?: DuplexWakeConfig
  turn?: { id: string; generation: number }
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

const echoProcessorSource = `
class OpenCodeEchoProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.reference = new Float32Array(Math.max(16384, Math.ceil(sampleRate * 0.35)))
    this.referenceOffset = 0
    this.pending = new Float32Array(2048)
    this.pendingOffset = 0
    this.delay = Math.round(sampleRate * 0.04)
    this.gain = 0
    this.tick = 0
  }

  referenceAt(blockLength, sample, delay) {
    const index = this.referenceOffset - blockLength + sample - delay
    return this.reference[(index % this.reference.length + this.reference.length) % this.reference.length]
  }

  process(inputs, outputs) {
    const microphone = inputs[0][0]
    const playback = inputs[1][0]
    const output = outputs[0][0]
    if (output) output.fill(0)
    if (!microphone) return true
    for (let index = 0; index < microphone.length; index += 1) {
      this.reference[this.referenceOffset] = playback?.[index] ?? 0
      this.referenceOffset = (this.referenceOffset + 1) % this.reference.length
    }

    let bestDelay = this.delay
    let bestCoherence = 0
    let bestGain = 0
    let inputEnergy = 0
    let referenceEnergy = 0
    for (let index = 0; index < microphone.length; index += 1) inputEnergy += microphone[index] * microphone[index]
    for (let delay = Math.round(sampleRate * 0.004); delay <= Math.round(sampleRate * 0.14); delay += 64) {
      let dot = 0
      let micEnergy = 0
      let refEnergy = 0
      for (let index = 0; index < microphone.length; index += 4) {
        const mic = microphone[index]
        const ref = this.referenceAt(microphone.length, index, delay)
        dot += mic * ref
        micEnergy += mic * mic
        refEnergy += ref * ref
      }
      const coherence = Math.abs(dot) / Math.sqrt(Math.max(1e-12, micEnergy * refEnergy))
      if (coherence <= bestCoherence) continue
      bestCoherence = coherence
      bestDelay = delay
      bestGain = dot / Math.max(1e-12, refEnergy)
      referenceEnergy = refEnergy
    }
    const active = bestCoherence >= 0.38 && referenceEnergy / Math.ceil(microphone.length / 4) >= 0.000009
    this.delay = active ? Math.round(this.delay * 0.75 + bestDelay * 0.25) : this.delay
    this.gain = active ? this.gain * 0.7 + Math.max(-2, Math.min(2, bestGain)) * 0.3 : this.gain * 0.6
    let residualEnergy = 0
    for (let index = 0; index < microphone.length; index += 1) {
      const sample = microphone[index] - this.referenceAt(microphone.length, index, this.delay) * this.gain
      residualEnergy += sample * sample
      this.pending[this.pendingOffset++] = sample
      if (this.pendingOffset !== this.pending.length) continue
      const samples = this.pending
      this.pending = new Float32Array(2048)
      this.pendingOffset = 0
      this.port.postMessage({ type: "audio", samples }, [samples.buffer])
    }
    this.tick += 1
    if (this.tick % 32 !== 0) return true
    const inputRms = Math.sqrt(inputEnergy / Math.max(1, microphone.length))
    const referenceRms = Math.sqrt((referenceEnergy * 4) / Math.max(1, microphone.length))
    const residualRms = Math.sqrt(residualEnergy / Math.max(1, microphone.length))
    this.port.postMessage({
      type: "echo",
      inputRms,
      referenceRms,
      residualRms,
      coherence: bestCoherence,
      suppressionDb: 20 * Math.log10(Math.max(1e-6, inputRms) / Math.max(1e-6, residualRms)),
      delayMs: this.delay / sampleRate * 1000,
    })
    return true
  }
}
registerProcessor("opencode-echo-canceller", OpenCodeEchoProcessor)
`

export function createLocalDuplexSpeech(options: DuplexSpeechOptions) {
  let socket: WebSocket | undefined
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: AudioWorkletNode | undefined
  let sink: GainNode | undefined
  let playbackReference: AudioNode | undefined
  let mode: DuplexSpeechMode = "paused"
  let reference = ""
  let ready: Promise<void> | undefined
  let wake = options.wake ?? { enabled: false, armed: false, phrases: [] }
  let turn = options.turn
  const preRoll: Int16Array[] = []
  let preRollSamples = 0
  let utterance: Int16Array[] = []
  let utteranceSamples = 0
  let utteranceTurn: { id: string; generation?: number } | undefined

  const sendState = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(
      JSON.stringify({
        type: "state",
        mode,
        reference,
        turn_id: turn?.id,
        turn_generation: turn?.generation,
      }),
    )
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
    playbackReference = undefined
    ready = undefined
    preRoll.length = 0
    preRollSamples = 0
    utterance = []
    utteranceSamples = 0
    utteranceTurn = undefined
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
      const processorURL = URL.createObjectURL(new Blob([echoProcessorSource], { type: "text/javascript" }))
      await context.audioWorklet.addModule(processorURL).finally(() => URL.revokeObjectURL(processorURL))
      processor = new AudioWorkletNode(context, "opencode-echo-canceller", {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      sink = context.createGain()
      sink.gain.value = 0
      source.connect(processor, 0, 0)
      playbackReference?.connect(processor, 0, 1)
      processor.connect(sink)
      sink.connect(context.destination)

      socket = new WebSocket(localSTTWebSocketURL(options.endpoint))
      socket.binaryType = "arraybuffer"
      processor.port.onmessage = (event: MessageEvent<{
        type: "audio" | "echo"
        samples?: Float32Array
        inputRms?: number
        referenceRms?: number
        residualRms?: number
        coherence?: number
        suppressionDb?: number
        delayMs?: number
      }>) => {
        if (event.data.type === "echo") {
          options.onEcho?.({
            echo_input_rms: event.data.inputRms,
            echo_reference_rms: event.data.referenceRms,
            echo_residual_rms: event.data.residualRms,
            echo_coherence: event.data.coherence,
            echo_suppression_db: event.data.suppressionDb,
            echo_delay_ms: event.data.delayMs,
          })
          return
        }
        const samples = event.data.samples
        if (!samples) return
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
        options.onLevel(Math.min(1, rms / 0.09))
        const pcm = resamplePCM16(samples, context?.sampleRate ?? 48_000)
        preRoll.push(pcm)
        preRollSamples += pcm.length
        while (preRollSamples > 24_000 && preRoll.length > 1) preRollSamples -= preRoll.shift()!.length
        if (utteranceTurn && utteranceSamples < 16_000 * 120) {
          utterance.push(pcm)
          utteranceSamples += pcm.length
        }
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
              turn_id: turn?.id,
              turn_generation: turn?.generation,
            }),
          )
          preRoll.forEach((chunk) => socket?.send(chunk))
          sendState()
        }
        socket.onmessage = (message) => {
          if (typeof message.data !== "string") return
          const event = JSON.parse(message.data) as DuplexSpeechEvent
          if (event.type === "speech_start") {
            utterance = preRoll.map((chunk) => chunk.slice())
            utteranceSamples = utterance.reduce((total, chunk) => total + chunk.length, 0)
            const id = event.turn_id ?? turn?.id
            utteranceTurn = id ? { id, generation: event.turn_generation ?? turn?.generation } : undefined
          }
          options.onEvent(event)
          if (
            utteranceTurn &&
            (event.type === "final" || event.type === "discard" || event.type === "wake_ignored")
          ) {
            const pcm = new Int16Array(utteranceSamples)
            utterance.reduce((offset, chunk) => {
              pcm.set(chunk, offset)
              return offset + chunk.length
            }, 0)
            options.onUtteranceAudio?.({
              turnID: utteranceTurn.id,
              turnGeneration: utteranceTurn.generation,
              pcm: pcm.buffer,
              sampleRate: 16_000,
              terminalEvent: event.type,
            })
            utterance = []
            utteranceSamples = 0
            utteranceTurn = undefined
          }
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
    audioContext() {
      return context
    },
    setPlaybackReference(node: AudioNode | undefined) {
      playbackReference = node
      if (!processor || !playbackReference) return
      playbackReference.connect(processor, 0, 1)
    },
    setState(next: DuplexSpeechMode, spoken = "") {
      mode = next
      reference = spoken
      sendState()
    },
    setTurn(next: { id: string; generation: number } | undefined) {
      turn = next
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
