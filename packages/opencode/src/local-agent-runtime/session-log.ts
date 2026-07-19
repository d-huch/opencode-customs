export * as SessionLog from "./session-log"

import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import path from "path"

const MAX_STRING_LENGTH = 32 * 1024
const MAX_ARRAY_LENGTH = 100
const MAX_DEPTH = 6
const pending = new Map<string, Promise<void>>()

export type Event = {
  readonly sessionID: string
  readonly type: string
  readonly messageID?: string
  readonly executionID?: string
  readonly data?: unknown
}

export function write(event: Event) {
  const file = filepath(event.sessionID)
  const previous = pending.get(file) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(directory(), { recursive: true })
      await fs.appendFile(
        file,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionID: event.sessionID,
          type: event.type,
          ...(event.messageID ? { messageID: event.messageID } : {}),
          ...(event.executionID ? { executionID: event.executionID } : {}),
          ...(event.data === undefined ? {} : { data: normalize(event.data) }),
        })}\n`,
        "utf8",
      )
    })
    .catch(() => undefined)
    .finally(() => {
      if (pending.get(file) === next) pending.delete(file)
    })
  pending.set(file, next)
  return next
}

export async function clear() {
  await Promise.allSettled(pending.values())
  await fs.rm(directory(), { recursive: true, force: true })
  await fs.mkdir(directory(), { recursive: true })
}

export function filepath(sessionID: string) {
  return path.join(directory(), `${safeName(sessionID)}.jsonl`)
}

export async function location(sessionID: string) {
  const value = filepath(sessionID)
  const exists = await fs.stat(value).then(
    () => true,
    () => false,
  )
  return { path: value, exists }
}

export function directory() {
  return process.env.OPENCODE_SESSION_LOG_DIR ?? path.join(Global.Path.log, "sessions")
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9_.-]/gi, "_") || "unknown-session"
}

function normalize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value
    return `${value.slice(0, MAX_STRING_LENGTH)}\n[session log truncated ${value.length - MAX_STRING_LENGTH} characters]`
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "symbol" || typeof value === "function") return String(value)
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  if (depth >= MAX_DEPTH) return "[session log depth limit]"
  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[session log circular reference]"
  seen.add(value)
  if (Array.isArray(value))
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => normalize(item, depth + 1, seen))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalize(item, depth + 1, seen)]),
  )
}
