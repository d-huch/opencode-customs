import os from "os"
import { Schema } from "effect"
import { findLmStudioModel, probeLmStudio } from "./lmstudio"

const GIB = 1024 ** 3
const DEFAULT_MODEL_CONCURRENCY = 1
const DEFAULT_CONTEXT_PERCENT = 90
const DEFAULT_PRESSURE_PERCENT = 12
const DEFAULT_CRITICAL_PERCENT = 6
const DEFAULT_MIN_FREE_BYTES = 2 * GIB
const DEFAULT_CRITICAL_FREE_BYTES = 1 * GIB
const UNLOADED_MODEL_CONTEXT = 8_192
const MAX_UNLOADED_MODEL_CONTEXT = 16_384
const MODEL_CRASH_COOLDOWN_MS = 10_000
const MODEL_CRASH_RECOVERY_MS = 2 * 60_000
const MODEL_CRASH_CONTEXT_PERCENT = 65

const PressureStatus = Schema.Literals(["healthy", "pressured", "critical"])

export const ResourceGovernorSnapshot = Schema.Struct({
  status: PressureStatus,
  checkedAt: Schema.Number,
  memory: Schema.Struct({
    totalBytes: Schema.Number,
    availableBytes: Schema.Number,
    availablePercent: Schema.Number,
    processRssBytes: Schema.Number,
    processHeapBytes: Schema.Number,
  }),
  limits: Schema.Struct({
    modelConcurrency: Schema.Number,
    contextPercent: Schema.Number,
    pressureAvailablePercent: Schema.Number,
    criticalAvailablePercent: Schema.Number,
    minFreeBytes: Schema.Number,
    criticalFreeBytes: Schema.Number,
  }),
  activity: Schema.Struct({
    activeModelRequests: Schema.Number,
    waitingModelRequests: Schema.Number,
  }),
  counters: Schema.Struct({
    contextAdjustments: Schema.Number,
    throttledModelRequests: Schema.Number,
    rejectedModelRequests: Schema.Number,
  }),
  lastDecision: Schema.optionalKey(
    Schema.Struct({
      time: Schema.Number,
      providerID: Schema.String,
      modelID: Schema.String,
      requestedContext: Schema.Number,
      runtimeContext: Schema.optionalKey(Schema.Number),
      safeInputTokens: Schema.Number,
      reason: Schema.String,
    }),
  ),
}).annotate({ identifier: "ResourceGovernorSnapshot" })
export type ResourceGovernorSnapshot = typeof ResourceGovernorSnapshot.Type
export type PressureStatus = typeof PressureStatus.Type

export type MemorySample = ResourceGovernorSnapshot["memory"]
export type Policy = ResourceGovernorSnapshot["limits"]

type ModelPermit = {
  readonly governed: boolean
  readonly release: () => Promise<void>
}

type Waiter = {
  readonly resolve: (permit: ModelPermit) => void
  readonly reject: (error: Error) => void
  readonly signal?: AbortSignal
  readonly abort?: () => void
}

const policy = loadPolicy()
const state = {
  activeModelRequests: 0,
  waitingModelRequests: 0,
  contextAdjustments: 0,
  throttledModelRequests: 0,
  rejectedModelRequests: 0,
  lastDecision: undefined as ResourceGovernorSnapshot["lastDecision"],
  lastModelCrash: undefined as
    | {
        providerID: string
        apiURL?: string
        time: number
        cooldownUntil: number
        recoveryUntil: number
      }
    | undefined,
  waiters: [] as Waiter[],
}

export class ResourcePressureError extends Error {
  override readonly name = "ResourcePressureError"

  constructor(readonly snapshot: ResourceGovernorSnapshot) {
    super(
      `Local Agent Runtime paused this request because available memory is critically low (${formatBytes(snapshot.memory.availableBytes)} free). Close memory-heavy apps or unload the local model, then try again.`,
    )
  }
}

export class LocalModelCooldownError extends Error {
  override readonly name = "LocalModelCooldownError"

  constructor(readonly retryAfterMs: number) {
    super(
      `Local Agent Runtime paused the local model after its process crashed. Wait ${Math.max(1, Math.ceil(retryAfterMs / 1_000))} seconds for the runtime to recover, then try again.`,
    )
  }
}

export function isLocalModelCrash(error: unknown) {
  const text = crashText(error).toLowerCase()
  return (
    text.includes("model has crashed") ||
    text.includes("model crashed") ||
    text.includes("model process crashed") ||
    text.includes("inference process crashed") ||
    (text.includes("exit code: null") && text.includes("model"))
  )
}

export function recordModelFailure(input: {
  readonly providerID: string
  readonly apiURL?: string
  readonly error: unknown
}) {
  if (!localProvider(input) || !isLocalModelCrash(input.error)) return false
  const time = Date.now()
  state.lastModelCrash = {
    providerID: input.providerID,
    ...(input.apiURL ? { apiURL: input.apiURL } : {}),
    time,
    cooldownUntil: time + MODEL_CRASH_COOLDOWN_MS,
    recoveryUntil: time + MODEL_CRASH_RECOVERY_MS,
  }
  return true
}

