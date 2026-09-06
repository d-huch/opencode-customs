import { randomUUID } from "node:crypto"
import { mkdir, readdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { RuntimeConfig } from "./config"

export type DemonstrationRisk = "ambient" | "interaction" | "critical"

export type DemonstrationEvent = {
  type: "demonstration.event"
  demonstrationID: string
  eventID: string
  sequence: number
  timestamp: number
  entityID: string
  capabilityID: string
  action: string
  ok: boolean
  code: string
  risk: DemonstrationRisk
  permissionCategory?: string
  postconditions: string[]
  narration?: string
}

export type DemonstrationRun = {
  format: "embodied-demonstration-v1"
  demonstrationID: string
  title: string
  gameID: string
  saveSlotID: string
  characterID: string
  clientID: string
  status: "recording" | "completed" | "cancelled"
  startedAt: number
  completedAt?: number
  transcriptCharacters: number
  transcriptEventIDs: string[]
  events: DemonstrationEvent[]
}

export type DemonstrationDraftStep = {
  id: string
  title: string
  instruction: string
  entityID: string
  capabilityID: string
  risk: DemonstrationRisk
  permissionCategory?: string
  postconditions: string[]
  sourceEventIDs: string[]
}

export type DemonstrationDraft = {
  format: "embodied-demonstration-draft-v1"
  demonstrationID: string
  revision: number
  title: string
  steps: DemonstrationDraftStep[]
  negativeExamples: Array<Pick<DemonstrationEvent, "eventID" | "entityID" | "capabilityID" | "code" | "timestamp">>
  assistance?: "deterministic" | "local-model"
}

type StartMessage = {
  type: "demonstration.start"
  demonstrationID: string
  timestamp: number
  title?: string
  gameID: string
  saveSlotID: string
  characterID: string
  clientID: string
}

type TranscriptMessage = {
  type: "demonstration.transcript"
  demonstrationID: string
  eventID: string
  timestamp: number
  text: string
}

type CompleteMessage = {
  type: "demonstration.complete" | "demonstration.cancel"
  demonstrationID: string
  timestamp: number
}

export type DemonstrationMessage = StartMessage | TranscriptMessage | CompleteMessage | DemonstrationEvent

const maximumDurationMs = 20 * 60_000
const maximumActions = 64
const maximumTranscriptCharacters = 12_000

export async function createDemonstrationStore(stateDirectory: string) {
  const directory = join(stateDirectory, "demonstrations")
  await mkdir(directory, { recursive: true })
  const active = new Map<string, DemonstrationRun>()
  const seen = new Map<string, Set<string>>()

  async function record(message: DemonstrationMessage) {
    if (message.type === "demonstration.start") {
      const existing = await get(message.demonstrationID)
      if (existing) return { ok: existing.status === "recording", code: existing.status === "recording" ? "already_recording" : "already_completed", run: existing }
      const recording = (await list()).find((run) => run.status === "recording")
      if (recording && message.timestamp - recording.startedAt <= maximumDurationMs)
        return { ok: false, code: "recording_in_progress" }
      if (recording) {
        recording.status = "cancelled"
        recording.completedAt = message.timestamp
        await save(recording)
      }
      const run: DemonstrationRun = {
        format: "embodied-demonstration-v1",
        demonstrationID: message.demonstrationID,
        title: message.title?.trim() || "Recorded equipment isolation",
        gameID: message.gameID,
        saveSlotID: message.saveSlotID,
        characterID: message.characterID,
        clientID: message.clientID,
        status: "recording",
        startedAt: message.timestamp,
        transcriptCharacters: 0,
        transcriptEventIDs: [],
        events: [],
      }
      active.set(run.demonstrationID, run)
      seen.set(run.demonstrationID, new Set())
      await save(run)
      return { ok: true, code: "recording_started", run }
    }

    const run = active.get(message.demonstrationID) ?? await get(message.demonstrationID)
    if (!run) return { ok: false, code: "recording_not_found" }
    if (run.status !== "recording") return { ok: false, code: "recording_terminal", run }
    if (message.timestamp - run.startedAt > maximumDurationMs) {
      run.status = "cancelled"
      run.completedAt = message.timestamp
      await save(run)
      active.delete(run.demonstrationID)
      return { ok: false, code: "duration_limit", run }
    }

    if (message.type === "demonstration.event") {
      const ids = seen.get(run.demonstrationID) ?? new Set(run.events.map((event) => event.eventID))
      seen.set(run.demonstrationID, ids)
      if (ids.has(message.eventID)) return { ok: true, code: "duplicate_ignored", run }
      if (run.events.length >= maximumActions) return { ok: false, code: "action_limit", run }
      if (run.events.some((event) => event.sequence === message.sequence)) return { ok: false, code: "sequence_conflict", run }
      ids.add(message.eventID)
      run.events.push({ ...message, narration: undefined })
      run.events.sort((left, right) => left.sequence - right.sequence || left.timestamp - right.timestamp)
      await save(run)
      return { ok: true, code: "event_recorded", run }
    }

    if (message.type === "demonstration.transcript") {
      run.transcriptEventIDs ??= []
      if (run.transcriptEventIDs.includes(message.eventID)) return { ok: true, code: "duplicate_ignored", run }
      const text = message.text.trim()
      if (!text) return { ok: false, code: "empty_transcript", run }
      if (run.transcriptCharacters + text.length > maximumTranscriptCharacters) return { ok: false, code: "transcript_limit", run }
      const target = nearestEvent(run.events, message.timestamp)
      if (!target) return { ok: false, code: "action_required", run }
      target.narration = target.narration ? `${target.narration} ${text}` : text
      run.transcriptCharacters += text.length
      run.transcriptEventIDs.push(message.eventID)
      await save(run)
      return { ok: true, code: "transcript_attached", run }
    }

    run.status = message.type === "demonstration.complete" ? "completed" : "cancelled"
    run.completedAt = message.timestamp
    await save(run)
    active.delete(run.demonstrationID)
    seen.delete(run.demonstrationID)
    return { ok: true, code: run.status, run }
  }

  async function list() {
    const names = await readdir(directory).catch(() => [])
    const runs = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => Bun.file(join(directory, name)).json().catch(() => undefined)))
    return runs.filter((run): run is DemonstrationRun => validRun(run)).sort((left, right) => right.startedAt - left.startedAt)
  }

  async function get(id: string) {
    const current = active.get(id)
    if (current) return structuredClone(current)
    const value = await Bun.file(join(directory, `${safeID(id)}.json`)).json().catch(() => undefined)
    return validRun(value) ? value : undefined
  }

  async function draft(id: string, config?: RuntimeConfig) {
    const run = await get(id)
    if (!run || run.status !== "completed") return
    const value = compileDraft(run)
    return config ? assistDraft(value, config) : value
  }

  async function save(run: DemonstrationRun) {
    const path = join(directory, `${safeID(run.demonstrationID)}.json`)
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(run, null, 2), { mode: 0o600 })
    await rename(temporary, path)
  }

  return { record, list, get, draft }
}

