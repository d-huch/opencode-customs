import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { WebSocket } from "ws"
import { startAvatarBridge } from "./avatar-bridge"

describe("Avatar Bridge v2 integration", () => {
  test("negotiates world state, capabilities, bounded actions, and idempotency", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-v2-"))
    const bridge = await startAvatarBridge({ stateDirectory: directory })
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
    expect(await next(resumedMessages, "welcome")).toMatchObject({ serverVersion: "2.1", protocolMinor: 1 })

    resumed.close()
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
