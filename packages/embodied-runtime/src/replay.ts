import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto"

export type ReplayEvent = {
  sequence: number
  type: string
  timestamp: number
  requestID?: string
  sessionID?: string
  scenarioID?: string
  scenarioRevision?: number
  stepID?: string
  memoryScope?: string
  actionID?: string
  idempotencyKey?: string
  risk?: "ambient" | "interaction" | "critical"
  approved?: boolean
  phase?: string
  modelRoute?: string
  latencyMs?: number
  textHash?: string
  data?: Record<string, string | number | boolean | null>
}

export type ReplayFault =
  | { type: "disconnect"; afterSequence: number }
  | { type: "model_offline"; afterSequence: number }
  | { type: "timeout"; afterSequence: number; durationMs: number }
  | { type: "duplicate_event"; sequence: number }
  | { type: "permission_denial"; actionID: string }
  | { type: "action_failure"; actionID: string; code?: string }
  | { type: "memory_scope_leak"; sequence: number; scope: string }
  | { type: "wrong_order"; actionID: string; stepID?: string }
  | { type: "missing_precondition"; actionID: string }
  | { type: "postcondition_failure"; actionID: string }
  | { type: "state_loss"; afterSequence: number }

export type ReplayFixture = {
  id: string
  name: string
  expectedFailures?: string[]
  faults?: ReplayFault[]
  events: ReplayEvent[]
}

export type ReplayAssertion = {
  id: string
  passed: boolean
  detail: string
  sequence?: number
}

export type ReplayEvaluation = {
  fixtureID: string
  passed: boolean
  assertions: ReplayAssertion[]
  firstFailure?: ReplayAssertion
}

export type ReplayComparison = {
  baselineID: string
  candidateID: string
  passed: boolean
  firstDifference?: {
    sequence: number
    baseline?: ReplayEvent
    candidate?: ReplayEvent
    detail: string
  }
  regressions: ReplayAssertion[]
}

export type ReplayAuditBundle = {
  format: "embodied-agent-replay-audit-v1"
  fixtureID: string
  generatedAt: string
  rootHash: string
  events: ReturnType<typeof auditReplay>
  signature?: { algorithm: string; publicKeyFingerprint: string; value: string }
}

export type ReplayAuditVerification = {
  valid: boolean
  hashChain: boolean
  rootHash: boolean
  signature: "valid" | "invalid" | "unsigned" | "missing_key"
  detail: string
}

