import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type {
  AvatarCapability,
  AvatarJson,
  AvatarWorld,
  AvatarWorldEntity,
  AvatarWorldEvent,
} from "./avatar-bridge-protocol"

export type AvatarBridgeConfig = {
  lanEnabled: boolean
  interactionAutoApprove: boolean
  maximumActionsPerCycle: number
  cycleTimeoutMs: number
  attentionThreshold: number
  attentionCooldownMs: number
  plannerEscalationMinWords: number
  plannerIdleUnloadMs: number
  dialogueModel?: AvatarModelSelection
  plannerModel?: AvatarModelSelection
  trustedProfiles: TrustedAutonomyProfile[]
}

export type AvatarModelSelection = {
  providerID: string
  modelID: string
}

export type TrustedAutonomyProfile = {
  gameID: string
  allowInteraction: boolean
  allowedCriticalCategories: string[]
}

export type AvatarPairedDevice = {
  id: string
  name: string
  tokenHash: string
  certificateFingerprint: string
  createdAt: number
  lastSeenAt?: number
  revokedAt?: number
}

export type AvatarMemory = {
  id: string
  gameID: string
  saveSlotID: string
  characterID: string
  kind: "episodic" | "relationship" | "quest" | "promise" | "correction" | "world" | "personal"
  scope: "save" | "game" | "personal"
  source: string
  confidence: number
  text: string
  importance: number
  topic?: string
  pinned: boolean
  conflictWith?: string
  createdAt: number
  updatedAt: number
}

export type GoalStep = {
  id: string
  text: string
  status: "pending" | "active" | "completed" | "failed" | "skipped"
  attempts: number
  failureReason?: string
}

export type GoalOutcome = {
  status: "completed" | "cancelled" | "failed"
  reason: string
  completedAt: number
}

export type AgentGoal = {
  id: string
  characterID: string
  text: string
  parentID?: string
  createdAt: number
  expiresAt: number
  status: "active" | "paused" | "completed" | "cancelled" | "failed"
  stopConditions: string[]
  riskBudget: AvatarCapability["risk"][]
  steps: GoalStep[]
  outcome?: GoalOutcome
  replanReason?: string
}

type PersistedState = {
  version: 3
  config: AvatarBridgeConfig
  devices: AvatarPairedDevice[]
  memories: AvatarMemory[]
}

export const avatarBridgeDefaults: AvatarBridgeConfig = {
  lanEnabled: false,
  interactionAutoApprove: true,
  maximumActionsPerCycle: 8,
  cycleTimeoutMs: 60_000,
  attentionThreshold: 0.65,
  attentionCooldownMs: 5_000,
  plannerEscalationMinWords: 18,
  plannerIdleUnloadMs: 120_000,
  trustedProfiles: [],
}

export class AvatarWorldStore {
  readonly worlds = new Map<string, AvatarWorld>()

  snapshot(world: AvatarWorld) {
    const previous = this.worlds.get(worldKey(world))
    if (previous && world.revision < previous.revision) return false
    this.worlds.set(worldKey(world), structuredClone(world))
    return true
  }

  delta(input: {
    gameID: string
    saveSlotID: string
    characterID: string
    revision: number
    timestamp: number
    upsert: AvatarWorldEntity[]
    remove: string[]
    inventory?: Record<string, AvatarJson>
    quests?: Record<string, AvatarJson>
    relationships?: Record<string, AvatarJson>
  }) {
    const key = worldKey(input)
    const previous = this.worlds.get(key)
    if (!previous || input.revision !== previous.revision + 1) return false
    const entities = new Map(previous.entities.map((entity) => [entity.id, entity]))
    input.upsert.forEach((entity) => entities.set(entity.id, structuredClone(entity)))
    input.remove.forEach((id) => entities.delete(id))
    this.worlds.set(key, {
      ...previous,
      revision: input.revision,
      timestamp: input.timestamp,
      entities: [...entities.values()],
      inventory: input.inventory ?? previous.inventory,
      quests: input.quests ?? previous.quests,
      relationships: input.relationships ?? previous.relationships,
    })
    return true
  }

  event(input: { gameID: string; saveSlotID: string; characterID: string; event: AvatarWorldEvent }) {
    const key = worldKey(input)
    const previous = this.worlds.get(key)
    if (!previous) return false
    const events = [...previous.events.filter((event) => event.id !== input.event.id), structuredClone(input.event)].slice(-64)
    this.worlds.set(key, { ...previous, timestamp: Math.max(previous.timestamp, input.event.timestamp), events })
    return true
  }