export function compileDraft(run: DemonstrationRun): DemonstrationDraft {
  const successful = run.events.filter((event) => event.ok)
  return {
    format: "embodied-demonstration-draft-v1",
    demonstrationID: run.demonstrationID,
    revision: 1,
    title: run.title,
    steps: successful.map((event, index) => ({
      id: `recorded-${String(index + 1).padStart(2, "0")}-${safeID(event.action)}`,
      title: title(event.action),
      instruction: event.narration?.trim() || `Perform ${title(event.action).toLocaleLowerCase("en-US")} on ${event.entityID}.`,
      entityID: event.entityID,
      capabilityID: event.capabilityID,
      risk: event.risk,
      ...(event.permissionCategory ? { permissionCategory: event.permissionCategory } : {}),
      postconditions: event.postconditions,
      sourceEventIDs: [event.eventID],
    })),
    negativeExamples: run.events.filter((event) => !event.ok).map((event) => ({
      eventID: event.eventID,
      entityID: event.entityID,
      capabilityID: event.capabilityID,
      code: event.code,
      timestamp: event.timestamp,
    })),
    assistance: "deterministic",
  }
}

async function assistDraft(draft: DemonstrationDraft, config: RuntimeConfig) {
  if (!draft.steps.length) return draft
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  const response = await fetch(new URL("chat/completions", config.baseURL.endsWith("/") ? config.baseURL : config.baseURL + "/"), {
    method: "POST",
    signal: controller.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.modelID,
      temperature: 0.1,
      max_tokens: 1_500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Improve training step titles and instructions. Return JSON {steps:[{sourceEventID,title,instruction}]}. Use every supplied sourceEventID exactly once. Never invent or change IDs, objects, capabilities, risk, permissions, or postconditions." },
        { role: "user", content: JSON.stringify(draft.steps.map((step) => ({ sourceEventID: step.sourceEventIDs[0], title: step.title, instruction: step.instruction, entityID: step.entityID, capabilityID: step.capabilityID }))) },
      ],
    }),
  }).finally(() => clearTimeout(timer)).catch(() => undefined)
  if (!response?.ok) return draft
  const body = await response.json().catch(() => undefined) as { choices?: Array<{ message?: { content?: string } }> } | undefined
  const content = body?.choices?.[0]?.message?.content
  if (!content) return draft
  const suggestion = parseSuggestion(content)
  if (!suggestion) return draft
  if (!Array.isArray(suggestion.steps) || suggestion.steps.length !== draft.steps.length) return draft
  const map = new Map(suggestion.steps.map((step) => [step.sourceEventID, step]))
  if (map.size !== draft.steps.length || draft.steps.some((step) => !map.has(step.sourceEventIDs[0]))) return draft
  return {
    ...draft,
    assistance: "local-model" as const,
    steps: draft.steps.map((step) => {
      const value = map.get(step.sourceEventIDs[0])!
      return {
        ...step,
        title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 160) : step.title,
        instruction: typeof value.instruction === "string" && value.instruction.trim() ? value.instruction.trim().slice(0, 2_000) : step.instruction,
      }
    }),
  }
}

function parseSuggestion(value: string) {
  try {
    return JSON.parse(value) as { steps?: Array<{ sourceEventID?: string; title?: string; instruction?: string }> }
  } catch {
    return
  }
}

function nearestEvent(events: DemonstrationEvent[], timestamp: number) {
  return events.reduce<DemonstrationEvent | undefined>((nearest, event) => {
    if (!nearest) return event
    return Math.abs(event.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? event : nearest
  }, undefined)
}

function safeID(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160)
}

function title(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function validRun(value: unknown): value is DemonstrationRun {
  if (!value || typeof value !== "object") return false
  const run = value as Partial<DemonstrationRun>
  return run.format === "embodied-demonstration-v1" && typeof run.demonstrationID === "string" && Array.isArray(run.events)
}
