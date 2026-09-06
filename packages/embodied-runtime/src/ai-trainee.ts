import { randomUUID } from "node:crypto"
import type { RuntimeConfig } from "./config"
import type { ReplayFixture } from "./replay"

export type AITraineeProfile = "guided" | "blind"
export type AITraineeMode = "live" | "fixture"
export type AITraineeStatus = "starting" | "observing" | "deciding" | "executing" | "verifying" | "paused" | "completed" | "cancelled" | "failed"

export type AITraineeCapability = {
  id: string
  title: string
  description: string
  parameters: Record<string, unknown>
  risk: "ambient" | "interaction" | "critical"
  permissionCategory: string
  preconditions: string[]
  postconditions: string[]
}

export type AITraineeWorldEntity = {
  id: string
  kind?: string
  label?: string
  visible?: boolean
  state?: Record<string, unknown>
  affordances?: string[]
}

export type AITraineeSnapshot = {
  clientID: string
  characterID: string
  gameID: string
  worldRevision: number
  entities: AITraineeWorldEntity[]
  capabilities: AITraineeCapability[]
  scenario: {
    runID: string
    scenarioID: string
    scenarioRevision: number
    title?: string
    status: "running" | "paused" | "completed" | "cancelled" | "failed"
    currentStepID?: string
    currentInstruction?: string
    allowedCapabilityIDs?: string[]
    attempt?: number
    simulation: boolean
    criticalAutoApproveCategories: string[]
    baselineFingerprint?: string
    capabilityRevision?: number
  }
}

export type AITraineeDecision = {
  capabilityID: string
  entityID: string
  arguments: Record<string, unknown>
  expectedPostconditions: string[]
}

export type AITraineeAttempt = {
  sequence: number
  timestamp: number
  worldRevision: number
  stepID?: string
  decision: AITraineeDecision
  ok: boolean
  code: string
  message?: string
  risk: AITraineeCapability["risk"]
  autoApproved: boolean
  approved: boolean
  simulation: boolean
  latencyMs: number
}

export type AITraineeRun = {
  id: string
  profile: AITraineeProfile
  mode: AITraineeMode
  characterID?: string
  seed: number
  status: AITraineeStatus
  startedAt: number
  completedAt?: number
  reason?: string
  modelRoute?: string
  scenarioID?: string
  scenarioRevision?: number
  currentStepID?: string
  currentDecision?: AITraineeDecision
  simulation?: boolean
  attempts: AITraineeAttempt[]
}

export type AITraineeEvaluation = {
  runID: string
  passed: boolean
  status: AITraineeRun["status"]
  completionRate: number
  firstAttemptAccuracy: number
  unsafeAttempts: number
  durationMs: number
  firstDivergence?: { sequence: number; expected: string; actual: string }
}

export type AITraineeBatch = {
  id: string
  profile: AITraineeProfile
  seed: number
  requestedRuns: number
  completedRuns: number
  status: "running" | "completed" | "cancelled" | "failed"
  evaluations: AITraineeEvaluation[]
  passRate: number
  completionRate: number
  firstAttemptAccuracy: number
  unsafeAttempts: number
}

export type AITraineeFixture = {
  id: string
  snapshots: AITraineeSnapshot[]
  results: Array<{ capabilityID: string; entityID: string; ok: boolean; code: string; message?: string; nextSnapshot: number }>
  goldenPath: string[]
}

type ActionResult = {
  ok: boolean
  code: string
  message?: string
  autoApproved?: boolean
  approved?: boolean
}

type CoordinatorOptions = {
  config: () => RuntimeConfig | undefined
  decide?: (config: RuntimeConfig, context: Record<string, unknown>, seed: number, signal: AbortSignal) => Promise<unknown>
  snapshot: (characterID?: string) => AITraineeSnapshot | undefined
  execute: (input: {
    runID: string
    scenarioRunID: string
    characterID: string
    decision: AITraineeDecision
    idempotencyKey: string
    simulationAutoApprove: boolean
  }) => Promise<ActionResult>
  notify?: (run: AITraineeRun) => void
}

const maxRunMs = 20 * 60_000
const maxDecisions = 64