  get(characterID?: string) {
    const values = [...this.worlds.values()]
    const selected = characterID ? values.find((world) => world.characterID === characterID) : values[0]
    return selected ? structuredClone(selected) : undefined
  }

  clearCharacter(characterID: string) {
    for (const [key, world] of this.worlds) {
      if (world.characterID === characterID) this.worlds.delete(key)
    }
  }
}

export class AvatarCycleBudget {
  readonly cycles = new Map<string, { startedAt: number; actions: number }>()

  consume(cycleID: string, config: AvatarBridgeConfig, now = Date.now()) {
    const current = this.cycles.get(cycleID) ?? { startedAt: now, actions: 0 }
    if (now - current.startedAt >= config.cycleTimeoutMs) {
      this.cycles.delete(cycleID)
      return { ok: false, reason: `Autonomy cycle exceeded ${config.cycleTimeoutMs / 1_000}s` } as const
    }
    if (current.actions >= config.maximumActionsPerCycle) {
      return { ok: false, reason: `Autonomy cycle exceeded ${config.maximumActionsPerCycle} actions` } as const
    }
    this.cycles.set(cycleID, { ...current, actions: current.actions + 1 })
    return { ok: true, remaining: config.maximumActionsPerCycle - current.actions - 1 } as const
  }

  clear(cycleID: string) {
    this.cycles.delete(cycleID)
  }
}

export class AvatarGoalStack {
  readonly goals = new Map<string, AgentGoal>()
  readonly failures = new Map<string, { signature: string; count: number }>()

  create(input: Omit<AgentGoal, "createdAt" | "status">, now = Date.now()) {
    this.list(input.characterID)
      .filter((goal) => goal.status === "active")
      .forEach((goal) => this.goals.set(goal.id, { ...goal, status: "paused" }))
    const goal: AgentGoal = { ...input, createdAt: now, status: "active" }
    this.goals.set(goal.id, goal)
    return structuredClone(goal)
  }

  get(id: string) {
    const goal = this.goals.get(id)
    return goal ? structuredClone(goal) : undefined
  }

  list(characterID?: string) {
    return [...this.goals.values()]
      .filter((goal) => !characterID || goal.characterID === characterID)
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .map((goal) => structuredClone(goal))
  }

  updateStep(goalID: string, stepID: string, status: GoalStep["status"], failureReason?: string) {
    const goal = this.goals.get(goalID)
    const step = goal?.steps.find((item) => item.id === stepID)
    if (!goal || !step || goal.status === "completed" || goal.status === "cancelled") return
    step.status = status
    if (status === "active" || status === "failed") step.attempts++
    if (failureReason) step.failureReason = failureReason.slice(0, 1_000)
    return structuredClone(goal)
  }

  actionResult(goalID: string, actionID: string, ok: boolean, reason = "") {
    const goal = this.goals.get(goalID)
    if (!goal) return { replan: false }
    if (ok) {
      this.failures.delete(goalID)
      return { replan: false }
    }
    const signature = `${actionID}\u0000${reason}`
    const previous = this.failures.get(goalID)
    const count = previous?.signature === signature ? previous.count + 1 : 1
    this.failures.set(goalID, { signature, count })
    if (count <= 2) return { replan: false, attempts: count }
    goal.replanReason = `Action ${actionID} failed repeatedly: ${reason || "unknown failure"}`.slice(0, 1_000)
    return { replan: true, attempts: count, reason: goal.replanReason }
  }

  finish(id: string, status: GoalOutcome["status"], reason: string, now = Date.now()) {
    const goal = this.goals.get(id)
    if (!goal) return
    goal.status = status
    goal.outcome = { status, reason: reason.slice(0, 1_000), completedAt: now }
    this.failures.delete(id)
    const parent = goal.parentID ? this.goals.get(goal.parentID) : undefined
    if (parent?.status === "paused") parent.status = "active"
    return structuredClone(goal)
  }

  expire(now = Date.now()) {
    return this.list()
      .filter((goal) => (goal.status === "active" || goal.status === "paused") && goal.expiresAt <= now)
      .flatMap((goal) => {
        const expired = this.finish(goal.id, "failed", "Goal time budget expired", now)
        return expired ? [expired] : []
      })
  }
}

