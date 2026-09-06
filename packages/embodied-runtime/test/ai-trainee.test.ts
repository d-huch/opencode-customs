import { describe, expect, test } from "bun:test"
import { createAITraineeCoordinator, evaluateAITraineeRun, runAITraineeFixtureBatch, validateAITraineeDecision, type AITraineeSnapshot } from "../src/ai-trainee"

const snapshot: AITraineeSnapshot = {
  clientID: "unity",
  characterID: "trainee",
  gameID: "loto",
  worldRevision: 1,
  entities: [{ id: "ppe", affordances: ["safety.inspect_ppe"] }, { id: "lock", affordances: ["safety.apply_lockout"] }],
  capabilities: [
    { id: "safety.inspect_ppe", title: "PPE", description: "Inspect PPE", parameters: {}, risk: "ambient", permissionCategory: "safety.observe", preconditions: [], postconditions: ["ppeInspected=true"] },
    { id: "safety.apply_lockout", title: "Lock", description: "Apply lock", parameters: {}, risk: "critical", permissionCategory: "equipment.lockout", preconditions: ["disconnectOpened=true"], postconditions: ["lockoutApplied=true"] },
  ],
  scenario: {
    runID: "scenario-run",
    scenarioID: "training.equipment-isolation",
    scenarioRevision: 1,
    title: "Equipment isolation",
    status: "running",
    currentStepID: "inspect-ppe",
    currentInstruction: "Inspect PPE",
    allowedCapabilityIDs: ["safety.inspect_ppe"],
    simulation: true,
    criticalAutoApproveCategories: ["equipment.lockout"],
  },
}