export function createAITraineeCoordinator(options: CoordinatorOptions) {
  let active: { run: AITraineeRun; controller: AbortController; paused: boolean; config?: RuntimeConfig } | undefined
  const history: AITraineeRun[] = []

  function start(input: { profile: AITraineeProfile; characterID?: string; seed?: number }) {
    if (active && !terminal(active.run.status)) throw new Error("An AI Trainee live run is already active.")
    const run: AITraineeRun = {
      id: `ai_${randomUUID()}`,
      profile: input.profile,
      mode: "live",
      ...(input.characterID ? { characterID: input.characterID } : {}),
      seed: boundedSeed(input.seed),
      status: "starting",
      startedAt: Date.now(),
      attempts: [],
    }
    active = { run, controller: new AbortController(), paused: false, config: options.config() }
    history.unshift(run)
    void drive(run, active.config, active.controller.signal).catch((error) => {
      if (active?.controller.signal.aborted || terminal(run.status)) return
      finish(run, "failed", error instanceof Error ? error.message : String(error))
    })
    publish(run)
    return structuredClone(run)
  }

  function pause() {
    if (!active || terminal(active.run.status)) return false
    active.paused = true
    active.run.status = "paused"
    publish(active.run)
    return true
  }

  function resume() {
    if (!active || !active.paused) return false
    active.paused = false
    active.run.status = "observing"
    publish(active.run)
    return true
  }

  function cancel(reason = "operator_cancelled") {
    if (!active || terminal(active.run.status)) return false
    active.controller.abort(reason)
    finish(active.run, "cancelled", reason)
    return true
  }

  async function drive(run: AITraineeRun, config: RuntimeConfig | undefined, signal: AbortSignal) {
    if (!config) return finish(run, "failed", "model_unconfigured")
    run.modelRoute = `${config.providerID}/${config.modelID}`
    while (!signal.aborted && !terminal(run.status)) {
      if (active?.paused) {
        await delay(100, signal).catch(() => undefined)
        continue
      }
      if (Date.now() - run.startedAt >= maxRunMs) return finish(run, "failed", "run_timeout")
      if (run.attempts.length >= maxDecisions) return finish(run, "failed", "decision_limit")
      const snapshot = await waitForSnapshot(options, run.characterID, signal)
      if (!snapshot) return finish(run, "failed", "unity_unavailable")
      run.characterID = snapshot.characterID
      run.scenarioID = snapshot.scenario.scenarioID
      run.scenarioRevision = snapshot.scenario.scenarioRevision
      run.currentStepID = snapshot.scenario.currentStepID
      run.simulation = snapshot.scenario.simulation
      if (snapshot.scenario.status === "paused") {
        setStatus(run, "paused")
        await delay(200, signal).catch(() => undefined)
        continue
      }
      if (snapshot.scenario.status !== "running") {
        return finish(run, snapshot.scenario.status === "completed" ? "completed" : "failed", `scenario_${snapshot.scenario.status}`)
      }
      setStatus(run, "observing")
      setStatus(run, "deciding")
      const started = Date.now()
      const decision = await (options.decide ?? decideAITrainee)(config, decisionContext(run.profile, snapshot), run.seed + run.attempts.length, signal)
        .catch((error) => ({ error: error instanceof Error ? error.message : String(error) } as const))
      if (record(decision) && typeof decision.error === "string") return finish(run, "failed", decision.error)
      const validated = validateAITraineeDecision(decision, snapshot, run.profile)
      if (!validated.ok) return finish(run, "failed", validated.code)
      const selected = validated.decision
      const signature = `${selected.capabilityID}\0${selected.entityID}\0${JSON.stringify(selected.arguments)}`
      const repeatedFailures = run.attempts.filter((attempt) => !attempt.ok && `${attempt.decision.capabilityID}\0${attempt.decision.entityID}\0${JSON.stringify(attempt.decision.arguments)}` === signature)
      if (repeatedFailures.length >= 2) return finish(run, "failed", "repeated_failure")
      const capability = snapshot.capabilities.find((item) => item.id === selected.capabilityID)!
      run.currentDecision = selected
      setStatus(run, "executing")
      const sequence = run.attempts.length + 1
      const result: ActionResult = await options.execute({
        runID: run.id,
        scenarioRunID: snapshot.scenario.runID,
        characterID: snapshot.characterID,
        decision: selected,
        idempotencyKey: `${run.id}:${sequence}`,
        simulationAutoApprove: snapshot.scenario.simulation && capability.risk === "critical" && snapshot.scenario.criticalAutoApproveCategories.includes(capability.permissionCategory),
      }).catch((error): ActionResult => ({ ok: false, code: "transport_error", message: error instanceof Error ? error.message : String(error) }))
      run.attempts.push({
        sequence,
        timestamp: Date.now(),
        worldRevision: snapshot.worldRevision,
        ...(snapshot.scenario.currentStepID ? { stepID: snapshot.scenario.currentStepID } : {}),
        decision: selected,
        ok: result.ok,
        code: result.code,
        ...(result.message ? { message: result.message } : {}),
        risk: capability.risk,
        autoApproved: result.autoApproved === true,
        approved: result.approved === true,
        simulation: snapshot.scenario.simulation,
        latencyMs: Date.now() - started,
      })
      run.currentDecision = undefined
      setStatus(run, "verifying")
      await waitForRevision(options, snapshot.worldRevision, snapshot.scenario.currentStepID, snapshot.scenario.attempt, selected.expectedPostconditions, run.characterID, signal)
    }
  }

  function setStatus(run: AITraineeRun, status: AITraineeStatus) {
    run.status = status
    publish(run)
  }

  function finish(run: AITraineeRun, status: "completed" | "cancelled" | "failed", reason: string) {
    if (terminal(run.status)) return
    run.status = status
    run.reason = reason
    run.completedAt = Date.now()
    publish(run)
  }

  function publish(run: AITraineeRun) {
    options.notify?.(structuredClone(run))
  }

  return {
    start,
    pause,
    resume,
    cancel,
    active: () => active ? structuredClone(active.run) : undefined,
    list: () => structuredClone(history.slice(0, 30)),
  }
}

