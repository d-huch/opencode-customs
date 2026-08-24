import type { NemotronVoiceEvent, Platform } from "@/context/platform"

export function createNemotronDuplex(input: {
  platform: Platform
  requestID: string
  systemPrompt?: string
  onEvent(event: NemotronVoiceEvent): void
  onLevel(level: number): void
}) {
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let unsubscribe: (() => void) | undefined
  let nextPlaybackAt = 0

  const play = (audio: ArrayBuffer, sampleRate: number) => {
    const current = context
    if (!current) return
    const pcm = new Int16Array(audio)
    const buffer = current.createBuffer(1, pcm.length, sampleRate)
    const channel = buffer.getChannelData(0)
    pcm.forEach((value, index) => (channel[index] = value / 32768))
    const playback = current.createBufferSource()
    playback.buffer = buffer
    playback.connect(current.destination)
    const at = Math.max(current.currentTime + 0.02, nextPlaybackAt)
    playback.start(at)
    nextPlaybackAt = at + buffer.duration
  }

  const stopGraph = () => {
    processor?.disconnect()
    source?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
    void context?.close()
    processor = undefined
    source = undefined
    stream = undefined
    context = undefined
    unsubscribe?.()
    unsubscribe = undefined
  }

  return {
    async start() {
      if (!input.platform.beginNemotronVoice || !input.platform.appendNemotronVoice || !input.platform.onNemotronVoiceEvent) {
        throw new Error("Nemotron realtime voice is unavailable on this platform")
      }
      await input.platform.configureNemotronVoice?.({ engine: "nemotron", systemPrompt: input.systemPrompt })
      await input.platform.beginNemotronVoice({
        owner: "desktop",
        requestID: input.requestID,
        systemPrompt: input.systemPrompt,
      })
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      context = new AudioContext()
      source = context.createMediaStreamSource(stream)
      processor = context.createScriptProcessor(2048, 1, 1)
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0)
        const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length))
        input.onLevel(Math.min(1, level * 8))
        const pcm = resample(samples, event.inputBuffer.sampleRate, 16000)
        input.platform.appendNemotronVoice?.({ requestID: input.requestID, pcm: pcm.buffer, sampleRate: 16000 })
      }
      source.connect(processor)
      processor.connect(context.destination)
      unsubscribe = input.platform.onNemotronVoiceEvent((event) => {
        if ("requestID" in event && event.requestID !== input.requestID) return
        if (event.type === "audio.delta") play(event.audio, event.sampleRate)
        input.onEvent(event)
      })
    },
    async commit() {
      processor?.disconnect()
      source?.disconnect()
      stream?.getTracks().forEach((track) => track.stop())
      input.onLevel(0)
      await input.platform.commitNemotronVoice?.(input.requestID)
    },
    async cancel() {
      stopGraph()
      await input.platform.cancelNemotronVoice?.(input.requestID)
    },
    stop: stopGraph,
  }
}

function resample(input: Float32Array, sourceRate: number, targetRate: number) {
  const output = new Int16Array(Math.max(1, Math.floor(input.length * targetRate / sourceRate)))
  output.forEach((_, index) => {
    const position = index * sourceRate / targetRate
    const left = Math.min(input.length - 1, Math.floor(position))
    const right = Math.min(input.length - 1, left + 1)
    const sample = input[left] + (input[right] - input[left]) * (position - left)
    output[index] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767)
  })
  return output
}
