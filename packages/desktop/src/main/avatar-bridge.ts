import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { WebSocket, WebSocketServer } from "ws"
import type { AvatarBridgeStatus } from "../preload/types"
import { write as writeLog } from "./logging"
import { synthesizeLocalSpeech } from "./local-tts"
import {
  AVATAR_BRIDGE_PROTOCOL,
  parseAvatarAction,
  parseAvatarClientMessage,
  type AvatarActionInput,
  type AvatarActionResult,
  type AvatarHello,
  type AvatarTranscript,
} from "./avatar-bridge-protocol"

const MAX_HTTP_BODY = 64 * 1024
const ACTION_TIMEOUT = 15_000
const TURN_TIMEOUT = 5 * 60_000

type ServerConnection = { url: string; username: string | null; password: string | null }
type ClientState = AvatarHello & { queue: Promise<void> }
type PendingAction = {
  socket: WebSocket
  timer: NodeJS.Timeout
  resolve: (result: { ok: boolean; message?: string }) => void
}

export type AvatarBridgeController = Awaited<ReturnType<typeof startAvatarBridge>>

export async function startAvatarBridge() {
  const token = randomBytes(32).toString("base64url")
  const clients = new Map<WebSocket, ClientState>()
  const pending = new Map<string, PendingAction>()
  const serverConnection = { current: undefined as ServerConnection | undefined }
  const server = createServer(async (request, response) => {
    if (request.socket.remoteAddress !== "127.0.0.1" && request.socket.remoteAddress !== "::1") {
      response.writeHead(403).end()
      return
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end()
      return
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method === "GET" && url.pathname === "/status") {
      json(response, 200, status())
      return
    }
    if (request.method !== "POST" || url.pathname !== "/action") {
      response.writeHead(404).end()
      return
    }
    const body = await readBody(request).catch(() => undefined)
    if (body === undefined) {
      json(response, 400, { error: "Invalid or oversized request body" })
      return
    }
    const action = parseAvatarAction(parseJSON(body))
    if (!action) {
      json(response, 400, { error: "Invalid avatar action" })
      return
    }
    const result = await dispatch(action)
    json(response, result.ok ? 200 : 409, result)
  })
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_HTTP_BODY })

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/avatar" || (request.socket.remoteAddress !== "127.0.0.1" && request.socket.remoteAddress !== "::1")) {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => sockets.emit("connection", websocket, request))
  })

  sockets.on("connection", (socket) => {
    const authTimer = setTimeout(() => socket.close(4401, "Pairing timed out"), 5_000)
    socket.on("message", (data, binary) => {
      if (binary) {
        socket.close(4400, "Binary client messages are not supported")
        return
      }
      const message = parseAvatarClientMessage(parseJSON(data.toString()))
      if (!message) {
        socket.close(4400, "Invalid bridge message")
        return
      }
      const state = clients.get(socket)
      if (!state) {
        if (message.type !== "hello" || message.token !== token) {
          socket.close(4401, "Pairing rejected")
          return
        }
        clearTimeout(authTimer)
        clients.set(socket, { ...message, queue: Promise.resolve() })
        send(socket, {
          type: "welcome",
          protocol: AVATAR_BRIDGE_PROTOCOL,
          clientID: message.clientID,
          characterID: message.characterID,
          sessionID: message.sessionID,
        })
        writeLog("avatar", "Unity avatar connected", {
          clientID: message.clientID,
          characterID: message.characterID,
          actions: message.actions,
        })
        return
      }
      if (message.type === "hello") return
      if (message.type === "character.action.result") {
        settleAction(pending, socket, message)
        return
      }
      const next = state.queue.then(() => handleTranscript(socket, state, message))
      state.queue = next.catch((error) => {
        send(socket, {
          type: "assistant.error",
          requestID: message.requestID,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    })
    socket.on("close", () => {
      clearTimeout(authTimer)
      const state = clients.get(socket)
      clients.delete(socket)
      for (const [id, action] of pending) {
        if (action.socket !== socket) continue
        clearTimeout(action.timer)
        pending.delete(id)
        action.resolve({ ok: false, message: "Unity character disconnected before completing the action" })
      }
      if (state) writeLog("avatar", "Unity avatar disconnected", { clientID: state.clientID })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Avatar Bridge could not allocate a loopback port")
  const url = `ws://127.0.0.1:${address.port}/avatar`

  function status(): AvatarBridgeStatus {
    return {
      available: true,
      protocol: AVATAR_BRIDGE_PROTOCOL,
      url,
      token,
      connectedClients: [...clients.values()].map((client) => ({
        clientID: client.clientID,
        characterID: client.characterID,
        sessionID: client.sessionID,
        actions: client.actions,
      })),
    }
  }

  async function dispatch(action: AvatarActionInput) {
    const target = [...clients.entries()].find(
      ([, client]) =>
        (!action.characterID || client.characterID === action.characterID) && client.actions.includes(action.action),
    )
    if (!target) return { ok: false, message: `No connected character supports ${action.action}` }
    const id = `act_${randomUUID()}`
    return new Promise<{ ok: boolean; message?: string }>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, message: `Unity did not confirm ${action.action} within ${ACTION_TIMEOUT / 1_000}s` })
      }, ACTION_TIMEOUT)
      pending.set(id, { socket: target[0], timer, resolve })
      send(target[0], { type: "character.action", id, ...action })
    })
  }

  async function handleTranscript(socket: WebSocket, state: ClientState, message: AvatarTranscript) {
    const connection = serverConnection.current
    if (!connection) throw new Error("OpenCode server is not ready")
    send(socket, { type: "assistant.started", requestID: message.requestID })
    const started = Date.now()
    const sessionID = state.sessionID ?? (await createChatSession(connection, state))
    state.sessionID = sessionID
    await request(connection, `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      method: "POST",
      body: JSON.stringify({
        agent: "chat",
        parts: [{ type: "text", text: message.text }],
      }),
      signal: AbortSignal.timeout(TURN_TIMEOUT),
    })
    await request(connection, `/api/session/${encodeURIComponent(sessionID)}/wait`, {
      method: "POST",
      signal: AbortSignal.timeout(TURN_TIMEOUT),
    })
    const response = await request(connection, `/api/session/${encodeURIComponent(sessionID)}/message?limit=40&order=desc`, {
      signal: AbortSignal.timeout(30_000),
    })
    const body = await response.json()
    const text = assistantText(body, started)
    if (!text) throw new Error("The agent completed without a text response")
    send(socket, { type: "assistant.text", requestID: message.requestID, sessionID, text })
    if (state.voice) {
      const audio = await synthesizeLocalSpeech({ ...state.voice, text })
      send(socket, {
        type: "assistant.audio",
        requestID: message.requestID,
        sessionID,
        contentType: audio.contentType,
        data: Buffer.from(new Uint8Array(audio.audio)).toString("base64"),
      })
    }
    send(socket, { type: "assistant.done", requestID: message.requestID, sessionID })
  }

  return {
    url,
    token,
    status,
    configureServer(connection: ServerConnection) {
      serverConnection.current = connection
    },
    stop: async () => {
      for (const socket of clients.keys()) socket.close(1001, "OpenCode Customs is shutting down")
      sockets.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function createChatSession(connection: ServerConnection, state: ClientState) {
  const response = await request(connection, "/api/session", {
    method: "POST",
    body: JSON.stringify({
      agent: "chat",
      mode: "chat",
      ...(state.model ? { model: state.model } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.json()
  if (!isRecord(body) || !isRecord(body.data) || typeof body.data.id !== "string") {
    throw new Error("OpenCode returned an invalid session response")
  }
  return body.data.id
}

async function request(connection: ServerConnection, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  if (connection.password) {
    headers.set("authorization", `Basic ${Buffer.from(`${connection.username ?? "opencode"}:${connection.password}`).toString("base64")}`)
  }
  const response = await fetch(new URL(path, connection.url), { ...init, headers })
  if (response.ok) return response
  const detail = (await response.text()).slice(0, 1_000)
  throw new Error(`OpenCode request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`)
}

function assistantText(value: unknown, started: number) {
  if (!isRecord(value) || !Array.isArray(value.data)) return
  const assistant = value.data.find((message) => {
    if (!isRecord(message) || message.type !== "assistant" || message.error !== undefined) return false
    if (!isRecord(message.time) || typeof message.time.created !== "number") return false
    return message.time.created >= started - 2_000 && Array.isArray(message.content)
  })
  if (!isRecord(assistant) || !Array.isArray(assistant.content)) return
  const text = assistant.content
    .flatMap((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("")
    .trim()
  return text || undefined
}

function settleAction(actions: Map<string, PendingAction>, socket: WebSocket, result: AvatarActionResult) {
  const action = actions.get(result.id)
  if (!action || action.socket !== socket) return
  actions.delete(result.id)
  clearTimeout(action.timer)
  action.resolve({ ok: result.ok, ...(result.message ? { message: result.message } : {}) })
}

function send(socket: WebSocket, value: object) {
  if (socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(value))
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  response.end(JSON.stringify(value))
}

async function readBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_HTTP_BODY) throw new Error("Request body is too large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function parseJSON(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
