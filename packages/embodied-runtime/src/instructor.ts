import { createHash } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

export type InstructorScenarioSnapshot = {
  type: "scenario.snapshot"
  runID: string
  scenarioID: string
  scenarioRevision: number
  timestamp: number
  sessionID?: string
  traineeID?: string
  instructorID?: string
  status: "running" | "paused" | "completed" | "cancelled" | "failed"
  currentStepID?: string
  attempt: number
  timeoutRemainingMs: number
  evidence: Record<string, unknown>
  instructorEvidenceIDs: string[]
}

export type InstructorCommandResult = {
  type?: "instructor.command.result"
  requestID: string
  runID: string
  ok: boolean
  code: string
  timestamp: number
  stepID?: string
  attempt?: number
  message?: string
}

export type InstructorEvent =
  | InstructorScenarioSnapshot
  | InstructorCommandResult
  | { type: "scenario.lifecycle"; timestamp: number; data: Record<string, unknown> }
  | { type: "approval.resolved"; timestamp: number; approvalID: string; approved: boolean; instructorID: string }
  | { type: "client.connected" | "client.disconnected"; clientID: string; timestamp: number }
  | { type: "instructor.command.sent"; timestamp: number; requestID: string; runID: string; command: string; instructorID: string; stepID?: string; evidenceID?: string; reason?: string; valueHash?: string }

export type InstructorSession = {
  status: "idle" | "active" | "offline" | "conflict"
  active?: InstructorScenarioSnapshot & { clientID: string; connected: boolean }
  conflicts: Array<InstructorScenarioSnapshot & { clientID: string; connected: boolean }>
  pendingApprovals: unknown[]
  modelRuntime?: unknown
  voice: { transcription: string; synthesis: string }
  timeline: Array<{ sequence: number; event: InstructorEvent }>
}

export function createInstructorState(stateDirectory: string) {
  const encoder = new TextEncoder()
  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const timeline: Array<{ sequence: number; event: InstructorEvent }> = []
  const snapshots = new Map<string, InstructorScenarioSnapshot>()
  let sequence = 0
  let lastStatusHash = ""
  const auditDirectory = join(stateDirectory, "instructor")
  const auditPath = join(auditDirectory, "audit.jsonl")
  let writeQueue = Promise.resolve()
  let previousHash = "0".repeat(64)
  let auditInitialized = false

  async function record(event: InstructorEvent) {
    if (event.type === "scenario.snapshot") {
      const previous = snapshots.get(event.runID)
      snapshots.set(event.runID, event)
      if (previous && sameScenarioState(previous, event)) return
    }
    const item = { sequence: ++sequence, event: sanitizeEvent(event) }
    timeline.push(item)
    if (timeline.length > 200) timeline.shift()
    writeQueue = writeQueue.then(async () => {
      await mkdir(auditDirectory, { recursive: true })
      if (!auditInitialized) {
        const lines = await Bun.file(auditPath).text().then((value) => value.trim().split("\n")).catch(() => [])
        const last = lines.length > 0
          ? await Promise.resolve(lines.at(-1) ?? "").then(JSON.parse).catch(() => undefined) as Record<string, unknown> | undefined
          : undefined
        previousHash = typeof last?.hash === "string" && /^[a-f0-9]{64}$/.test(last.hash) ? last.hash : previousHash
        auditInitialized = true
      }
      const hash = createHash("sha256").update(previousHash).update(JSON.stringify(item)).digest("hex")
      await appendFile(auditPath, JSON.stringify({ ...item, previousHash, hash }) + "\n", { mode: 0o600 })
      previousHash = hash
    }, async () => {
      auditInitialized = false
      await mkdir(auditDirectory, { recursive: true })
      const hash = createHash("sha256").update(previousHash).update(JSON.stringify(item)).digest("hex")
      await appendFile(auditPath, JSON.stringify({ ...item, previousHash, hash }) + "\n", { mode: 0o600 })
      previousHash = hash
    })
    await writeQueue
    const frame = encoder.encode(`id: ${item.sequence}\nevent: instructor\ndata: ${JSON.stringify(item)}\n\n`)
    subscribers.forEach((subscriber) => {
      if (subscriber.desiredSize === null) {
        subscribers.delete(subscriber)
        return
      }
      subscriber.enqueue(frame)
    })
    return item
  }

  function session(input: {
    connectedClients: Array<{ clientID?: string; scenario?: InstructorScenarioSnapshot }>
    pendingApprovals?: unknown[]
    modelRuntime?: unknown
    voice: InstructorSession["voice"]
  }): InstructorSession {
    const connected = input.connectedClients
      .filter((client): client is { clientID: string; scenario: InstructorScenarioSnapshot } => typeof client.clientID === "string" && !!client.scenario)
      .map((client) => ({ ...client.scenario, clientID: client.clientID, connected: true }))
    const connectedRunIDs = new Set(connected.map((scenario) => scenario.runID))
    const disconnected = [...snapshots.values()]
      .filter((scenario) => !connectedRunIDs.has(scenario.runID) && (scenario.status === "running" || scenario.status === "paused"))
      .map((scenario) => ({ ...scenario, clientID: "disconnected", connected: false }))
    const current = [...connected.filter((scenario) => scenario.status === "running" || scenario.status === "paused"), ...disconnected]
    const active = current.length === 1 ? current[0] : undefined
    return {
      status: current.length > 1 ? "conflict" : active ? active.connected ? "active" : "offline" : "idle",
      ...(active ? { active } : {}),
      conflicts: current.length > 1 ? current : [],
      pendingApprovals: input.pendingApprovals ?? [],
      modelRuntime: input.modelRuntime,
      voice: input.voice,
      timeline: timeline.slice(-100),
    }
  }

  function stream(snapshot: InstructorSession) {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
        subscribers.add(value)
        value.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`))
      },
      cancel() {
        if (controller) subscribers.delete(controller)
      },
    })
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    })
  }

  function publishStatus(snapshot: InstructorSession) {
    const hash = createHash("sha256").update(JSON.stringify({
      status: snapshot.status,
      active: snapshot.active,
      conflicts: snapshot.conflicts,
      approvals: snapshot.pendingApprovals,
      modelRuntime: snapshot.modelRuntime,
      voice: snapshot.voice,
    })).digest("hex")
    if (hash === lastStatusHash) return
    lastStatusHash = hash
    const frame = encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
    subscribers.forEach((subscriber) => subscriber.enqueue(frame))
  }

  return { record, session, stream, publishStatus, snapshots: () => [...snapshots.values()] }
}

function sanitizeEvent(event: InstructorEvent): InstructorEvent {
  if (event.type !== "instructor.command.sent") return event
  return {
    ...event,
    reason: event.reason?.slice(0, 500),
    valueHash: event.valueHash,
  }
}

function sameScenarioState(left: InstructorScenarioSnapshot, right: InstructorScenarioSnapshot) {
  return left.scenarioRevision === right.scenarioRevision &&
    left.status === right.status &&
    left.currentStepID === right.currentStepID &&
    left.attempt === right.attempt &&
    left.traineeID === right.traineeID &&
    left.instructorID === right.instructorID &&
    JSON.stringify(left.evidence) === JSON.stringify(right.evidence) &&
    JSON.stringify(left.instructorEvidenceIDs) === JSON.stringify(right.instructorEvidenceIDs)
}