describe("AI Trainee", () => {
  test("validates declared entities, capabilities and postconditions", () => {
    expect(validateAITraineeDecision({
      capabilityID: "safety.inspect_ppe",
      entityID: "ppe",
      arguments: {},
      expectedPostconditions: ["ppeInspected=true"],
    }, snapshot, "guided").ok).toBe(true)
    expect(validateAITraineeDecision({
      capabilityID: "safety.apply_lockout",
      entityID: "lock",
      arguments: {},
      expectedPostconditions: ["lockoutApplied=true"],
    }, snapshot, "guided")).toEqual({ ok: false, code: "guided_step_mismatch" })
    expect(validateAITraineeDecision({
      capabilityID: "safety.inspect_ppe",
      entityID: "invented",
      arguments: {},
      expectedPostconditions: [],
    }, snapshot, "blind")).toEqual({ ok: false, code: "entity_mismatch" })
    expect(validateAITraineeDecision({
      capabilityID: "safety.apply_lockout",
      entityID: "ppe",
      arguments: {},
      expectedPostconditions: ["lockoutApplied=true"],
    }, snapshot, "blind")).toEqual({ ok: false, code: "entity_capability_mismatch" })
  })

  test("ends with the concrete model failure without executing a fallback", async () => {
    let executions = 0
    const coordinator = createAITraineeCoordinator({
      config: () => ({ providerID: "lmstudio", baseURL: "http://127.0.0.1:1234/v1", modelID: "trainee" }),
      snapshot: () => snapshot,
      decide: async () => { throw new Error("model_timeout") },
      execute: async () => { executions++; return { ok: true, code: "completed" } },
    })
    coordinator.start({ profile: "guided" })
    await Bun.sleep(10)
    expect(coordinator.active()).toMatchObject({ status: "failed", reason: "model_timeout" })
    expect(executions).toBe(0)
  })

  test("stops after two identical failures", async () => {
    let revision = 1
    const coordinator = createAITraineeCoordinator({
      config: () => ({ providerID: "lmstudio", baseURL: "http://127.0.0.1:1234/v1", modelID: "trainee" }),
      snapshot: () => ({ ...snapshot, worldRevision: revision++ }),
      decide: async () => ({ capabilityID: "safety.inspect_ppe", entityID: "ppe", arguments: {}, expectedPostconditions: ["ppeInspected=true"] }),
      execute: async () => ({ ok: false, code: "failed" }),
    })
    coordinator.start({ profile: "guided", seed: 7 })
    await Bun.sleep(50)
    expect(coordinator.active()).toMatchObject({ status: "failed", reason: "repeated_failure" })
    expect(coordinator.active()?.attempts).toHaveLength(2)
  })

  test("evaluates completion and first divergence", () => {
    const result = evaluateAITraineeRun({
      id: "run", profile: "blind", mode: "fixture", seed: 1, status: "completed", startedAt: 1, completedAt: 3,
      attempts: [{ sequence: 1, timestamp: 2, worldRevision: 1, decision: { capabilityID: "wrong", entityID: "ppe", arguments: {}, expectedPostconditions: [] }, ok: true, code: "completed", risk: "ambient", autoApproved: false, approved: true, simulation: true, latencyMs: 1 }],
    }, ["safety.inspect_ppe"])
    expect(result.passed).toBe(false)
    expect(result.firstDivergence).toEqual({ sequence: 1, expected: "safety.inspect_ppe", actual: "wrong" })
  })

  test("auto-approves critical actions only for simulation allowlists", async () => {
    let input: { simulationAutoApprove: boolean; scenarioRunID: string } | undefined
    let calls = 0
    const coordinator = createAITraineeCoordinator({
      config: () => ({ providerID: "lmstudio", baseURL: "http://127.0.0.1:1234/v1", modelID: "trainee" }),
      snapshot: () => ({
        ...snapshot,
        worldRevision: ++calls,
        scenario: { ...snapshot.scenario, currentStepID: "apply-lockout", allowedCapabilityIDs: ["safety.apply_lockout"] },
      }),
      decide: async () => ({ capabilityID: "safety.apply_lockout", entityID: "lock", arguments: {}, expectedPostconditions: ["lockoutApplied=true"] }),
      execute: async (value) => {
        input = value
        return { ok: false, code: "stop", approved: value.simulationAutoApprove, autoApproved: value.simulationAutoApprove }
      },
    })
    coordinator.start({ profile: "guided" })
    await Bun.sleep(25)
    expect(input).toMatchObject({ simulationAutoApprove: true, scenarioRunID: "scenario-run" })
  })

  test("never requests critical auto-approval outside simulation", async () => {
    let autoApprove: boolean | undefined
    const coordinator = createAITraineeCoordinator({
      config: () => ({ providerID: "lmstudio", baseURL: "http://127.0.0.1:1234/v1", modelID: "trainee" }),
      snapshot: () => ({
        ...snapshot,
        scenario: { ...snapshot.scenario, currentStepID: "apply-lockout", allowedCapabilityIDs: ["safety.apply_lockout"], simulation: false },
      }),
      decide: async () => ({ capabilityID: "safety.apply_lockout", entityID: "lock", arguments: {}, expectedPostconditions: ["lockoutApplied=true"] }),
      execute: async (value) => { autoApprove = value.simulationAutoApprove; return { ok: false, code: "approval_required" } },
    })
    coordinator.start({ profile: "guided" })
    await Bun.sleep(10)
    expect(autoApprove).toBe(false)
  })

  test("runs 100 fixture evaluations without a live action adapter", async () => {
    const completed = { ...snapshot, worldRevision: 2, scenario: { ...snapshot.scenario, status: "completed" as const } }
    const batch = await runAITraineeFixtureBatch(
      { providerID: "lmstudio", baseURL: "http://127.0.0.1:1234/v1", modelID: "trainee" },
      {
        id: "loto-fixture",
        snapshots: [snapshot, completed],
        results: [{ capabilityID: "safety.inspect_ppe", entityID: "ppe", ok: true, code: "completed", nextSnapshot: 1 }],
        goldenPath: ["safety.inspect_ppe"],
      },
      { profile: "guided", runs: 100, seed: 10 },
      new AbortController().signal,
      undefined,
      async () => ({ capabilityID: "safety.inspect_ppe", entityID: "ppe", arguments: {}, expectedPostconditions: ["ppeInspected=true"] }),
    )
    expect(batch).toMatchObject({ status: "completed", completedRuns: 100, passRate: 1 })
  })
})
