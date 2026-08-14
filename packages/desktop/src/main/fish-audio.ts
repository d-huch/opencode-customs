import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"

import { write as writeLog } from "./logging"

const maximumAudioBytes = 25 * 1024 * 1024
const requestTimeout = 90_000
const referenceDirectory = () => join(app.getPath("userData"), "fish-audio-local")
const referenceAudioPath = () => join(referenceDirectory(), "reference.audio")
const referenceMetadataPath = () => join(referenceDirectory(), "reference.json")

export type FishAudioLocalReference = {
  filename: string
  contentType: string
  transcript: string
  bytes: number
}

export type FishAudioLocalReferenceInput = {
  filename: string
  contentType: string
  audio: ArrayBuffer
  transcript: string
}

export type FishAudioLocalSpeechInput = {
  endpoint: string
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

export type FishAudioLocalStatus = {
  status: "ready" | "offline" | "error"
  endpoint: string
  latencyMs?: number
  detail?: string
}

export async function getFishAudioLocalReference() {
  return readFile(referenceMetadataPath(), "utf8")
    .then((value) => JSON.parse(value) as FishAudioLocalReference)
    .catch(() => undefined)
}

export async function setFishAudioLocalReference(input: FishAudioLocalReferenceInput) {
  if (!input.audio.byteLength) throw new Error("Choose a non-empty Fish Audio reference recording.")
  if (input.audio.byteLength > maximumAudioBytes) throw new Error("Voice reference audio must be 25 MB or smaller.")
  if (!input.transcript.trim()) throw new Error("Enter the exact transcript of the Fish Audio reference recording.")
  const letters = input.transcript.match(/\p{L}/gu) ?? []
  if (letters.length < 4 || new Set(letters.map((letter) => letter.toLocaleLowerCase())).size < 2) {
    throw new Error("Enter a meaningful exact transcript of the reference recording, not placeholder letters.")
  }
  await mkdir(referenceDirectory(), { recursive: true })
  const metadata = {
    filename: input.filename.slice(0, 255),
    contentType: input.contentType || "application/octet-stream",
    transcript: input.transcript.trim().slice(0, 10_000),
    bytes: input.audio.byteLength,
  }
  await writeFile(`${referenceAudioPath()}.tmp`, new Uint8Array(input.audio))
  await writeFile(`${referenceMetadataPath()}.tmp`, JSON.stringify(metadata))
  await rename(`${referenceAudioPath()}.tmp`, referenceAudioPath())
  await rename(`${referenceMetadataPath()}.tmp`, referenceMetadataPath())
  writeLog("voice", "Fish Audio local reference saved", {
    filename: metadata.filename,
    contentType: metadata.contentType,
    bytes: metadata.bytes,
  })
  return metadata
}

export async function clearFishAudioLocalReference() {
  await Promise.all([
    unlink(referenceAudioPath()).catch(() => undefined),
    unlink(referenceMetadataPath()).catch(() => undefined),
  ])
}

export async function getFishAudioLocalStatus(value: string): Promise<FishAudioLocalStatus> {
  const started = performance.now()
  const endpoint = requireLocalEndpoint(value)
  const health = new URL("/v1/health", endpoint.origin)
  const response = await fetch(health, { signal: AbortSignal.timeout(3_000) }).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    writeLog("voice", "Fish Speech MPS health check could not connect", { endpoint: health.toString(), detail })
    return undefined
  })
  if (!response) {
    return {
      status: "offline",
      endpoint: health.toString(),
      detail: "Native Fish Speech is not reachable. Start services/fish-speech-macos/start.sh.",
    }
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    return {
      status: "error",
      endpoint: health.toString(),
      latencyMs: Math.round(performance.now() - started),
      detail: `Health check returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    }
  }
  return {
    status: "ready",
    endpoint: health.toString(),
    latencyMs: Math.round(performance.now() - started),
  }
}

export async function synthesizeFishAudioLocal(input: FishAudioLocalSpeechInput, signal?: AbortSignal) {
  if (!input.text.trim()) throw new Error("Fish Audio Local received empty text.")
  const endpoint = requireLocalEndpoint(input.endpoint)
  const reference = await getFishAudioLocalReference()
  if (!reference) throw new Error("Fish Audio Local reference is not configured. Save a reference recording first.")
  const audio = await readFile(referenceAudioPath()).catch(() => undefined)
  if (!audio?.byteLength) throw new Error("Fish Audio Local reference audio is missing. Save it again.")
  const started = performance.now()
  const { pack } = await import("msgpackr")
  const timeout = AbortSignal.timeout(requestTimeout)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  writeLog("voice", "Fish Audio local request started", {
    endpoint: endpoint.toString(),
    reference: reference.filename,
    latency: input.latency ?? "balanced",
    language: input.language ?? "auto",
    temperature: clamp(input.temperature, 0.1, 1, 0.8),
    topP: clamp(input.topP, 0.1, 1, 0.8),
    repetitionPenalty: clamp(input.repetitionPenalty, 0.9, 2, 1.1),
    seed: input.seed ?? null,
    chunkLength: Math.round(clamp(input.chunkLength, 100, 1_000, 300)),
    normalize: input.normalize ?? true,
    streaming: input.streaming ?? false,
    memoryCache: input.useMemoryCache ?? true,
    maxNewTokens: Math.round(clamp(input.maxNewTokens, 128, 4_096, 1_024)),
    textLength: input.text.length,
  })
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "audio/wav",
      "content-type": "application/msgpack",
    },
    body: Uint8Array.from(
      pack({
        text: input.text.trim().slice(0, 6_000),
        references: [{ audio, text: reference.transcript }],
        format: "wav",
        latency: input.latency ?? "balanced",
        seed: input.seed === null || input.seed === undefined ? null : Math.round(input.seed),
        streaming: input.streaming ?? false,
        use_memory_cache: input.useMemoryCache === false ? "off" : "on",
        normalize: input.normalize ?? true,
        max_new_tokens: Math.round(clamp(input.maxNewTokens, 128, 4_096, 1_024)),
        chunk_length: Math.round(clamp(input.chunkLength, 100, 1_000, 300)),
        top_p: clamp(input.topP, 0.1, 1, 0.8),
        repetition_penalty: clamp(input.repetitionPenalty, 0.9, 2, 1.1),
        temperature: clamp(input.temperature, 0.1, 1, 0.8),
      }),
    ),
    signal: requestSignal,
  }).catch((error: unknown) => {
    if (timeout.aborted) throw new Error(`Fish Audio Local did not respond within ${requestTimeout / 1_000} seconds.`)
    if (requestSignal.aborted) throw new Error("Fish Audio Local request was cancelled.")
    const detail = error instanceof Error ? error.message : String(error)
    writeLog("voice", "Fish Speech MPS request could not connect", { endpoint: endpoint.toString(), detail }, "error")
    throw new Error(
      `Native Fish Speech is not reachable at ${endpoint.origin}. Start services/fish-speech-macos/start.sh and retry. No cloud, Apple, or CPU fallback was used.`,
      { cause: error },
    )
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000)
    writeLog("voice", "Fish Audio local request failed", { status: response.status, detail }, "error")
    throw new Error(`Fish Audio Local returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`)
  }
  const result = new Uint8Array(await response.arrayBuffer())
  if (!result.byteLength) throw new Error("Fish Audio Local returned an empty audio response.")
  if (result.byteLength > maximumAudioBytes) throw new Error("Fish Audio Local response exceeds the 25 MB audio limit.")
  const totalMs = performance.now() - started
  writeLog("voice", "Fish Audio local request completed", { bytes: result.byteLength, totalMs: Math.round(totalMs) })
  return {
    audio: Uint8Array.from(result).buffer,
    contentType: response.headers.get("content-type")?.split(";", 1)[0] || "audio/wav",
    metrics: { cache: "local", prepareMs: 0, synthesisMs: totalMs, totalMs },
  }
}

function requireLocalEndpoint(value: string) {
  const endpoint = new URL(value)
  const local = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "[::1]"
  if (!local || (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")) {
    throw new Error("Fish Audio Local endpoint must use localhost, 127.0.0.1, or ::1.")
  }
  return endpoint
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value))
}
