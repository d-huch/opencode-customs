import { describe, expect, test } from "bun:test"
import { AVATAR_ACTIONS, parseAvatarAction, parseAvatarClientMessage, parseGameAction } from "./avatar-bridge-protocol"

describe("Unity Avatar Bridge protocol", () => {
  test("accepts a bounded pairing handshake and removes duplicate capabilities", () => {
    expect(
      parseAvatarClientMessage({
        type: "hello",
        protocol: 1,
        token: "secret",
        clientID: "unity",
        characterID: "jarvis",
        actions: ["gesture.play", "gesture.play", "look_at"],
      }),
    ).toEqual({
      type: "hello",
      protocol: 1,
      token: "secret",
      clientID: "unity",
      characterID: "jarvis",
      actions: ["gesture.play", "look_at"],
    })
  })

  test("rejects arbitrary Unity method names and invalid action shapes", () => {
    expect(parseAvatarAction({ action: "invoke", name: "Destroy" })).toBeUndefined()
    expect(parseAvatarAction({ action: "move_to" })).toBeUndefined()
    expect(parseAvatarAction({ action: "look_at", target: { x: 0, y: Number.NaN, z: 0 } })).toBeUndefined()
  })

  test.each(AVATAR_ACTIONS)("recognizes declared capability %s", (action) => {
    const input =
      action === "animation.trigger" || action === "gesture.play"
        ? { action, name: "wave" }
        : action === "emotion.set"
          ? { action, emotion: "calm" }
          : action === "look_at"
            ? { action, target: { x: 0, y: 1, z: 2 } }
            : action === "move_to"
              ? { action, position: { x: 0, y: 0, z: 1 } }
              : { action }
    expect(parseAvatarAction(input)?.action).toBe(action)
  })

  test("rejects oversized transcript payloads", () => {
    expect(
      parseAvatarClientMessage({ type: "user.transcript", requestID: "req", text: "x".repeat(20_001) }),
    ).toBeUndefined()
  })

  test("accepts a v2 capability manifest and bounded world snapshot", () => {
    expect(
      parseAvatarClientMessage({
        type: "capability.manifest",
        revision: 1,
        capabilities: [
          {
            id: "inventory.pick_up",
            title: "Pick up",
            description: "Pick up a visible item",
            parameters: { type: "object", required: ["entityID"] },
            risk: "interaction",
            cooldownMs: 500,
            timeoutMs: 10_000,
            cancellable: true,
            preconditions: ["visible"],
            permissionCategory: "inventory.pick_up",
            postconditions: ["item is in inventory"],
            sideEffects: ["inventory changes"],
          },
        ],
      }),
    ).toMatchObject({ type: "capability.manifest", revision: 1 })
    expect(
      parseAvatarClientMessage({
        type: "world.snapshot",
        world: {
          gameID: "demo",
          saveSlotID: "slot-1",
          characterID: "jarvis",
          revision: 1,
          timestamp: 1,
          entities: [
            {
              id: "door-1",
              kind: "door",
              tags: ["interactable"],
              visible: true,
              state: { open: false },
              affordances: ["door.open"],
            },
          ],
          inventory: {},
          quests: {},
          relationships: {},
          events: [],
        },
      }),
    ).toMatchObject({ type: "world.snapshot", world: { revision: 1 } })
  })

  test("accepts v2.1 action evidence while keeping v2 defaults", () => {
    expect(parseAvatarClientMessage({
      type: "game.action.result",
      id: "action-1",
      ok: true,
      code: "completed",
      changedEntityIDs: ["door-1"],
      observeAgain: true,
    })).toMatchObject({ code: "completed", changedEntityIDs: ["door-1"], observeAgain: true })
    expect(parseAvatarClientMessage({
      type: "hello", protocol: 2, protocolMinor: 1, token: "secret", clientID: "unity", characterID: "jarvis", actions: [],
    })).toMatchObject({ protocol: 2, protocolMinor: 1 })
  })

  test("accepts v2.3 Quest microphone frames and rejects unsafe formats", () => {
    expect(
      parseAvatarClientMessage({
        type: "audio.start",
        requestID: "voice-1",
        codec: "pcm_s16le",
        sampleRate: 16_000,
        channels: 1,
        locale: "uk-UA",
        mode: "hands_free",
      }),
    ).toEqual({
      type: "audio.start",
      requestID: "voice-1",
      codec: "pcm_s16le",
      sampleRate: 16_000,
      channels: 1,
      locale: "uk-UA",
      mode: "hands_free",
    })
    expect(parseAvatarClientMessage({ type: "audio.end", requestID: "voice-1" })).toEqual({
      type: "audio.end",
      requestID: "voice-1",
    })
    expect(
      parseAvatarClientMessage({
        type: "audio.start",
        requestID: "voice-2",
        codec: "float32",
        sampleRate: 96_000,
        channels: 2,
        locale: "uk-UA",
        mode: "hands_free",
      }),
    ).toBeUndefined()
  })

  test("rejects duplicate capability IDs and oversized world snapshots", () => {
    const capability = {
      id: "door.open",
      title: "Open",
      description: "Open a door",
      parameters: {},
      risk: "interaction",
      cooldownMs: 0,
      timeoutMs: 5_000,
      cancellable: true,
      preconditions: [],
    }
    expect(
      parseAvatarClientMessage({ type: "capability.manifest", revision: 1, capabilities: [capability, capability] }),
    ).toBeUndefined()
    expect(
      parseAvatarClientMessage({
        type: "world.snapshot",
        world: {
          gameID: "demo",
          saveSlotID: "slot",
          characterID: "agent",
          revision: 1,
          timestamp: 1,
          entities: Array.from({ length: 257 }, (_, index) => ({
            id: `entity-${index}`,
            kind: "item",
            tags: [],
            visible: true,
            state: {},
            affordances: [],
          })),
          inventory: {},
          quests: {},
          relationships: {},
          events: [],
        },
      }),
    ).toBeUndefined()
  })

  test("parses typed game actions without accepting arbitrary payload depth", () => {
    expect(parseGameAction({ actionID: "door.open", args: { entityID: "door-1" }, cycleID: "cycle-1" })).toEqual({
      actionID: "door.open",
      args: { entityID: "door-1" },
      cycleID: "cycle-1",
    })
    let nested: unknown = "value"
    for (let index = 0; index < 10; index++) nested = { nested }
    expect(parseGameAction({ actionID: "door.open", args: nested })).toBeUndefined()
  })

  test("accepts one bounded JPEG camera frame and rejects oversized evidence", () => {
    expect(
      parseAvatarClientMessage({
        type: "world.camera.result",
        id: "camera_1",
        contentType: "image/jpeg",
        data: Buffer.from("jpeg").toString("base64"),
      }),
    ).toMatchObject({ type: "world.camera.result", id: "camera_1" })
    expect(
      parseAvatarClientMessage({
        type: "world.camera.result",
        id: "camera_1",
        contentType: "image/jpeg",
        data: "A".repeat(48 * 1024 + 1),
      }),
    ).toBeUndefined()
  })
})