export function evaluateReplay(fixture: ReplayFixture): ReplayEvaluation {
  const sourceOrderValid = fixture.events.every((event, index) => index === 0 || event.sequence > fixture.events[index - 1]!.sequence)
  const ordered = [...fixture.events].sort((left, right) => left.sequence - right.sequence)
  const responses = ordered.filter((event) => event.type === "assistant.done" && event.requestID)
  const duplicated = responses.find((event, index) =>
    responses.findIndex((candidate) => candidate.requestID === event.requestID) !== index,
  )
  const sessions = ordered.filter((event) => event.type === "connection.snapshot" && event.sessionID)
  const stateLoss = sessions.length > 1 && new Set(sessions.map((event) => event.sessionID)).size > 1
  const disconnect = ordered.find((event) => event.type === "connection.closed")
  const reconnect = disconnect
    ? ordered.find((event) => event.type === "connection.snapshot" && event.sequence > disconnect.sequence && event.sessionID === sessions.find((item) => item.sequence < disconnect.sequence)?.sessionID)
    : true
  const permissionBypass = ordered.find(
    (event) => event.type === "action.executed" && event.risk === "critical" && event.approved !== true,
  )
  const deniedActions = new Map(ordered.filter((event) => event.type === "action.denied" && event.actionID).map((event) => [event.actionID!, event.sequence]))
  const actionAfterDenial = ordered.find((event) => event.type === "action.executed" && event.actionID && event.sequence > (deniedActions.get(event.actionID) ?? Number.MAX_SAFE_INTEGER))
  const actionExecutions = ordered.filter((event) => event.type === "action.executed" && event.idempotencyKey)
  const duplicateAction = actionExecutions.find((event, index) =>
    actionExecutions.findIndex((candidate) => candidate.idempotencyKey === event.idempotencyKey) !== index,
  )
  const scopes = ordered.filter((event) => event.type === "memory.used" && event.memoryScope)
  const expectedScope = ordered.find((event) => event.type === "turn.started")?.memoryScope
  const leaked = expectedScope
    ? scopes.find((event) => event.memoryScope !== expectedScope && event.memoryScope !== "user:shared")
    : undefined
  const bargeIn = ordered.find((event) => event.type === "barge_in")
  const neutral = bargeIn
    ? ordered.find(
        (event) =>
          event.type === "presentation.neutral" &&
          event.sequence > bargeIn.sequence &&
          event.timestamp - bargeIn.timestamp <= 150,
      )
    : undefined
  const started = ordered.filter((event) => event.type === "turn.started" && event.requestID)
  const terminal = new Set(
    ordered
      .filter((event) => ["assistant.done", "turn.cancelled", "turn.error"].includes(event.type) && event.requestID)
      .map((event) => event.requestID),
  )
  const unterminated = started.find((event) => !terminal.has(event.requestID ?? ""))
  const postconditionFailure = ordered.find(
    (event) => event.type === "action.executed" && event.data?.postconditionsVerified === false,
  )
  const preconditionFailure = ordered.find(
    (event) => event.type === "action.executed" && event.data?.preconditionsVerified === false,
  )
  const wrongOrder = ordered.find(
    (event) => event.type === "action.executed" && event.data?.allowedAtStep === false,
  )
  const expiredApprovals = new Map(ordered.filter((event) => event.type === "approval.expired" && event.actionID).map((event) => [event.actionID!, event.sequence]))
  const actionAfterExpiry = ordered.find((event) => event.type === "action.executed" && event.actionID && event.sequence > (expiredApprovals.get(event.actionID) ?? Number.MAX_SAFE_INTEGER))
  const deliveries = ordered.filter((event) => event.type === "result.delivered" && event.idempotencyKey)
  const duplicateDelivery = deliveries.find((event, index) => deliveries.findIndex((item) => item.idempotencyKey === event.idempotencyKey) !== index)
  const crash = ordered.find((event) => event.type === "runtime.crashed")
  const safeRecovery = crash
    ? ordered.find((event) => event.sequence > crash.sequence && event.type === "scenario.suspended") &&
      ordered.find((event) => event.sequence > crash.sequence && event.type === "runtime.recovered")
    : true
  const corrupt = ordered.find((event) => event.type === "runtime.state_corrupt")
  const corruptionRecovered = corrupt
    ? ordered.find((event) => event.sequence > corrupt.sequence && event.type === "runtime.recovered")
    : true
  const interventions = ordered.filter((event) => event.type.startsWith("instructor.") && !["instructor.command.sent", "instructor.command.result"].includes(event.type))
  const duplicateIntervention = interventions.find((event, index) => {
    const requestID = event.requestID ?? (typeof event.data?.requestID === "string" ? event.data.requestID : undefined)
    if (!requestID) return false
    return interventions.findIndex((candidate) => (candidate.requestID ?? candidate.data?.requestID) === requestID) !== index
  })
  const invalidInstructorEvidence = interventions.find((event) => event.type === "instructor.evidence" && event.data?.source !== "instructor")
  const terminate = interventions.find((event) => event.type === "instructor.terminate")
  const safeTermination = !terminate || ordered.find((event) =>
    event.sequence > terminate.sequence && event.type === "scenario.cancelled" && event.data?.reason === "instructor_terminated",
  )
  const aiRuns = ordered.filter((event) => event.type === "ai.trainee.started" && typeof event.data?.runID === "string")
  const aiTerminalIDs = new Set(ordered
    .filter((event) => ["ai.trainee.completed", "ai.trainee.cancelled", "ai.trainee.failed"].includes(event.type) && typeof event.data?.runID === "string")
    .map((event) => event.data?.runID))
  const unfinishedAITrainee = aiRuns.find((event) => !aiTerminalIDs.has(event.data?.runID))
  const invalidAIAutoApproval = ordered.find((event) =>
    event.type === "ai.trainee.auto_approval" && (event.risk !== "critical" || event.data?.simulation !== true),
  )
  const assertions: ReplayAssertion[] = [
    assertion("events-are-strictly-ordered", sourceOrderValid, sourceOrderValid
      ? "event sequence is strictly increasing"
      : "fixture contains an out-of-order or duplicate sequence"),
    assertion("no-duplicate-response", !duplicated, duplicated
      ? `request ${duplicated.requestID} completed more than once`
      : "responses are idempotent", duplicated?.sequence),
    assertion("session-survives-reconnect", !stateLoss, stateLoss
      ? "canonical session changed across reconnect"
      : "canonical session was preserved", sessions.at(-1)?.sequence),
    assertion("reconnect-restores-session", Boolean(reconnect), reconnect
      ? "reconnect restored the previous canonical session"
      : "disconnect was not followed by a matching session snapshot", disconnect?.sequence),
    assertion("critical-actions-require-approval", !permissionBypass, permissionBypass
      ? `${permissionBypass.actionID ?? "critical action"} ran without approval`
      : "permission boundary held", permissionBypass?.sequence),
    assertion("permission-denial-blocks-action", !actionAfterDenial, actionAfterDenial
      ? `${actionAfterDenial.actionID ?? "action"} executed after permission was denied`
      : "denied actions remained blocked", actionAfterDenial?.sequence),
    assertion("actions-are-idempotent", !duplicateAction, duplicateAction
      ? `${duplicateAction.actionID ?? "action"} executed more than once for one idempotency key`
      : "action execution is idempotent", duplicateAction?.sequence),
    assertion("memory-scope-isolated", !leaked, leaked
      ? `memory from ${leaked.memoryScope} crossed into ${expectedScope}`
      : "memory scope remained isolated", leaked?.sequence),
    assertion("barge-in-neutral-within-150ms", !bargeIn || Boolean(neutral), !bargeIn || neutral
      ? "presentation neutralized within budget"
      : "presentation remained active after barge-in", bargeIn?.sequence),
    assertion("turn-reaches-terminal-state", !unterminated, unterminated
      ? `request ${unterminated.requestID} never reached a terminal state`
      : "all turns reached a terminal state", unterminated?.sequence),
    assertion("postconditions-verified", !postconditionFailure, postconditionFailure
      ? `${postconditionFailure.actionID ?? "action"} completed without verified postconditions`
      : "completed actions verified postconditions", postconditionFailure?.sequence),
    assertion("preconditions-verified", !preconditionFailure, preconditionFailure
      ? `${preconditionFailure.actionID ?? "action"} executed without verified preconditions`
      : "actions respected declared preconditions", preconditionFailure?.sequence),
    assertion("scenario-order-enforced", !wrongOrder, wrongOrder
      ? `${wrongOrder.actionID ?? "action"} executed outside its expected step`
      : "scenario action order was enforced", wrongOrder?.sequence),
    assertion("expired-approvals-cannot-execute", !actionAfterExpiry, actionAfterExpiry
      ? `${actionAfterExpiry.actionID ?? "action"} executed after its approval expired`
      : "expired approvals did not authorize execution", actionAfterExpiry?.sequence),
    assertion("training-results-deliver-at-most-once", !duplicateDelivery, duplicateDelivery
      ? `result ${duplicateDelivery.idempotencyKey} was delivered more than once`
      : "training result delivery is idempotent", duplicateDelivery?.sequence),
    assertion("crash-recovery-suspends-safely", Boolean(safeRecovery), safeRecovery
      ? "runtime crash recovered through a suspended scenario"
      : "runtime resumed after crash without a safe suspended state", crash?.sequence),
    assertion("corrupt-state-recovers-safely", Boolean(corruptionRecovered), corruptionRecovered
      ? "corrupt state was absent or recovered"
      : "runtime continued after detecting corrupt state", corrupt?.sequence),
    assertion("instructor-commands-execute-at-most-once", !duplicateIntervention, duplicateIntervention
      ? `instructor request ${duplicateIntervention.requestID ?? duplicateIntervention.data?.requestID ?? "unknown"} changed scenario state more than once`
      : "instructor commands changed scenario state at most once", duplicateIntervention?.sequence),
    assertion("instructor-evidence-is-owned", !invalidInstructorEvidence, invalidInstructorEvidence
      ? "manual evidence was accepted without instructor ownership"
      : "manual evidence remained instructor-owned", invalidInstructorEvidence?.sequence),
    assertion("instructor-terminate-is-safe", Boolean(safeTermination), safeTermination
      ? "instructor termination was absent or ended in a safe cancelled state"
      : "instructor termination did not produce a safe cancelled outcome", terminate?.sequence),
    assertion("ai-trainee-reaches-terminal-state", !unfinishedAITrainee, unfinishedAITrainee
      ? `AI Trainee run ${unfinishedAITrainee.data?.runID ?? "unknown"} never reached a terminal state`
      : "all AI Trainee runs reached a terminal state", unfinishedAITrainee?.sequence),
    assertion("ai-trainee-auto-approval-is-simulation-only", !invalidAIAutoApproval, invalidAIAutoApproval
      ? `${invalidAIAutoApproval.actionID ?? "AI action"} was auto-approved outside a critical simulation action`
      : "AI auto-approval remained simulation-only", invalidAIAutoApproval?.sequence),
  ]
  const firstFailure = assertions.find((item) => !item.passed)
  return {
    fixtureID: fixture.id,
    passed: !firstFailure,
    assertions,
    ...(firstFailure ? { firstFailure } : {}),
  }
}