export async function decideAITrainee(config: RuntimeConfig, context: Record<string, unknown>, seed: number, signal: AbortSignal) {
  const endpoint = new URL("chat/completions", config.baseURL.endsWith("/") ? config.baseURL : config.baseURL + "/")
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.modelID,
      temperature: 0,
      seed,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are an AI trainee in a safety simulation. Choose exactly one declared capability on one visible entity. Return only JSON: {capabilityID,entityID,arguments,expectedPostconditions}. Never invent IDs, lower risk, approve actions, or provide prose." },
        { role: "user", content: JSON.stringify(context) },
      ],
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  })
  if (!response.ok) throw new Error(`model_http_${response.status}`)
  const value = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = value.choices?.[0]?.message?.content
  if (typeof content !== "string" || content.length > 32_000) throw new Error("invalid_model_output")
  try {
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as unknown
  } catch {
    throw new Error("invalid_json")
  }
}

export function validateAITraineeDecision(value: unknown, snapshot: AITraineeSnapshot, profile: AITraineeProfile): { ok: true; decision: AITraineeDecision } | { ok: false; code: string } {
  if (!record(value)) return { ok: false, code: "invalid_decision" }
  if (typeof value.capabilityID !== "string" || typeof value.entityID !== "string" || !record(value.arguments) || !Array.isArray(value.expectedPostconditions))
    return { ok: false, code: "invalid_decision" }
  const capability = snapshot.capabilities.find((item) => item.id === value.capabilityID)
  if (!capability) return { ok: false, code: "capability_mismatch" }
  const entity = snapshot.entities.find((item) => item.id === value.entityID)
  if (!entity) return { ok: false, code: "entity_mismatch" }
  if (!(entity.affordances ?? []).includes(value.capabilityID)) return { ok: false, code: "entity_capability_mismatch" }
  if (profile === "guided" && !(snapshot.scenario.allowedCapabilityIDs ?? []).includes(value.capabilityID))
    return { ok: false, code: "guided_step_mismatch" }
  if (JSON.stringify(value.arguments).length > 32_000 || !jsonValue(value.arguments, 0)) return { ok: false, code: "invalid_arguments" }
  const postconditions = value.expectedPostconditions
  if (postconditions.length > 16 || !postconditions.every((item): item is string => typeof item === "string" && capability.postconditions.includes(item)))
    return { ok: false, code: "postcondition_mismatch" }
  return {
    ok: true,
    decision: {
      capabilityID: value.capabilityID,
      entityID: value.entityID,
      arguments: value.arguments,
      expectedPostconditions: postconditions,
    },
  }
}

