import { describe, expect, test } from "bun:test"
import { AVATAR_ACTIONS, parseAvatarAction, parseAvatarClientMessage } from "./avatar-bridge-protocol"

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
})
