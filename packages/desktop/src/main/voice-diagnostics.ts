import { appendFile, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"

export type VoiceDiagnosticInput = {
  sessionID: string
  turnID?: string
  source: "agent" | "stt" | "tts" | "ui" | "replay"
  event: string
  state?: string
  text?: string
  error?: string
  generation?: number
  level?: number
  durationMs?: number
  diagnostics?: Record<string, string | number | boolean | null | undefined>
}

export type VoiceDiagnosticEntry = VoiceDiagnosticInput & {
  timestamp: string
}

const directory = () => join(app.getPath("userData"), "voice-diagnostics")
const safeSessionID = (sessionID: string) => sessionID.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160) || "default"
const safeTurnID = (turnID: string) => turnID.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160) || "turn"
const pathFor = (sessionID: string) => join(directory(), `${safeSessionID(sessionID)}.jsonl`)
const audioDirectoryFor = (sessionID: string) => join(directory(), "audio", safeSessionID(sessionID))
const audioPathFor = (sessionID: string, turnID: string) => join(audioDirectoryFor(sessionID), `${safeTurnID(turnID)}.wav`)
const pending = new Map<string, Promise<void>>()

export type VoiceTurnAudioInput = {
  sessionID: string
  turnID: string
  pcm: ArrayBuffer
  sampleRate: number
}

export async function appendVoiceDiagnostic(input: VoiceDiagnosticInput) {
  const path = pathFor(input.sessionID)
  const write = (pending.get(path) ?? Promise.resolve()).then(async () => {
    await mkdir(directory(), { recursive: true })
    await appendFile(path, `${JSON.stringify({ timestamp: new Date().toISOString(), ...input })}\n`, "utf8")
    if ((await stat(path)).size <= 5 * 1024 * 1024) return
    const tail = (await readFile(path, "utf8")).slice(-4 * 1024 * 1024)
    await writeFile(path, tail.slice(Math.max(0, tail.indexOf("\n") + 1)), "utf8")
  })
  pending.set(path, write)
  await write.finally(() => {
    if (pending.get(path) === write) pending.delete(path)
  })
}

export async function getVoiceDiagnostics(sessionID: string) {
  const path = pathFor(sessionID)
  await pending.get(path)
  const contents = await readFile(path, "utf8").catch(() => "")
  const entries = contents
    .split("\n")
    .filter(Boolean)
    .slice(-500)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as VoiceDiagnosticEntry]
      } catch {
        return []
      }
    })
  return { path, entries }
}

export async function storeVoiceTurnAudio(input: VoiceTurnAudioInput) {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate < 8_000 || input.sampleRate > 192_000) {
    throw new Error("Invalid voice diagnostic sample rate.")
  }
  if (input.pcm.byteLength === 0 || input.pcm.byteLength > 16 * 1024 * 1024 || input.pcm.byteLength % 2 !== 0) {
    throw new Error("Invalid voice diagnostic PCM payload.")
  }
  const path = audioPathFor(input.sessionID, input.turnID)
  const pcm = Buffer.from(input.pcm)
  const wav = Buffer.alloc(44 + pcm.byteLength)
  wav.write("RIFF", 0)
  wav.writeUInt32LE(36 + pcm.byteLength, 4)
  wav.write("WAVE", 8)
  wav.write("fmt ", 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(input.sampleRate, 24)
  wav.writeUInt32LE(input.sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write("data", 36)
  wav.writeUInt32LE(pcm.byteLength, 40)
  pcm.copy(wav, 44)
  await mkdir(audioDirectoryFor(input.sessionID), { recursive: true })
  await writeFile(path, wav)
  const files = await readdir(audioDirectoryFor(input.sessionID))
  const dated = await Promise.all(
    files.map(async (file) => ({ file, modified: (await stat(join(audioDirectoryFor(input.sessionID), file))).mtimeMs })),
  )
  await Promise.all(
    dated
      .sort((a, b) => b.modified - a.modified)
      .slice(200)
      .map((item) => rm(join(audioDirectoryFor(input.sessionID), item.file), { force: true })),
  )
  return {
    path,
    bytes: wav.byteLength,
    durationMs: Math.round((pcm.byteLength / 2 / input.sampleRate) * 1_000),
    sampleRate: input.sampleRate,
  }
}

export async function getVoiceTurnAudio(sessionID: string, turnID: string) {
  const path = audioPathFor(sessionID, turnID)
  const contents = await readFile(path).catch(() => undefined)
  if (!contents) return
  return {
    path,
    contentType: "audio/wav",
    audio: contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer,
  }
}

export async function clearVoiceDiagnostics(sessionID?: string) {
  if (sessionID) {
    const path = pathFor(sessionID)
    await pending.get(path)
    const audioFiles = await readdir(audioDirectoryFor(sessionID)).catch(() => [])
    const sizes = await Promise.all([
      stat(path).then((value) => value.size, () => 0),
      ...audioFiles.map((file) => stat(join(audioDirectoryFor(sessionID), file)).then((value) => value.size, () => 0)),
    ])
    await Promise.all([rm(path, { force: true }), rm(audioDirectoryFor(sessionID), { recursive: true, force: true })])
    return { files: sizes.filter((size) => size > 0).length, bytes: sizes.reduce((total, size) => total + size, 0) }
  }
  await Promise.all(pending.values())
  const files = await readdir(directory()).catch(() => [])
  const sizes = await Promise.all(files.map((file) => stat(join(directory(), file)).then((value) => value.size, () => 0)))
  await rm(directory(), { recursive: true, force: true })
  return { files: files.length, bytes: sizes.reduce((total, size) => total + size, 0) }
}

export async function exportVoiceDiagnostics(sessionID: string) {
  const source = pathFor(sessionID)
  await pending.get(source)
  await stat(source)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const target = join(app.getPath("downloads"), `opencode-voice-${safeSessionID(sessionID)}-${timestamp}.jsonl`)
  await copyFile(source, target)
  return target
}