export function evaluateAITraineeRun(run: AITraineeRun, goldenPath: string[] = []): AITraineeEvaluation {
  const successful = run.attempts.filter((attempt) => attempt.ok)
  const firstAttempts = run.attempts.filter((attempt, index, values) => values.findIndex((item) => item.stepID === attempt.stepID) === index)
  const actual = successful.map((attempt) => attempt.decision.capabilityID)
  const divergence = goldenPath.findIndex((item, index) => actual[index] !== item)
  return {
    runID: run.id,
    passed: run.status === "completed" && divergence < 0,
    status: run.status,
    completionRate: goldenPath.length ? Math.min(1, successful.length / goldenPath.length) : run.status === "completed" ? 1 : 0,
    firstAttemptAccuracy: firstAttempts.length ? firstAttempts.filter((attempt) => attempt.ok).length / firstAttempts.length : 0,
    unsafeAttempts: run.attempts.filter((attempt) => attempt.risk === "critical" && !attempt.ok).length,
    durationMs: Math.max(0, (run.completedAt ?? Date.now()) - run.startedAt),
    ...(divergence >= 0 ? { firstDivergence: { sequence: divergence + 1, expected: goldenPath[divergence] ?? "complete", actual: actual[divergence] ?? "missing" } } : {}),
  }
}

export async function runAITraineeFixtureBatch(
  config: RuntimeConfig,
  fixture: AITraineeFixture,
  input: { profile: AITraineeProfile; runs: number; seed?: number },
  signal: AbortSignal,
  onProgress?: (batch: AITraineeBatch) => void,
  decide: NonNullable<CoordinatorOptions["decide"]> = decideAITrainee,
) {
  if (!fixture.id || !Array.isArray(fixture.snapshots) || fixture.snapshots.length === 0 || !Array.isArray(fixture.results) || !Array.isArray(fixture.goldenPath))
    throw new Error("invalid_fixture")
  const batch: AITraineeBatch = {
    id: `batch_${randomUUID()}`,
    profile: input.profile,
    seed: boundedSeed(input.seed),
    requestedRuns: Math.max(1, Math.min(100, Math.floor(input.runs))),
    completedRuns: 0,
    status: "running",
    evaluations: [],
    passRate: 0,
    completionRate: 0,
    firstAttemptAccuracy: 0,
    unsafeAttempts: 0,
  }
  onProgress?.(structuredClone(batch))
  for (let index = 0; index < batch.requestedRuns; index++) {
    if (signal.aborted) { batch.status = "cancelled"; break }
    const run: AITraineeRun = {
      id: `${batch.id}:${index + 1}`,
      profile: input.profile,
      mode: "fixture",
      seed: batch.seed + index,
      status: "observing",
      startedAt: Date.now(),
      attempts: [],
    }
    let snapshotIndex = 0
    while (snapshotIndex < fixture.snapshots.length && run.attempts.length < maxDecisions) {
      const snapshot = fixture.snapshots[snapshotIndex]!
      run.scenarioID = snapshot.scenario.scenarioID
      run.scenarioRevision = snapshot.scenario.scenarioRevision
      run.currentStepID = snapshot.scenario.currentStepID
      run.simulation = snapshot.scenario.simulation
      if (snapshot.scenario.status !== "running") {
        run.status = snapshot.scenario.status === "completed" ? "completed" : "failed"
        run.reason = `scenario_${snapshot.scenario.status}`
        break
      }
      const raw = await decide(config, decisionContext(input.profile, snapshot), run.seed + run.attempts.length, signal)
      const validated = validateAITraineeDecision(raw, snapshot, input.profile)
      if (!validated.ok) { run.status = "failed"; run.reason = validated.code; break }
      const selected = validated.decision
      const capability = snapshot.capabilities.find((item) => item.id === selected.capabilityID)!
      const signature = `${selected.capabilityID}\0${selected.entityID}\0${JSON.stringify(selected.arguments)}`
      if (run.attempts.filter((attempt) => !attempt.ok && `${attempt.decision.capabilityID}\0${attempt.decision.entityID}\0${JSON.stringify(attempt.decision.arguments)}` === signature).length >= 2) {
        run.status = "failed"
        run.reason = "repeated_failure"
        break
      }
      const result = fixture.results.find((item) => item.capabilityID === selected.capabilityID && item.entityID === selected.entityID)
      const sequence = run.attempts.length + 1
      run.attempts.push({
        sequence,
        timestamp: Date.now(),
        worldRevision: snapshot.worldRevision,
        ...(snapshot.scenario.currentStepID ? { stepID: snapshot.scenario.currentStepID } : {}),
        decision: selected,
        ok: result?.ok === true,
        code: result?.code ?? "fixture_action_missing",
        ...(result?.message ? { message: result.message } : {}),
        risk: capability.risk,
        autoApproved: capability.risk === "critical" && snapshot.scenario.simulation && snapshot.scenario.criticalAutoApproveCategories.includes(capability.permissionCategory),
        approved: capability.risk !== "critical" || snapshot.scenario.simulation && snapshot.scenario.criticalAutoApproveCategories.includes(capability.permissionCategory),
        simulation: snapshot.scenario.simulation,
        latencyMs: 0,
      })
      if (!result) { run.status = "failed"; run.reason = "fixture_action_missing"; break }
      snapshotIndex = result.nextSnapshot
    }
    if (!terminal(run.status)) {
      const terminalSnapshot = fixture.snapshots[snapshotIndex]
      run.status = terminalSnapshot?.scenario.status === "completed" ? "completed" : "failed"
      run.reason = terminalSnapshot ? `scenario_${terminalSnapshot.scenario.status}` : "fixture_exhausted"
    }
    run.completedAt = Date.now()
    batch.evaluations.push(evaluateAITraineeRun(run, fixture.goldenPath))
    batch.completedRuns++
    updateBatch(batch)
    onProgress?.(structuredClone(batch))
  }
  if (batch.status === "running") batch.status = "completed"
  updateBatch(batch)
  onProgress?.(structuredClone(batch))
  return batch
}

