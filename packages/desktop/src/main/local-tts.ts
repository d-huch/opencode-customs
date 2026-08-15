import { write as writeLog } from "./logging"
import { synthesizeFishAudioLocal } from "./fish-audio"

export type LocalTTSInput = {
  provider?: "local" | "fish-local"
  fishPresetID?: string
  endpoint: string
  model: string
  voice: string
  mode: "quality" | "fast"
  speed?: number
  text: string
  latency?: "normal" | "balanced"
  language?: "auto" | "uk" | "en" | "mixed"
  temperature?: number
  topP?: number
  repetitionPenalty?: number
  seed?: number | null
  chunkLength?: number
  normalize?: boolean
  streaming?: boolean
  useMemoryCache?: boolean
  maxNewTokens?: number
}

const maximumAudioBytes = 25 * 1024 * 1024
const requestTimeout = 45_000
const qualityVoices = ["kateryna", "lada", "mykyta", "oleksa", "tetiana"]

export async function synthesizeLocalSpeech(input: LocalTTSInput, signal?: AbortSignal) {
  if (input.provider === "fish-local") {
    return synthesizeFishAudioLocal(
      {
        endpoint: input.endpoint,
        presetID: input.fishPresetID,
        text: input.text,
        latency: input.latency,
        language: input.language,
        temperature: input.temperature,
        topP: input.topP,
        repetitionPenalty: input.repetitionPenalty,
        seed: input.seed,
        chunkLength: input.chunkLength,
        normalize: input.normalize,
        streaming: input.streaming,
        useMemoryCache: input.useMemoryCache,
        maxNewTokens: input.maxNewTokens,
      },
      signal,
    )
  }
  const endpoint = new URL(input.endpoint)
  const local = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "[::1]"
  if (!local || (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")) {
    throw new Error("Custom TTS endpoint must use localhost, 127.0.0.1, or ::1.")
  }
  if (!input.model.trim()) throw new Error("Custom TTS model is not configured.")
  if (!input.voice.trim()) throw new Error("Custom TTS voice is not configured.")
  if (!input.text.trim()) throw new Error("Custom TTS received empty text.")

  const voice =
    input.mode === "quality" ? (qualityVoices.includes(input.voice) ? input.voice : "kateryna") : "ukrainian_tts"

  writeLog("voice", "local TTS request started", {
    endpoint: endpoint.toString(),
    model: input.model,
    voice,
    mode: input.mode,
    textLength: input.text.length,
  })
  const body = JSON.stringify({
    model: input.model,
    voice,
    mode: input.mode,
    speed: input.speed ?? 1,
    input: input.text.slice(0, 6_000),
    response_format: "wav",
  })
  const timeout = AbortSignal.timeout(requestTimeout)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const result = await requestSpeech(endpoint, body, requestSignal).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    writeLog("voice", "local TTS request failed", { error: message }, "error")
    if (requestSignal.aborted && timeout.aborted) {
      throw new Error(`Custom TTS did not respond within ${requestTimeout / 1_000} seconds.`)
    }
    if (requestSignal.aborted) throw new Error("Custom TTS request was cancelled.")
    throw error
  })
  if (result.status < 200 || result.status >= 300) {
    const detail = new TextDecoder().decode(result.audio).slice(0, 1_000)
    writeLog("voice", "local TTS request failed", { status: result.status, detail }, "error")
    throw new Error(`Custom TTS returned HTTP ${result.status}${detail ? `: ${detail}` : ""}`)
  }
  if (result.audio.byteLength === 0) throw new Error("Custom TTS returned an empty audio response.")
  writeLog("voice", "local TTS request completed", {
    bytes: result.audio.byteLength,
    contentType: result.contentType,
    cache: result.headers["x-tts-cache"],
    backendMs: result.headers["x-tts-total-ms"],
  })
  return {
    audio: Uint8Array.from(result.audio).buffer,
    contentType: result.contentType,
    metrics: {
      cache: result.headers["x-tts-cache"] ?? "unknown",
      prepareMs: Number(result.headers["x-tts-prepare-ms"] ?? 0),
      synthesisMs: Number(result.headers["x-tts-synthesis-ms"] ?? 0),
      totalMs: Number(result.headers["x-tts-total-ms"] ?? 0),
    },
  }
}

async function requestSpeech(endpoint: URL, body: string, signal: AbortSignal) {
  const { request } = endpoint.protocol === "http:" ? await import("node:http") : await import("node:https")
  return new Promise<{ status: number; contentType: string; audio: Uint8Array; headers: Record<string, string> }>(
    (resolve, reject) => {
      const pending = request(
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
          signal,
        },
        (response) => {
          const expected = Number(response.headers["content-length"] ?? 0)
          if (expected > maximumAudioBytes) {
            response.destroy(new Error("Custom TTS response exceeds the 25 MB audio limit."))
            return
          }
          const chunks: Uint8Array[] = []
          const append = (chunk: Buffer) => {
            chunks.push(chunk)
            if (chunks.reduce((total, item) => total + item.byteLength, 0) <= maximumAudioBytes) return
            response.destroy(new Error("Custom TTS response exceeds the 25 MB audio limit."))
          }
          response.on("data", append)
          response.on("error", reject)
          response.on("end", () => {
            const audio = Buffer.concat(chunks)
            resolve({
              status: response.statusCode ?? 500,
              contentType: response.headers["content-type"]?.split(";", 1)[0] || "audio/wav",
              audio,
              headers: Object.fromEntries(
                Object.entries(response.headers).flatMap(([key, value]) =>
                  typeof value === "string" ? [[key, value]] : [],
                ),
              ),
            })
          })
        },
      )
      pending.on("error", reject)
      pending.end(body)
    },
  )
}
