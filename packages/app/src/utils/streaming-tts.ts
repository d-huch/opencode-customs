export type StreamingSpeechChunk = {
  audio: Int16Array
  sampleRate: number
  index: number
  text: string
  cache: "hit" | "miss"
  prepareMs: number
  synthesisMs: number
  totalMs: number
}

type StreamingSpeechInput = {
  endpoint: string
  model: string
  voice: string
  mode: "quality" | "fast"
  text: string
  speed?: number
  onChunk: (chunk: StreamingSpeechChunk) => void
}

type ChunkMetadata = {
  type: "chunk"
  index: number
  text: string
  cache: "hit" | "miss"
  prepare_ms: number
  synthesis_ms: number
  total_ms: number
  format: "pcm_s16le"
  sample_rate: number
  channels: 1
  frames: number
}

export function localTTSWebSocketURL(endpoint: string) {
  const url = new URL(endpoint)
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Local TTS endpoint must use localhost, 127.0.0.1, or ::1.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local TTS endpoint must use HTTP or HTTPS.")
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/v1/audio/speech/stream"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export function createLocalSpeechStream(input: StreamingSpeechInput) {
  const socket = new WebSocket(localTTSWebSocketURL(input.endpoint))
  socket.binaryType = "arraybuffer"
  let metadata: ChunkMetadata | undefined
  let settled = false
  let cancelled = false
  let finish: ((value: { chunks: number; totalMs: number }) => void) | undefined
  const done = new Promise<{ chunks: number; totalMs: number }>((resolve, reject) => {
    finish = resolve
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          model: input.model,
          input: input.text,
          voice: input.voice,
          mode: input.mode,
          response_format: "wav",
          speed: input.speed ?? 1,
        }),
      )
    }
    socket.onmessage = (message) => {
      if (typeof message.data !== "string") {
        if (!metadata) {
          reject(new Error("The streaming TTS backend returned audio without chunk metadata."))
          socket.close(1002)
          return
        }
        if (metadata.format !== "pcm_s16le" || metadata.channels !== 1 || metadata.sample_rate <= 0) {
          reject(new Error("The streaming TTS backend returned an unsupported PCM format."))
          socket.close(1002)
          return
        }
        const data = message.data instanceof ArrayBuffer ? message.data : undefined
        if (!data || data.byteLength !== metadata.frames * 2) {
          reject(new Error("The streaming TTS backend returned malformed PCM audio."))
          socket.close(1002)
          return
        }
        input.onChunk({
          audio: new Int16Array(data),
          sampleRate: metadata.sample_rate,
          index: metadata.index,
          text: metadata.text,
          cache: metadata.cache,
          prepareMs: metadata.prepare_ms,
          synthesisMs: metadata.synthesis_ms,
          totalMs: metadata.total_ms,
        })
        metadata = undefined
        return
      }
      const event = JSON.parse(message.data) as
        | { type: "started"; chunks: number }
        | ChunkMetadata
        | { type: "done"; chunks: number; total_ms: number }
        | { type: "error"; error: string }
      if (event.type === "chunk") {
        metadata = event
        return
      }
      if (event.type === "error") {
        settled = true
        reject(new Error(event.error))
        socket.close(1011)
        return
      }
      if (event.type !== "done") return
      settled = true
      resolve({ chunks: event.chunks, totalMs: event.total_ms })
      socket.close(1000)
    }
    socket.onerror = () => {
      if (cancelled || settled) return
      settled = true
      reject(new Error("Could not connect to the local streaming TTS backend."))
    }
    socket.onclose = (event) => {
      if (cancelled || settled || event.code === 1000) return
      settled = true
      reject(new Error(`Local streaming TTS disconnected (${event.code}).`))
    }
  })
  return {
    done,
    cancel() {
      cancelled = true
      settled = true
      finish?.({ chunks: 0, totalMs: 0 })
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000)
    },
  }
}
