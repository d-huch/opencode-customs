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
const pathFor = (sessionID: string) => join(directory(), `${safeSessionID(sessionID)}.jsonl`)
const pending = new Map<string, Promise<void>>()

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

export async function clearVoiceDiagnostics(sessionID?: string) {
  if (sessionID) {
    const path = pathFor(sessionID)
    await pending.get(path)
    const bytes = await stat(path).then((value) => value.size, () => 0)
    const removed = await rm(path, { force: true }).then(() => bytes > 0)
    return { files: removed ? 1 : 0, bytes }
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
