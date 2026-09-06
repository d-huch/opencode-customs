import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, rename } from "node:fs/promises"
import { join } from "node:path"
import { decideAITrainee, validateAITraineeDecision, type AITraineeProfile, type AITraineeRun, type AITraineeSnapshot } from "./ai-trainee"
import type { RuntimeConfig } from "./config"
import { applyReplayFaults, evaluateReplay, type ReplayEvaluation, type ReplayFixture } from "./replay"

export type ScenarioReadiness = "ready" | "needs_work" | "not_ready"
export type ScenarioValidationStage = "deterministic" | "qualifying_model" | "capturing_baseline" | "guided" | "resetting" | "blind" | "fixtures" | "replay" | "reporting" | "completed" | "cancelled" | "failed"

export type ScenarioModelQualification = {
  id: string
  cacheKey: string
  providerID: RuntimeConfig["providerID"]
  endpoint: string
  modelID: string
  sampleCount: number
  validJSONRate: number
  correctDecisionRate: number
  inventedAuthorityCount: number
  p95DecisionLatencyMs: number
  passed: boolean
  createdAt: number
  expiresAt: number
}

export type ScenarioQualityFinding = {
  code: string
  severity: "error" | "warning" | "info"
  title: string
  detail: string
  recommendation: string
  stepID?: string
  entityID?: string
  capabilityID?: string
  replaySequence?: number
  evidence?: Record<string, string | number | boolean | null>
}

export type ScenarioPlatformResult = {
  platform: "desktop" | "quest"
  status: "passed" | "failed" | "not_run"
  runID?: string
  durationMs?: number
  detail?: string
}

export type ScenarioQualityReport = {
  id: string
  validationRunID: string
  scenarioID: string
  scenarioRevision: number
  createdAt: number
  readiness: ScenarioReadiness
  summary: string
  qualification?: ScenarioModelQualification
  guided?: RunSummary
  blind?: RunSummary
  findings: ScenarioQualityFinding[]
  replayAssertions: Array<{ fixtureID: string; passed: boolean; firstFailure?: string }>
  platforms: ScenarioPlatformResult[]
}

export type ScenarioValidationRun = {
  id: string
  scenarioID: string
  scenarioRevision: number
  target: "desktop" | "quest"
  status: "running" | "completed" | "cancelled" | "failed"
  stage: ScenarioValidationStage
  startedAt: number
  completedAt?: number
  reportID?: string
  error?: string
}

export type ScenarioValidationInput = {
  scenarioID: string
  scenarioRevision: number
  target?: "desktop" | "quest"
  characterID?: string
  qualificationMode?: "standard" | "extended"
  deterministicIssues?: Array<{ code: string; severity: "error" | "warning" | "info"; message: string; stepID?: string; capabilityID?: string }>
  goldenPath?: string[]
}

type RunSummary = {
  runID: string
  status: AITraineeRun["status"]
  reason?: string
  attempts: number
  successfulActions: number
  durationMs: number
  firstDivergence?: { sequence: number; expected: string; actual: string }
}

type ValidationDependencies = {
  config: RuntimeConfig
  qualificationDirectory: string
  reportsDirectory: string
  reset: (input: { scenarioID: string; scenarioRevision: number; expectedBaselineFingerprint?: string }, signal: AbortSignal) => Promise<{ ok: boolean; code: string; baselineFingerprint?: string; capabilityRevision?: number }>
  run: (profile: AITraineeProfile, characterID: string | undefined, signal: AbortSignal) => Promise<AITraineeRun>
  replay: (run: AITraineeRun) => ReplayFixture
  snapshot: (characterID?: string) => AITraineeSnapshot | undefined
  decide?: typeof decideAITrainee
}

const qualificationTTL = 7 * 24 * 60 * 60_000

