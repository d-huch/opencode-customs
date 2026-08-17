export const AVATAR_BRIDGE_PROTOCOL = 1
export const AVATAR_ACTIONS = [
  "animation.trigger",
  "emotion.set",
  "gesture.play",
  "look_at",
  "move_to",
  "speech.stop",
] as const

export type AvatarActionName = (typeof AVATAR_ACTIONS)[number]
export type AvatarVector = { x: number; y: number; z: number }

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
  protocol: 1
  token: string
  clientID: string
  characterID: string
  actions: AvatarActionName[]
  sessionID?: string
  model?: { providerID: string; id: string }
  voice?: AvatarVoice
}

export type AvatarTranscript = {
  type: "user.transcript"
  requestID: string
  text: string
  language?: string
}

export type AvatarActionResult = {
  type: "character.action.result"
  id: string
  ok: boolean
  message?: string
}

export type AvatarClientMessage = AvatarHello | AvatarTranscript | AvatarActionResult

export function parseAvatarClientMessage(value: unknown): AvatarClientMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return
  if (value.type === "hello") return parseHello(value)
  if (value.type === "user.transcript") {
    if (typeof value.requestID !== "string" || !bounded(value.requestID, 128)) return
    if (typeof value.text !== "string" || !value.text.trim() || !bounded(value.text, 20_000)) return
    if (value.language !== undefined && (typeof value.language !== "string" || !bounded(value.language, 32))) return
    return {
      type: value.type,
      requestID: value.requestID,
      text: value.text.trim(),
      ...(value.language === undefined ? {} : { language: value.language }),
    }
  }
  if (value.type !== "character.action.result") return
  if (typeof value.id !== "string" || !bounded(value.id, 128) || typeof value.ok !== "boolean") return
  if (value.message !== undefined && (typeof value.message !== "string" || !bounded(value.message, 1_000))) return
  return {
    type: value.type,
    id: value.id,
    ok: value.ok,
    ...(value.message === undefined ? {} : { message: value.message }),
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

function parseHello(value: Record<string, unknown>): AvatarHello | undefined {
  if (value.protocol !== AVATAR_BRIDGE_PROTOCOL) return
  if (typeof value.token !== "string" || !bounded(value.token, 256)) return
  if (typeof value.clientID !== "string" || !bounded(value.clientID, 128)) return
  if (typeof value.characterID !== "string" || !bounded(value.characterID, 128)) return
  if (!Array.isArray(value.actions) || !value.actions.every(isAvatarAction)) return
  const sessionID = optionalString(value.sessionID, 128)
  if (sessionID === invalid) return
  const model = parseModel(value.model)
  if (model === invalid) return
  const voice = parseVoice(value.voice)
  if (voice === invalid) return
  return {
    type: "hello",
    protocol: AVATAR_BRIDGE_PROTOCOL,
    token: value.token,
    clientID: value.clientID,
    characterID: value.characterID,
    actions: [...new Set(value.actions)],
    ...(typeof sessionID === "string" ? { sessionID } : {}),
    ...(model ? { model } : {}),
    ...(voice ? { voice } : {}),
  }
}

function parseModel(value: unknown) {
  if (value === undefined) return undefined
  if (!isRecord(value)) return invalid
  if (typeof value.providerID !== "string" || !bounded(value.providerID, 128)) return invalid
  if (typeof value.id !== "string" || !bounded(value.id, 256)) return invalid
  return { providerID: value.providerID, id: value.id }
}

function parseVoice(value: unknown): AvatarVoice | undefined | typeof invalid {
  if (value === undefined) return
  if (!isRecord(value)) return invalid
  if (value.provider !== undefined && value.provider !== "local" && value.provider !== "fish-local") return invalid
  if (typeof value.endpoint !== "string" || !bounded(value.endpoint, 2_048)) return invalid
  if (typeof value.model !== "string" || !bounded(value.model, 256)) return invalid
  if (typeof value.voice !== "string" || !bounded(value.voice, 256)) return invalid
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

function optionalString(value: unknown, maximum: number) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value.trim() || !bounded(value, maximum)) return invalid
  return value.trim()
}

function optionalFinite(value: unknown, minimum: number, maximum: number) {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) return invalid
  return value
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

function bounded(value: string, maximum: number) {
  return Buffer.byteLength(value, "utf8") <= maximum
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
