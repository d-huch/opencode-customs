export const AVATAR_BRIDGE_PROTOCOL = 2
export const AVATAR_BRIDGE_PROTOCOL_MINOR = 2
export const AVATAR_BRIDGE_VERSION = "2.2"
export const AVATAR_BRIDGE_PROTOCOLS = [1, 2] as const
export const AVATAR_ACTIONS = [
  "animation.trigger",
  "emotion.set",
  "gesture.play",
  "look_at",
  "move_to",
  "speech.stop",
] as const

export type AvatarActionName = (typeof AVATAR_ACTIONS)[number]
export type AvatarRisk = "ambient" | "interaction" | "critical"
export type AvatarVector = { x: number; y: number; z: number }
export type AvatarJson = null | boolean | number | string | AvatarJson[] | { [key: string]: AvatarJson }

export type AvatarActionInput = {
  action: AvatarActionName
  characterID?: string
  name?: string
  emotion?: string
  position?: AvatarVector
  target?: AvatarVector
  speed?: number
  intensity?: number
  durationMs?: number
}

export type GameActionInput = {
  actionID: string
  characterID?: string
  args: Record<string, AvatarJson>
  cycleID?: string
  idempotencyKey?: string
}

export type AvatarCapability = {
  id: string
  title: string
  description: string
  parameters: Record<string, AvatarJson>
  risk: AvatarRisk
  cooldownMs: number
  timeoutMs: number
  cancellable: boolean
  preconditions: string[]
  permissionCategory: string
  postconditions: string[]
  sideEffects: string[]
}

export type AvatarWorldEntity = {
  id: string
  kind: string
  label?: string
  tags: string[]
  position?: AvatarVector
  distance?: number
  visible: boolean
  state: Record<string, AvatarJson>
  affordances: string[]
}

export type AvatarWorld = {
  gameID: string
  saveSlotID: string
  characterID: string
  revision: number
  timestamp: number
  entities: AvatarWorldEntity[]
  inventory: Record<string, AvatarJson>
  quests: Record<string, AvatarJson>
  relationships: Record<string, AvatarJson>
  events: AvatarWorldEvent[]
}

export type AvatarWorldEvent = {
  id: string
  kind: string
  attention: boolean
  timestamp: number
  entityID?: string
  data: Record<string, AvatarJson>
}

export type AvatarVoice = {
  provider?: "local" | "fish-local"
  fishPresetID?: string
  endpoint: string
  model: string
  voice: string
  mode: "quality" | "fast"
  speed?: number
  latency?: "normal" | "balanced"
  language?: "auto" | "uk" | "en" | "mixed"
  temperature?: number
  topP?: number
  repetitionPenalty?: number
  seed?: number | null
  chunkLength?: number
  normalize?: boolean
  streaming?: boolean
  useMemoryCache?: boolean
  maxNewTokens?: number
}

export type AvatarHello = {
  type: "hello"
  protocol: 1 | 2
  protocolMinor?: number
  token: string
  clientID: string
  characterID: string
  actions: AvatarActionName[]
  sessionID?: string
  model?: { providerID: string; id: string }
  voice?: AvatarVoice
  gameID?: string
  saveSlotID?: string
  resumeSequence?: number
  profileID?: string
  profileRevision?: number
}

export type AvatarTranscript = {
  type: "user.transcript" | "speech.final"
  requestID: string
  text: string
  language?: string
}

export type AvatarActionResult = {
  type: "character.action.result" | "game.action.result"
  id: string
  ok: boolean
  code?: string
  message?: string
  data?: Record<string, AvatarJson>
  changedEntityIDs?: string[]
  observeAgain?: boolean
}

export type AvatarClientMessage =
  | AvatarHello
  | AvatarTranscript
  | AvatarActionResult
  | { type: "heartbeat"; sequence: number }
  | { type: "speech.start" | "speech.cancel"; requestID: string }
  | { type: "speech.partial"; requestID: string; text: string; language?: string }
  | { type: "capability.manifest"; revision: number; capabilities: AvatarCapability[] }
  | { type: "world.snapshot"; world: AvatarWorld }
  | {
      type: "world.delta"
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
    }
  | { type: "world.event"; gameID: string; saveSlotID: string; characterID: string; event: AvatarWorldEvent }
  | { type: "world.camera.result"; id: string; contentType: "image/jpeg"; data: string }
  | { type: "game.action.progress"; id: string; progress: number; message?: string }
  | { type: "approval.result"; id: string; approved: boolean; source: "vr" | "voice" | "desktop" }

