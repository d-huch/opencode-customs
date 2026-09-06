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

  test("accepts text-only avatar transcripts and rejects unknown response modes", () => {
    expect(parseAvatarClientMessage({
      type: "speech.final",
      requestID: "typed-1",
      text: "  Привіт, Джарвісе!  ",
      responseMode: "text",
    })).toEqual({
      type: "speech.final",
      requestID: "typed-1",
      text: "Привіт, Джарвісе!",
      responseMode: "text",
    })
    expect(parseAvatarClientMessage({
      type: "speech.final",
      requestID: "typed-2",
      text: "Привіт",
      responseMode: "silent",
    })).toBeUndefined()
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
      type: "hello", protocol: 2, protocolMinor: 6, token: "secret", clientID: "unity", characterID: "jarvis", surface: "pcvr", actions: [],
    })).toMatchObject({ protocol: 2, protocolMinor: 6, surface: "pcvr" })
  })

  test("accepts bounded v2.9 scenario lifecycle, snapshots, and instructor results", () => {
    expect(parseAvatarClientMessage({
      type: "scenario.step",
      runID: "run-1",
      scenarioID: "training.equipment-isolation",
      scenarioRevision: 2,
      timestamp: 1_000,
      sessionID: "session-1",
      stepID: "verify-energy",
      outcome: "success",
      evidence: { "energy.zero": true },
    })).toMatchObject({ type: "scenario.step", stepID: "verify-energy", scenarioRevision: 2 })
    expect(parseAvatarClientMessage({
      type: "scenario.completed",
      runID: "run-1",
      scenarioID: "training.equipment-isolation",
      scenarioRevision: 2,
      timestamp: 2_000,
      durationMs: 1_000,
      auditRootHash: "a".repeat(64),
    })).toMatchObject({ type: "scenario.completed", durationMs: 1_000 })
    expect(parseAvatarClientMessage({
      type: "scenario.snapshot",
      runID: "run-1",
      scenarioID: "training.equipment-isolation",
      scenarioRevision: 2,
      timestamp: 2_100,
      sessionID: "session-1",
      traineeID: "trainee-1",
      instructorID: "instructor-1",
      status: "paused",
      currentStepID: "verify-energy",
      attempt: 2,
      timeoutRemainingMs: 12_000,
      evidence: { "energy.zero": true },
      instructorEvidenceIDs: ["instructor.signed"],
    })).toMatchObject({ type: "scenario.snapshot", status: "paused", attempt: 2 })
    expect(parseAvatarClientMessage({
      type: "instructor.command.result",
      requestID: "command-1",
      runID: "run-1",
      ok: true,
      code: "paused",
      timestamp: 2_200,
      stepID: "verify-energy",
      attempt: 2,
    })).toMatchObject({ type: "instructor.command.result", code: "paused" })
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

  test("accepts bounded v2.10 demonstration events and recording audio", () => {
    expect(parseAvatarClientMessage({
      type: "demonstration.start",
      demonstrationID: "loto-demo-1",
      timestamp: 1_000,
      title: "Equipment isolation",
    })).toMatchObject({ type: "demonstration.start", demonstrationID: "loto-demo-1" })
    expect(parseAvatarClientMessage({
      type: "demonstration.event",
      demonstrationID: "loto-demo-1",
      eventID: "event-1",
      sequence: 1,
      timestamp: 1_100,
      entityID: "disconnect_switch",
      capabilityID: "safety.open_disconnect",
      action: "open_disconnect",
      ok: true,
      code: "completed",
      risk: "critical",
      permissionCategory: "equipment.isolation",
      postconditions: ["disconnectOpened=true"],
    })).toMatchObject({ type: "demonstration.event", risk: "critical", sequence: 1 })
    expect(parseAvatarClientMessage({
      type: "audio.start",
      requestID: "narration-1",
      codec: "pcm_s16le",
      sampleRate: 16_000,
      channels: 1,
      mode: "push_to_talk",
      purpose: "demonstration",
      demonstrationID: "loto-demo-1",
    })).toMatchObject({ purpose: "demonstration", demonstrationID: "loto-demo-1" })
    expect(parseAvatarClientMessage({
      type: "audio.start",
      requestID: "narration-2",
      codec: "pcm_s16le",
      sampleRate: 16_000,
      channels: 1,
      mode: "push_to_talk",
      purpose: "demonstration",
    })).toBeUndefined()
  })

  test("accepts bounded v2.11 AI Trainee controls", () => {
    expect(parseAvatarClientMessage({
      type: "ai.trainee.control",
      requestID: "ai-start-1",
      command: "start",
      profile: "guided",
      seed: 42,
    })).toEqual({ type: "ai.trainee.control", requestID: "ai-start-1", command: "start", profile: "guided", seed: 42 })
    expect(parseAvatarClientMessage({ type: "ai.trainee.control", requestID: "ai-pause-1", command: "pause" }))
      .toEqual({ type: "ai.trainee.control", requestID: "ai-pause-1", command: "pause" })
    expect(parseAvatarClientMessage({ type: "ai.trainee.control", requestID: "ai-invalid", command: "start", profile: "adversarial" }))
      .toBeUndefined()
    expect(parseAvatarClientMessage({ type: "ai.trainee.control", requestID: "ai-invalid", command: "start", profile: "blind", seed: -1 }))
      .toBeUndefined()
  })

  test("accepts bounded v2.12 scenario reset results", () => {
    expect(parseAvatarClientMessage({
      type: "scenario.test.reset.result",
      requestID: "reset-1",
      ok: true,
      code: "reset",
      timestamp: 100,
      scenarioID: "training.equipment-isolation",
      scenarioRevision: 3,
      baselineFingerprint: "abc123",
      capabilityRevision: 4,
      worldRevision: 20,
      runID: "scenario-run-2",
    })).toMatchObject({ type: "scenario.test.reset.result", requestID: "reset-1", ok: true, baselineFingerprint: "abc123" })
    expect(parseAvatarClientMessage({
      type: "scenario.test.reset.result",
      requestID: "reset-1",
      ok: true,
      code: "reset",
      timestamp: 100,
      scenarioID: "training.equipment-isolation",
      scenarioRevision: 0,
    })).toBeUndefined()
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
