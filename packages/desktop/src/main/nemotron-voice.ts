import { spawn, type ChildProcess } from "node:child_process"
import { access, mkdir, readFile, readdir } from "node:fs/promises"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { WebSocket } from "ws"

export type NemotronVoiceEngine = "cascade" | "nemotron"
export type NemotronVoicePhase = "missing" | "installing" | "starting" | "ready" | "busy" | "error"

export type NemotronVoiceStatus = {
  engine: NemotronVoiceEngine
  phase: NemotronVoicePhase
  model?: string
  modelPath?: string
  runtimeInstalled: boolean
  incompleteDownload: boolean
  inputSampleRate: 16000
  outputSampleRate: 22050
  owner?: "desktop" | "unity"
  message?: string
  loadMs?: number
  transcriptLatencyMs?: number
  firstTextMs?: number
  firstAudioMs?: number
  droppedChunks: number
  cancelLatencyMs?: number
  generationMs?: number
  realTimeFactor?: number
}

export type NemotronVoiceEvent =
  | { type: "status"; status: NemotronVoiceStatus }
  | { type: "transcript.delta"; requestID: string; delta: string }
  | { type: "text.delta"; requestID: string; delta: string }
  | { type: "audio.delta"; requestID: string; audio: ArrayBuffer; sampleRate: 22050 }
  | { type: "function.delta"; requestID: string; delta: string }
  | { type: "done"; requestID: string; transcript: string; text: string }
  | { type: "cancelled"; requestID: string }
  | { type: "error"; requestID?: string; error: string }

type Logger = (source: string, message: string, metadata?: Record<string, unknown>, level?: "info" | "warn" | "error") => void

type ActiveTurn = {
  requestID: string
  owner: "desktop" | "unity"
  startedAt: number
  transcript: string
  text: string
  firstTextAt?: number
  firstAudioAt?: number
  outputSamples: number
}

export type NemotronVoiceController = {
  engine(): NemotronVoiceEngine
  status(): Promise<NemotronVoiceStatus>
  configure(input: { engine: NemotronVoiceEngine; systemPrompt?: string }): Promise<NemotronVoiceStatus>
  install(): Promise<NemotronVoiceStatus>
  start(): Promise<NemotronVoiceStatus>
  stop(): Promise<void>
  begin(input: { owner: "desktop" | "unity"; requestID: string; systemPrompt?: string }): Promise<void>
  append(input: { requestID: string; pcm: ArrayBuffer | Uint8Array; sampleRate: number }): boolean
  commit(requestID: string): Promise<void>
  cancel(requestID?: string): Promise<void>
  subscribe(listener: (event: NemotronVoiceEvent) => void): () => void
}

const MODEL_TYPE = "nemotron_voicechat"
const MODEL_NAME = "OsaurusAI/NemotronLabs-VoiceChat-11B-MXFP8"
const INPUT_RATE = 16000 as const
const OUTPUT_RATE = 22050 as const
const RUNTIME_VERSION = "0.6.15"
const RESPONSE_WINDOW_SECONDS = 6