export function aiTraineeReplay(run: AITraineeRun): ReplayFixture {
  const events: ReplayFixture["events"] = [{
    sequence: 1,
    type: "ai.trainee.started",
    timestamp: run.startedAt,
    scenarioID: run.scenarioID,
    scenarioRevision: run.scenarioRevision,
    data: { runID: run.id, profile: run.profile, mode: run.mode, simulation: run.simulation === true },
  }]
  run.attempts.forEach((attempt) => {
    const base = events.length + 1
    events.push({
      sequence: base,
      type: "ai.trainee.decision",
      timestamp: attempt.timestamp,
      scenarioID: run.scenarioID,
      scenarioRevision: run.scenarioRevision,
      stepID: attempt.stepID,
      actionID: attempt.decision.capabilityID,
      idempotencyKey: `${run.id}:${attempt.sequence}`,
      risk: attempt.risk,
      modelRoute: run.modelRoute,
      data: { entityID: attempt.decision.entityID },
    })
    if (attempt.autoApproved) events.push({
      sequence: events.length + 1,
      type: "ai.trainee.auto_approval",
      timestamp: attempt.timestamp,
      actionID: attempt.decision.capabilityID,
      risk: attempt.risk,
      approved: true,
      data: { simulation: attempt.simulation },
    })
    events.push({
      sequence: events.length + 1,
      type: attempt.ok ? "action.executed" : "action.failed",
      timestamp: attempt.timestamp + attempt.latencyMs,
      scenarioID: run.scenarioID,
      scenarioRevision: run.scenarioRevision,
      stepID: attempt.stepID,
      actionID: attempt.decision.capabilityID,
      idempotencyKey: `${run.id}:${attempt.sequence}`,
      risk: attempt.risk,
      approved: attempt.approved,
      latencyMs: attempt.latencyMs,
      data: { code: attempt.code, postconditionsVerified: attempt.ok, autoApproved: attempt.autoApproved, simulation: attempt.simulation },
    })
  })
  events.push({
    sequence: events.length + 1,
    type: `ai.trainee.${run.status}`,
    timestamp: run.completedAt ?? Date.now(),
    scenarioID: run.scenarioID,
    scenarioRevision: run.scenarioRevision,
    data: { runID: run.id, reason: run.reason ?? run.status },
  })
  return { id: run.id, name: `AI Trainee ${run.profile}`, events }
}

