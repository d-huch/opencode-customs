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
    let jarvisTurnSequence = 0
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
        if (request.method === "POST" && request.url === "/api/jarvis/conversation/adopt") {
          response.end(JSON.stringify({ sessionID: "ses_unity", updatedAt: Date.now() }))
          return
        }
        if (request.method === "POST" && request.url === "/api/jarvis/turns") {
          const input = JSON.parse(Buffer.concat(body).toString()) as Record<string, unknown>
          response.end(JSON.stringify({
            id: `turn-${String(input.requestID)}`,
            ...input,
            phase: input.phase ?? "listening",
            sequence: jarvisTurnSequence,
            metrics: {},
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }))
          return
        }
        if (request.method === "PATCH" && request.url?.startsWith("/api/jarvis/turns/")) {
          const input = JSON.parse(Buffer.concat(body).toString()) as Record<string, unknown>
          jarvisTurnSequence = Number(input.sequence ?? jarvisTurnSequence + 1)
          response.end(JSON.stringify({ id: request.url.split("/").at(-1), ...input }))
          return
        }
        if (request.method === "POST" && request.url === "/api/jarvis/presence/handoff") {
          response.end(Buffer.concat(body).toString())
          return
        }
        if (request.method === "POST" && request.url === "/api/jarvis/media") {
          response.end(Buffer.concat(body).toString())
          return
        }
        if (request.method === "POST" && request.url === "/api/jarvis/replays") {
          const input = JSON.parse(Buffer.concat(body).toString()) as Record<string, unknown>
          response.end(JSON.stringify({ id: "replay-unity", ...input, createdAt: Date.now(), updatedAt: Date.now() }))
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
        if (request.method === "POST" && request.url === "/api/jarvis/turns/admit") {
          const input = JSON.parse(Buffer.concat(body).toString()) as Record<string, unknown>
          promptBodies.push(input)
          response.end(JSON.stringify({
            conversation: { sessionID: "ses_unity", updatedAt: Date.now() },
            turn: {
              id: `turn-${String(input.requestID)}`,
              requestID: input.requestID,
              sessionID: "ses_unity",
              surface: input.surface,
              phase: "responding",
              sequence: ++jarvisTurnSequence,
              metrics: { admittedAt: Date.now() },
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            messageID: "msg_jarvis_test",
            admitted: true,
          }))
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
    expect(promptBodies[0]).toMatchObject({ transcript: "Привіт" })
    expect(promptBodies[1]).toMatchObject({ transcript: "Що ти бачиш?" })
    expect(promptBodies[0]).not.toHaveProperty("prompt")
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
    expect(await next(resumedMessages, "welcome")).toMatchObject({ serverVersion: "2.12", protocolMinor: 12 })

    resumed.close()
    await bridge.stop()
    await rm(directory, { recursive: true })
  })

  test.serial("retries one instructor command after a matching scenario reconnect", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-instructor-"))
    const bridge = await startAvatarBridge({ stateDirectory: directory, bootstrapPort: 0, discoveryPort: 0 })
    const identity = {
      protocol: 2,
      protocolMinor: 9,
      token: bridge.token,
      clientID: "instructor-client",
      characterID: "instructor",
      gameID: "safety-training",
      saveSlotID: "pilot-1",
      actions: [],
    }
    const snapshot = {
      type: "scenario.snapshot",
      runID: "run-instructor-1",
      scenarioID: "equipment-isolation",
      scenarioRevision: 3,
      timestamp: Date.now(),
      traineeID: "trainee-1",
      instructorID: "instructor-1",
      status: "running",
      currentStepID: "ppe-inspection",
      attempt: 1,
      timeoutRemainingMs: 45_000,
      evidence: {},
      instructorEvidenceIDs: ["instructor-signoff"],
    }
    const first = new WebSocket(bridge.url)
    const firstMessages: Record<string, unknown>[] = []
    first.on("message", (value, binary) => {
      if (!binary) firstMessages.push(JSON.parse(value.toString()) as Record<string, unknown>)
    })
    await opened(first)
    first.send(JSON.stringify({ type: "hello", ...identity }))
    await next(firstMessages, "welcome")
    first.send(JSON.stringify(snapshot))
    await Bun.sleep(20)

    const input = {
      requestID: "instructor-request-1",
      runID: snapshot.runID,
      scenarioRevision: snapshot.scenarioRevision,
      expectedStepID: snapshot.currentStepID,
      instructorID: snapshot.instructorID,
      command: "pause" as const,
    }
    const pending = bridge.instructorCommand(input)
    expect(await next(firstMessages, "instructor.command")).toMatchObject({ requestID: input.requestID, command: "pause" })
    first.close()
    await closed(first)

    const resumed = new WebSocket(bridge.url)
    const resumedMessages: Record<string, unknown>[] = []
    resumed.on("message", (value, binary) => {
      if (!binary) resumedMessages.push(JSON.parse(value.toString()) as Record<string, unknown>)
    })
    await opened(resumed)
    resumed.send(JSON.stringify({ type: "hello", ...identity }))
    await next(resumedMessages, "welcome")
    resumed.send(JSON.stringify({ ...snapshot, timestamp: Date.now() }))
    expect(await next(resumedMessages, "instructor.command")).toMatchObject({ requestID: input.requestID, command: "pause" })
    resumed.send(JSON.stringify({
      type: "instructor.command.result",
      requestID: input.requestID,
      runID: input.runID,
      ok: true,
      code: "paused",
      timestamp: Date.now(),
      stepID: input.expectedStepID,
      attempt: 1,
    }))
    expect(await pending).toMatchObject({ requestID: input.requestID, ok: true, code: "paused" })
    expect(await bridge.instructorCommand(input)).toMatchObject({ requestID: input.requestID, ok: true, code: "paused" })

    resumed.close()
    await bridge.stop()
    await rm(directory, { recursive: true })
  })

  test.serial("routes v2.11 AI Trainee controls and auto-approves only simulation allowlists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-ai-trainee-"))
    const controls: Record<string, unknown>[] = []
    const bridge = await startAvatarBridge({
      stateDirectory: directory,
      bootstrapPort: 0,
      discoveryPort: 0,
      onAITraineeControl: async (message) => {
        controls.push(message)
        return { ok: true, code: "started", runID: "ai-run-1" }
      },
    })
    let socket = new WebSocket(bridge.url)
    const messages: Record<string, unknown>[] = []
    socket.on("message", (value, binary) => { if (!binary) messages.push(JSON.parse(value.toString()) as Record<string, unknown>) })
    await opened(socket)
    socket.send(JSON.stringify({
      type: "hello", protocol: 2, protocolMinor: 11, token: bridge.token, clientID: "ai-client",
      characterID: "trainee", gameID: "loto", saveSlotID: "simulation", actions: [],
    }))
    await next(messages, "welcome")
    socket.send(JSON.stringify({ type: "ai.trainee.control", requestID: "control-1", command: "start", profile: "guided", seed: 7 }))
    expect(await next(messages, "ai.trainee.command.result")).toMatchObject({ requestID: "control-1", ok: true, runID: "ai-run-1" })
    expect(controls).toEqual([expect.objectContaining({ command: "start", profile: "guided", characterID: "trainee" })])

    socket.send(JSON.stringify({
      type: "capability.manifest", revision: 1, capabilities: [{
        id: "safety.apply_lockout", title: "Apply lockout", description: "Apply a simulated lock",
        parameters: { type: "object", properties: { entityID: { type: "string" } }, required: ["entityID"] },
        risk: "critical", permissionCategory: "equipment.lockout", cooldownMs: 0, timeoutMs: 2_000,
        cancellable: true, preconditions: ["disconnectOpened=true"], postconditions: ["lockoutApplied=true"],
      }],
    }))
    await next(messages, "capability.ack")
    socket.send(JSON.stringify({
      type: "world.snapshot", world: {
        gameID: "loto", saveSlotID: "simulation", characterID: "trainee", revision: 1, timestamp: Date.now(),
        entities: [{ id: "lock", kind: "equipment", tags: ["lockout"], visible: true, state: {}, affordances: ["safety.apply_lockout"] }],
        inventory: {}, quests: {}, relationships: {}, events: [],
      },
    }))
    await next(messages, "world.ack")
    const scenario = {
      type: "scenario.snapshot", runID: "scenario-run-1", scenarioID: "equipment-isolation", scenarioRevision: 1,
      timestamp: Date.now(), status: "running", attempt: 1, timeoutRemainingMs: 60_000,
      currentStepID: "apply-lockout", currentInstruction: "Apply the lock", allowedCapabilityIDs: ["safety.apply_lockout"],
      evidence: {}, instructorEvidenceIDs: [], simulation: true, criticalAutoApproveCategories: ["equipment.lockout"],
    }
    socket.send(JSON.stringify(scenario))
    await Bun.sleep(20)

    const input = {
      runID: "ai-run-1", scenarioRunID: "scenario-run-1", characterID: "trainee",
      decision: { capabilityID: "safety.apply_lockout", entityID: "lock", arguments: {}, expectedPostconditions: ["lockoutApplied=true"] },
      idempotencyKey: "ai-run-1:1", simulationAutoApprove: true,
    }
    const pending = bridge.aiTraineeAction(input)
    const action = await next(messages, "game.action")
    expect(messages.some((message) => message.type === "approval.request")).toBe(false)
    socket.send(JSON.stringify({ type: "game.action.result", id: action.id, ok: true, code: "completed" }))
    const result = await pending
    expect(result).toMatchObject({ ok: true, autoApproved: true, approved: true })
    expect(await bridge.aiTraineeAction(input)).toEqual(result)
    expect(messages.filter((message) => message.type === "game.action")).toHaveLength(0)

    const reconnectInput = { ...input, idempotencyKey: "ai-run-1:reconnect" }
    const reconnectPending = bridge.aiTraineeAction(reconnectInput)
    const originalRequest = await next(messages, "game.action")
    socket.close()
    await closed(socket)
    const resumed = new WebSocket(bridge.url)
    resumed.on("message", (value, binary) => { if (!binary) messages.push(JSON.parse(value.toString()) as Record<string, unknown>) })
    await opened(resumed)
    resumed.send(JSON.stringify({
      type: "hello", protocol: 2, protocolMinor: 11, token: bridge.token, clientID: "ai-client",
      characterID: "trainee", gameID: "loto", saveSlotID: "simulation", actions: [],
    }))
    await next(messages, "welcome")
    const retriedRequest = await next(messages, "game.action")
    expect(retriedRequest.id).toBe(originalRequest.id)
    resumed.send(JSON.stringify({ type: "game.action.result", id: retriedRequest.id, ok: true, code: "completed" }))
    expect(await reconnectPending).toMatchObject({ ok: true, autoApproved: true })
    socket = resumed

    socket.send(JSON.stringify({
      type: "capability.manifest", revision: 1, capabilities: [{
        id: "safety.apply_lockout", title: "Apply lockout", description: "Apply a simulated lock",
        parameters: { type: "object", properties: { entityID: { type: "string" } }, required: ["entityID"] },
        risk: "critical", permissionCategory: "equipment.lockout", cooldownMs: 0, timeoutMs: 2_000,
        cancellable: true, preconditions: ["disconnectOpened=true"], postconditions: ["lockoutApplied=true"],
      }],
    }))
    await next(messages, "capability.ack")
    socket.send(JSON.stringify({
      type: "world.snapshot", world: {
        gameID: "loto", saveSlotID: "simulation", characterID: "trainee", revision: 2, timestamp: Date.now(),
        entities: [{ id: "lock", kind: "equipment", tags: ["lockout"], visible: true, state: {}, affordances: ["safety.apply_lockout"] }],
        inventory: {}, quests: {}, relationships: {}, events: [],
      },
    }))
    await next(messages, "world.ack")
    socket.send(JSON.stringify({ ...scenario, timestamp: Date.now(), simulation: false }))
    await Bun.sleep(20)
    const denied = bridge.aiTraineeAction({ ...input, idempotencyKey: "ai-run-1:2" })
    const approval = await next(messages, "approval.request")
    expect(bridge.resolveApproval(String(approval.id), false)).toBe(true)
    expect(await denied).toMatchObject({ ok: false, code: "approval_denied" })

    socket.close()
    await bridge.stop()
    await rm(directory, { recursive: true })
  })

  test.serial("performs one bounded v2.12 scenario test reset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-reset-"))
    const bridge = await startAvatarBridge({ stateDirectory: directory, bootstrapPort: 0, discoveryPort: 0 })
    const socket = new WebSocket(bridge.url)
    const messages: Record<string, unknown>[] = []
    socket.on("message", (value, binary) => { if (!binary) messages.push(JSON.parse(value.toString()) as Record<string, unknown>) })
    await opened(socket)
    socket.send(JSON.stringify({
      type: "hello", protocol: 2, protocolMinor: 12, token: bridge.token, clientID: "validation-client",
      characterID: "trainee", gameID: "loto", saveSlotID: "simulation", actions: [],
    }))
    await next(messages, "welcome")
    socket.send(JSON.stringify({
      type: "scenario.snapshot", runID: "scenario-run-1", scenarioID: "training.equipment-isolation", scenarioRevision: 2,
      timestamp: Date.now(), status: "running", attempt: 1, timeoutRemainingMs: 60_000, evidence: {}, instructorEvidenceIDs: [],
      simulation: true, baselineFingerprint: "baseline", capabilityRevision: 3,
    }))
    await Bun.sleep(20)
    const pending = bridge.scenarioTestReset({ scenarioID: "training.equipment-isolation", scenarioRevision: 2, expectedBaselineFingerprint: "baseline" })
    const request = await next(messages, "scenario.test.reset")
    socket.send(JSON.stringify({
      type: "scenario.test.reset.result", requestID: request.requestID, ok: true, code: "reset", timestamp: Date.now(),
      scenarioID: "training.equipment-isolation", scenarioRevision: 2, baselineFingerprint: "baseline", capabilityRevision: 3,
      worldRevision: 9, runID: "scenario-run-2",
    }))
    expect(await pending).toMatchObject({ ok: true, code: "reset", baselineFingerprint: "baseline", capabilityRevision: 3, worldRevision: 9 })
    socket.close()
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
      protocolMinor: 6,
    }
    const profile = await fetch(`${endpoint}/v1/avatar/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(identity),
    }).then((response) => response.json()) as Record<string, unknown>
    expect(profile).toMatchObject({ ...identity, protocolMinor: 12, bootstrapVersion: 1, url: bridge.url })
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
      protocolMinor: 12,
      certificateFingerprint: bridge.status().lan?.certificateFingerprint,
    })
    expect(value).not.toHaveProperty("token")
    expect(value.addresses).toBeArray()

    socket.close()
    await bridge.stop()
    await rm(directory, { recursive: true })
  })

  test.serial("forwards v2.10 demonstration events once and acknowledges them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-demonstration-"))
    const recorded: Record<string, unknown>[] = []
    const bridge = await startAvatarBridge({
      stateDirectory: directory,
      bootstrapPort: 0,
      discoveryPort: 0,
      onDemonstrationEvent: (message) => { recorded.push(message) },
    })
    const socket = new WebSocket(bridge.url)
    const messages: Record<string, unknown>[] = []
    socket.on("message", (value, binary) => { if (!binary) messages.push(JSON.parse(value.toString()) as Record<string, unknown>) })
    await opened(socket)
    socket.send(JSON.stringify({
      type: "hello", protocol: 2, protocolMinor: 10, token: bridge.token, clientID: "demo-client",
      characterID: "instructor", gameID: "loto", saveSlotID: "one", actions: [],
    }))
    await next(messages, "welcome")
    socket.send(JSON.stringify({ type: "demonstration.start", demonstrationID: "demo-1", timestamp: Date.now(), title: "LOTO" }))
    expect(await next(messages, "demonstration.ack")).toMatchObject({ demonstrationID: "demo-1", status: "recorded" })
    socket.send(JSON.stringify({
      type: "demonstration.event", demonstrationID: "demo-1", eventID: "event-1", sequence: 1, timestamp: Date.now(),
      entityID: "disconnect_switch", capabilityID: "safety.open_disconnect", action: "open_disconnect", ok: true,
      code: "completed", risk: "critical", permissionCategory: "equipment.isolation", postconditions: ["disconnectOpened=true"],
    }))
    expect(await next(messages, "demonstration.ack")).toMatchObject({ demonstrationID: "demo-1", eventID: "event-1" })
    expect(recorded).toEqual([
      expect.objectContaining({ type: "demonstration.start", clientID: "demo-client", gameID: "loto" }),
      expect.objectContaining({ type: "demonstration.event", eventID: "event-1", risk: "critical" }),
    ])
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