export function verifyReplayAuditBundle(bundle: ReplayAuditBundle, publicKey?: string): ReplayAuditVerification {
  const events = Array.isArray(bundle.events) ? bundle.events : []
  const hashChain = events.every((event, index) => {
    const previousHash = index === 0 ? "0".repeat(64) : events[index - 1]!.hash
    if (event.previousHash !== previousHash) return false
    const source = Object.fromEntries(Object.entries(event).filter(([key]) => key !== "hash" && key !== "previousHash"))
    return event.hash === createHash("sha256").update(previousHash).update(JSON.stringify(source)).digest("hex")
  })
  const rootHash = bundle.rootHash === (events.at(-1)?.hash ?? "0".repeat(64))
  if (!bundle.signature) return { valid: hashChain && rootHash, hashChain, rootHash, signature: "unsigned", detail: "audit is unsigned" }
  if (!publicKey) return { valid: false, hashChain, rootHash, signature: "missing_key", detail: "a public verification key is required" }
  const key = createPublicKey(publicKey)
  const fingerprint = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex")
  const algorithm = key.asymmetricKeyType === "ed25519" || key.asymmetricKeyType === "ed448" ? null : "sha256"
  const signature = fingerprint === bundle.signature.publicKeyFingerprint && verify(
    algorithm,
    Buffer.from(bundle.rootHash, "utf8"),
    key,
    Buffer.from(bundle.signature.value, "base64"),
  ) ? "valid" : "invalid"
  return { valid: hashChain && rootHash && signature === "valid", hashChain, rootHash, signature, detail: signature === "valid" ? "audit signature and hash chain are valid" : "audit signature is invalid" }
}

