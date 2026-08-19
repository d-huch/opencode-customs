import { spawn } from "node:child_process"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { app } from "electron"
import type { WebContents } from "electron"
import { write as writeLog } from "./logging"

export type VoiceEvent = {
  type: "listening" | "level" | "partial" | "final" | "retrying" | "error"
  text?: string
  error?: string
  level?: number
}

type VoiceRun = {
  cancelled: boolean
  stop: () => void
}

export type PCMRecognition = {
  write: (chunk: Buffer) => boolean
  finish: () => void
  cancel: () => void
  result: Promise<string>
}

export function startPCMRecognition(input: {
  locale: string
  sampleRate: number
  onEvent?: (event: VoiceEvent) => void
  onDrain?: () => void
}): PCMRecognition {
  if (process.platform !== "darwin") throw new Error("Streaming speech recognition is only available on macOS.")
  const child = spawn(voiceExecutable(), ["--stdin-pcm", input.locale, String(input.sampleRate)], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  let cancelled = false
  let latest = ""
  let failure = ""
  let stderr = ""
  const result = new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const event = parseVoiceEvent(line)
      if (!event) return
      input.onEvent?.(event)
      if (event.text) latest = event.text
      if (event.type === "error") failure = event.error ?? "Streaming speech recognition failed."
    })
    child.stderr.on("data", (value: Buffer) => {
      stderr = `${stderr}${value.toString()}`.slice(-4_000)
    })
    child.stdin.on("drain", () => input.onDrain?.())
    child.once("error", (error) => {
      failure = error.message
    })
    child.once("close", (code) => {
      if (cancelled) return resolve("")
      if (failure) return reject(new Error(failure))
      if (code !== 0) return reject(new Error(stderr.trim() || `Native speech recognition exited with code ${code}.`))
      resolve(latest.trim())
    })
  })
  writeLog("voice", "remote PCM speech recognition started", {
    locale: input.locale,
    sampleRate: input.sampleRate,
  })
  return {
    write: (chunk) => !cancelled && child.stdin.writable && child.stdin.write(chunk),
    finish: () => {
      if (cancelled || child.stdin.destroyed) return
      child.stdin.end()
    },
    cancel: () => {
      if (cancelled) return
      cancelled = true
      child.stdin.destroy()
      child.kill("SIGTERM")
    },
    result,
  }
}

export function createNativeVoiceController() {
  const runs = new Map<number, VoiceRun>()

  const stop = (senderID: number) => {
    const run = runs.get(senderID)
    if (!run) return
    run.cancelled = true
    run.stop()
  }

  const recognize = async (sender: WebContents, locale: string) => {
    stop(sender.id)
    if (process.platform !== "darwin") throw new Error("Native speech recognition is only available on macOS.")

    const executable = voiceExecutable()
    const child = spawn(executable, [locale], { stdio: ["ignore", "pipe", "pipe"] })
    writeLog("voice", "native speech recognition started", { locale, executable })
    const run: VoiceRun = { cancelled: false, stop: () => child.kill("SIGTERM") }
    runs.set(sender.id, run)
    const destroyed = () => stop(sender.id)
    sender.once("destroyed", destroyed)

    return new Promise<string>((resolve, reject) => {
      let latest = ""
      let failure = ""
      let stderr = ""
      createInterface({ input: child.stdout }).on("line", (line) => {
        const event = parseVoiceEvent(line)
        if (!event) return
        if (event.type === "level" && event.level !== undefined) {
          if (!sender.isDestroyed()) sender.send("speech-recognition-level", event.level)
          return
        }
        if (!sender.isDestroyed()) sender.send("speech-recognition-event", event)
        if (event.text) latest = event.text
        if (event.type === "retrying") {
          writeLog(
            "voice",
            "speech recognition retrying after system service failure",
            { locale, error: event.error },
            "warn",
          )
        }
        if (event.type === "error") failure = event.error ?? "Native speech recognition failed."
      })
      child.stderr.on("data", (value: Buffer) => {
        stderr = `${stderr}${value.toString()}`.slice(-4_000)
      })
      child.once("error", (error) => {
        failure = error.message
        writeLog("voice", "failed to launch native speech recognition", { locale, error }, "error")
      })
      child.once("close", (code) => {
        sender.off("destroyed", destroyed)
        if (!sender.isDestroyed()) sender.send("speech-recognition-level", 0)
        if (runs.get(sender.id) === run) runs.delete(sender.id)
        if (run.cancelled) return resolve("")
        if (failure) {
          writeLog("voice", "native speech recognition failed", { locale, error: failure, stderr }, "error")
          return reject(new Error(failure))
        }
        if (code !== 0) {
          const error = stderr.trim() || `Native speech recognition exited with code ${code}.`
          writeLog("voice", "native speech recognition exited unexpectedly", { locale, code, error }, "error")
          return reject(new Error(error))
        }
        writeLog("voice", "native speech recognition completed", { locale, transcriptLength: latest.trim().length })
        resolve(latest.trim())
      })
    })
  }

  return {
    recognize,
    stop,
    stopAll: () => runs.forEach((run) => run.stop()),
  }
}

function voiceExecutable() {
  return join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    "native/swift-build/OpenCode Customs Voice Agent.app/Contents/MacOS/OpenCode Customs Voice Agent",
  )
}

function parseVoiceEvent(line: string): VoiceEvent | undefined {
  const value: unknown = (() => {
    try {
      return JSON.parse(line)
    } catch {
      return undefined
    }
  })()
  if (!value || typeof value !== "object") return undefined
  if (!("type" in value) || typeof value.type !== "string") return undefined
  const type =
    value.type === "listening" ||
    value.type === "level" ||
    value.type === "partial" ||
    value.type === "final" ||
    value.type === "retrying" ||
    value.type === "error"
      ? value.type
      : undefined
  if (!type) return undefined
  return {
    type,
    text: "text" in value && typeof value.text === "string" ? value.text : undefined,
    error: "error" in value && typeof value.error === "string" ? value.error : undefined,
    level: "level" in value && typeof value.level === "number" ? value.level : undefined,
  }
}
