import { createHash, randomBytes } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { safeStorage, shell } from "electron"
import type { AddressInfo } from "node:net"
import { parseGoogleDesktopClient, sanitizeGoogleError, type GoogleDesktopClient } from "./google-companion-config"

const READ_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
]
const GMAIL_DRAFT_SCOPE = "https://www.googleapis.com/auth/gmail.compose"
const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events"

type Log = (source: string, message: string, data?: Record<string, unknown>, level?: "info" | "warn" | "error") => void
type Client = GoogleDesktopClient
type Token = { accessToken: string; refreshToken?: string; expiresAt: number; scopes: string[] }
type Stored = { client: Client; token?: Token; accountID?: string; email?: string }
type Source = { status: "ready" | "unavailable" | "error"; items: Array<{ id: string; title: string; summary?: string; timestamp?: number; url?: string; revision?: string }>; error?: string }

export type GoogleCompanionStatus = ReturnType<GoogleCompanionController["status"]>
export type GoogleCompanionController = Awaited<ReturnType<typeof startGoogleCompanion>>

export async function startGoogleCompanion(input: { stateDirectory: string; log: Log }) {
  const file = join(input.stateDirectory, "google-companion.enc")
  const state = await readEncrypted(file).catch(() => undefined)
  let stored = state
  let phase: "disconnected" | "connecting" | "connected" | "expired" | "error" = stored?.token ? "connected" : "disconnected"
  let error: string | undefined
  const bearer = randomBytes(32).toString("base64url")
  const requests = new Map<string, { startedAt: number; count: number }>()

  const status = () => ({
    available: safeStorage.isEncryptionAvailable(),
    phase: safeStorage.isEncryptionAvailable() ? phase : "unavailable" as const,
    accountID: stored?.accountID,
    email: stored?.email,
    scopes: stored?.token?.scopes.filter((scope) => READ_SCOPES.includes(scope)) ?? [],
    writeScopes: stored?.token?.scopes.filter((scope) => [GMAIL_DRAFT_SCOPE, CALENDAR_WRITE_SCOPE].includes(scope)) ?? [],
    checkedAt: Date.now(),
    error: safeStorage.isEncryptionAvailable() ? error : "Secure credential storage is unavailable on this system.",
  })

  const server = createServer(async (request, response) => {
    const remote = request.socket.remoteAddress
    const host = request.headers.host?.split(":")[0]
    if (!isLoopback(remote) || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(host ?? "")) return send(response, 403, { error: "loopback_only" })
    if (request.headers.authorization !== `Bearer ${bearer}`) return send(response, 401, { error: "unauthorized" })
    if (!allowRequest(requests, remote ?? "loopback")) return send(response, 429, { error: "rate_limited" })
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method === "GET" && url.pathname === "/status") return send(response, 200, status())
    const body = await readBody(request, 64 * 1024).catch(() => undefined)
    if (!body) return send(response, 400, { error: "invalid_payload" })
    if (request.method === "POST" && url.pathname === "/snapshot") {
      const result = await snapshot(body as { timezone?: string; sources?: Record<string, boolean> }).catch((cause) => ({ error: safeError(cause) }))
      return "error" in result ? send(response, 503, result) : send(response, 200, result)
    }
    if (request.method === "POST" && url.pathname === "/action") {
      const result = await executeAction(body as { kind?: string; input?: Record<string, unknown>; externalRevision?: string }).catch((cause) => ({ error: safeError(cause) }))
      return "error" in result ? send(response, 409, result) : send(response, 200, result)
    }
    return send(response, 404, { error: "not_found" })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address() as AddressInfo

  const save = async () => {
    if (!stored) return
    await writeEncrypted(file, stored)
  }

  const importClient = async (path: string) => {
    const client = parseGoogleDesktopClient(await readFile(path, "utf8"))
    stored = {
      client,
    }
    phase = "disconnected"
    error = undefined
    await save()
    return status()
  }

  const connect = async (writeScopes: string[] = []) => {
    if (!stored) throw new Error("Import a Google Desktop OAuth JSON file first.")
    phase = "connecting"
    error = undefined
    const verifier = randomBytes(48).toString("base64url")
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    const oauthState = randomBytes(24).toString("base64url")
    const callback = createServer()
    await new Promise<void>((resolve, reject) => {
      callback.once("error", reject)
      callback.listen(0, "127.0.0.1", resolve)
    })
    const callbackAddress = callback.address() as AddressInfo
    const redirectURI = `http://127.0.0.1:${callbackAddress.port}/oauth/callback`
    const scopes = [...new Set([...READ_SCOPES, ...writeScopes.filter((scope) => [GMAIL_DRAFT_SCOPE, CALENDAR_WRITE_SCOPE].includes(scope))])]
    const code = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Google authorization timed out.")), 180_000)
      callback.on("request", (request, response) => {
        const url = new URL(request.url ?? "/", redirectURI)
        if (url.pathname !== "/oauth/callback" || url.searchParams.get("state") !== oauthState) {
          response.writeHead(400).end("Invalid OAuth callback")
          return
        }
        const value = url.searchParams.get("code")
        if (!value) {
          response.writeHead(400).end("Authorization was not completed")
          clearTimeout(timeout)
          reject(new Error(url.searchParams.get("error") ?? "Google authorization failed."))
          return
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<h2>OpenCode Customs connected.</h2><p>You can close this window.</p>")
        clearTimeout(timeout)
        resolve(value)
      })
    })
    const auth = new URL(stored.client.authURI)
    auth.search = new URLSearchParams({ client_id: stored.client.clientID, redirect_uri: redirectURI, response_type: "code", scope: scopes.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", code_challenge: challenge, code_challenge_method: "S256", state: oauthState }).toString()
    await shell.openExternal(auth.toString())
    try {
      const authorizationCode = await code
      const token = await tokenRequest(stored.client.tokenURI, { client_id: stored.client.clientID, client_secret: stored.client.clientSecret, code: authorizationCode, code_verifier: verifier, redirect_uri: redirectURI, grant_type: "authorization_code" })
      stored.token = tokenFromResponse(token, stored.token?.refreshToken)
      const profile = await google<{ sub: string; email?: string }>("https://openidconnect.googleapis.com/v1/userinfo")
      stored.accountID = profile.sub
      stored.email = profile.email
      phase = "connected"
      await save()
      return status()
    } catch (cause) {
      phase = "error"
      error = safeError(cause)
      throw cause
    } finally {
      callback.close()
    }
  }

  const test = async () => {
    const profile = await google<{ sub: string; email?: string }>("https://openidconnect.googleapis.com/v1/userinfo")
    if (!stored) throw new Error("Google account is not configured.")
    stored.accountID = profile.sub
    stored.email = profile.email
    phase = "connected"
    error = undefined
    await save()
    return status()
  }

  const disconnect = async () => {
    stored = undefined
    phase = "disconnected"
    error = undefined
    await rm(file, { force: true })
    return status()
  }

  async function snapshot(input: { timezone?: string; sources?: Record<string, boolean> }) {
    if (!stored?.accountID) await test()
    if (!stored?.accountID) throw new Error("Google account is not connected.")
    const [calendar, gmail, drive] = await Promise.all([
      input.sources?.calendar === false ? Promise.resolve(unavailable()) : calendarSource(input.timezone ?? "Europe/Kyiv"),
      input.sources?.gmail === false ? Promise.resolve(unavailable()) : gmailSource(),
      input.sources?.drive === false ? Promise.resolve(unavailable()) : driveSource(),
    ])
    return { accountID: stored.accountID, email: stored.email, calendar, gmail, drive }
  }

  async function executeAction(input: { kind?: string; input?: Record<string, unknown>; externalRevision?: string }) {
    const data = input.input ?? {}
    if (input.kind === "gmail_draft") {
      requireScope(GMAIL_DRAFT_SCOPE)
      const to = requireString(data.to, "Recipient")
      const subject = requireString(data.subject, "Subject")
      const body = requireString(data.body, "Body")
      const raw = Buffer.from([`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n")).toString("base64url")
      const draft = await google<{ id: string }>("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", body: JSON.stringify({ message: { raw } }) })
      return { id: draft.id, kind: input.kind }
    }
    if (input.kind === "calendar_create") {
      requireScope(CALENDAR_WRITE_SCOPE)
      const event = await google<{ id: string; etag?: string; htmlLink?: string }>("https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", body: JSON.stringify(data) })
      return { id: event.id, revision: event.etag, url: event.htmlLink, kind: input.kind }
    }
    if (input.kind === "calendar_update") {
      requireScope(CALENDAR_WRITE_SCOPE)
      const eventID = encodeURIComponent(requireString(data.eventID, "Event ID"))
      const current = await google<{ etag?: string }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventID}`)
      if (input.externalRevision && current.etag !== input.externalRevision) throw new Error("Calendar event changed. Review a new preview before approval.")
      const body = typeof data.event === "object" && data.event ? data.event : {}
      const event = await google<{ id: string; etag?: string; htmlLink?: string }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventID}`, { method: "PATCH", headers: current.etag ? { "if-match": current.etag } : undefined, body: JSON.stringify(body) })
      return { id: event.id, revision: event.etag, url: event.htmlLink, kind: input.kind }
    }
    throw new Error("This companion action is not available through Google.")
  }

  async function calendarSource(timezone: string): Promise<Source> {
    try {
      const now = new Date()
      const end = new Date(now.getTime() + 48 * 60 * 60_000)
      const query = new URLSearchParams({ timeMin: now.toISOString(), timeMax: end.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "50", timeZone: timezone, fields: "items(id,etag,summary,start,end,htmlLink,status)" })
      const data = await google<{ items?: Array<{ id: string; etag?: string; summary?: string; start?: { dateTime?: string; date?: string }; htmlLink?: string }> }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`)
      return { status: "ready", items: (data.items ?? []).map((item) => ({ id: item.id, title: item.summary ?? "Untitled event", timestamp: Date.parse(item.start?.dateTime ?? item.start?.date ?? "") || undefined, url: item.htmlLink, revision: item.etag })) }
    } catch (cause) {
      return sourceError(cause)
    }
  }

  async function gmailSource(): Promise<Source> {
    try {
      const query = new URLSearchParams({ q: "(is:unread OR is:important) newer_than:1d", maxResults: "30" })
      const list = await google<{ messages?: Array<{ id: string }> }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`)
      const items = await Promise.all((list.messages ?? []).slice(0, 30).map(async (message) => {
        const params = new URLSearchParams({ format: "metadata", metadataHeaders: "From" })
        params.append("metadataHeaders", "Subject")
        params.append("metadataHeaders", "Date")
        const data = await google<{ id: string; internalDate?: string; snippet?: string; labelIds?: string[]; payload?: { headers?: Array<{ name: string; value: string }> } }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?${params}`)
        const headers = new Map((data.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]))
        return { id: data.id, title: `${headers.get("from") ?? "Unknown sender"}: ${headers.get("subject") ?? "No subject"}`, summary: compact(data.snippet ?? "", 500), timestamp: Number(data.internalDate) || Date.parse(headers.get("date") ?? "") || undefined }
      }))
      return { status: "ready", items }
    } catch (cause) {
      return sourceError(cause)
    }
  }

  async function driveSource(): Promise<Source> {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()
      const query = new URLSearchParams({ q: `modifiedTime >= '${since}' and trashed = false`, orderBy: "modifiedTime desc", pageSize: "10", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" })
      const data = await google<{ files?: Array<{ id: string; name?: string; mimeType?: string; modifiedTime?: string; webViewLink?: string }> }>(`https://www.googleapis.com/drive/v3/files?${query}`)
      return { status: "ready", items: (data.files ?? []).map((file) => ({ id: file.id, title: file.name ?? "Untitled file", summary: file.mimeType, timestamp: Date.parse(file.modifiedTime ?? "") || undefined, url: file.webViewLink })) }
    } catch (cause) {
      return sourceError(cause)
    }
  }

  async function google<T>(url: string, init?: RequestInit): Promise<T> {
    if (!stored?.token) throw new Error("Google account is not connected.")
    if (stored.token.expiresAt <= Date.now() + 30_000) await refresh()
    const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${stored.token.accessToken}`, "content-type": "application/json", ...init?.headers }, signal: AbortSignal.timeout(20_000) })
    if (response.status === 401 && stored.token.refreshToken) {
      await refresh()
      return google(url, init)
    }
    if (!response.ok) throw new Error(`Google API returned HTTP ${response.status}`)
    return await response.json() as T
  }

  async function refresh() {
    if (!stored?.token?.refreshToken) throw new Error("Google authorization expired. Reconnect the account.")
    const token = await tokenRequest(stored.client.tokenURI, { client_id: stored.client.clientID, client_secret: stored.client.clientSecret, refresh_token: stored.token.refreshToken, grant_type: "refresh_token" })
    stored.token = tokenFromResponse(token, stored.token.refreshToken)
    phase = "connected"
    await save()
  }

  function requireScope(scope: string) {
    if (!stored?.token?.scopes.includes(scope)) throw new Error("This action requires an additional Google permission.")
  }

  input.log("companion", "Google Companion bridge started", { port: address.port })
  return {
    url: `http://127.0.0.1:${address.port}/`,
    token: bearer,
    status,
    importClient,
    connect,
    test,
    disconnect,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function readEncrypted(path: string): Promise<Stored> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable")
  return JSON.parse(safeStorage.decryptString(Buffer.from(await readFile(path, "utf8"), "base64"))) as Stored
}

async function writeEncrypted(path: string, value: Stored) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable")
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  await writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)).toString("base64"), { mode: 0o600 })
  await rename(temporary, path)
}