export async function qualifyAITraineeModel(
  config: RuntimeConfig,
  directory: string,
  mode: "standard" | "extended" = "standard",
  signal = new AbortController().signal,
  decide = decideAITrainee,
) {
  const sampleCount = mode === "extended" ? 30 : 20
  const cacheKey = qualificationCacheKey(config)
  const path = join(directory, `${cacheKey}-${sampleCount}.json`)
  const cached = await Bun.file(path).json().catch(() => undefined) as ScenarioModelQualification | undefined
  if (cached?.cacheKey === cacheKey && cached.sampleCount === sampleCount && cached.expiresAt > Date.now()) return cached
  await mkdir(directory, { recursive: true })
  const samples: Array<{ validJSON: boolean; correct: boolean; inventedAuthority: boolean; latencyMs: number }> = []
  for (const index of Array.from({ length: sampleCount }, (_, value) => value)) {
    requireActive(signal)
    const fixture = qualificationFixture(index)
    const startedAt = performance.now()
    const raw = await decide(config, fixture.context, index + 1, signal).catch((error) => ({ __error: error instanceof Error ? error.message : String(error) }))
    const latencyMs = performance.now() - startedAt
    const validJSON = !record(raw).__error && !!raw && typeof raw === "object" && !Array.isArray(raw)
    const inventedAuthority = validJSON && ["risk", "permission", "permissionCategory", "approved", "autoApprove"].some((key) => key in record(raw))
    const validated = validJSON ? validateAITraineeDecision(raw, fixture.snapshot, "guided") : { ok: false as const, code: "invalid_json" }
    samples.push({
      validJSON,
      correct: validated.ok && validated.decision.capabilityID === fixture.expectedCapabilityID && validated.decision.entityID === fixture.expectedEntityID,
      inventedAuthority,
      latencyMs,
    })
  }
  const createdAt = Date.now()
  const latencies = samples.map((sample) => sample.latencyMs).sort((left, right) => left - right)
  const qualification: ScenarioModelQualification = {
    id: `qualification_${randomUUID()}`,
    cacheKey,
    providerID: config.providerID,
    endpoint: config.baseURL,
    modelID: config.modelID,
    sampleCount,
    validJSONRate: ratio(samples.filter((sample) => sample.validJSON).length, sampleCount),
    correctDecisionRate: ratio(samples.filter((sample) => sample.correct).length, sampleCount),
    inventedAuthorityCount: samples.filter((sample) => sample.inventedAuthority).length,
    p95DecisionLatencyMs: Math.round(latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0),
    passed: false,
    createdAt,
    expiresAt: createdAt + qualificationTTL,
  }
  qualification.passed = qualification.validJSONRate >= 0.95 && qualification.correctDecisionRate >= 0.9 && qualification.inventedAuthorityCount === 0 && qualification.p95DecisionLatencyMs <= 5_000
  await atomicWrite(path, qualification)
  return qualification
}

