import { readdir, rename, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import type { RuntimeConfig } from "./config"
import { RuntimeVersion } from "./version"

type RestartRecord = { detectedAt: string; reason: "unclean_shutdown" | "clean_start" }
type ScenarioState = {
  runID: string
  scenarioID: string
  scenarioRevision: number
  status: "active" | "suspended" | "completed" | "cancelled" | "failed"
  sessionID?: string
  stepID?: string
  reason?: string
  updatedAt: string
}
type RuntimeState = {
  schemaVersion: 1
  version: string
  migration: "current" | "recovered"
  lastStartedAt: string
  lastStoppedAt?: string
  previousUncleanShutdown: boolean
  restarts: RestartRecord[]
  scenario?: ScenarioState
}

export async function openRuntimeState(stateDirectory: string) {
  const statePath = join(stateDirectory, "runtime-state.json")
  const markerPath = join(stateDirectory, "runtime-active.json")
  const previous = await Bun.file(statePath).json().catch(() => undefined)
  const valid = validState(previous)
  const marker = await Bun.file(markerPath).exists()
  const restart: RestartRecord = { detectedAt: new Date().toISOString(), reason: marker ? "unclean_shutdown" : "clean_start" }
  const state: RuntimeState = {
    schemaVersion: 1,
    version: RuntimeVersion,
    migration: valid ? "current" : previous === undefined ? "current" : "recovered",
    lastStartedAt: new Date().toISOString(),
    lastStoppedAt: valid ? previous.lastStoppedAt : undefined,
    previousUncleanShutdown: marker,
    restarts: [
      ...(valid ? previous.restarts : []),
      restart,
    ].slice(-20),
    scenario: valid && previous.scenario?.status === "active"
      ? { ...previous.scenario, status: "suspended", reason: "process_restart", updatedAt: new Date().toISOString() }
      : valid ? previous.scenario : undefined,
  }
  await atomicWrite(statePath, state)
  await atomicWrite(markerPath, { pid: process.pid, startedAt: state.lastStartedAt, version: RuntimeVersion })
  return {
    status: () => state,
    async recordScenario(message: {
      type: "scenario.started" | "scenario.step" | "scenario.completed" | "scenario.cancelled" | "scenario.failed"
      runID: string
      scenarioID: string
      scenarioRevision: number
      sessionID?: string
      stepID?: string
    }) {
      state.scenario = {
        runID: message.runID,
        scenarioID: message.scenarioID,
        scenarioRevision: message.scenarioRevision,
        status: message.type === "scenario.started" || message.type === "scenario.step"
          ? "active"
          : message.type.slice("scenario.".length) as ScenarioState["status"],
        sessionID: message.sessionID,
        stepID: message.stepID,
        updatedAt: new Date().toISOString(),
      }
      await atomicWrite(statePath, state)
    },
    async close() {
      state.lastStoppedAt = new Date().toISOString()
      state.previousUncleanShutdown = false
      await atomicWrite(statePath, state)
      await rm(markerPath, { force: true })
    },
  }
}

export async function applyRetention(stateDirectory: string, config?: RuntimeConfig["retention"]) {
  const retention = config ?? { logsDays: 14, replaysDays: 30, resultsDays: 365 }
  const removed = await Promise.all([
    prune(join(stateDirectory, "logs"), retention.logsDays),
    prune(join(stateDirectory, "replays"), retention.replaysDays),
    prune(join(stateDirectory, "results"), retention.resultsDays),
  ])
  return { ...retention, removed: removed.reduce((sum, value) => sum + value, 0), lastAppliedAt: new Date().toISOString() }
}

async function prune(directory: string, days: number) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const threshold = Date.now() - days * 86_400_000
  const expired = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const path = join(directory, entry.name)
    const value = await stat(path).catch(() => undefined)
    if (!value || value.mtimeMs >= threshold) return false
    await rm(path, { force: true })
    return true
  }))
  return expired.filter(Boolean).length
}

async function atomicWrite(path: string, value: unknown) {
  const temporary = path + ".tmp"
  await Bun.write(temporary, JSON.stringify(value, null, 2))
  await rename(temporary, path)
}

function validState(value: unknown): value is RuntimeState {
  if (!value || typeof value !== "object") return false
  const input = value as Record<string, unknown>
  return input.schemaVersion === 1 && typeof input.lastStartedAt === "string" && Array.isArray(input.restarts)
}