async function tokenRequest(url: string, input: Record<string, string>) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(input), signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Google token endpoint returned HTTP ${response.status}`)
  return await response.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }
}

function tokenFromResponse(input: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }, refreshToken?: string): Token {
  return { accessToken: input.access_token, refreshToken: input.refresh_token ?? refreshToken, expiresAt: Date.now() + (input.expires_in ?? 3600) * 1000, scopes: input.scope?.split(" ").filter(Boolean) ?? READ_SCOPES }
}

function isLoopback(value?: string) {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1"
}

function allowRequest(requests: Map<string, { startedAt: number; count: number }>, key: string) {
  const now = Date.now()
  const current = requests.get(key)
  if (!current || now - current.startedAt > 60_000) {
    requests.set(key, { startedAt: now, count: 1 })
    return true
  }
  current.count += 1
  return current.count <= 60
}

async function readBody(request: import("node:http").IncomingMessage, limit: number) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new Error("payload_too_large")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body))
}

function sourceError(cause: unknown): Source {
  return { status: "error", items: [], error: safeError(cause) }
}

function unavailable(): Source {
  return { status: "unavailable", items: [] }
}

function safeError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return sanitizeGoogleError(message)
}

function compact(value: string, limit: number) {
  const text = value.replace(/[\u0000-\u001f]+/g, " ").trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`)
  return value.trim()
}