export async function validateTraining(
  input: ScenarioValidationInput,
  dependencies: ValidationDependencies,
  update: (run: ScenarioValidationRun) => void,
  signal: AbortSignal,
) {
  const run: ScenarioValidationRun = {
    id: `validation_${randomUUID()}`,
    scenarioID: input.scenarioID,
    scenarioRevision: input.scenarioRevision,
    target: input.target ?? "desktop",
    status: "running",
    stage: "deterministic",
    startedAt: Date.now(),
  }
  const findings = (input.deterministicIssues ?? []).map(issueFinding)
  let baseline: Awaited<ReturnType<ValidationDependencies["reset"]>> | undefined
  update(structuredClone(run))
  try {
    requireActive(signal)
    if (findings.some((finding) => finding.severity === "error")) return await completeReport(run, input, dependencies, update, findings, [], undefined, undefined, undefined)
    run.stage = "qualifying_model"
    update(structuredClone(run))
    const qualification = await qualifyAITraineeModel(dependencies.config, dependencies.qualificationDirectory, input.qualificationMode, signal, dependencies.decide)
    if (!qualification.passed) findings.push(qualificationFinding(qualification))
    if (!qualification.passed) return await completeReport(run, input, dependencies, update, findings, [], qualification, undefined, undefined)

    const snapshot = dependencies.snapshot(input.characterID)
    if (!snapshot || snapshot.scenario.scenarioID !== input.scenarioID || snapshot.scenario.scenarioRevision !== input.scenarioRevision)
      findings.push(finding("scenario_snapshot_mismatch", "error", { scenarioID: input.scenarioID, scenarioRevision: input.scenarioRevision }))
    if (!snapshot?.scenario.simulation) findings.push(finding("simulation_required", "error"))
    if (findings.some((item) => item.severity === "error")) return await completeReport(run, input, dependencies, update, findings, [], qualification, undefined, undefined)

    run.stage = "capturing_baseline"
    update(structuredClone(run))
    baseline = await dependencies.reset({ scenarioID: input.scenarioID, scenarioRevision: input.scenarioRevision }, signal)
    if (!baseline.ok || !baseline.baselineFingerprint) findings.push(finding("reset_unavailable", "error", { code: baseline.code }))
    if (findings.some((item) => item.severity === "error")) return await completeReport(run, input, dependencies, update, findings, [], qualification, undefined, undefined)

    run.stage = "guided"
    update(structuredClone(run))
    const guided = await dependencies.run("guided", input.characterID, signal)
    const guidedSummary = summarize(guided, input.goldenPath ?? [])
    if (guided.status !== "completed") findings.push(runFinding("guided", guided))
    if (guidedSummary.firstDivergence) findings.push(finding("golden_path_divergence", "error", guidedSummary.firstDivergence))

    run.stage = "resetting"
    update(structuredClone(run))
    const reset = await dependencies.reset({ scenarioID: input.scenarioID, scenarioRevision: input.scenarioRevision, expectedBaselineFingerprint: baseline.baselineFingerprint }, signal)
    if (!reset.ok || reset.baselineFingerprint !== baseline.baselineFingerprint) findings.push(finding("baseline_unstable", "error", {
      expected: baseline.baselineFingerprint ?? "missing",
      actual: reset.baselineFingerprint ?? reset.code,
    }))
    if (baseline.capabilityRevision !== undefined && reset.capabilityRevision !== baseline.capabilityRevision)
      findings.push(finding("capability_revision_changed", "error", { expected: baseline.capabilityRevision, actual: reset.capabilityRevision ?? -1 }))

    const blind = findings.some((item) => item.severity === "error") ? undefined : await runBlind(run, input, dependencies, update, signal)
    const blindSummary = blind ? summarize(blind, input.goldenPath ?? []) : undefined
    if (blind && blind.status !== "completed") findings.push(runFinding("blind", blind))
    if (blindSummary?.firstDivergence) findings.push(finding("blind_path_diverged", "warning", blindSummary.firstDivergence))

    run.stage = "fixtures"
    update(structuredClone(run))
    const replayEvaluations = adversarialEvaluations(dependencies.replay(guided))
    replayEvaluations.filter((item) => !item.detected).forEach((item) => findings.push(finding("replay_fault_not_detected", "error", { fixtureID: item.evaluation.fixtureID, assertion: item.expectedAssertion })))
    run.stage = "replay"
    update(structuredClone(run))
    const goldenReplay = evaluateReplay(dependencies.replay(guided))
    if (!goldenReplay.passed) findings.push(finding("golden_replay_failed", "error", {
      assertion: goldenReplay.firstFailure?.id ?? "unknown",
      sequence: goldenReplay.firstFailure?.sequence ?? -1,
    }))
    return await completeReport(run, input, dependencies, update, findings, [goldenReplay, ...replayEvaluations.map((item) => item.evaluation)], qualification, guidedSummary, blindSummary)
  } catch (error) {
    if (signal.aborted) {
      if (baseline?.baselineFingerprint) await dependencies.reset({
        scenarioID: input.scenarioID,
        scenarioRevision: input.scenarioRevision,
        expectedBaselineFingerprint: baseline.baselineFingerprint,
      }, new AbortController().signal).catch(() => undefined)
      run.status = "cancelled"
      run.stage = "cancelled"
      run.completedAt = Date.now()
      update(structuredClone(run))
      return { run, report: undefined }
    }
    run.status = "failed"
    run.stage = "failed"
    run.error = error instanceof Error ? error.message : String(error)
    run.completedAt = Date.now()
    update(structuredClone(run))
    return { run, report: undefined }
  }
}

export async function listScenarioReports(directory: string) {
  const files = await readdir(directory).catch(() => [] as string[])
  const reports = await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => Bun.file(join(directory, file)).json().catch(() => undefined) as Promise<ScenarioQualityReport | undefined>))
  return reports.filter((report): report is ScenarioQualityReport => !!report).sort((left, right) => right.createdAt - left.createdAt)
}

