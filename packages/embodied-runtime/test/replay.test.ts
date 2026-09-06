import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { generateKeyPairSync } from "node:crypto"
import { auditReplay, compareReplays, evaluateReplay, redactReplay, replayAuditBundle, replayJUnit, verifyReplayAuditBundle, type ReplayFixture } from "../src/replay"

const fixtures = resolve(import.meta.dir, "../fixtures")

describe("Embodied Agent Replay Lab", () => {
  test("reference safety run passes every reliability assertion", async () => {
    const fixture = await Bun.file(resolve(fixtures, "equipment-isolation-happy.json")).json() as ReplayFixture
    expect(evaluateReplay(fixture).passed).toBe(true)
    expect((fixture.events.at(-1)?.timestamp ?? 0) - (fixture.events[0]?.timestamp ?? 0)).toBeGreaterThanOrEqual(20 * 60 * 1000)
    expect(fixture.events.filter((event) => event.type === "action.executed").every((event) => Boolean(event.idempotencyKey))).toBe(true)
  })

  for (const name of [
    "duplicate-response", "reconnect-state-loss", "permission-bypass", "barge-in-stuck", "memory-scope-leak",
    "out-of-order-events", "expired-approval", "duplicate-result-delivery", "unsafe-crash-recovery", "unsafe-corrupt-state",
  ]) {
    test(`detects seeded ${name} regression`, async () => {
      const fixture = await Bun.file(resolve(fixtures, `regressions/${name}.json`)).json() as ReplayFixture
      const result = evaluateReplay(fixture)
      expect(result.passed).toBe(false)
      expect(result.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id)).toEqual(
        fixture.expectedFailures ?? [],
      )
    })
  }

  test("audit export removes prompt, audio, and secret fields", () => {
    const fixture: ReplayFixture = {
      id: "redaction",
      name: "redaction",
      events: [{
        sequence: 1,
        type: "turn.started",
        timestamp: 1,
        data: { prompt: "private", audio: "pcm", token: "secret", model: "local-model" },
      }],
    }
    expect(redactReplay(fixture).events[0]?.data).toEqual({ model: "local-model" })
  })

  test("audit events form a verifiable hash chain", () => {
    const fixture: ReplayFixture = {
      id: "audit",
      name: "audit",
      events: [
        { sequence: 1, type: "turn.started", timestamp: 1 },
        { sequence: 2, type: "turn.cancelled", timestamp: 2 },
      ],
    }
    const audit = auditReplay(fixture)
    expect(audit[0]?.previousHash).toBe("0".repeat(64))
    expect(audit[1]?.previousHash).toBe(audit[0]?.hash)
    expect(audit.every((event) => event.hash.length === 64)).toBe(true)
  })

  test("audit bundle exposes the immutable root without including private source data", () => {
    const fixture: ReplayFixture = { id: "pilot-audit", name: "pilot", events: [{ sequence: 1, type: "scenario.completed", timestamp: 1 }] }
    const bundle = replayAuditBundle(fixture)
    expect(bundle.format).toBe("embodied-agent-replay-audit-v1")
    expect(bundle.rootHash).toHaveLength(64)
    expect(bundle.signature).toBeUndefined()
  })

  test("comparison reports the first deterministic timeline difference", async () => {
    const fixture = await Bun.file(resolve(fixtures, "equipment-isolation-happy.json")).json() as ReplayFixture
    const candidate = structuredClone(fixture)
    candidate.id = "candidate"
    candidate.events[2] = { ...candidate.events[2]!, type: "action.failed" }
    expect(compareReplays(fixture, candidate).firstDifference).toMatchObject({ sequence: 3 })
  })

  test("JUnit output reports failures for CI", async () => {
    const fixture = await Bun.file(resolve(fixtures, "regressions/duplicate-response.json")).json() as ReplayFixture
    const output = replayJUnit([evaluateReplay(fixture)])
    expect(output).toContain('failures="1"')
    expect(output).toContain("no-duplicate-response")
  })

  test("detects Beta ordering, expired approval, duplicate delivery and unsafe crash recovery regressions", () => {
    const fixture: ReplayFixture = {
      id: "beta-regressions",
      name: "beta regressions",
      events: [
        { sequence: 1, type: "turn.started", timestamp: 1, requestID: "turn" },
        { sequence: 3, type: "approval.expired", timestamp: 2, actionID: "lockout" },
        { sequence: 2, type: "presentation.neutral", timestamp: 3 },
        { sequence: 4, type: "action.executed", timestamp: 4, actionID: "lockout", risk: "critical", approved: true, idempotencyKey: "action" },
        { sequence: 5, type: "result.delivered", timestamp: 5, idempotencyKey: "result" },
        { sequence: 6, type: "result.delivered", timestamp: 6, idempotencyKey: "result" },
        { sequence: 7, type: "runtime.crashed", timestamp: 7 },
        { sequence: 8, type: "assistant.done", timestamp: 8, requestID: "turn" },
      ],
    }
    expect(evaluateReplay(fixture).assertions.filter((item) => !item.passed).map((item) => item.id)).toEqual([
      "events-are-strictly-ordered",
      "expired-approvals-cannot-execute",
      "training-results-deliver-at-most-once",
      "crash-recovery-suspends-safely",
    ])
  })

  test("accepts a supervised instructor fixture", async () => {
    const fixture = await Bun.file(resolve(fixtures, "instructor-supervised.json")).json() as ReplayFixture
    const result = evaluateReplay(fixture)
    expect(result.passed).toBe(true)
    expect(result.assertions.filter((item) => item.id.startsWith("instructor-")).every((item) => item.passed)).toBe(true)
  })

  test("detects duplicate intervention, foreign evidence and unsafe termination", () => {
    const fixture: ReplayFixture = {
      id: "instructor-regressions",
      name: "instructor regressions",
      events: [
        { sequence: 1, type: "instructor.pause", timestamp: 1, data: { requestID: "same-request" } },
        { sequence: 2, type: "instructor.pause", timestamp: 2, data: { requestID: "same-request" } },
        { sequence: 3, type: "instructor.evidence", timestamp: 3, data: { requestID: "evidence", source: "sensor" } },
        { sequence: 4, type: "instructor.terminate", timestamp: 4, data: { requestID: "terminate" } },
      ],
    }
    expect(evaluateReplay(fixture).assertions.filter((item) => !item.passed).map((item) => item.id)).toEqual([
      "instructor-commands-execute-at-most-once",
      "instructor-evidence-is-owned",
      "instructor-terminate-is-safe",
    ])
  })

  test("detects unfinished AI Trainee and non-simulation auto approval", () => {
    const fixture: ReplayFixture = {
      id: "ai-trainee-regressions",
      name: "AI Trainee regressions",
      events: [
        { sequence: 1, type: "ai.trainee.started", timestamp: 1, data: { runID: "ai-1", profile: "blind" } },
        { sequence: 2, type: "ai.trainee.auto_approval", timestamp: 2, actionID: "safety.apply_lockout", risk: "critical", approved: true, data: { simulation: false } },
      ],
    }
    expect(evaluateReplay(fixture).assertions.filter((item) => !item.passed).map((item) => item.id)).toEqual([
      "ai-trainee-reaches-terminal-state",
      "ai-trainee-auto-approval-is-simulation-only",
    ])
  })

  test("verifies a signed audit and rejects tampering", () => {
    const keys = generateKeyPairSync("ed25519")
    const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString()
    const bundle = replayAuditBundle({ id: "signed", name: "signed", events: [{ sequence: 1, type: "scenario.completed", timestamp: 1 }] }, privateKey)
    expect(verifyReplayAuditBundle(bundle, publicKey).valid).toBe(true)
    bundle.events[0]!.type = "scenario.failed"
    expect(verifyReplayAuditBundle(bundle, publicKey).valid).toBe(false)
  })
})