export function selectAvatarModelRole(
  config: AvatarBridgeConfig,
  input: { text: string; goal?: AgentGoal; resourceStatus?: "healthy" | "pressured" | "critical" },
) {
  if (!config.plannerModel) return { role: "dialogue" as const, reason: "planner model is not configured" }
  const words = input.text.trim().split(/\s+/u).filter(Boolean).length
  const complex =
    words >= config.plannerEscalationMinWords ||
    Boolean(input.goal && (input.goal.steps.length > 1 || input.goal.replanReason)) ||
    /(план|квест|сюжет|виріш|стратег|порівн|\bplan\b|\bquest\b|\bstory\b|\bstrategy\b|\bdecide\b|\bcompare\b)/iu.test(input.text)
  if (!complex) return { role: "dialogue" as const, reason: "single-step or conversational turn" }
  if (input.resourceStatus === "critical") {
    return { role: "dialogue" as const, reason: "planner escalation skipped under critical memory pressure" }
  }
  return { role: "planner" as const, reason: input.goal?.replanReason ?? "multi-step goal requires planning" }
}

export class AvatarPersistentStore {
  private state: PersistedState
  private pending = Promise.resolve()

  private constructor(
    private readonly path: string,
    state: PersistedState,
  ) {
    this.state = state
  }

  static async open(path: string) {
    const state = await readPersisted(path)
    return new AvatarPersistentStore(path, state)
  }

  config() {
    return { ...this.state.config }
  }

  updateConfig(input: Partial<AvatarBridgeConfig>) {
    this.state.config = normalizeConfig({ ...this.state.config, ...input })
    return this.save().then(() => this.config())
  }

  devices() {
    return this.state.devices.map((device) => ({ ...device }))
  }

  upsertDevice(device: AvatarPairedDevice) {
    this.state.devices = [...this.state.devices.filter((item) => item.id !== device.id), { ...device }].slice(-32)
    return this.save()
  }

  touchDevice(id: string) {
    const device = this.state.devices.find((item) => item.id === id)
    if (!device || device.revokedAt) return Promise.resolve()
    device.lastSeenAt = Date.now()
    return this.save()
  }

  revokeDevice(id: string) {
    const device = this.state.devices.find((item) => item.id === id)
    if (!device) return Promise.resolve(false)
    device.revokedAt = Date.now()
    return this.save().then(() => true)
  }

  memories(filter?: Partial<Pick<AvatarMemory, "gameID" | "saveSlotID" | "characterID">>) {
    return this.state.memories
      .filter(
        (memory) =>
          (!filter?.gameID || memory.gameID === filter.gameID) &&
          (!filter?.saveSlotID || memory.saveSlotID === filter.saveSlotID) &&
          (!filter?.characterID || memory.characterID === filter.characterID),
      )
      .toSorted((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
      .map((memory) => ({ ...memory }))
  }

  relevantMemories(gameID: string, saveSlotID: string, characterID: string) {
    return this.state.memories
      .filter(
        (memory) =>
          (memory.scope === "personal" ||
            (memory.scope === "game" && memory.gameID === gameID) ||
            (memory.scope === "save" && memory.gameID === gameID && memory.saveSlotID === saveSlotID)) &&
          (memory.kind === "personal" || memory.characterID === characterID),
      )
      .toSorted((left, right) => Number(right.pinned) - Number(left.pinned) || right.importance - left.importance || right.updatedAt - left.updatedAt)
      .map((memory) => ({ ...memory }))
  }

  remember(input: Omit<AvatarMemory, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
    const now = Date.now()
    const previous = input.id ? this.state.memories.find((memory) => memory.id === input.id) : undefined
    const conflict = input.topic
      ? this.state.memories.find(
          (memory) =>
            memory.id !== input.id &&
            memory.topic === input.topic &&
            memory.gameID === input.gameID &&
            memory.saveSlotID === input.saveSlotID &&
            memory.characterID === input.characterID &&
            memory.text.trim().toLocaleLowerCase() !== input.text.trim().toLocaleLowerCase(),
        )
      : undefined
    const memory: AvatarMemory = {
      id: previous?.id ?? input.id ?? `mem_${randomUUID()}`,
      gameID: input.gameID,
      saveSlotID: input.saveSlotID,
      characterID: input.characterID,
      kind: input.kind,
      scope: input.scope,
      source: input.source.trim().slice(0, 256),
      confidence: Math.max(0, Math.min(1, input.confidence)),
      text: input.text.trim().slice(0, 2_000),
      importance: Math.max(0, Math.min(1, input.importance)),
      ...(input.topic ? { topic: input.topic.trim().slice(0, 160) } : {}),
      pinned: input.pinned,
      ...(conflict ? { conflictWith: conflict.id } : input.conflictWith ? { conflictWith: input.conflictWith } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    this.state.memories = [...this.state.memories.filter((item) => item.id !== memory.id), memory]
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 1_000)
    return this.save().then(() => ({ ...memory }))
  }

  deleteMemory(id: string) {
    const length = this.state.memories.length
    this.state.memories = this.state.memories.filter((memory) => memory.id !== id)
    if (length === this.state.memories.length) return Promise.resolve(false)
    return this.save().then(() => true)
  }

  clearMemories(filter?: Partial<Pick<AvatarMemory, "gameID" | "saveSlotID" | "characterID">>) {
    if (!filter || Object.keys(filter).length === 0) this.state.memories = []
    else {
      const ids = new Set(this.memories(filter).map((memory) => memory.id))
      this.state.memories = this.state.memories.filter((memory) => !ids.has(memory.id))
    }
    return this.save()
  }

  flush() {
    return this.pending
  }

  private save() {
    const snapshot = JSON.stringify(this.state, null, 2)
    this.pending = this.pending.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600 })
      await rename(temporary, this.path)
    })
    return this.pending
  }
}

