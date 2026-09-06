import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { XApiOutbox } from "../src/xapi"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

describe("durable xAPI outbox", () => {
  test("delivers one deterministic statement for a terminal scenario", async () => {
    const directory = await mkdtemp(join(tmpdir(), "embodied-xapi-")); directories.push(directory)
    const requests: Array<{ url: string; body: string }> = []
    const outbox = new XApiOutbox(directory, { enabled: true, endpoint: "https://lrs.example/xapi", actorAccount: "deployment" }, "secret", async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body) })
      return new Response(null, { status: 204 })
    }, async () => undefined)
    await outbox.initialize()
    const event = { type: "scenario.completed" as const, runID: "run", scenarioID: "training.safety", scenarioRevision: 1, timestamp: 1, durationMs: 1_000 }
    await outbox.enqueue(event)
    await outbox.enqueue(event)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain("statementId=")
    expect(JSON.parse(requests[0]?.body ?? "{}").actor.account.name).toBe("deployment")
    expect(await outbox.status()).toEqual({ pending: 0, delivered: 1, uncertain: 0 })
  })

  test("marks a result uncertain after bounded transient retries and permits manual retry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "embodied-xapi-")); directories.push(directory)
    let available = false
    let attempts = 0
    const outbox = new XApiOutbox(directory, { enabled: true, endpoint: "https://lrs.example/xapi", actorAccount: "deployment" }, "secret", async () => {
      attempts += 1
      return new Response(null, { status: available ? 204 : 503 })
    }, async () => undefined)
    await outbox.initialize()
    await outbox.enqueue({ type: "scenario.failed", runID: "run", scenarioID: "training.safety", scenarioRevision: 1, timestamp: 1 })
    expect(await outbox.status()).toEqual({ pending: 0, delivered: 0, uncertain: 1 })
    expect(attempts).toBe(4)
    available = true
    await outbox.retry()
    expect(await outbox.status()).toEqual({ pending: 0, delivered: 1, uncertain: 0 })
  })
})