export function applyReplayFaults(fixture: ReplayFixture): ReplayFixture {
  const events = [...fixture.events]
  for (const fault of fixture.faults ?? []) {
    const target = "sequence" in fault ? fault.sequence : "afterSequence" in fault ? fault.afterSequence : undefined
    const index = target === undefined ? -1 : events.findIndex((event) => event.sequence === target)
    const source = index < 0 ? undefined : events[index]
    if (fault.type === "duplicate_event" && source) events.splice(index + 1, 0, { ...source, sequence: source.sequence + 0.1 })
    if (fault.type === "disconnect" && source) events.splice(index + 1, 0, {
      sequence: source.sequence + 0.1, type: "connection.closed", timestamp: source.timestamp + 1,
    })
    if (fault.type === "model_offline" && source) events.splice(index + 1, 0, {
      sequence: source.sequence + 0.1, type: "turn.error", timestamp: source.timestamp + 1,
      requestID: source.requestID, data: { code: "model_offline" },
    })
    if (fault.type === "timeout" && source) events.splice(index + 1, 0, {
      sequence: source.sequence + 0.1, type: "clock.advanced", timestamp: source.timestamp + fault.durationMs,
      data: { durationMs: fault.durationMs },
    })
    if (fault.type === "permission_denial") events.push({
      sequence: nextSequence(events), type: "action.denied", timestamp: Date.now(), actionID: fault.actionID, approved: false,
    })
    if (fault.type === "action_failure") events.push({
      sequence: nextSequence(events), type: "action.failed", timestamp: Date.now(), actionID: fault.actionID,
      data: { code: fault.code ?? "failed" },
    })
    if (fault.type === "memory_scope_leak" && source) events.splice(index + 1, 0, {
      sequence: source.sequence + 0.1, type: "memory.used", timestamp: source.timestamp + 1, memoryScope: fault.scope,
    })
    if (fault.type === "wrong_order") events.push({
      sequence: nextSequence(events), type: "action.executed", timestamp: Date.now(), actionID: fault.actionID,
      stepID: fault.stepID, data: { allowedAtStep: false, postconditionsVerified: true, preconditionsVerified: true },
    })
    if (fault.type === "missing_precondition") events.push({
      sequence: nextSequence(events), type: "action.executed", timestamp: Date.now(), actionID: fault.actionID,
      data: { allowedAtStep: true, preconditionsVerified: false, postconditionsVerified: true },
    })
    if (fault.type === "postcondition_failure") events.push({
      sequence: nextSequence(events), type: "action.executed", timestamp: Date.now(), actionID: fault.actionID,
      data: { allowedAtStep: true, preconditionsVerified: true, postconditionsVerified: false },
    })
    if (fault.type === "state_loss" && source) events.splice(index + 1, 0, {
      sequence: source.sequence + 0.1, type: "connection.snapshot", timestamp: source.timestamp + 1,
      sessionID: `${source.sessionID ?? "session"}:lost`, scenarioID: source.scenarioID, scenarioRevision: source.scenarioRevision,
    })
  }
  return { ...fixture, events: events.sort((left, right) => left.sequence - right.sequence) }
}