export function parseAvatarClientMessage(value: unknown): AvatarClientMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return
  if (value.type === "hello") return parseHello(value)
  if (value.type === "user.transcript" || value.type === "speech.final") return parseTranscript(value)
  if (value.type === "speech.start" || value.type === "speech.cancel") {
    if (!shortID(value.requestID)) return
    return { type: value.type, requestID: value.requestID }
  }
  if (value.type === "speech.partial") {
    if (!shortID(value.requestID) || !text(value.text, 20_000)) return
    const language = optionalString(value.language, 32)
    if (language === invalid) return
    return {
      type: value.type,
      requestID: value.requestID,
      text: value.text,
      ...(typeof language === "string" ? { language } : {}),
    }
  }
  if (value.type === "heartbeat") {
    if (!integer(value.sequence, 0, Number.MAX_SAFE_INTEGER)) return
    return { type: value.type, sequence: value.sequence }
  }
  if (value.type === "capability.manifest") return parseCapabilityManifest(value)
  if (value.type === "world.snapshot") {
    const world = parseWorld(value.world)
    return world ? { type: value.type, world } : undefined
  }
  if (value.type === "world.delta") return parseWorldDelta(value)
  if (value.type === "world.event") return parseWorldEventMessage(value)
  if (value.type === "world.camera.result") {
    if (!shortID(value.id) || value.contentType !== "image/jpeg" || !text(value.data, 48 * 1024)) return
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) return
    return { type: value.type, id: value.id, contentType: value.contentType, data: value.data }
  }
  if (value.type === "game.action.progress") {
    if (!shortID(value.id) || !finite(value.progress, 0, 1)) return
    const message = optionalString(value.message, 1_000)
    if (message === invalid) return
    return {
      type: value.type,
      id: value.id,
      progress: value.progress,
      ...(typeof message === "string" ? { message } : {}),
    }
  }
  if (value.type === "approval.result") {
    if (!shortID(value.id) || typeof value.approved !== "boolean") return
    if (value.source !== "vr" && value.source !== "voice" && value.source !== "desktop") return
    return { type: value.type, id: value.id, approved: value.approved, source: value.source }
  }
  if (value.type !== "character.action.result" && value.type !== "game.action.result") return
  if (!shortID(value.id) || typeof value.ok !== "boolean") return
  const code = optionalIdentifier(value.code, 80)
  const message = optionalString(value.message, 1_000)
  const data = jsonRecord(value.data, 32 * 1024)
  const changedEntityIDs = optionalIdentifiers(value.changedEntityIDs, 64, 128)
  const observeAgain = optionalBoolean(value.observeAgain)
  if ([code, message, data, changedEntityIDs, observeAgain].includes(invalid)) return
  return {
    type: value.type,
    id: value.id,
    ok: value.ok,
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof message === "string" ? { message } : {}),
    ...(isRecord(data) ? { data } : {}),
    ...(Array.isArray(changedEntityIDs) ? { changedEntityIDs } : {}),
    ...(typeof observeAgain === "boolean" ? { observeAgain } : {}),
  }
}