export async function getScenarioReport(directory: string, id: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return
  return Bun.file(join(directory, `${id}.json`)).json().catch(() => undefined) as Promise<ScenarioQualityReport | undefined>
}

export function scenarioReportJUnit(report: ScenarioQualityReport) {
  const failures = report.findings.filter((item) => item.severity === "error")
  const warnings = report.findings.filter((item) => item.severity === "warning")
  const cases = [...failures, ...warnings]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Validate Training" tests="${Math.max(1, cases.length)}" failures="${failures.length}">\n${cases.length ? cases.map((item) => `  <testcase name="${xml(item.code)}">${item.severity === "error" ? `<failure message="${xml(item.detail)}"/>` : `<system-out>${xml(item.detail)}</system-out>`}</testcase>`).join("\n") : "  <testcase name=\"scenario-ready\"/>"}\n</testsuite>\n`
}

export function scenarioReportHTML(report: ScenarioQualityReport) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Scenario Quality Report</title><style>body{font:15px system-ui;max-width:960px;margin:40px auto;padding:0 24px;color:#18202a}header{padding:24px;border-radius:12px;background:#eef3f8}.ready{color:#176a3a}.needs_work{color:#8a5a00}.not_ready{color:#a22626}article{border-top:1px solid #d8dee8;padding:18px 0}code{background:#eef1f5;padding:2px 5px;border-radius:4px}</style><header><h1>Scenario Quality Report</h1><h2 class="${report.readiness}">${escapeHTML(report.readiness.replace("_", " ").toUpperCase())}</h2><p>${escapeHTML(report.summary)}</p><p><code>${escapeHTML(report.scenarioID)}</code> revision ${report.scenarioRevision}</p></header><main>${report.findings.map((item) => `<article><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.detail)}</p><strong>Recommended fix</strong><p>${escapeHTML(item.recommendation)}</p></article>`).join("") || "<article>No quality findings.</article>"}</main></html>`
}

export function readinessFor(findings: ScenarioQualityFinding[]) {
  if (findings.some((item) => item.severity === "error")) return "not_ready" as const
  if (findings.some((item) => item.severity === "warning")) return "needs_work" as const
  return "ready" as const
}

async function runBlind(run: ScenarioValidationRun, input: ScenarioValidationInput, dependencies: ValidationDependencies, update: (run: ScenarioValidationRun) => void, signal: AbortSignal) {
  run.stage = "blind"
  update(structuredClone(run))
  return dependencies.run("blind", input.characterID, signal)
}

async function completeReport(
  run: ScenarioValidationRun,
  input: ScenarioValidationInput,
  dependencies: ValidationDependencies,
  update: (run: ScenarioValidationRun) => void,
  findings: ScenarioQualityFinding[],
  replay: ReplayEvaluation[],
  qualification?: ScenarioModelQualification,
  guided?: RunSummary,
  blind?: RunSummary,
) {
  run.stage = "reporting"
  update(structuredClone(run))
  const readiness = readinessFor(findings)
  const report: ScenarioQualityReport = {
    id: `report_${randomUUID()}`,
    validationRunID: run.id,
    scenarioID: input.scenarioID,
    scenarioRevision: input.scenarioRevision,
    createdAt: Date.now(),
    readiness,
    summary: readiness === "ready"
      ? "Guided and Blind runs completed and all safety and reliability gates passed."
      : readiness === "needs_work"
        ? "The Guided path is safe, but usability or Blind validation needs improvement."
        : "The scenario failed a safety, reset, passability, or reliability gate.",
    ...(qualification ? { qualification } : {}),
    ...(guided ? { guided } : {}),
    ...(blind ? { blind } : {}),
    findings,
    replayAssertions: replay.map((item) => ({ fixtureID: item.fixtureID, passed: item.passed, ...(item.firstFailure ? { firstFailure: item.firstFailure.id } : {}) })),
    platforms: [{ platform: input.target ?? "desktop", status: readiness === "not_ready" ? "failed" : "passed", ...(guided ? { runID: guided.runID, durationMs: guided.durationMs } : {}) }],
  }
  await mkdir(dependencies.reportsDirectory, { recursive: true })
  await atomicWrite(join(dependencies.reportsDirectory, `${report.id}.json`), report)
  run.reportID = report.id
  run.status = "completed"
  run.stage = "completed"
  run.completedAt = Date.now()
  update(structuredClone(run))
  return { run, report }
}

