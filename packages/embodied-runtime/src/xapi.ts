import { createHash } from "node:crypto"
import { mkdir, readdir, rename } from "node:fs/promises"
import { join } from "node:path"
import type { RuntimeConfig } from "./config"

export type ScenarioLifecycle = {
  type: "scenario.started" | "scenario.step" | "scenario.completed" | "scenario.cancelled" | "scenario.failed"
  runID: string
  scenarioID: string
  scenarioRevision: number
  timestamp: number
  sessionID?: string
  stepID?: string
  outcome?: string
  durationMs?: number
}

type OutboxEntry = {
  version: 1
  statementID: string
  runID: string
  status: "pending" | "delivered" | "uncertain"
  attempts: number
  createdAt: string
  updatedAt: string
  lastError?: string
  statement: Record<string, unknown>
}

type Request = (input: string | URL | globalThis.Request, init?: RequestInit) => Promise<Response>

export class XApiOutbox {
  private queue = Promise.resolve()

  constructor(
    private readonly directory: string,
    private readonly config: NonNullable<RuntimeConfig["xapi"]>,
    private readonly credential: string,
    private readonly request: Request = fetch,
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) => Bun.sleep(milliseconds),
  ) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true })
    await this.retry()
  }

  enqueue(message: ScenarioLifecycle) {
    if (!this.config.enabled || !["scenario.completed", "scenario.cancelled", "scenario.failed"].includes(message.type)) return Promise.resolve()
    this.queue = this.queue.then(async () => {
      const statementID = deterministicUUID(`${message.runID}:${message.scenarioID}:${message.scenarioRevision}`)
      const path = join(this.directory, statementID + ".json")
      if (await Bun.file(path).exists()) return
      const now = new Date().toISOString()
      await atomicWrite(path, {
        version: 1,
        statementID,
        runID: message.runID,
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        statement: statement(message, statementID, this.config.actorAccount),
      } satisfies OutboxEntry)
      await this.deliver(path)
    })
    return this.queue
  }

  retry(statementID?: string) {
    this.queue = this.queue.then(async () => {
      const names = statementID ? [statementID + ".json"] : await readdir(this.directory).catch(() => [])
      await names.filter((name) => name.endsWith(".json")).reduce(
        (pending, name) => pending.then(() => this.deliver(join(this.directory, name), true)),
        Promise.resolve(),
      )
    })
    return this.queue
  }

  async status() {
    const names = await readdir(this.directory).catch(() => [])
    const entries = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => Bun.file(join(this.directory, name)).json().catch(() => undefined) as Promise<OutboxEntry | undefined>))
    return {
      pending: entries.filter((entry) => entry?.status === "pending").length,
      delivered: entries.filter((entry) => entry?.status === "delivered").length,
      uncertain: entries.filter((entry) => entry?.status === "uncertain").length,
    }
  }

  async test() {
    const endpoint = statementsURL(this.config.endpoint, deterministicUUID("embodied-agent-xapi-health"))
    const response = await this.request(endpoint, { method: "HEAD", headers: this.headers(), signal: AbortSignal.timeout(5_000) })
    return { ok: response.ok || response.status === 405, status: response.status }
  }

  private async deliver(path: string, manual = false) {
    const entry = await Bun.file(path).json().catch(() => undefined) as OutboxEntry | undefined
    if (!entry || entry.version !== 1 || entry.status === "delivered" || (entry.status === "uncertain" && !manual)) return
    const delays = [0, 250, 1_000, 3_000]
    for (const delay of delays) {
      if (delay) await this.wait(delay)
      entry.attempts += 1
      entry.updatedAt = new Date().toISOString()
      const response = await this.request(statementsURL(this.config.endpoint, entry.statementID), {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(entry.statement),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => undefined)
      if (response?.ok) {
        entry.status = "delivered"
        entry.lastError = undefined
        await atomicWrite(path, entry)
        return
      }
      const transient = !response || [408, 425, 429, 500, 502, 503, 504].includes(response.status)
      entry.lastError = response ? `HTTP ${response.status}` : "network_or_timeout"
      if (!transient) {
        entry.status = "uncertain"
        await atomicWrite(path, entry)
        return
      }
      await atomicWrite(path, entry)
    }
    entry.status = "uncertain"
    await atomicWrite(path, entry)
  }

  private headers() {
    return { authorization: `Bearer ${this.credential}`, "content-type": "application/json", "x-experience-api-version": "1.0.3" }
  }
}

function statement(message: ScenarioLifecycle, statementID: string, actorAccount: string) {
  const completed = message.type === "scenario.completed"
  return {
    id: statementID,
    actor: { objectType: "Agent", account: { homePage: "urn:embodied-agent", name: actorAccount } },
    verb: {
      id: completed ? "http://adlnet.gov/expapi/verbs/completed" : "http://adlnet.gov/expapi/verbs/failed",
      display: { "en-US": completed ? "completed" : "failed" },
    },
    object: { id: `urn:embodied-agent:scenario:${message.scenarioID}`, objectType: "Activity" },
    result: {
      completion: completed,
      duration: `PT${Math.max(0, (message.durationMs ?? 0) / 1_000).toFixed(3)}S`,
      extensions: {
        "https://embodied-agent.dev/extensions/revision": message.scenarioRevision,
        "https://embodied-agent.dev/extensions/run": message.runID,
        "https://embodied-agent.dev/extensions/outcome": message.outcome ?? message.type,
      },
    },
    timestamp: new Date(message.timestamp).toISOString(),
  }
}

function deterministicUUID(value: string) {
  const hash = createHash("sha256").update(value).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function statementsURL(endpoint: string, statementID: string) {
  const url = new URL(endpoint)
  if (!url.pathname.endsWith("/statements") && !url.pathname.endsWith("statements"))
    url.pathname = url.pathname.replace(/\/$/, "") + "/statements"
  url.searchParams.set("statementId", statementID)
  return url
}

async function atomicWrite(path: string, value: unknown) {
  const temporary = path + ".tmp"
  await Bun.write(temporary, JSON.stringify(value, null, 2))
  await rename(temporary, path)
}