export function parseAvatarAction(value: unknown): AvatarActionInput | undefined {
  if (!isRecord(value) || !isAvatarAction(value.action)) return
  const characterID = optionalString(value.characterID, 128)
  const name = optionalString(value.name, 128)
  const emotion = optionalString(value.emotion, 64)
  const position = optionalVector(value.position)
  const target = optionalVector(value.target)
  const speed = optionalFinite(value.speed, 0, 100)
  const intensity = optionalFinite(value.intensity, 0, 1)
  const durationMs = optionalFinite(value.durationMs, 0, 300_000)
  if ([characterID, name, emotion, position, target, speed, intensity, durationMs].includes(invalid)) return
  if ((value.action === "animation.trigger" || value.action === "gesture.play") && !name) return
  if (value.action === "emotion.set" && !emotion) return
  if (value.action === "look_at" && !target) return
  if (value.action === "move_to" && !position) return
  return {
    action: value.action,
    ...(typeof characterID === "string" ? { characterID } : {}),
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof emotion === "string" ? { emotion } : {}),
    ...(isVector(position) ? { position } : {}),
    ...(isVector(target) ? { target } : {}),
    ...(typeof speed === "number" ? { speed } : {}),
    ...(typeof intensity === "number" ? { intensity } : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
  }
}

export function parseGameAction(value: unknown): GameActionInput | undefined {
  if (!isRecord(value) || !identifier(value.actionID, 160)) return
  const characterID = optionalString(value.characterID, 128)
  const cycleID = optionalString(value.cycleID, 128)
  const idempotencyKey = optionalString(value.idempotencyKey, 128)
  const args = jsonRecord(value.args ?? {}, 32 * 1024)
  if ([characterID, cycleID, idempotencyKey, args].includes(invalid) || !isRecord(args)) return
  return {
    actionID: value.actionID,
    args,
    ...(typeof characterID === "string" ? { characterID } : {}),
    ...(typeof cycleID === "string" ? { cycleID } : {}),
    ...(typeof idempotencyKey === "string" ? { idempotencyKey } : {}),
  }
}

function parseHello(value: Record<string, unknown>): AvatarHello | undefined {
  if (value.protocol !== 1 && value.protocol !== 2) return
  if (!text(value.token, 256) || !shortID(value.clientID) || !shortID(value.characterID)) return
  if (!Array.isArray(value.actions) || value.actions.length > AVATAR_ACTIONS.length || !value.actions.every(isAvatarAction))
    return
  const sessionID = optionalString(value.sessionID, 128)
  const gameID = optionalString(value.gameID, 128)
  const saveSlotID = optionalString(value.saveSlotID, 128)
  const resumeSequence = value.resumeSequence === undefined ? undefined : value.resumeSequence
  const protocolMinor = value.protocolMinor === undefined ? undefined : value.protocolMinor
  const profileID = optionalString(value.profileID, 128)
  const profileRevision = value.profileRevision === undefined ? undefined : value.profileRevision
  if ([sessionID, gameID, saveSlotID, profileID].includes(invalid)) return
  if (resumeSequence !== undefined && !integer(resumeSequence, 0, Number.MAX_SAFE_INTEGER)) return
  if (protocolMinor !== undefined && !integer(protocolMinor, 0, 99)) return
  if (profileRevision !== undefined && !integer(profileRevision, 0, Number.MAX_SAFE_INTEGER)) return
  const model = parseModel(value.model)
  const voice = parseVoice(value.voice)
  if (model === invalid || voice === invalid) return
  return {
    type: "hello",
    protocol: value.protocol,
    ...(typeof protocolMinor === "number" ? { protocolMinor } : {}),
    token: value.token,
    clientID: value.clientID,
    characterID: value.characterID,
    actions: [...new Set(value.actions)],
    ...(typeof sessionID === "string" ? { sessionID } : {}),
    ...(model ? { model } : {}),
    ...(voice ? { voice } : {}),
    ...(typeof gameID === "string" ? { gameID } : {}),
    ...(typeof saveSlotID === "string" ? { saveSlotID } : {}),
    ...(typeof resumeSequence === "number" ? { resumeSequence } : {}),
    ...(typeof profileID === "string" ? { profileID } : {}),
    ...(typeof profileRevision === "number" ? { profileRevision } : {}),
  }
}

function parseTranscript(value: Record<string, unknown>): AvatarTranscript | undefined {
  if (!shortID(value.requestID) || !text(value.text, 20_000) || !value.text.trim()) return
  const language = optionalString(value.language, 32)
  if (language === invalid) return
  return {
    type: value.type === "speech.final" ? "speech.final" : "user.transcript",
    requestID: value.requestID,
    text: value.text.trim(),
    ...(typeof language === "string" ? { language } : {}),
  }
}