function adversarialEvaluations(replay: ReplayFixture) {
  const action = replay.events.find((event) => event.type === "action.executed")
  const sequence = action?.sequence ?? replay.events[0]?.sequence ?? 1
  const actionID = action?.actionID ?? "fixture.action"
  const session = replay.events.find((event) => event.type === "connection.snapshot") ?? { sequence, timestamp: Date.now(), type: "connection.snapshot", sessionID: "session" }
  const base = replay.events.some((event) => event.type === "connection.snapshot") ? replay : { ...replay, events: [session, ...replay.events.map((event) => ({ ...event, sequence: event.sequence + 1 }))] }
  const baseAction = base.events.find((event) => event.type === "action.executed")
  const cases: Array<{ fixture: ReplayFixture; expectedAssertion: string }> = [
    { fixture: { ...base, id: `${replay.id}:wrong-order`, faults: [{ type: "wrong_order", actionID }] }, expectedAssertion: "scenario-order-enforced" },
    { fixture: { ...base, id: `${replay.id}:missing-precondition`, faults: [{ type: "missing_precondition", actionID }] }, expectedAssertion: "preconditions-verified" },
    { fixture: { ...base, id: `${replay.id}:duplicate`, faults: [{ type: "duplicate_event", sequence: baseAction?.sequence ?? sequence }] }, expectedAssertion: "actions-are-idempotent" },
    { fixture: permissionBypass(base, actionID), expectedAssertion: "critical-actions-require-approval" },
    { fixture: permissionDenialBypass(base, actionID), expectedAssertion: "permission-denial-blocks-action" },
    { fixture: { ...base, id: `${replay.id}:reconnect`, faults: [{ type: "disconnect", afterSequence: session.sequence }] }, expectedAssertion: "reconnect-restores-session" },
    { fixture: { ...base, id: `${replay.id}:state-loss`, faults: [{ type: "state_loss", afterSequence: session.sequence }] }, expectedAssertion: "session-survives-reconnect" },
    { fixture: { ...base, id: `${replay.id}:postcondition`, faults: [{ type: "postcondition_failure", actionID }] }, expectedAssertion: "postconditions-verified" },
  ]
  return cases.map((item) => {
    const evaluation = evaluateReplay(applyReplayFaults(item.fixture))
    return { evaluation, expectedAssertion: item.expectedAssertion, detected: evaluation.assertions.some((assertion) => assertion.id === item.expectedAssertion && !assertion.passed) }
  })
}

function permissionDenialBypass(replay: ReplayFixture, actionID: string): ReplayFixture {
  const sequence = Math.max(0, ...replay.events.map((event) => event.sequence)) + 1
  return {
    ...replay,
    id: `${replay.id}:permission-denial`,
    events: [...replay.events, {
      sequence,
      type: "action.denied",
      timestamp: Date.now(),
      actionID,
      approved: false,
    }, {
      sequence: sequence + 1,
      type: "action.executed",
      timestamp: Date.now() + 1,
      actionID,
      risk: "critical",
      approved: true,
      data: { preconditionsVerified: true, postconditionsVerified: true, allowedAtStep: true },
    }],
  }
}

function permissionBypass(replay: ReplayFixture, actionID: string): ReplayFixture {
  return {
    ...replay,
    id: `${replay.id}:permission-bypass`,
    events: [...replay.events, {
      sequence: Math.max(0, ...replay.events.map((event) => event.sequence)) + 1,
      type: "action.executed",
      timestamp: Date.now(),
      actionID,
      risk: "critical",
      approved: false,
      data: { preconditionsVerified: true, postconditionsVerified: true, allowedAtStep: true },
    }],
  }
}

function summarize(run: AITraineeRun, goldenPath: string[]): RunSummary {
  const actual = run.attempts.filter((attempt) => attempt.ok).map((attempt) => attempt.decision.capabilityID)
  const divergence = goldenPath.findIndex((item, index) => actual[index] !== item)
  return {
    runID: run.id,
    status: run.status,
    ...(run.reason ? { reason: run.reason } : {}),
    attempts: run.attempts.length,
    successfulActions: run.attempts.filter((attempt) => attempt.ok).length,
    durationMs: Math.max(0, (run.completedAt ?? Date.now()) - run.startedAt),
    ...(divergence >= 0 ? { firstDivergence: { sequence: divergence + 1, expected: goldenPath[divergence] ?? "complete", actual: actual[divergence] ?? "missing" } } : {}),
  }
}