export function compareReplays(baseline: ReplayFixture, candidate: ReplayFixture): ReplayComparison {
  const expected = canonicalEvents(baseline)
  const actual = canonicalEvents(candidate)
  const size = Math.max(expected.length, actual.length)
  const index = Array.from({ length: size }, (_, value) => value).find((value) =>
    JSON.stringify(expected[value]) !== JSON.stringify(actual[value]),
  )
  const evaluation = evaluateReplay(candidate)
  const firstDifference = index === undefined ? undefined : {
    sequence: Math.min(expected[index]?.sequence ?? Number.MAX_SAFE_INTEGER, actual[index]?.sequence ?? Number.MAX_SAFE_INTEGER),
    baseline: expected[index],
    candidate: actual[index],
    detail: !expected[index]
      ? "candidate contains an additional event"
      : !actual[index]
        ? "candidate is missing an event"
        : `expected ${expected[index].type}, received ${actual[index].type}`,
  }
  return {
    baselineID: baseline.id,
    candidateID: candidate.id,
    passed: !firstDifference && evaluation.passed,
    ...(firstDifference ? { firstDifference } : {}),
    regressions: evaluation.assertions.filter((item) => !item.passed),
  }
}

export function redactReplay(fixture: ReplayFixture): ReplayFixture {
  return {
    id: fixture.id,
    name: fixture.name,
    expectedFailures: fixture.expectedFailures,
    faults: fixture.faults,
    events: fixture.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      timestamp: event.timestamp,
      requestID: event.requestID,
      sessionID: event.sessionID,
      scenarioID: event.scenarioID,
      scenarioRevision: event.scenarioRevision,
      stepID: event.stepID,
      memoryScope: event.memoryScope,
      actionID: event.actionID,
      idempotencyKey: event.idempotencyKey,
      risk: event.risk,
      approved: event.approved,
      phase: event.phase,
      modelRoute: event.modelRoute,
      latencyMs: event.latencyMs,
      textHash: event.textHash,
      data: event.data
        ? Object.fromEntries(
            Object.entries(event.data).filter(([key]) => !/(token|secret|audio|prompt|transcript|password|email|name)/i.test(key)),
          )
        : undefined,
    })),
  }
}