export function snapshot(): ResourceGovernorSnapshot {
  const memory = sampleMemory()
  return {
    status: evaluateMemoryPressure(memory, policy),
    checkedAt: Date.now(),
    memory,
    limits: policy,
    activity: {
      activeModelRequests: state.activeModelRequests,
      waitingModelRequests: state.waitingModelRequests,
    },
    counters: {
      contextAdjustments: state.contextAdjustments,
      throttledModelRequests: state.throttledModelRequests,
      rejectedModelRequests: state.rejectedModelRequests,
    },
    ...(state.lastDecision ? { lastDecision: state.lastDecision } : {}),
  }
}

export async function contextBudget(input: {
  readonly providerID: string
  readonly modelID: string
  readonly requestedContext: number
  readonly outputTokens: number
  readonly apiURL?: string
  readonly baseURL?: unknown
  readonly apiKey?: unknown
}) {
  if (!localProvider(input)) return

  const current = snapshot()
  if (current.status === "critical") {
    state.rejectedModelRequests += 1
    throw new ResourcePressureError(snapshot())
  }
  const recovering = recoveryActive(input)
  const probe =
    input.providerID === "lmstudio"
      ? await probeLmStudio({ baseURL: input.baseURL, apiKey: input.apiKey, refresh: recovering })
      : undefined
  const model = findLmStudioModel(probe, input.modelID)
  const runtimeContext = model?.context.active
  const unloadedContext = Math.min(
    input.requestedContext,
    model?.context.supported ?? input.requestedContext,
    model ? MAX_UNLOADED_MODEL_CONTEXT : UNLOADED_MODEL_CONTEXT,
  )
  const decision = safeContextBudget({
    requestedContext: input.requestedContext,
    outputTokens: input.outputTokens,
    runtimeContext: runtimeContext ?? unloadedContext,
    status: current.status,
    contextPercent: recovering ? Math.min(policy.contextPercent, MODEL_CRASH_CONTEXT_PERCENT) : policy.contextPercent,
  })
  const reason = recovering
    ? "reduced context while the local model recovers from a process crash"
    : runtimeContext
      ? decision.hardContext < input.requestedContext
        ? "clamped to the context of the loaded LM Studio model"
        : "loaded model context with reserved output and safety headroom"
      : model
        ? "model is not loaded; conservative startup context applied"
        : "runtime context is unknown; conservative local context applied"

  state.contextAdjustments += 1
  state.lastDecision = {
    time: Date.now(),
    providerID: input.providerID,
    modelID: input.modelID,
    requestedContext: input.requestedContext,
    ...(runtimeContext ? { runtimeContext } : {}),
    safeInputTokens: decision.safeInputTokens,
    reason,
  }
  return decision
}

export async function acquireModel(input: {
  readonly providerID: string
  readonly apiURL?: string
  readonly signal?: AbortSignal
}): Promise<ModelPermit> {
  if (!localProvider(input)) return permit(false)
  if (input.signal?.aborted) throw new Error("Local model request was cancelled before resource admission")

  const cooldown = cooldownRemaining(input)
  if (cooldown > 0) {
    state.rejectedModelRequests += 1
    throw new LocalModelCooldownError(cooldown)
  }

  const current = snapshot()
  if (current.status === "critical") {
    state.rejectedModelRequests += 1
    throw new ResourcePressureError(snapshot())
  }
  if (state.activeModelRequests < policy.modelConcurrency) {
    state.activeModelRequests += 1
    return permit(true)
  }

  state.waitingModelRequests += 1
  state.throttledModelRequests += 1
  return await new Promise<ModelPermit>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      signal: input.signal,
      abort: input.signal
        ? () => {
            const index = state.waiters.indexOf(waiter)
            if (index === -1) return
            state.waiters.splice(index, 1)
            state.waitingModelRequests -= 1
            reject(new Error("Local model request was cancelled while waiting for resources"))
          }
        : undefined,
    }
    state.waiters.push(waiter)
    input.signal?.addEventListener("abort", waiter.abort!, { once: true })
  })
}

export function evaluateMemoryPressure(memory: MemorySample, limits: Policy = policy): PressureStatus {
  const availableRatio = memory.totalBytes ? (memory.availableBytes / memory.totalBytes) * 100 : 100
  const processRatio = memory.totalBytes ? (memory.processRssBytes / memory.totalBytes) * 100 : 0
  if (
    availableRatio <= limits.criticalAvailablePercent ||
    memory.availableBytes <= limits.criticalFreeBytes ||
    processRatio >= 40
  )
    return "critical"
  if (
    availableRatio <= limits.pressureAvailablePercent ||
    memory.availableBytes <= limits.minFreeBytes ||
    processRatio >= 25
  )
    return "pressured"
  return "healthy"
}