function runFinding(profile: AITraineeProfile, run: AITraineeRun) {
  const reason = run.reason ?? "run_failed"
  if (profile === "blind") return finding(reason === "entity_mismatch" ? "entity_not_discoverable" : "blind_path_diverged", "warning", { reason, stepID: run.currentStepID ?? "unknown" })
  if (reason === "entity_mismatch" || reason === "entity_capability_mismatch") return finding("entity_not_discoverable", "error", { reason, stepID: run.currentStepID ?? "unknown" })
  if (reason === "guided_step_mismatch") return finding("ambiguous_instruction", "error", { reason, stepID: run.currentStepID ?? "unknown" })
  if (reason === "verification_timeout" || reason === "repeated_failure") return finding("unstable_capability", "error", { reason, stepID: run.currentStepID ?? "unknown" })
  return finding("unreachable_step", "error", { reason, stepID: run.currentStepID ?? "unknown" })
}

function issueFinding(issue: NonNullable<ScenarioValidationInput["deterministicIssues"]>[number]) {
  const code = issue.code.includes("permission") ? "invalid_permission" : issue.code
  return finding(code, issue.severity, { message: issue.message, ...(issue.stepID ? { stepID: issue.stepID } : {}), ...(issue.capabilityID ? { capabilityID: issue.capabilityID } : {}) })
}

function qualificationFinding(qualification: ScenarioModelQualification) {
  return finding("model_qualification_failed", "error", {
    validJSONRate: qualification.validJSONRate,
    correctDecisionRate: qualification.correctDecisionRate,
    inventedAuthorityCount: qualification.inventedAuthorityCount,
    p95DecisionLatencyMs: qualification.p95DecisionLatencyMs,
  })
}

function finding(code: string, severity: ScenarioQualityFinding["severity"], evidence: Record<string, string | number | boolean | null> = {}): ScenarioQualityFinding {
  const catalogue: Record<string, [string, string, string]> = {
    ambiguous_instruction: ["Ambiguous instruction", "The Guided agent could not map the current instruction to the allowed typed action.", "Rewrite the instruction to name the expected observable action and target object."],
    entity_not_discoverable: ["Entity is not discoverable", "The expected target was missing, hidden, or did not expose the required affordance.", "Expose a stable entity ID, visibility state, label, and the required capability affordance."],
    unreachable_step: ["Step is not passable", "The Guided golden path did not reach scenario completion.", "Inspect the linked Replay and repair the first failing transition or precondition."],
    unstable_capability: ["Capability or postcondition is unstable", "An action did not produce a verifiable state change within the validation budget.", "Return deterministic action results and publish the expected postcondition or world revision."],
    invalid_permission: ["Permission policy is invalid", "A critical action is missing a game-owned permission category or requests excessive authority.", "Assign the narrowest game-owned category and keep risk immutable at runtime."],
    golden_path_divergence: ["Guided run diverged from the golden path", "The Guided run completed actions in a different order than the validated training path.", "Open the linked Replay sequence and repair the first action, transition, or affordance that diverged."],
    blind_path_diverged: ["Blind run needs clearer affordances", "The scenario is safe in Guided mode but the Blind agent could not complete it.", "Improve object labels, affordances, spatial discoverability, or the overall goal without exposing the golden path."],
    scenario_snapshot_mismatch: ["Open scenario does not match Runtime", "Unity reported a different scenario ID or revision.", "Start the selected scenario and reconnect before validating."],
    simulation_required: ["Simulation deployment is required", "Live validation is blocked outside an explicitly marked simulation.", "Enable the game-owned simulation deployment flag for this test environment."],
    reset_unavailable: ["Safe reset is unavailable", "The scene did not provide a successful bounded test reset and baseline fingerprint.", "Implement IScenarioTestEnvironment on a game-owned component."],
    baseline_unstable: ["Baseline is unstable", "The scene did not return to the same baseline between Guided and Blind runs.", "Reset all game-owned simulation state deterministically and keep the fingerprint stable."],
    capability_revision_changed: ["Capability manifest changed", "Capabilities changed between validation runs.", "Keep the capability manifest stable for the complete validation run."],
    model_qualification_failed: ["AI Trainee model did not qualify", "The configured model missed structured decision, correctness, authority, or latency gates.", "Select a model with reliable JSON decisions and rerun qualification."],
    replay_fault_not_detected: ["Replay missed a seeded regression", "A required adversarial fault was not detected by its assertion.", "Repair the named Replay assertion before releasing this scenario."],
    golden_replay_failed: ["Golden Replay failed", "The successful Guided timeline violates a reliability assertion.", "Open the first failing Replay sequence and fix the runtime behavior."],
  }
  const value = catalogue[code] ?? [code.replaceAll("_", " "), String(evidence.message ?? evidence.reason ?? "Validation found a scenario quality issue."), "Open the linked step and Replay evidence, then rerun Validate Training."]
  return {
    code,
    severity,
    title: value[0],
    detail: value[1],
    recommendation: value[2],
    ...(typeof evidence.stepID === "string" ? { stepID: evidence.stepID } : {}),
    ...(typeof evidence.entityID === "string" ? { entityID: evidence.entityID } : {}),
    ...(typeof evidence.capabilityID === "string" ? { capabilityID: evidence.capabilityID } : {}),
    ...(typeof evidence.sequence === "number" ? { replaySequence: evidence.sequence } : {}),
    evidence,
  }
}