export function createNemotronVoiceController(input: { stateDirectory: string; log: Logger }): NemotronVoiceController {
  const runtimeDirectory = join(input.stateDirectory, "runtime")
  const python = join(runtimeDirectory, "venv", "bin", "python")
  const listeners = new Set<(event: NemotronVoiceEvent) => void>()
  let engine: NemotronVoiceEngine = "cascade"
  let phase: NemotronVoicePhase = "missing"
  let message: string | undefined
  let modelPath: string | undefined
  let incompleteDownload = false
  let process: ChildProcess | undefined
  let socket: WebSocket | undefined
  let port: number | undefined
  let systemPrompt = "You are Jarvis, a concise and natural personal assistant."
  let active: ActiveTurn | undefined
  let loadMs: number | undefined
  let transcriptLatencyMs: number | undefined
  let firstTextMs: number | undefined
  let firstAudioMs: number | undefined
  let cancelLatencyMs: number | undefined
  let generationMs: number | undefined
  let realTimeFactor: number | undefined
  let droppedChunks = 0
  let restartCount = 0

  const emit = (event: NemotronVoiceEvent) => listeners.forEach((listener) => listener(event))
  const runtimeInstalled = () => access(python).then(() => true, () => false)
  const snapshot = async (): Promise<NemotronVoiceStatus> => ({
    engine,
    phase,
    model: modelPath ? MODEL_NAME : undefined,
    modelPath,
    runtimeInstalled: await runtimeInstalled(),
    incompleteDownload,
    inputSampleRate: INPUT_RATE,
    outputSampleRate: OUTPUT_RATE,
    owner: active?.owner,
    message,
    loadMs,
    transcriptLatencyMs,
    firstTextMs,
    firstAudioMs,
    droppedChunks,
    cancelLatencyMs,
    generationMs,
    realTimeFactor,
  })
  const publishStatus = async () => emit({ type: "status", status: await snapshot() })

  const discover = async () => {
    const roots = [processEnv("LMSTUDIO_MODEL_DIR"), join(homedir(), ".lmstudio", "models")].filter(
      (value): value is string => Boolean(value),
    )
    const configs = (
      await Promise.all(
        roots.map(async (root) => {
          const owners = await readdir(root, { withFileTypes: true }).catch(() => [])
          return (
            await Promise.all(
              owners
                .filter((entry) => entry.isDirectory())
                .map(async (owner) => {
                  const repositories = await readdir(join(root, owner.name), { withFileTypes: true }).catch(() => [])
                  return repositories
                    .filter((entry) => entry.isDirectory())
                    .map((repository) => join(root, owner.name, repository.name, "config.json"))
                }),
            )
          ).flat()
        }),
      )
    ).flat()
    const found = (
      await Promise.all(
        configs.map(async (configPath) => {
          const config = await readFile(configPath, "utf8").then(parseJSON, () => undefined)
          if (!config || config.model_type !== MODEL_TYPE) return
          return configPath.slice(0, -"/config.json".length)
        }),
      )
    ).find((value): value is string => Boolean(value))
    modelPath = found
    incompleteDownload = false
    if (!found) return
    const validation = await inspectNemotronModelDirectory(found)
    incompleteDownload = !validation.valid
  }

  const requireModel = async () => {
    await discover()
    if (!modelPath) throw new Error(`Nemotron VoiceChat model was not found in LM Studio (${MODEL_NAME})`)
    if (incompleteDownload) throw new Error("Nemotron VoiceChat download is incomplete. Wait for all three weight shards.")
    return modelPath
  }

  const install = async () => {
    phase = "installing"
    message = undefined
    await publishStatus()
    await mkdir(runtimeDirectory, { recursive: true })
    const uv = await findUv()
    await run(uv, ["venv", "--python", "3.12", join(runtimeDirectory, "venv")])
    await run(uv, ["pip", "install", "--python", python, `mlx-vlm==${RUNTIME_VERSION}`])
    phase = modelPath ? "ready" : "missing"
    await publishStatus()
    return snapshot()
  }

  const stop = async () => {
    if (active) await cancel(active.requestID)
    socket?.close()
    socket = undefined
    const current = process
    process = undefined
    if (current && !current.killed) current.kill("SIGTERM")
    port = undefined
    phase = modelPath ? "ready" : "missing"
    message = undefined
    await publishStatus()
  }

  const start = async () => {
    const selected = await requireModel()
    if (!(await runtimeInstalled())) throw new Error("Nemotron MLX runtime is not installed")
    if (process && port) return snapshot()
    phase = "starting"
    message = undefined
    const startedAt = Date.now()
    await publishStatus()
    port = await freePort()
    const child = spawn(python, ["-m", "mlx_vlm.server", "--host", "127.0.0.1", "--port", String(port), "--model", selected], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...processEnvAll(), PYTHONUNBUFFERED: "1" },
    })
    process = child
    child.stdout?.on("data", (value) => input.log("nemotron", "runtime", { stream: "stdout", text: bounded(value.toString()) }))
    child.stderr?.on("data", (value) => input.log("nemotron", "runtime", { stream: "stderr", text: bounded(value.toString()) }))
    child.once("exit", (code) => {
      if (process !== child) return
      process = undefined
      socket = undefined
      port = undefined
      if (phase === "missing") return
      phase = "error"
      message = `Nemotron runtime exited (${code ?? "signal"})`
      void publishStatus()
    })
    await waitReady(port)
    loadMs = Date.now() - startedAt
    phase = "ready"
    restartCount = 0
    await publishStatus()
    return snapshot()
  }

  const begin = async (turn: { owner: "desktop" | "unity"; requestID: string; systemPrompt?: string }) => {
    if (engine !== "nemotron") throw new Error("Nemotron voice engine is not selected")
    if (active) await cancel(active.requestID)
    await start()
    const currentPort = port
    if (!currentPort) throw new Error("Nemotron runtime did not publish a port")
    const connected = new WebSocket(`ws://127.0.0.1:${currentPort}/v1/realtime`)
    socket = connected
    active = { ...turn, startedAt: Date.now(), transcript: "", text: "", outputSamples: 0 }
    phase = "busy"
    message = undefined
    await publishStatus()
    connected.on("message", (value) => receive(value.toString()))
    connected.on("close", () => {
      if (socket !== connected) return
      socket = undefined
      if (!active) return
      const requestID = active.requestID
      active = undefined
      phase = "ready"
      emit({ type: "cancelled", requestID })
      void publishStatus()
    })
    connected.on("error", (error) => fail(error.message))
    await new Promise<void>((resolve, reject) => {
      connected.once("open", resolve)
      connected.once("error", reject)
    })
    const configured = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        connected.off("message", inspect)
        reject(new Error("Nemotron realtime session did not become ready within 120 seconds"))
      }, 120_000)
      const inspect = (value: unknown) => {
        const event = parseJSON(String(value))
        if (event?.type !== "session.updated" && event?.type !== "error") return
        clearTimeout(timer)
        connected.off("message", inspect)
        if (event.type === "session.updated") resolve()
        else reject(new Error(realtimeError(event)))
      }
      connected.on("message", inspect)
    })
    connected.send(JSON.stringify({
      type: "session.update",
      session: {
        model: selectedModelName(modelPath),
        system_prompt: turn.systemPrompt ?? systemPrompt,
        tools: [],
      },
    }))
    await configured
  }

  const receive = (raw: string) => {
    const event = parseJSON(raw)
    const turn = active
    if (!turn || !event) return
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const delta = textDelta(event)
      if (!delta) return
      turn.transcript += delta
      transcriptLatencyMs ??= Date.now() - turn.startedAt
      emit({ type: "transcript.delta", requestID: turn.requestID, delta })
      return
    }
    if (event.type === "response.text.delta") {
      const delta = textDelta(event)
      if (!delta) return
      turn.text += delta
      turn.firstTextAt ??= Date.now()
      firstTextMs ??= turn.firstTextAt - turn.startedAt
      emit({ type: "text.delta", requestID: turn.requestID, delta })
      return
    }
    if (event.type === "response.audio.delta") {
      const audio = typeof event.delta === "string" ? Buffer.from(event.delta, "base64") : Buffer.alloc(0)
      if (!audio.byteLength) return
      turn.firstAudioAt ??= Date.now()
      firstAudioMs ??= turn.firstAudioAt - turn.startedAt
      turn.outputSamples += audio.byteLength / 2
      emit({ type: "audio.delta", requestID: turn.requestID, audio: exactArrayBuffer(audio), sampleRate: OUTPUT_RATE })
      return
    }
    if (event.type === "response.function.delta") {
      const delta = textDelta(event)
      if (delta) emit({ type: "function.delta", requestID: turn.requestID, delta })
      return
    }
    if (event.type === "response.done") {
      generationMs = Date.now() - turn.startedAt
      realTimeFactor = turn.outputSamples
        ? generationMs / (turn.outputSamples / OUTPUT_RATE * 1_000)
        : undefined
      active = undefined
      socket?.close()
      socket = undefined
      phase = "ready"
      emit({ type: "done", requestID: turn.requestID, transcript: turn.transcript, text: turn.text })
      void publishStatus()
      return
    }
    if (event.type === "response.cancelled") {
      active = undefined
      socket?.close()
      socket = undefined
      phase = "ready"
      emit({ type: "cancelled", requestID: turn.requestID })
      void publishStatus()
      return
    }
    if (event.type === "error")
      fail(
        isRecord(event.error) && typeof event.error.message === "string"
          ? event.error.message
          : typeof event.message === "string"
            ? event.message
            : "Nemotron realtime error",
      )
  }

  const fail = (detail: string) => {
    const requestID = active?.requestID
    active = undefined
    socket?.close()
    socket = undefined
    phase = "error"
    message = bounded(detail)
    emit({ type: "error", requestID, error: message })
    void publishStatus()
    if (!process || restartCount >= 2) return
    restartCount += 1
  }

  const append = (chunk: { requestID: string; pcm: ArrayBuffer | Uint8Array; sampleRate: number }) => {
    if (!active || active.requestID !== chunk.requestID || socket?.readyState !== WebSocket.OPEN) {
      droppedChunks += 1
      return false
    }
    const pcm = chunk.sampleRate === INPUT_RATE ? Buffer.from(asBytes(chunk.pcm)) : resamplePCM16(asBytes(chunk.pcm), chunk.sampleRate, INPUT_RATE)
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.toString("base64"), sample_rate: INPUT_RATE }))
    return true
  }

  const commit = async (requestID: string) => {
    if (!active || active.requestID !== requestID || socket?.readyState !== WebSocket.OPEN) return
    // VoiceChat advances speech, text and Aria audio on the microphone timeline.
    // Continue it with bounded silence after capture stops so the response is
    // not truncated to the last live input frame.
    socket.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: Buffer.alloc(INPUT_RATE * 2 * RESPONSE_WINDOW_SECONDS).toString("base64"),
      sample_rate: INPUT_RATE,
    }))
    socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }))
  }

  const cancel = async (requestID?: string) => {
    if (!active || (requestID && active.requestID !== requestID)) return
    const startedAt = Date.now()
    const id = active.requestID
    const current = socket
    if (current?.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: "response.cancel" }))
    active = undefined
    current?.close()
    socket = undefined
    phase = process ? "ready" : "missing"
    cancelLatencyMs = Date.now() - startedAt
    emit({ type: "cancelled", requestID: id })
    await publishStatus()
  }

  void discover().then(() => {
    void runtimeInstalled().then((installed) => {
      phase = modelPath && !incompleteDownload && installed ? "ready" : "missing"
      void publishStatus()
    })
  })

  return {
    engine: () => engine,
    async status() {
      await discover()
      if (!process && phase !== "installing" && phase !== "starting" && phase !== "error")
        phase = modelPath && !incompleteDownload && await runtimeInstalled() ? "ready" : "missing"
      return snapshot()
    },
    async configure(value) {
      if (active && value.engine !== engine) throw new Error("Voice engine cannot be changed during an active turn")
      engine = value.engine
      systemPrompt = value.systemPrompt?.trim() || systemPrompt
      await publishStatus()
      return snapshot()
    },
    install: () => install().catch(async (error) => {
      phase = "error"
      message = error instanceof Error ? error.message : String(error)
      await publishStatus()
      throw error
    }),
    start: () => start().catch(async (error) => {
      phase = "error"
      message = error instanceof Error ? error.message : String(error)
      await publishStatus()
      throw error
    }),
    stop,
    begin,
    append,
    commit,
    cancel,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function processEnv(key: string) {
  return process.env[key]?.trim()
}

function processEnvAll() {
  return process.env
}

async function findUv() {
  const candidates = [processEnv("UV_BIN"), "/opt/homebrew/bin/uv", "/usr/local/bin/uv"].filter(
    (value): value is string => Boolean(value),
  )
  const found = (await Promise.all(candidates.map((value) => access(value).then(() => value, () => undefined)))).find(Boolean)
  if (!found) throw new Error("uv is required to install the Nemotron MLX runtime")
  return found
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" })
    child.once("error", reject)
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${basename(command)} exited with code ${code}`)))
  })
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => port ? resolve(port) : reject(new Error("Failed to allocate Nemotron runtime port")))
    })
  })
}

async function waitReady(port: number) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const ready = await fetch(`http://127.0.0.1:${port}/v1/models`).then((response) => response.ok, () => false)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error("Nemotron MLX runtime did not become ready within 120 seconds")
}

function parseJSON(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function textDelta(event: Record<string, unknown>) {
  return typeof event.delta === "string" ? event.delta : typeof event.text === "string" ? event.text : ""
}

function realtimeError(event: Record<string, unknown>) {
  return isRecord(event.error) && typeof event.error.message === "string"
    ? event.error.message
    : typeof event.message === "string"
      ? event.message
      : "Nemotron realtime error"
}

function selectedModelName(path: string | undefined) {
  return path ?? MODEL_NAME
}

function bounded(value: string) {
  return value.replace(/[\r\n]+/g, " ").slice(0, 1_000)
}

function asBytes(value: ArrayBuffer | Uint8Array) {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function exactArrayBuffer(value: Buffer) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function resamplePCM16(input: Uint8Array, sourceRate: number, targetRate: number) {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) return Buffer.from(input)
  const source = new Int16Array(input.buffer, input.byteOffset, Math.floor(input.byteLength / 2))
  const output = new Int16Array(Math.max(1, Math.floor(source.length * targetRate / sourceRate)))
  for (let index = 0; index < output.length; index += 1) {
    const position = index * sourceRate / targetRate
    const left = Math.min(source.length - 1, Math.floor(position))
    const right = Math.min(source.length - 1, left + 1)
    output[index] = Math.round(source[left] + (source[right] - source[left]) * (position - left))
  }
  return Buffer.from(output.buffer)
}

export async function inspectNemotronModelDirectory(directory: string) {
  const config = await readFile(join(directory, "config.json"), "utf8").then(parseJSON, () => undefined)
  if (config?.model_type !== MODEL_TYPE) return { valid: false, incomplete: false, reason: "architecture" as const }
  const files = await readdir(directory).catch(() => [])
  if (files.some((file) => file.endsWith(".part"))) return { valid: false, incomplete: true, reason: "partial" as const }
  const index = await readFile(join(directory, "model.safetensors.index.json"), "utf8").then(parseJSON, () => undefined)
  const weightMap = index && isRecord(index.weight_map) ? index.weight_map : {}
  const shards = [...new Set(Object.values(weightMap).filter((value): value is string => typeof value === "string"))]
  if (shards.length !== 3) return { valid: false, incomplete: true, reason: "shards" as const }
  const complete = (await Promise.all(shards.map((file) => access(join(directory, file)).then(() => true, () => false)))).every(Boolean)
  return complete
    ? { valid: true, incomplete: false, reason: undefined }
    : { valid: false, incomplete: true, reason: "shards" as const }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
