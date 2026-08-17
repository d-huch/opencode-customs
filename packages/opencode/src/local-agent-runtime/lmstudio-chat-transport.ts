export * as LmStudioChatTransport from "./lmstudio-chat-transport"

import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import path from "path"
import { isRecord } from "@/util/record"

export type Identity = {
  readonly baseURL: string
  readonly modelID: string
  readonly instanceID: string
}

export type FallbackReason = "system_message_position" | "invalid_responses_input" | "unsupported_item_reference"

type Entry = {
  readonly transport: "chat_completions"
  readonly reason: FallbackReason
  readonly expiresAt: number
}

const TTL_MS = 24 * 60 * 60 * 1_000
const file = path.join(Global.Path.state, "lmstudio-chat-transport.json")
const store = createStore(file)

export async function resolve(input: Identity, now = Date.now()) {
  return store.resolve(input, now)
}

export async function rememberFallback(input: Identity, reason: FallbackReason, now = Date.now()) {
  return store.rememberFallback(input, reason, now)
}

export function createStore(file: string) {
  let state: Promise<Record<string, Entry>> | undefined
  let write = Promise.resolve()

  const load = () => {
    if (state) return state
    const current = fs
      .readFile(file, "utf8")
      .then(JSON.parse)
      .then(parse)
      .catch((): Record<string, Entry> => ({}))
    state = current
    return current
  }

  const save = (value: Record<string, Entry>) => {
    write = write
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        const temporary = `${file}.${process.pid}.tmp`
        await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8")
        await fs.rename(temporary, file)
      })
    return write
  }

  return {
    async resolve(input: Identity, now = Date.now()) {
      const current = await load()
      const entry = current[key(input)]
      if (!entry) return { transport: "responses" as const }
      if (entry.expiresAt > now) return entry
      delete current[key(input)]
      await save(current).catch(() => undefined)
      return { transport: "responses" as const }
    },
    async rememberFallback(input: Identity, reason: FallbackReason, now = Date.now()) {
      const current = await load()
      current[key(input)] = { transport: "chat_completions", reason, expiresAt: now + TTL_MS }
      await save(current)
    },
  }
}

export function fallbackReason(error: unknown): FallbackReason | undefined {
  const text = errorText(error).toLowerCase()
  if (text.includes("system message must be at the beginning")) return "system_message_position"
  if (text.includes("invalid_union") && /(?:param|for|['\"])?input\b/.test(text)) return "invalid_responses_input"
  if (text.includes("item_reference") && /(invalid|unsupported|unknown|reference|union)/.test(text))
    return "unsupported_item_reference"
}

export function identity(input: Identity) {
  return {
    baseURL: normalizeBaseURL(input.baseURL),
    modelID: input.modelID,
    instanceID: input.instanceID,
  }
}

function key(input: Identity) {
  const current = identity(input)
  return `${current.baseURL}\0${current.modelID}\0${current.instanceID}`
}

function normalizeBaseURL(value: string) {
  if (!URL.canParse(value)) return value.replace(/\/$/, "")
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/$/, "").replace(/\/(?:api\/)?v1$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function parse(value: unknown): Record<string, Entry> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, entry]) => {
      if (!isRecord(entry) || entry.transport !== "chat_completions") return []
      if (typeof entry.expiresAt !== "number") return []
      const reason = entry.reason
      if (
        reason !== "system_message_position" &&
        reason !== "invalid_responses_input" &&
        reason !== "unsupported_item_reference"
      )
        return []
      return [[id, { transport: "chat_completions" as const, reason, expiresAt: entry.expiresAt }] as const]
    }),
  )
}

function errorText(value: unknown, depth = 0): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return `${value.name} ${value.message} ${errorText(value.cause, depth + 1)}`
  if (!value || typeof value !== "object" || depth >= 5) return ""
  if (Array.isArray(value)) return value.map((item) => errorText(item, depth + 1)).join(" ")
  const record = value as Record<string, unknown>
  return ["message", "responseBody", "body", "error", "data", "cause"]
    .map((name) => errorText(record[name], depth + 1))
    .join(" ")
}
