import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyRetention, openRuntimeState } from "../src/runtime-state"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

describe("Runtime supervisor state", () => {
  test("recovers an active scenario as suspended after an unclean restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "embodied-runtime-state-")); directories.push(directory)
    const first = await openRuntimeState(directory)
    await first.recordScenario({
      type: "scenario.step",
      runID: "run-1",
      scenarioID: "training.equipment-isolation",
      scenarioRevision: 4,
      sessionID: "session-1",
      stepID: "apply-lockout",
    })
    const recovered = await openRuntimeState(directory)
    expect(recovered.status()).toMatchObject({
      previousUncleanShutdown: true,
      scenario: { runID: "run-1", status: "suspended", reason: "process_restart", stepID: "apply-lockout" },
    })
    await recovered.close()
  })

  test("applies independent retention windows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "embodied-retention-")); directories.push(directory)
    await mkdir(join(directory, "logs"), { recursive: true })
    await mkdir(join(directory, "replays"), { recursive: true })
    await Bun.write(join(directory, "logs", "old.log"), "old")
    await Bun.write(join(directory, "replays", "fresh.json"), "fresh")
    const old = new Date(Date.now() - 10 * 86_400_000)
    await utimes(join(directory, "logs", "old.log"), old, old)
    const result = await applyRetention(directory, { logsDays: 5, replaysDays: 30, resultsDays: 365 })
    expect(result.removed).toBe(1)
    expect(await Bun.file(join(directory, "logs", "old.log")).exists()).toBe(false)
    expect(await Bun.file(join(directory, "replays", "fresh.json")).exists()).toBe(true)
  })
})