export function aiTraineeJUnit(batch: AITraineeBatch | undefined, runs: AITraineeRun[]) {
  const cases = batch?.evaluations ?? runs.map((run) => evaluateAITraineeRun(run))
  const failures = cases.filter((item) => !item.passed).length
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Embodied AI Trainee" tests="${cases.length}" failures="${failures}">\n${cases.map((item) => `  <testcase name="${xml(item.runID)}" time="${(item.durationMs / 1_000).toFixed(3)}">${item.passed ? "" : `<failure message="${xml(item.firstDivergence ? `expected ${item.firstDivergence.expected}, received ${item.firstDivergence.actual}` : item.status)}"/>`}</testcase>`).join("\n")}\n</testsuite>\n`
}

function decisionContext(profile: AITraineeProfile, snapshot: AITraineeSnapshot) {
  return {
    profile,
    goal: snapshot.scenario.title ?? snapshot.scenario.scenarioID,
    ...(profile === "guided" ? {
      currentStepID: snapshot.scenario.currentStepID,
      currentInstruction: snapshot.scenario.currentInstruction,
      allowedCapabilityIDs: snapshot.scenario.allowedCapabilityIDs,
    } : {}),
    worldRevision: snapshot.worldRevision,
    entities: snapshot.entities,
    capabilities: snapshot.capabilities.map((capability) => ({
      id: capability.id,
      title: capability.title,
      description: capability.description,
      parameters: capability.parameters,
      risk: capability.risk,
      preconditions: capability.preconditions,
      postconditions: capability.postconditions,
    })),
  }
}

async function waitForRevision(options: CoordinatorOptions, revision: number, stepID: string | undefined, attempt: number | undefined, postconditions: string[], characterID: string | undefined, signal: AbortSignal) {
  const deadline = Date.now() + 5_000
  while (!signal.aborted && Date.now() < deadline) {
    const next = options.snapshot(characterID)
    if (next && (
      next.worldRevision > revision ||
      next.scenario.currentStepID !== stepID ||
      next.scenario.attempt !== attempt ||
      next.scenario.status !== "running" ||
      postconditions.length > 0 && postconditions.every((condition) => snapshotContains(next, condition))
    )) return
    await delay(100, signal)
  }
  if (!signal.aborted) throw new Error("verification_timeout")
}

function snapshotContains(snapshot: AITraineeSnapshot, condition: string) {
  if (!condition) return false
  const expected = condition.toLowerCase()
  return snapshot.entities.some((entity) => JSON.stringify(entity.state ?? {}).toLowerCase().includes(expected))
}

function terminal(status: AITraineeStatus) {
  return status === "completed" || status === "cancelled" || status === "failed"
}

async function waitForSnapshot(options: CoordinatorOptions, characterID: string | undefined, signal: AbortSignal) {
  const deadline = Date.now() + 30_000
  while (!signal.aborted && Date.now() < deadline) {
    const snapshot = options.snapshot(characterID)
    if (snapshot) return snapshot
    await delay(250, signal).catch(() => undefined)
  }
}

function boundedSeed(value?: number) {
  return Number.isInteger(value) ? Math.max(0, Math.min(2_147_483_647, value!)) : 1
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function updateBatch(batch: AITraineeBatch) {
  batch.passRate = average(batch.evaluations.map((item) => item.passed ? 1 : 0))
  batch.completionRate = average(batch.evaluations.map((item) => item.completionRate))
  batch.firstAttemptAccuracy = average(batch.evaluations.map((item) => item.firstAttemptAccuracy))
  batch.unsafeAttempts = batch.evaluations.reduce((sum, item) => sum + item.unsafeAttempts, 0)
}

function xml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function jsonValue(value: unknown, depth: number): boolean {
  if (depth > 8) return false
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 128 && value.every((item) => jsonValue(item, depth + 1))
  return record(value) && Object.keys(value).length <= 128 && Object.values(value).every((item) => jsonValue(item, depth + 1))
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}