export function validateCapabilityArguments(capability: AvatarCapability, args: Record<string, AvatarJson>) {
  const schema = capability.parameters
  if (schema.type !== undefined && schema.type !== "object") return { ok: false, error: "Capability schema must be an object" } as const
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []
  const missing = required.find((key) => args[key] === undefined)
  if (missing) return { ok: false, error: `Missing required argument '${missing}'` } as const
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const unknown = Object.keys(args).find((key) => !(key in properties) && schema.additionalProperties === false)
  if (unknown) return { ok: false, error: `Unknown argument '${unknown}'` } as const
  const invalid = Object.entries(args).find(([key, value]) => {
    const definition = properties[key]
    if (!isRecord(definition)) return false
    if (Array.isArray(definition.enum) && !definition.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) return true
    if (definition.type === "string") return typeof value !== "string"
    if (definition.type === "number") return typeof value !== "number" || !Number.isFinite(value)
    if (definition.type === "integer") return typeof value !== "number" || !Number.isInteger(value)
    if (definition.type === "boolean") return typeof value !== "boolean"
    if (definition.type === "array") return !Array.isArray(value)
    if (definition.type === "object") return !isRecord(value)
    return false
  })
  if (invalid) return { ok: false, error: `Invalid value for '${invalid[0]}'` } as const
  return { ok: true } as const
}

function worldKey(input: { gameID: string; saveSlotID: string; characterID: string }) {
  return `${input.gameID}\u0000${input.saveSlotID}\u0000${input.characterID}`
}

async function readPersisted(path: string): Promise<PersistedState> {
  const value = await readFile(path, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => undefined)
  if (!isRecord(value) || (value.version !== 2 && value.version !== 3)) return defaults()
  return {
    version: 3,
    config: normalizeConfig(isRecord(value.config) ? value.config : {}),
    devices: Array.isArray(value.devices) ? value.devices.filter(isDevice).slice(-32) : [],
    memories: Array.isArray(value.memories)
      ? value.memories.flatMap((memory) => migrateMemory(memory)).filter(isMemory).slice(0, 1_000)
      : [],
  }
}

function defaults(): PersistedState {
  return { version: 3, config: { ...avatarBridgeDefaults }, devices: [], memories: [] }
}

