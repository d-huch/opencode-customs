import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createInstructorState, type InstructorScenarioSnapshot } from "../src/instructor"

describe("instructor state", () => {
  test("selects one active trainee and reports a second run as a conflict", async () => {
    const directory = await mkdtemp(join(tmpdir(), "embodied-instructor-"))
    const state = createInstructorState(directory)
    const first = snapshot("run-1", "step-1")
    await state.record(first)
    expect(state.session({
      connectedClients: [{ clientID: "quest-1", scenario: first }],
      voice: { transcription: "ready", synthesis: "ready" },
    })).toMatchObject({ status: "active", active: { runID: "run-1", clientID: "quest-1", connected: true } })

    const second = snapshot("run-2", "step-2")
    await state.record(second)
    const conflict = state.session({
      connectedClients: [
        { clientID: "quest-1", scenario: first },
        { clientID: "desktop-2", scenario: second },
      ],
      voice: { transcription: "ready", synthesis: "ready" },
    })
    expect(conflict.status).toBe("conflict")
    expect(conflict.conflicts.map((item) => item.runID).sort()).toEqual(["run-1", "run-2"])

    await state.record({
      type: "instructor.command.sent",
      timestamp: Date.now(),
      requestID: "request-1",
      runID: "run-1",
      command: "evidence",
      instructorID: "instructor-1",
      evidenceID: "signoff",
      reason: "Observed safe procedure",
      valueHash: "abc123",
    })
    const audit = await readFile(join(directory, "instructor", "audit.jsonl"), "utf8")
    expect(audit).toContain("abc123")
    expect(audit).not.toContain("verified evidence value")
    const lines = audit.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines[0]?.previousHash).toBe("0".repeat(64))
    expect(lines.at(-1)?.previousHash).toBe(lines.at(-2)?.hash)
    await rm(directory, { recursive: true })
  })

  test("keeps the last active snapshot available while the trainee reconnects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "embodied-instructor-offline-"))
    const state = createInstructorState(directory)
    const value = snapshot("run-offline", "isolate")
    await state.record(value)
    expect(state.session({ connectedClients: [], voice: { transcription: "ready", synthesis: "ready" } })).toMatchObject({
      status: "offline",
      active: { runID: "run-offline", connected: false },
    })
    await rm(directory, { recursive: true })
  })
})

function snapshot(runID: string, currentStepID: string): InstructorScenarioSnapshot {
  return {
    type: "scenario.snapshot",
    runID,
    scenarioID: "equipment-isolation",
    scenarioRevision: 3,
    timestamp: Date.now(),
    traineeID: "trainee-1",
    instructorID: "instructor-1",
    status: "running",
    currentStepID,
    attempt: 1,
    timeoutRemainingMs: 30_000,
    evidence: {},
    instructorEvidenceIDs: ["signoff"],
  }
}
