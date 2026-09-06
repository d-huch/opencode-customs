import type { RuntimeConfig } from "./config"

const maximumAudioBytes = 25 * 1024 * 1024
const maximumInputBytes = 16_000 * 2 * 60

export function createPCMRecognition(config: NonNullable<RuntimeConfig["speech"]>["transcription"], input: {
  locale: string
  sampleRate: number
  onEvent?: (event: { type: string; text?: string }) => void
  onDrain?: () => void
}) {
  if (!config) throw new Error("Local speech recognition is not configured.")
  const chunks: Buffer[] = []
  const controller = new AbortController()
  let bytes = 0
  let finish: () => void = () => undefined
  const ended = new Promise<void>((resolve) => {
    finish = resolve
  })
  input.onEvent?.({ type: "listening" })
  const result = ended.then(async () => {
    if (controller.signal.aborted) return ""
    if (!bytes) return ""
    input.onEvent?.({ type: "processing" })
    const form = new FormData()
    form.set("file", new Blob([pcm16Wav(Buffer.concat(chunks), input.sampleRate)], { type: "audio/wav" }), "speech.wav")
    form.set("model", config.modelID)
    form.set("response_format", "json")
    form.set("language", config.language ?? languageCode(input.locale))
    const response = await fetch(new URL("audio/transcriptions", `${config.baseURL}/`), {
      method: "POST",
      body: form,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
    })
    if (!response.ok) throw new Error(`Local STT returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
    const value: unknown = await response.json()
    if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string")
      throw new Error("Local STT returned an invalid transcript.")
    const text = value.text.trim()
    if (text) input.onEvent?.({ type: "final", text })
    return text
  })
  return {
    write(chunk: Buffer) {
      if (controller.signal.aborted || bytes + chunk.byteLength > maximumInputBytes) return false
      chunks.push(Buffer.from(chunk))
      bytes += chunk.byteLength
      input.onDrain?.()
      return true
    },
    finish,
    cancel() {
      if (controller.signal.aborted) return
      controller.abort()
      finish()
    },
    result,
  }
}

export async function synthesizeSpeech(config: NonNullable<RuntimeConfig["speech"]>["synthesis"], text: string, signal: AbortSignal) {
  if (!config) throw new Error("Local speech synthesis is not configured.")
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/wav" },
    body: JSON.stringify({
      model: config.modelID,
      voice: config.voice,
      input: text.slice(0, 6_000),
      speed: config.speed ?? 1,
      response_format: "wav",
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  })
  if (!response.ok) throw new Error(`Local TTS returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
  const audio = await response.arrayBuffer()
  if (!audio.byteLength) throw new Error("Local TTS returned an empty audio response.")
  if (audio.byteLength > maximumAudioBytes) throw new Error("Local TTS response exceeds the 25 MB limit.")
  return { contentType: response.headers.get("content-type")?.split(";", 1)[0] || "audio/wav", audio }
}

function languageCode(locale: string) {
  return locale.split(/[-_]/, 1)[0] || "en"
}

function pcm16Wav(pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.byteLength, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([header, pcm])
}