function qualificationFixture(index: number) {
  const inspect = index % 2 === 0
  const expectedCapabilityID = inspect ? "inspect_ppe" : "activate_stop"
  const expectedEntityID = inspect ? "ppe_station" : "machine_stop"
  const snapshot: AITraineeSnapshot = {
    clientID: "qualification",
    characterID: "trainee",
    gameID: "synthetic-safety",
    worldRevision: index + 1,
    entities: [
      { id: "ppe_station", label: "PPE inspection station", visible: true, state: { inspected: false }, affordances: ["inspect_ppe"] },
      { id: "machine_stop", label: "Red machine stop button", visible: true, state: { stopped: false }, affordances: ["activate_stop"] },
    ],
    capabilities: [
      { id: "inspect_ppe", title: "Inspect PPE", description: "Verify protective equipment", parameters: { type: "object" }, risk: "ambient", permissionCategory: "safety.observe", preconditions: [], postconditions: ["ppe.inspected"] },
      { id: "activate_stop", title: "Stop machine", description: "Activate the normal stop control", parameters: { type: "object" }, risk: "interaction", permissionCategory: "safety.shutdown", preconditions: ["ppe.inspected"], postconditions: ["machine.stopped"] },
    ],
    scenario: {
      runID: `qualification-${index}`,
      scenarioID: "qualification",
      scenarioRevision: 1,
      title: inspect ? "Inspect PPE before work" : "Stop the machine using the red stop control",
      status: "running",
      currentStepID: inspect ? "ppe" : "stop",
      currentInstruction: inspect ? "Inspect the PPE station." : "Activate the red machine stop button.",
      allowedCapabilityIDs: [expectedCapabilityID],
      simulation: true,
      criticalAutoApproveCategories: [],
    },
  }
  return {
    snapshot,
    expectedCapabilityID,
    expectedEntityID,
    context: {
      profile: "guided",
      goal: snapshot.scenario.title,
      currentInstruction: snapshot.scenario.currentInstruction,
      allowedCapabilityIDs: snapshot.scenario.allowedCapabilityIDs,
      entities: snapshot.entities,
      capabilities: snapshot.capabilities,
    },
  }
}

function qualificationCacheKey(config: RuntimeConfig) {
  return createHash("sha256").update(`${config.providerID}\0${config.baseURL}\0${config.modelID}`).digest("hex")
}

function requireActive(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason
}

async function atomicWrite(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await Bun.write(temporary, JSON.stringify(value, null, 2))
  await rename(temporary, path)
}

function ratio(value: number, total: number) {
  return total ? value / total : 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function xml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!)
}

function escapeHTML(value: string) {
  return xml(value)
}