function normalizeConfig(value: Record<string, unknown>): AvatarBridgeConfig {
  return {
    lanEnabled: typeof value.lanEnabled === "boolean" ? value.lanEnabled : avatarBridgeDefaults.lanEnabled,
    interactionAutoApprove:
      typeof value.interactionAutoApprove === "boolean"
        ? value.interactionAutoApprove
        : avatarBridgeDefaults.interactionAutoApprove,
    maximumActionsPerCycle:
      typeof value.maximumActionsPerCycle === "number" && Number.isInteger(value.maximumActionsPerCycle)
        ? Math.max(1, Math.min(8, value.maximumActionsPerCycle))
        : avatarBridgeDefaults.maximumActionsPerCycle,
    cycleTimeoutMs:
      typeof value.cycleTimeoutMs === "number" && Number.isInteger(value.cycleTimeoutMs)
        ? Math.max(5_000, Math.min(60_000, value.cycleTimeoutMs))
        : avatarBridgeDefaults.cycleTimeoutMs,
    attentionThreshold:
      typeof value.attentionThreshold === "number" && Number.isFinite(value.attentionThreshold)
        ? Math.max(0, Math.min(1, value.attentionThreshold))
        : avatarBridgeDefaults.attentionThreshold,
    attentionCooldownMs:
      typeof value.attentionCooldownMs === "number" && Number.isInteger(value.attentionCooldownMs)
        ? Math.max(500, Math.min(60_000, value.attentionCooldownMs))
        : avatarBridgeDefaults.attentionCooldownMs,
    plannerEscalationMinWords:
      typeof value.plannerEscalationMinWords === "number" && Number.isInteger(value.plannerEscalationMinWords)
        ? Math.max(4, Math.min(100, value.plannerEscalationMinWords))
        : avatarBridgeDefaults.plannerEscalationMinWords,
    plannerIdleUnloadMs:
      typeof value.plannerIdleUnloadMs === "number" && Number.isInteger(value.plannerIdleUnloadMs)
        ? Math.max(30_000, Math.min(30 * 60_000, value.plannerIdleUnloadMs))
        : avatarBridgeDefaults.plannerIdleUnloadMs,
    ...(isModelSelection(value.dialogueModel) ? { dialogueModel: value.dialogueModel } : {}),
    ...(isModelSelection(value.plannerModel) ? { plannerModel: value.plannerModel } : {}),
    trustedProfiles: Array.isArray(value.trustedProfiles)
      ? value.trustedProfiles.filter(isTrustedProfile).slice(0, 64).map((profile) => ({
          ...profile,
          allowedCriticalCategories: [...new Set(profile.allowedCriticalCategories)].slice(0, 64),
        }))
      : [],
  }
}

function isDevice(value: unknown): value is AvatarPairedDevice {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.tokenHash === "string" &&
    typeof value.certificateFingerprint === "string" &&
    typeof value.createdAt === "number"
  )
}

function isMemory(value: unknown): value is AvatarMemory {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.gameID === "string" &&
    typeof value.saveSlotID === "string" &&
    typeof value.characterID === "string" &&
    (value.kind === "episodic" ||
      value.kind === "relationship" ||
      value.kind === "quest" ||
      value.kind === "promise" ||
      value.kind === "correction" ||
      value.kind === "world" ||
      value.kind === "personal") &&
    (value.scope === "save" || value.scope === "game" || value.scope === "personal") &&
    typeof value.source === "string" &&
    typeof value.confidence === "number" &&
    typeof value.text === "string" &&
    typeof value.importance === "number" &&
    typeof value.pinned === "boolean" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  )
}

function migrateMemory(value: unknown): unknown[] {
  if (!isRecord(value)) return []
  if (typeof value.scope === "string") return [value]
  const kind =
    value.kind === "event"
      ? "episodic"
      : value.kind === "relationship" ||
          value.kind === "quest" ||
          value.kind === "promise" ||
          value.kind === "correction"
        ? value.kind
        : "episodic"
  return [
    {
      ...value,
      kind,
      scope: "save",
      source: "avatar-bridge-v2-migration",
      confidence: 0.75,
      pinned: false,
    },
  ]
}

function isModelSelection(value: unknown): value is AvatarModelSelection {
  return (
    isRecord(value) &&
    typeof value.providerID === "string" &&
    value.providerID.length > 0 &&
    value.providerID.length <= 128 &&
    typeof value.modelID === "string" &&
    value.modelID.length > 0 &&
    value.modelID.length <= 256
  )
}

function isTrustedProfile(value: unknown): value is TrustedAutonomyProfile {
  return (
    isRecord(value) &&
    typeof value.gameID === "string" &&
    value.gameID.length > 0 &&
    value.gameID.length <= 128 &&
    typeof value.allowInteraction === "boolean" &&
    Array.isArray(value.allowedCriticalCategories) &&
    value.allowedCriticalCategories.every((item) => typeof item === "string" && item.length > 0 && item.length <= 160)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