function parseCapabilityManifest(value: Record<string, unknown>): AvatarClientMessage | undefined {
  if (!integer(value.revision, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(value.capabilities)) return
  if (value.capabilities.length > 128) return
  const capabilities = value.capabilities.map(parseCapability)
  if (capabilities.some((item) => !item)) return
  const ids = capabilities.map((item) => item?.id)
  if (new Set(ids).size !== ids.length) return
  return { type: "capability.manifest", revision: value.revision, capabilities: capabilities as AvatarCapability[] }
}

function parseCapability(value: unknown): AvatarCapability | undefined {
  if (!isRecord(value) || !identifier(value.id, 160)) return
  if (!text(value.title, 160) || !text(value.description, 2_000)) return
  if (value.risk !== "ambient" && value.risk !== "interaction" && value.risk !== "critical") return
  const parameters = jsonRecord(value.parameters ?? {}, 16 * 1024)
  if (!isRecord(parameters)) return
  if (!finite(value.cooldownMs ?? 0, 0, 300_000) || !finite(value.timeoutMs ?? 15_000, 100, 300_000)) return
  if (typeof value.cancellable !== "boolean") return
  if (!Array.isArray(value.preconditions) || value.preconditions.length > 32) return
  if (!value.preconditions.every((item) => text(item, 256))) return
  const permissionCategory = value.permissionCategory ?? value.id
  if (!identifier(permissionCategory, 160)) return
  const postconditions = value.postconditions ?? []
  const sideEffects = value.sideEffects ?? []
  if (!Array.isArray(postconditions) || postconditions.length > 32 || !postconditions.every((item) => text(item, 256))) return
  if (!Array.isArray(sideEffects) || sideEffects.length > 32 || !sideEffects.every((item) => text(item, 256))) return
  const cooldownMs = value.cooldownMs ?? 0
  const timeoutMs = value.timeoutMs ?? 15_000
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    parameters,
    risk: value.risk,
    cooldownMs: typeof cooldownMs === "number" ? cooldownMs : 0,
    timeoutMs: typeof timeoutMs === "number" ? timeoutMs : 15_000,
    cancellable: value.cancellable,
    preconditions: value.preconditions,
    permissionCategory,
    postconditions,
    sideEffects,
  }
}

function parseWorld(value: unknown): AvatarWorld | undefined {
  if (!isRecord(value)) return
  if (!shortID(value.gameID) || !shortID(value.saveSlotID) || !shortID(value.characterID)) return
  if (!integer(value.revision, 0, Number.MAX_SAFE_INTEGER) || !finite(value.timestamp, 0, Number.MAX_SAFE_INTEGER)) return
  if (!Array.isArray(value.entities) || value.entities.length > 256) return
  const entities = value.entities.map(parseEntity)
  if (entities.some((entity) => !entity)) return
  const ids = entities.map((entity) => entity?.id)
  if (new Set(ids).size !== ids.length) return
  const inventory = jsonRecord(value.inventory ?? {}, 32 * 1024)
  const quests = jsonRecord(value.quests ?? {}, 32 * 1024)
  const relationships = jsonRecord(value.relationships ?? {}, 32 * 1024)
  if (!isRecord(inventory) || !isRecord(quests) || !isRecord(relationships)) return
  const sourceEvents = value.events ?? []
  if (!Array.isArray(sourceEvents) || sourceEvents.length > 64) return
  const events = sourceEvents.map(parseEvent)
  if (events.some((event) => !event)) return
  return {
    gameID: value.gameID,
    saveSlotID: value.saveSlotID,
    characterID: value.characterID,
    revision: value.revision,
    timestamp: value.timestamp,
    entities: entities as AvatarWorldEntity[],
    inventory,
    quests,
    relationships,
    events: events as AvatarWorldEvent[],
  }
}

