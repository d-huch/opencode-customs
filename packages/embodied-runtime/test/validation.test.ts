import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { aiTraineeRuntimeConfig, validateRuntimeConfig, type RuntimeConfig } from "../src/config"
import { aiTraineeReplay, type AITraineeRun, type AITraineeSnapshot } from "../src/ai-trainee"
import { applyReplayFaults, evaluateReplay, type ReplayFixture } from "../src/replay"
import { qualifyAITraineeModel, readinessFor, scenarioReportJUnit, validateTraining } from "../src/validation"

const config = {
  providerID: "lmstudio" as const,
  baseURL: "http://127.0.0.1:1234/v1",
  modelID: "dialogue",
  aiTraineeModel: { providerID: "llama-server" as const, baseURL: "http://127.0.0.1:8081/v1", modelID: "trainee" },
}

test("AI Trainee model route is optional and inherits dialogue", () => {
  expect(aiTraineeRuntimeConfig({ providerID: "lmstudio", baseURL: "http://127.0.0.1:1234/v1", modelID: "dialogue" }).modelID).toBe("dialogue")
  expect(aiTraineeRuntimeConfig(config)).toMatchObject({ providerID: "llama-server", baseURL: "http://127.0.0.1:8081/v1", modelID: "trainee" })
  expect(validateRuntimeConfig(config)?.aiTraineeModel?.modelID).toBe("trainee")
})

test("qualification enforces gates and reuses seven day cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "embodied-qualification-"))
  let decisions = 0
  const decide = async (_config: RuntimeConfig, context: Record<string, unknown>) => {
    decisions++
    const inspect = String(context.currentInstruction).includes("PPE")
    return {
      capabilityID: inspect ? "inspect_ppe" : "activate_stop",
      entityID: inspect ? "ppe_station" : "machine_stop",
      arguments: {},
      expectedPostconditions: [inspect ? "ppe.inspected" : "machine.stopped"],
    }
  }
  const first = await qualifyAITraineeModel(aiTraineeRuntimeConfig(config), directory, "standard", undefined, decide)
  const second = await qualifyAITraineeModel(aiTraineeRuntimeConfig(config), directory, "standard", undefined, decide)
  expect(first.passed).toBe(true)
  expect(first.sampleCount).toBe(20)
  expect(second.id).toBe(first.id)
  expect(decisions).toBe(20)
})

test("new Replay faults expose wrong order, preconditions, postconditions and state loss", () => {
  const fixture: ReplayFixture = {
    id: "faults",
    name: "faults",
    events: [
      { sequence: 1, type: "connection.snapshot", timestamp: 1, sessionID: "session" },
      { sequence: 2, type: "action.executed", timestamp: 2, actionID: "stop", idempotencyKey: "one", data: { preconditionsVerified: true, postconditionsVerified: true, allowedAtStep: true } },
    ],
    faults: [
      { type: "wrong_order", actionID: "lock" },
      { type: "missing_precondition", actionID: "stop" },
      { type: "postcondition_failure", actionID: "stop" },
      { type: "state_loss", afterSequence: 1 },
    ],
  }
  const evaluation = evaluateReplay(applyReplayFaults(fixture))
  expect(evaluation.assertions.find((item) => item.id === "scenario-order-enforced")?.passed).toBe(false)
  expect(evaluation.assertions.find((item) => item.id === "preconditions-verified")?.passed).toBe(false)
  expect(evaluation.assertions.find((item) => item.id === "postconditions-verified")?.passed).toBe(false)
  expect(evaluation.assertions.find((item) => item.id === "session-survives-reconnect")?.passed).toBe(false)
})

test("Blind failure produces Needs work while reset or safety failures are Not ready", async () => {
  const directory = await mkdtemp(join(tmpdir(), "embodied-validation-"))
  const guided = traineeRun("guided", "completed")
  const blind = traineeRun("blind", "failed", "entity_mismatch")
  const snapshot = scenarioSnapshot()
  const stages: string[] = []
  const result = await validateTraining({
    scenarioID: "training.equipment-isolation",
    scenarioRevision: 1,
    goldenPath: ["safety.inspect_ppe"],
  }, {
    config: aiTraineeRuntimeConfig(config),
    qualificationDirectory: join(directory, "qualification"),
    reportsDirectory: join(directory, "reports"),
    reset: async () => ({ ok: true, code: "reset", baselineFingerprint: "stable", capabilityRevision: 1 }),
    run: async (profile) => profile === "guided" ? guided : blind,
    replay: aiTraineeReplay,
    snapshot: () => snapshot,
    decide: async (_config, context) => {
      const inspect = String(context.currentInstruction).includes("PPE")
      return { capabilityID: inspect ? "inspect_ppe" : "activate_stop", entityID: inspect ? "ppe_station" : "machine_stop", arguments: {}, expectedPostconditions: [inspect ? "ppe.inspected" : "machine.stopped"] }
    },
  }, (run) => stages.push(run.stage), new AbortController().signal)
  expect(result.report?.readiness).toBe("needs_work")
  expect(result.report?.findings.some((item) => item.code === "entity_not_discoverable" && item.severity === "warning")).toBe(true)
  expect(stages).toEqual(expect.arrayContaining(["deterministic", "guided", "resetting", "blind", "fixtures", "replay", "completed"]))
  expect(scenarioReportJUnit(result.report!).includes("testsuite")).toBe(true)
  expect(readinessFor([{ code: "reset", severity: "error", title: "", detail: "", recommendation: "" }])).toBe("not_ready")
})

function traineeRun(profile: "guided" | "blind", status: AITraineeRun["status"], reason?: string): AITraineeRun {
  return {
    id: `${profile}-run`, profile, mode: "live", seed: 1, status, startedAt: 1, completedAt: 100,
    ...(reason ? { reason } : {}), modelRoute: "llama-server/trainee", scenarioID: "training.equipment-isolation", scenarioRevision: 1, currentStepID: "inspect-ppe", simulation: true,
    attempts: [{
      sequence: 1, timestamp: 2, worldRevision: 1, stepID: "inspect-ppe",
      decision: { capabilityID: "safety.inspect_ppe", entityID: "ppe_station", arguments: {}, expectedPostconditions: ["ppe.inspected"] },
      ok: true, code: "completed", risk: "ambient", autoApproved: false, approved: true, simulation: true, latencyMs: 10,
    }],
  }
}

function scenarioSnapshot(): AITraineeSnapshot {
  return {
    clientID: "unity", characterID: "trainee", gameID: "safety", worldRevision: 1,
    entities: [{ id: "ppe_station", visible: true, affordances: ["safety.inspect_ppe"], state: { inspected: false } }],
    capabilities: [{ id: "safety.inspect_ppe", title: "Inspect PPE", description: "Inspect PPE", parameters: {}, risk: "ambient", permissionCategory: "safety.observe", preconditions: [], postconditions: ["ppe.inspected"] }],
    scenario: { runID: "run", scenarioID: "training.equipment-isolation", scenarioRevision: 1, status: "running", currentStepID: "inspect-ppe", currentInstruction: "Inspect PPE", allowedCapabilityIDs: ["safety.inspect_ppe"], attempt: 1, simulation: true, criticalAutoApproveCategories: [], baselineFingerprint: "stable", capabilityRevision: 1 },
  }
}
import { expect, test } from "bun:test"
