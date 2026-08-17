import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  AvatarCycleBudget,
  AvatarGoalStack,
  AvatarPersistentStore,
  AvatarWorldStore,
  avatarBridgeDefaults,
  selectAvatarModelRole,
  validateCapabilityArguments,
} from "./avatar-bridge-state"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Avatar Bridge v2 state", () => {
  test("applies ordered world deltas and ignores gaps", () => {
    const store = new AvatarWorldStore()
    expect(
      store.snapshot({
        gameID: "game",
        saveSlotID: "slot",
        characterID: "agent",
        revision: 1,
        timestamp: 1,
        entities: [],
        inventory: {},
        quests: {},
        relationships: {},
        events: [],
      }),
    ).toBeTrue()
    expect(
      store.delta({
        gameID: "game",
        saveSlotID: "slot",
        characterID: "agent",
        revision: 3,
        timestamp: 3,
        upsert: [],
        remove: [],
      }),
    ).toBeFalse()
    expect(
      store.delta({
        gameID: "game",
        saveSlotID: "slot",
        characterID: "agent",
        revision: 2,
        timestamp: 2,
        upsert: [
          { id: "door", kind: "door", tags: [], visible: true, state: { open: false }, affordances: ["door.open"] },
        ],
        remove: [],
      }),
    ).toBeTrue()
    expect(store.get("agent")?.entities[0]?.id).toBe("door")
  })

  test("enforces autonomy action and time budgets", () => {
    const budget = new AvatarCycleBudget()
    const config = { ...avatarBridgeDefaults, maximumActionsPerCycle: 2, cycleTimeoutMs: 5_000 }
    expect(budget.consume("cycle", config, 1)).toMatchObject({ ok: true, remaining: 1 })
    expect(budget.consume("cycle", config, 2)).toMatchObject({ ok: true, remaining: 0 })
    expect(budget.consume("cycle", config, 3)).toMatchObject({ ok: false })
    expect(budget.consume("expired", config, 1)).toMatchObject({ ok: true })
    expect(budget.consume("expired", config, 6_001)).toMatchObject({ ok: false })
  })

  test("validates capability arguments against the declared schema", () => {
    const capability = {
      id: "door.open",
      title: "Open",
      description: "Open a door",
      risk: "interaction" as const,
      cooldownMs: 0,
      timeoutMs: 5_000,
      cancellable: true,
      preconditions: [],
      parameters: {
        type: "object",
        required: ["entityID"],
        additionalProperties: false,
        properties: { entityID: { type: "string" } },
      },
    }
    expect(validateCapabilityArguments(capability, { entityID: "door" })).toEqual({ ok: true })
    expect(validateCapabilityArguments(capability, {})).toMatchObject({ ok: false })
    expect(validateCapabilityArguments(capability, { entityID: 1 })).toMatchObject({ ok: false })
  })

  test("persists isolated save-slot memories and tolerates missing files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-state-"))
    directories.push(directory)
    const path = join(directory, "state.json")
    const store = await AvatarPersistentStore.open(path)
    await store.remember({
      gameID: "game",
      saveSlotID: "slot-a",
      characterID: "agent",
      kind: "promise",
      scope: "save",
      source: "test",
      confidence: 1,
      text: "Protect the player",
      importance: 0.9,
      pinned: false,
    })
    await store.remember({
      gameID: "game",
      saveSlotID: "slot-b",
      characterID: "agent",
      kind: "episodic",
      scope: "save",
      source: "test",
      confidence: 0.8,
      text: "Found a key",
      importance: 0.5,
      pinned: false,
    })
    const reopened = await AvatarPersistentStore.open(path)
    expect(reopened.memories({ saveSlotID: "slot-a" }).map((memory) => memory.text)).toEqual(["Protect the player"])
    expect(reopened.memories({ saveSlotID: "slot-b" }).map((memory) => memory.text)).toEqual(["Found a key"])
  })

  test("manages nested goals and requires replanning after a repeated failure", () => {
    const stack = new AvatarGoalStack()
    const goal = stack.create({
      id: "goal-1",
      characterID: "agent",
      text: "Deliver the key",
      expiresAt: 60_000,
      stopConditions: ["quest is complete"],
      riskBudget: ["ambient", "interaction"],
      steps: [{ id: "step-1", text: "Pick up key", status: "pending", attempts: 0 }],
    }, 1)
    expect(goal.status).toBe("active")
    expect(stack.updateStep(goal.id, "step-1", "active")?.steps[0]?.attempts).toBe(1)
    expect(stack.actionResult(goal.id, "pick_up", false, "blocked").replan).toBeFalse()
    expect(stack.actionResult(goal.id, "pick_up", false, "blocked").replan).toBeFalse()
    expect(stack.actionResult(goal.id, "pick_up", false, "blocked").replan).toBeTrue()
    expect(stack.finish(goal.id, "completed", "delivered")?.status).toBe("completed")
  })

  test("keeps conflicting memories inspectable instead of overwriting them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-conflict-"))
    directories.push(directory)
    const store = await AvatarPersistentStore.open(join(directory, "state.json"))
    const first = await store.remember({
      gameID: "game", saveSlotID: "slot", characterID: "agent", kind: "world", scope: "game",
      source: "npc", confidence: 0.8, text: "The vault code is blue", importance: 0.8, topic: "vault-code", pinned: false,
    })
    const second = await store.remember({
      gameID: "game", saveSlotID: "slot", characterID: "agent", kind: "world", scope: "game",
      source: "terminal", confidence: 0.9, text: "The vault code is green", importance: 0.9, topic: "vault-code", pinned: false,
    })
    expect(second.conflictWith).toBe(first.id)
    expect(store.memories({ gameID: "game" })).toHaveLength(2)
  })

  test("escalates multi-step turns to planner unless memory pressure is critical", () => {
    const config = {
      ...avatarBridgeDefaults,
      dialogueModel: { providerID: "lmstudio", modelID: "fast" },
      plannerModel: { providerID: "lmstudio", modelID: "planner" },
    }
    expect(selectAvatarModelRole(config, { text: "Привіт" }).role).toBe("dialogue")
    expect(selectAvatarModelRole(config, { text: "Склади план виконання цього квесту" }).role).toBe("planner")
    expect(selectAvatarModelRole(config, { text: "Склади план виконання цього квесту", resourceStatus: "critical" }).role).toBe("dialogue")
  })

  test("migrates v2 event memories and autonomy defaults without losing save isolation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-v2-migration-"))
    directories.push(directory)
    const path = join(directory, "state.json")
    await writeFile(path, JSON.stringify({
      version: 2,
      config: { lanEnabled: false, interactionAutoApprove: false, maximumActionsPerCycle: 8, cycleTimeoutMs: 60_000 },
      devices: [],
      memories: [{
        id: "old", gameID: "game", saveSlotID: "slot", characterID: "agent", kind: "event",
        text: "Found a key", importance: 0.7, createdAt: 1, updatedAt: 1,
      }],
    }))
    const store = await AvatarPersistentStore.open(path)
    expect(store.config().interactionAutoApprove).toBeFalse()
    expect(store.memories({ saveSlotID: "slot" })[0]).toMatchObject({
      id: "old", kind: "episodic", scope: "save", source: "avatar-bridge-v2-migration", confidence: 0.75,
    })
  })
})