function parseWorldDelta(value: Record<string, unknown>): AvatarClientMessage | undefined {
  if (!shortID(value.gameID) || !shortID(value.saveSlotID) || !shortID(value.characterID)) return
  if (!integer(value.revision, 0, Number.MAX_SAFE_INTEGER) || !finite(value.timestamp, 0, Number.MAX_SAFE_INTEGER)) return
  if (!Array.isArray(value.upsert) || value.upsert.length > 128 || !Array.isArray(value.remove) || value.remove.length > 128)
    return
  const upsert = value.upsert.map(parseEntity)
  if (upsert.some((entity) => !entity) || !value.remove.every(shortID)) return
  const inventory = jsonRecord(value.inventory, 32 * 1024)
  const quests = jsonRecord(value.quests, 32 * 1024)
  const relationships = jsonRecord(value.relationships, 32 * 1024)
  if ([inventory, quests, relationships].includes(invalid)) return
  return {
    type: "world.delta",
    gameID: value.gameID,
    saveSlotID: value.saveSlotID,
    characterID: value.characterID,
    revision: value.revision,
    timestamp: value.timestamp,
    upsert: upsert as AvatarWorldEntity[],
    remove: value.remove,
    ...(isRecord(inventory) ? { inventory } : {}),
    ...(isRecord(quests) ? { quests } : {}),
    ...(isRecord(relationships) ? { relationships } : {}),
  }
}

function parseWorldEventMessage(value: Record<string, unknown>): AvatarClientMessage | undefined {
  if (!shortID(value.gameID) || !shortID(value.saveSlotID) || !shortID(value.characterID)) return
  const event = parseEvent(value.event)
  if (!event) return
  return {
    type: "world.event",
    gameID: value.gameID,
    saveSlotID: value.saveSlotID,
    characterID: value.characterID,
    event,
  }
}

function parseEntity(value: unknown): AvatarWorldEntity | undefined {
  if (!isRecord(value) || !shortID(value.id) || !identifier(value.kind, 80)) return
  const label = optionalString(value.label, 160)
  const position = optionalVector(value.position)
  const distance = optionalFinite(value.distance, 0, 1_000_000)
  if ([label, position, distance].includes(invalid) || typeof value.visible !== "boolean") return
  if (!Array.isArray(value.tags) || value.tags.length > 32 || !value.tags.every((item) => identifier(item, 80))) return
  if (!Array.isArray(value.affordances) || value.affordances.length > 64 || !value.affordances.every((item) => identifier(item, 160)))
    return
  const state = jsonRecord(value.state ?? {}, 16 * 1024)
  if (!isRecord(state)) return
  return {
    id: value.id,
    kind: value.kind,
    ...(typeof label === "string" ? { label } : {}),
    tags: value.tags,
    ...(isVector(position) ? { position } : {}),
    ...(typeof distance === "number" ? { distance } : {}),
    visible: value.visible,
    state,
    affordances: value.affordances,
  }
}

function parseEvent(value: unknown): AvatarWorldEvent | undefined {
  if (!isRecord(value) || !shortID(value.id) || !identifier(value.kind, 120)) return
  if (typeof value.attention !== "boolean" || !finite(value.timestamp, 0, Number.MAX_SAFE_INTEGER)) return
  const entityID = optionalString(value.entityID, 128)
  const data = jsonRecord(value.data ?? {}, 16 * 1024)
  if (entityID === invalid || !isRecord(data)) return
  return {
    id: value.id,
    kind: value.kind,
    attention: value.attention,
    timestamp: value.timestamp,
    ...(typeof entityID === "string" ? { entityID } : {}),
    data,
  }
}

function parseModel(value: unknown) {
  if (value === undefined) return undefined
  if (!isRecord(value) || !text(value.providerID, 128) || !text(value.id, 256)) return invalid
  return { providerID: value.providerID, id: value.id }
}