export function safeContextBudget(input: {
  readonly requestedContext: number
  readonly outputTokens: number
  readonly runtimeContext?: number
  readonly status: PressureStatus
  readonly contextPercent?: number
}) {
  const hardContext = Math.max(1, Math.min(input.requestedContext, input.runtimeContext ?? input.requestedContext))
  const percent = Math.min(
    input.contextPercent ?? DEFAULT_CONTEXT_PERCENT,
    input.status === "critical" ? 55 : input.status === "pressured" ? 75 : 100,
  )
  const reservedOutput = Math.min(Math.max(0, input.outputTokens), Math.floor(hardContext * 0.25))
  return {
    hardContext,
    safeInputTokens: Math.max(1, Math.floor(hardContext * (percent / 100)) - reservedOutput),
    percent,
  }
}

function permit(governed: boolean): ModelPermit {
  let released = false
  return {
    governed,
    release: async () => {
      if (released || !governed) return
      released = true
      state.activeModelRequests = Math.max(0, state.activeModelRequests - 1)
      drain()
    },
  }
}

function drain() {
  while (state.activeModelRequests < policy.modelConcurrency && state.waiters.length > 0) {
    const waiter = state.waiters.shift()!
    state.waitingModelRequests = Math.max(0, state.waitingModelRequests - 1)
    waiter.signal?.removeEventListener("abort", waiter.abort!)
    if (waiter.signal?.aborted) {
      waiter.reject(new Error("Local model request was cancelled while waiting for resources"))
      continue
    }
    if (snapshot().status === "critical") {
      state.rejectedModelRequests += 1
      waiter.reject(new ResourcePressureError(snapshot()))
      continue
    }
    state.activeModelRequests += 1
    waiter.resolve(permit(true))
  }
}

function localProvider(input: { readonly providerID: string; readonly apiURL?: string; readonly baseURL?: unknown }) {
  if (input.providerID === "lmstudio") return true
  return [input.apiURL, typeof input.baseURL === "string" ? input.baseURL : undefined].some((value) => {
    if (!value) return false
    try {
      const host = new URL(value).hostname
      return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1"
    } catch {
      return false
    }
  })
}

function recoveryActive(input: { readonly providerID: string; readonly apiURL?: string }) {
  const crash = state.lastModelCrash
  if (!crash || crash.recoveryUntil <= Date.now()) return false
  return crash.providerID === input.providerID || (!!input.apiURL && crash.apiURL === input.apiURL)
}

function cooldownRemaining(input: { readonly providerID: string; readonly apiURL?: string }) {
  if (!recoveryActive(input)) return 0
  return Math.max(0, (state.lastModelCrash?.cooldownUntil ?? 0) - Date.now())
}

function crashText(value: unknown, depth = 0): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return `${value.name} ${value.message} ${crashText(value.cause, depth + 1)}`
  if (!value || typeof value !== "object" || depth >= 4) return ""
  if (Array.isArray(value)) return value.map((item) => crashText(item, depth + 1)).join(" ")
  const record = value as Record<string, unknown>
  return ["name", "message", "responseBody", "error", "data", "cause"]
    .map((key) => crashText(record[key], depth + 1))
    .join(" ")
}

function sampleMemory(): MemorySample {
  const usage = process.memoryUsage()
  const totalBytes = os.totalmem()
  const availableBytes = os.freemem()
  return {
    totalBytes,
    availableBytes,
    availablePercent: totalBytes ? Math.round((availableBytes / totalBytes) * 1_000) / 10 : 100,
    processRssBytes: usage.rss,
    processHeapBytes: usage.heapUsed,
  }
}

function loadPolicy(): Policy {
  return {
    modelConcurrency: envInt("OPENCODE_LOCAL_AGENT_MAX_MODEL_CONCURRENCY", DEFAULT_MODEL_CONCURRENCY, 1, 4),
    contextPercent: envInt("OPENCODE_LOCAL_AGENT_CONTEXT_PERCENT", DEFAULT_CONTEXT_PERCENT, 50, 95),
    pressureAvailablePercent: envInt("OPENCODE_LOCAL_AGENT_PRESSURE_PERCENT", DEFAULT_PRESSURE_PERCENT, 5, 40),
    criticalAvailablePercent: envInt("OPENCODE_LOCAL_AGENT_CRITICAL_PERCENT", DEFAULT_CRITICAL_PERCENT, 2, 20),
    minFreeBytes:
      envInt("OPENCODE_LOCAL_AGENT_MIN_FREE_MB", DEFAULT_MIN_FREE_BYTES / 1024 ** 2, 512, 32_768) * 1024 ** 2,
    criticalFreeBytes:
      envInt("OPENCODE_LOCAL_AGENT_CRITICAL_FREE_MB", DEFAULT_CRITICAL_FREE_BYTES / 1024 ** 2, 256, 16_384) * 1024 ** 2,
  }
}

function envInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name])
  if (!Number.isSafeInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function formatBytes(value: number) {
  return `${Math.max(0, value / GIB).toFixed(1)} GB`
}