export function auditReplay(fixture: ReplayFixture) {
  return redactReplay(fixture).events.reduce<Array<ReplayEvent & { previousHash: string; hash: string }>>((events, event) => {
    const previousHash = events.at(-1)?.hash ?? "0".repeat(64)
    const hash = createHash("sha256").update(previousHash).update(JSON.stringify(event)).digest("hex")
    events.push({ ...event, previousHash, hash })
    return events
  }, [])
}

export function replayAuditBundle(fixture: ReplayFixture, privateKey?: string): ReplayAuditBundle {
  const events = auditReplay(fixture)
  const rootHash = events.at(-1)?.hash ?? "0".repeat(64)
  const bundle: ReplayAuditBundle = {
    format: "embodied-agent-replay-audit-v1",
    fixtureID: fixture.id,
    generatedAt: new Date().toISOString(),
    rootHash,
    events,
  }
  if (!privateKey) return bundle
  const key = createPrivateKey(privateKey)
  const publicKey = createPublicKey(key).export({ type: "spki", format: "der" })
  const algorithm = key.asymmetricKeyType === "ed25519" || key.asymmetricKeyType === "ed448" ? null : "sha256"
  return {
    ...bundle,
    signature: {
      algorithm: algorithm ?? key.asymmetricKeyType ?? "ed25519",
      publicKeyFingerprint: createHash("sha256").update(publicKey).digest("hex"),
      value: sign(algorithm, Buffer.from(rootHash, "utf8"), key).toString("base64"),
    },
  }
}

export function replayJUnit(evaluations: ReplayEvaluation[]) {
  const failures = evaluations.flatMap((evaluation) => evaluation.assertions.filter((item) => !item.passed))
  const cases = evaluations.flatMap((evaluation) => evaluation.assertions.map((item) =>
    `    <testcase classname="${xml(evaluation.fixtureID)}" name="${xml(item.id)}">${item.passed ? "" : `\n      <failure message="${xml(item.detail)}"/>\n    `}</testcase>`,
  )).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Embodied Agent Replay Lab" tests="${evaluations.reduce((sum, item) => sum + item.assertions.length, 0)}" failures="${failures.length}">\n${cases}\n</testsuite>\n`
}

function assertion(id: string, passed: boolean, detail: string, sequence?: number): ReplayAssertion {
  return { id, passed, detail, ...(sequence === undefined ? {} : { sequence }) }
}

function canonicalEvents(fixture: ReplayFixture) {
  return redactReplay(fixture).events
    .filter((event) => event.type !== "clock.advanced")
    .map((event) => ({ ...event, timestamp: 0, latencyMs: undefined }))
}

function nextSequence(events: ReplayEvent[]) {
  return Math.max(0, ...events.map((event) => event.sequence)) + 1
}

function xml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;",
  })[character] ?? character)
}