function parseVoice(value: unknown): AvatarVoice | undefined | typeof invalid {
  if (value === undefined) return
  if (!isRecord(value)) return invalid
  if (value.provider !== undefined && value.provider !== "local" && value.provider !== "fish-local") return invalid
  if (!text(value.endpoint, 2_048) || !text(value.model, 256) || !text(value.voice, 256)) return invalid
  if (value.mode !== "quality" && value.mode !== "fast") return invalid
  const optional = {
    fishPresetID: optionalString(value.fishPresetID, 128),
    speed: optionalFinite(value.speed, 0.25, 4),
    latency: enumValue(value.latency, ["normal", "balanced"] as const),
    language: enumValue(value.language, ["auto", "uk", "en", "mixed"] as const),
    temperature: optionalFinite(value.temperature, 0, 2),
    topP: optionalFinite(value.topP, 0, 1),
    repetitionPenalty: optionalFinite(value.repetitionPenalty, 0, 3),
    seed: value.seed === null ? null : optionalFinite(value.seed, -2_147_483_648, 2_147_483_647),
    chunkLength: optionalFinite(value.chunkLength, 1, 2_048),
    normalize: optionalBoolean(value.normalize),
    streaming: optionalBoolean(value.streaming),
    useMemoryCache: optionalBoolean(value.useMemoryCache),
    maxNewTokens: optionalFinite(value.maxNewTokens, 1, 8_192),
  }
  if (Object.values(optional).includes(invalid)) return invalid
  return {
    ...(value.provider === undefined ? {} : { provider: value.provider }),
    endpoint: value.endpoint,
    model: value.model,
    voice: value.voice,
    mode: value.mode,
    ...Object.fromEntries(Object.entries(optional).filter((entry) => entry[1] !== undefined)),
  } as AvatarVoice
}

const invalid = Symbol("invalid")

function isAvatarAction(value: unknown): value is AvatarActionName {
  return typeof value === "string" && (AVATAR_ACTIONS as readonly string[]).includes(value)
}

function shortID(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && bounded(value, 128)
}

function identifier(value: unknown, maximum: number): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value) && bounded(value, maximum)
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && bounded(value, maximum)
}

function optionalString(value: unknown, maximum: number) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value.trim() || !bounded(value, maximum)) return invalid
  return value.trim()
}

function optionalIdentifier(value: unknown, maximum: number) {
  if (value === undefined) return undefined
  if (!identifier(value, maximum)) return invalid
  return value
}

function optionalIdentifiers(value: unknown, maximumItems: number, maximumBytes: number) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maximumItems || !value.every((item) => identifier(item, maximumBytes))) return invalid
  return [...new Set(value)]
}

function optionalFinite(value: unknown, minimum: number, maximum: number) {
  if (value === undefined) return undefined
  if (!finite(value, minimum, maximum)) return invalid
  return value
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value, minimum, maximum) && Number.isInteger(value)
}

function optionalBoolean(value: unknown) {
  if (value === undefined || typeof value === "boolean") return value
  return invalid
}

function enumValue<T extends readonly string[]>(value: unknown, values: T) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !values.includes(value)) return invalid
  return value as T[number]
}

function optionalVector(value: unknown) {
  if (value === undefined) return undefined
  if (!isRecord(value)) return invalid
  if (![value.x, value.y, value.z].every((item) => typeof item === "number" && Number.isFinite(item))) return invalid
  if ([value.x, value.y, value.z].some((item) => Math.abs(item as number) > 1_000_000)) return invalid
  return { x: value.x as number, y: value.y as number, z: value.z as number }
}

function isVector(value: unknown): value is AvatarVector {
  return isRecord(value) && [value.x, value.y, value.z].every((item) => typeof item === "number")
}

function jsonRecord(value: unknown, maximum: number): Record<string, AvatarJson> | undefined | typeof invalid {
  if (value === undefined) return undefined
  if (!isRecord(value) || !jsonValue(value)) return invalid
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximum) return invalid
  return value
}

function jsonValue(value: unknown, depth = 0): value is AvatarJson {
  if (depth > 8) return false
  if (value === null || typeof value === "boolean" || typeof value === "string") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => jsonValue(item, depth + 1))
  if (!isRecord(value) || Object.keys(value).length > 256) return false
  return Object.entries(value).every(([key, item]) => bounded(key, 160) && jsonValue(item, depth + 1))
}

function bounded(value: string, maximum: number) {
  return Buffer.byteLength(value, "utf8") <= maximum
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
