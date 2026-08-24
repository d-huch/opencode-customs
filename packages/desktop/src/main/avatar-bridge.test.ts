import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createSocket } from "node:dgram"
import { createServer, type ServerResponse } from "node:http"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { WebSocket } from "ws"
import { startAvatarBridge } from "./avatar-bridge"

describe("Avatar Bridge v2 integration", () => {
  test.serial("submits Unity transcripts through the durable Session prompt API", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-session-"))
    const promptBodies: unknown[] = []
    let synthesisCalls = 0
    let catalogCalls = 0
    const streams = new Set<ServerResponse>()
    const emit = (type: string, data: Record<string, unknown>) => {
      const frame = `data: ${JSON.stringify({ type, data })}\n\n`
      for (const stream of streams) stream.write(frame)
    }
    const server = createServer((request, response) => {
      const body: Buffer[] = []
      request.on("data", (chunk: Buffer) => body.push(chunk))
      request.on("end", () => {
        if (request.method === "GET" && request.url === "/api/event") {
          response.setHeader("content-type", "text/event-stream")
          response.setHeader("cache-control", "no-cache")
          response.write(": subscribed\n\n")
          streams.add(response)
          response.once("close", () => streams.delete(response))
          return
        }
        response.setHeader("content-type", "application/json")
        if (request.method === "GET" && request.url === "/api/jarvis/status") {
          response.end(JSON.stringify({ config: { models: { dialogue: { providerID: "lmstudio", modelID: "qwen/test" } } } }))
          return
        }
        if (request.method === "GET" && request.url === "/api/model") {
          catalogCalls++
          response.end(JSON.stringify({ data: catalogCalls <= 2 ? [] : [{ providerID: "lmstudio", id: "qwen/test" }] }))
          return
        }
        if (request.method === "GET" && request.url === "/provider/lmstudio/probe") {
          response.end(JSON.stringify({
            provider: "lmstudio",
            status: "ready",
            models: [{ id: "qwen/test", loaded: true, instances: [] }],
          }))
          return
        }
        if (request.method === "POST" && request.url === "/api/session") {
          response.end(JSON.stringify({ data: { id: "ses_unity" } }))
          return
        }
        if (request.method === "GET" && request.url === "/api/session/ses_unity") {
          response.end(JSON.stringify({ data: { id: "ses_unity" } }))
          return
        }
        if (request.method === "GET" && request.url === "/api/session/ses_stale") {
          response.statusCode = 404
          response.end(JSON.stringify({ message: "Session not found" }))
          return
        }
        if (request.method === "POST" && request.url === "/api/session/ses_unity/prompt") {
          promptBodies.push(JSON.parse(Buffer.concat(body).toString()))
          response.end(JSON.stringify({ data: { id: "input_unity" } }))
          const assistantMessageID = `assistant-${promptBodies.length}`
          setTimeout(() => {
            if (promptBodies.length >= 3) {
              emit("session.next.step.failed", {
                sessionID: "ses_unity",
                assistantMessageID,
                error: { message: "Model unavailable: lmstudio/qwen/test" },
              })
              return
            }
            emit("session.next.step.started", {
              sessionID: "ses_unity",
              assistantMessageID,
              model: { providerID: "lmstudio", id: "qwen/test" },
            })
            emit("session.next.text.started", { sessionID: "ses_unity", assistantMessageID, textID: "text-1" })
            emit("session.next.text.delta", {
              sessionID: "ses_unity",
              assistantMessageID,
              textID: "text-1",
              delta: "Вітаю ",
            })
            emit("session.next.text.delta", {
              sessionID: "ses_unity",
              assistantMessageID,
              textID: "text-1",
              delta: "з Unity",
            })
            emit("session.next.text.ended", {
              sessionID: "ses_unity",
              assistantMessageID,
              textID: "text-1",
              text: "Вітаю з Unity",
            })
            emit("session.next.step.ended", { sessionID: "ses_unity", assistantMessageID, finish: "stop" })
          }, 5)
          return
        }
        response.statusCode = 404
        response.end(JSON.stringify({ error: "Not found" }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Test server did not allocate a port")
    const bridge = await startAvatarBridge({
      stateDirectory: directory,
      bootstrapPort: 0,
      discoveryPort: 0,
      synthesize: async () => {
        synthesisCalls++
        return { contentType: "audio/wav", audio: new Uint8Array([1, 2, 3]).buffer }
      },
    })
    bridge.configureServer({ url: `http://127.0.0.1:${address.port}`, username: null, password: null })
    const socket = new WebSocket(bridge.url)
    const messages: Record<string, unknown>[] = []
    socket.on("message", (value, binary) => {
      if (!binary) messages.push(JSON.parse(value.toString()) as Record<string, unknown>)
    })
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    })
    socket.send(JSON.stringify({
      type: "hello",
      protocol: 2,
      protocolMinor: 4,
      token: bridge.token,
      clientID: "unity-test",
      characterID: "jarvis",
      gameID: "jarvis-lab",
      saveSlotID: "slot-1",
      sessionID: "ses_stale",
      actions: [],
      voice: {
        provider: "fish-local",
        endpoint: "http://127.0.0.1:8080/v1/tts",
        model: "fish-speech-s2-pro",
        voice: "default",
        mode: "quality",
      },
    }))
    await next(messages, "welcome")
    socket.send(JSON.stringify({
      type: "world.snapshot",
      world: {
        gameID: "jarvis-lab",
        saveSlotID: "slot-1",
        characterID: "jarvis",
        revision: 1,
        timestamp: Date.now(),
        entities: [],
        inventory: {},
        quests: {},
        relationships: {},
        events: [],
      },
    }))
    await next(messages, "world.ack")
    socket.send(JSON.stringify({ type: "user.transcript", requestID: "voice-1", text: "Привіт" }))
    expect(await next(messages, "assistant.text.start")).toMatchObject({ model: "lmstudio/qwen/test" })
    expect(await next(messages, "assistant.text.delta")).toMatchObject({ delta: "Вітаю " })
    expect(await next(messages, "assistant.text.delta")).toMatchObject({ delta: "з Unity" })
    expect(await next(messages, "assistant.text.done")).toMatchObject({ text: "Вітаю з Unity", model: "lmstudio/qwen/test" })
    await next(messages, "assistant.audio.start")
    await next(messages, "assistant.done")
    expect(synthesisCalls).toBe(1)

    socket.send(JSON.stringify({
      type: "speech.final",
      requestID: "typed-1",
      text: "Що ти бачиш?",
      responseMode: "text",
    }))
    await next(messages, "assistant.text.start")
    await next(messages, "assistant.text.delta")
    await next(messages, "assistant.text.delta")
    expect(await next(messages, "assistant.text.done")).toMatchObject({ text: "Вітаю з Unity" })
    await next(messages, "assistant.done")
    expect(synthesisCalls).toBe(1)
    expect(promptBodies).toHaveLength(2)
    expect(promptBodies[0]).toMatchObject({ prompt: { text: expect.stringContaining("Привіт") } })
    expect(promptBodies[1]).toMatchObject({ prompt: { text: expect.stringContaining("Що ти бачиш?") } })
    expect(promptBodies[0]).not.toHaveProperty("parts")
    expect(catalogCalls).toBeGreaterThanOrEqual(3)

    socket.send(JSON.stringify({
      type: "speech.final",
      requestID: "typed-error",
      text: "Trigger model error",
      responseMode: "text",
    }))
    expect(await next(messages, "assistant.error")).toMatchObject({
      error: "Model unavailable: lmstudio/qwen/test",
    })
    expect(synthesisCalls).toBe(1)

    socket.close()
    await bridge.stop()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true })
  })

  test.serial("negotiates world state, capabilities, bounded actions, and idempotency", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-v2-"))
    const bridge = await startAvatarBridge({ stateDirectory: directory, bootstrapPort: 0, discoveryPort: 0 })
    const socket = new WebSocket(bridge.url)
    const messages: Record<string, unknown>[] = []
    socket.on("message", (value, binary) => {
      if (!binary) messages.push(JSON.parse(value.toString()) as Record<string, unknown>)
    })
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    })
    socket.send(
      JSON.stringify({
        type: "hello",
        protocol: 2,
        token: bridge.token,
        clientID: "test-client",
        characterID: "companion",
        gameID: "test-game",
        saveSlotID: "slot-1",
        actions: [],
      }),
    )
    await next(messages, "welcome")
    socket.send(
      JSON.stringify({
        type: "capability.manifest",
        revision: 1,
        capabilities: [
          {
            id: "look_at",
            title: "Look at target",
            description: "Turn toward a world target",
            parameters: {
              type: "object",
              properties: { entityID: { type: "string" } },
              required: ["entityID"],
            },
            risk: "ambient",
            cooldownMs: 0,
            timeoutMs: 2000,
            cancellable: true,
            preconditions: [],
          },
        ],
      }),
    )
    socket.send(
      JSON.stringify({
        type: "world.snapshot",
        world: {
          gameID: "test-game",
          saveSlotID: "slot-1",
          characterID: "companion",
          revision: 1,
          timestamp: Date.now(),
          entities: [
            {
              id: "player",
              kind: "player",
              tags: ["player"],
              visible: true,
              state: {},
              affordances: [],
            },
          ],
          inventory: {},
          quests: {},
          relationships: {},
          events: [],
        },
      }),
    )
    await next(messages, "world.ack")

    const endpoint = bridge.url.replace("ws://", "http://").replace("/avatar", "")
    const headers = { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" }
    const world = await fetch(`${endpoint}/world?characterID=companion`, { headers }).then((response) => response.json())
    expect(world).toMatchObject({ characterID: "companion", revision: 1 })

    const action = fetch(`${endpoint}/action`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        characterID: "companion",
        actionID: "look_at",
        args: { entityID: "player" },
        cycleID: "cycle-1",
        idempotencyKey: "look-player-once",
      }),
    })
    const request = await next(messages, "game.action")
    socket.send(JSON.stringify({ type: "game.action.result", id: request.id, ok: true, message: "looked" }))
    const result = await action.then((response) => response.json())
    expect(result).toMatchObject({ ok: true, actionID: "look_at", remainingActions: 7 })

    const repeated = await fetch(`${endpoint}/action`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        characterID: "companion",
        actionID: "look_at",
        args: { entityID: "player" },
        cycleID: "cycle-1",
        idempotencyKey: "look-player-once",
      }),
    }).then((response) => response.json())
    expect(repeated).toEqual(result)

    socket.send(
      JSON.stringify({
        type: "capability.manifest",
        revision: 2,
        capabilities: [
          {
            id: "critical_choice",
            title: "Commit story choice",
            description: "Persist a branching story decision",
            parameters: { type: "object" },
            risk: "critical",
            cooldownMs: 0,
            timeoutMs: 2000,
            cancellable: false,
            preconditions: [],
          },
        ],
      }),
    )
    await next(messages, "capability.ack")
    const critical = fetch(`${endpoint}/action`, {
      method: "POST",
      headers,
      body: JSON.stringify({ characterID: "companion", actionID: "critical_choice", args: {} }),
    })
    const approval = await next(messages, "approval.request")
    expect(bridge.resolveApproval(String(approval.id), false)).toBe(true)
    const denied = await critical.then(async (response) => ({ status: response.status, body: await response.json() }))
    expect(denied).toMatchObject({ status: 403, body: { ok: false, code: "approval_denied" } })

    await bridge.updateConfig({
      trustedProfiles: [{ gameID: "test-game", allowInteraction: true, allowedCriticalCategories: ["critical_choice"] }],
    })
    const trusted = fetch(`${endpoint}/action`, {
      method: "POST",
      headers,
      body: JSON.stringify({ characterID: "companion", actionID: "critical_choice", args: {}, idempotencyKey: "trusted-choice" }),
    })
    const trustedRequest = await next(messages, "game.action")
    socket.send(JSON.stringify({
      type: "game.action.result",
      id: trustedRequest.id,
      ok: true,
      code: "completed",
      changedEntityIDs: ["story"],
      observeAgain: true,
    }))
    expect(await trusted.then((response) => response.json())).toMatchObject({
      ok: true,
      changedEntityIDs: ["story"],
      observeAgain: true,
    })

    for (let revision = 2; revision <= 101; revision++) {
      socket.send(JSON.stringify({
        type: "world.delta",
        gameID: "test-game",
        saveSlotID: "slot-1",
        characterID: "companion",
        revision,
        timestamp: Date.now(),
        upsert: [],
        remove: [],
      }))
      await next(messages, "world.ack")
    }
    expect(await fetch(`${endpoint}/world?characterID=companion`, { headers }).then((response) => response.json())).toMatchObject({ revision: 101 })

    const latestSequence = Math.max(...messages.flatMap((message) => typeof message.sequence === "number" ? [message.sequence] : []), 0)
    socket.close()
    await new Promise((resolve) => socket.once("close", resolve))
    const resumed = new WebSocket(bridge.url)
    const resumedMessages: Record<string, unknown>[] = []
    resumed.on("message", (value, binary) => {
      if (!binary) resumedMessages.push(JSON.parse(value.toString()) as Record<string, unknown>)
    })
    await new Promise<void>((resolve, reject) => {
      resumed.once("open", resolve)
      resumed.once("error", reject)
    })
    resumed.send(JSON.stringify({
      type: "hello",
      protocol: 2,
      protocolMinor: 1,
      token: bridge.token,
      clientID: "test-client",
      characterID: "companion",
      gameID: "test-game",
      saveSlotID: "slot-1",
      actions: [],
      resumeSequence: latestSequence,
    }))
    expect(await next(resumedMessages, "welcome")).toMatchObject({ serverVersion: "2.5", protocolMinor: 5 })

    resumed.close()
    await bridge.stop()
    await rm(directory, { recursive: true })
  })

  test.serial("issues one-time identity-bound localhost bootstrap profiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-bootstrap-"))
    const logs: Array<{ message: string; data?: Record<string, unknown> }> = []
    const bridge = await startAvatarBridge({
      stateDirectory: directory,
      bootstrapPort: 0,
      discoveryPort: 0,
      log: (_category, message, data) => logs.push({ message, data }),
    })
    const bootstrap = bridge.status().bootstrap
    expect(bootstrap).toMatchObject({ available: true })
    const endpoint = `http://127.0.0.1:${bootstrap?.port}`
    expect(await fetch(`${endpoint}/v1/avatar/health`).then((response) => response.json())).toMatchObject({
      product: "OpenCode Customs",
      available: true,
      bootstrapVersion: 1,
      protocol: 2,
    })
    const identity = {
      clientID: "unity-bootstrap",
      characterID: "jarvis",
      gameID: "jarvis-lab",
      saveSlotID: "slot-1",
      protocol: 2,
      protocolMinor: 5,
    }
    const profile = await fetch(`${endpoint}/v1/avatar/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(identity),
    }).then((response) => response.json()) as Record<string, unknown>
    expect(profile).toMatchObject({ ...identity, bootstrapVersion: 1, url: bridge.url })
    expect(typeof profile.token).toBe("string")
    expect(typeof profile.expiresAt).toBe("number")

    const first = new WebSocket(String(profile.url))
    const messages: Record<string, unknown>[] = []
    first.on("message", (value, binary) => {
      if (!binary) messages.push(JSON.parse(value.toString()) as Record<string, unknown>)
    })
    await opened(first)
    first.send(JSON.stringify({ type: "hello", ...identity, token: profile.token, actions: [] }))
    expect(await next(messages, "welcome")).toMatchObject({ protocol: 2 })

    const replay = new WebSocket(String(profile.url))
    await opened(replay)
    replay.send(JSON.stringify({ type: "hello", ...identity, token: profile.token, actions: [] }))
    expect(await closed(replay)).toBe(4401)

    const retryProfile = await fetch(`${endpoint}/v1/avatar/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(identity),
    }).then((response) => response.json()) as Record<string, unknown>
    const mismatched = new WebSocket(String(retryProfile.url))
    await opened(mismatched)
    mismatched.send(JSON.stringify({
      type: "hello",
      ...identity,
      characterID: "not-jarvis",
      token: retryProfile.token,
      actions: [],
    }))
    expect(await closed(mismatched)).toBe(4401)

    const retried = new WebSocket(String(retryProfile.url))
    const retriedMessages: Record<string, unknown>[] = []
    retried.on("message", (value, binary) => {
      if (!binary) retriedMessages.push(JSON.parse(value.toString()) as Record<string, unknown>)
    })
    await opened(retried)
    retried.send(JSON.stringify({ type: "hello", ...identity, token: retryProfile.token, actions: [] }))
    expect(await next(retriedMessages, "welcome")).toMatchObject({ protocol: 2 })
    expect(logs.some((entry) => entry.data?.reason === "replay")).toBe(true)
    expect(logs.some((entry) => entry.data?.reason === "identity_mismatch")).toBe(true)
    expect(JSON.stringify(logs)).not.toContain(String(profile.token))
    expect(JSON.stringify(logs)).not.toContain(String(retryProfile.token))

    first.close()
    retried.close()
    await bridge.stop()
    await rm(directory, { recursive: true })
  })

  test.serial("advertises secure Quest endpoints without credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-discovery-"))
    const bridge = await startAvatarBridge({ stateDirectory: directory, bootstrapPort: 0, discoveryPort: 0 })
    await bridge.updateConfig({ lanEnabled: true })
    const discovery = bridge.status().lan?.discovery
    expect(discovery).toMatchObject({ available: true })
    const socket = createSocket("udp4")
    await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve))
    const announcement = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Quest discovery timed out")), 2_000)
      socket.once("message", (value) => {
        clearTimeout(timer)
        resolve(JSON.parse(value.toString()) as Record<string, unknown>)
      })
    })
    socket.send(
      Buffer.from(JSON.stringify({ service: "opencode-customs-avatar", version: 1 })),
      discovery?.port,
      "127.0.0.1",
    )
    const value = await announcement
    expect(value).toMatchObject({
      service: "opencode-customs-avatar",
      version: 1,
      protocol: 2,
      protocolMinor: 5,
      certificateFingerprint: bridge.status().lan?.certificateFingerprint,
    })
    expect(value).not.toHaveProperty("token")
    expect(value.addresses).toBeArray()

    socket.close()
    await bridge.stop()
    await rm(directory, { recursive: true })
  })
})

async function next(messages: Record<string, unknown>[], type: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const index = messages.findIndex((message) => message.type === type)
    if (index >= 0) return messages.splice(index, 1)[0]
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${type}`)
}

function opened(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
}

function closed(socket: WebSocket) {
  return new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)))
}
