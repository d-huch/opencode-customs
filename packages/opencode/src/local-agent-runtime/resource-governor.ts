import os from "os"
import { spawnSync } from "node:child_process"
import { ModelV2 } from "@opencode-ai/core/model"
import { Schema } from "effect"
import { findLmStudioModel, probeLmStudio } from "./lmstudio"

const GIB = 1024 ** 3
const DEFAULT_MODEL_CONCURRENCY = 1
const DEFAULT_CONTEXT_PERCENT = 90
const DEFAULT_PRESSURE_PERCENT = 12
const DEFAULT_CRITICAL_PERCENT = 6
const DEFAULT_MIN_FREE_BYTES = 2 * GIB
const DEFAULT_CRITICAL_FREE_BYTES = 1 * GIB
const UNLOADED_MODEL_CONTEXT = ModelV2.MIN_CONTEXT_LIMIT
const MAX_UNLOADED_MODEL_CONTEXT = 16_384
const MODEL_CRASH_COOLDOWN_MS = 10_000
const MODEL_CRASH_RECOVERY_MS = 2 * 60_000
const MODEL_CRASH_CONTEXT_PERCENT = 65
const MAC_MEMORY_SAMPLE_CACHE_MS = 1_000

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
  providerContext: Schema.optionalKey(
    Schema.Struct({
      time: Schema.Number,
      providerID: Schema.String,
      modelID: Schema.String,
      contextLimit: Schema.Number,
      providerTokens: Schema.Number,
      cachedTokens: Schema.Number,
      currentTokens: Schema.Number,
      remainingTokens: Schema.Number,
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

export type ModelRequestPriority = "interactive" | "background"

export function rejectForPressure(status: PressureStatus, priority: ModelRequestPriority) {
  return status === "critical" && priority === "background"
}

type Waiter = {
  readonly resolve: (permit: ModelPermit) => void
  readonly reject: (error: Error) => void
  readonly priority: ModelRequestPriority
  readonly model?: ModelIdentity
  readonly signal?: AbortSignal
  readonly abort?: () => void
}

type ModelIdentity = {
  readonly providerID: string
  readonly apiURL?: string
  readonly modelID: string
}

const policy = loadPolicy()
const macMemory = { expires: 0, availableBytes: undefined as number | undefined }
const state = {
  activeModelRequests: 0,
  waitingModelRequests: 0,
  contextAdjustments: 0,
  throttledModelRequests: 0,
  rejectedModelRequests: 0,
  lastDecision: undefined as ResourceGovernorSnapshot["lastDecision"],
  providerContext: undefined as ResourceGovernorSnapshot["providerContext"],
  activeModels: new Map<string, number>(),
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
      `Local Agent Runtime paused this request because available memory is critically low (${formatBytes(snapshot.memory.availableBytes)} available). Close memory-heavy apps or unload the local model, then try again.`,
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
    ...(state.providerContext ? { providerContext: state.providerContext } : {}),
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
  readonly request?: import("./lmstudio").LmStudioRequest
}) {
  if (!localProvider(input)) return

  const current = snapshot()
  const recovering = recoveryActive(input)
  const probe =
    input.providerID === "lmstudio"
      ? await probeLmStudio({
          baseURL: input.baseURL,
          apiKey: input.apiKey,
          request: input.request,
          refresh: recovering,
        })
      : undefined
  const model = findLmStudioModel(probe, input.modelID)
  const runtimeContext = model?.context.active
  const requestedContext = minimumManagedContext(input.requestedContext, model?.context.supported)
  const unloadedContext = Math.min(
    requestedContext,
    model?.context.supported ?? requestedContext,
    model ? MAX_UNLOADED_MODEL_CONTEXT : UNLOADED_MODEL_CONTEXT,
  )
  const decision = safeContextBudget({
    requestedContext,
    outputTokens: input.outputTokens,
    runtimeContext: runtimeContext ?? unloadedContext,
    status: current.status,
    contextPercent: recovering ? Math.min(policy.contextPercent, MODEL_CRASH_CONTEXT_PERCENT) : policy.contextPercent,
  })
  const reason = recovering
    ? "reduced context while the local model recovers from a process crash"
    : current.status === "critical"
      ? "critical host pressure; interactive request admitted with minimum context"
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

export function minimumManagedContext(requested: number, supported?: number) {
  return Math.max(requested, Math.min(ModelV2.MIN_CONTEXT_LIMIT, supported ?? ModelV2.MIN_CONTEXT_LIMIT))
}

export async function acquireModel(input: {
  readonly providerID: string
  readonly apiURL?: string
  readonly modelID?: string
  readonly priority?: ModelRequestPriority
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
  const priority = input.priority ?? "interactive"
  if (rejectForPressure(current.status, priority)) {
    state.rejectedModelRequests += 1
    throw new ResourcePressureError(snapshot())
  }
  if (state.activeModelRequests < policy.modelConcurrency) {
    state.activeModelRequests += 1
    return permit(true, identity(input))
  }

  state.waitingModelRequests += 1
  state.throttledModelRequests += 1
  return await new Promise<ModelPermit>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      priority,
      model: identity(input),
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

export function activeRequestsForModel(input: ModelIdentity) {
  return state.activeModels.get(modelKey(input)) ?? 0
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

export function providerContextBudget(input: {
  readonly contextLimit: number
  readonly providerTokens: number
  readonly cachedTokens: number
  readonly currentTokens: number
}) {
  const headroom = Math.max(1_024, Math.min(4_096, Math.floor(input.contextLimit * 0.1)))
  const usedTokens = input.providerTokens + input.currentTokens
  return {
    usedTokens,
    headroom,
    remainingTokens: Math.max(0, input.contextLimit - usedTokens - headroom),
    allowed: usedTokens + headroom < input.contextLimit,
  }
}

export function recordProviderContext(input: {
  readonly providerID: string
  readonly modelID: string
  readonly contextLimit: number
  readonly providerTokens: number
  readonly cachedTokens: number
  readonly currentTokens: number
  readonly reason: string
}) {
  const budget = providerContextBudget(input)
  state.providerContext = {
    time: Date.now(),
    providerID: input.providerID,
    modelID: input.modelID,
    contextLimit: input.contextLimit,
    providerTokens: input.providerTokens,
    cachedTokens: input.cachedTokens,
    currentTokens: input.currentTokens,
    remainingTokens: budget.remainingTokens,
    reason: input.reason,
  }
  return budget
}

function permit(governed: boolean, model?: ModelIdentity): ModelPermit {
  let released = false
  if (governed && model) state.activeModels.set(modelKey(model), (state.activeModels.get(modelKey(model)) ?? 0) + 1)
  return {
    governed,
    release: async () => {
      if (released || !governed) return
      released = true
      state.activeModelRequests = Math.max(0, state.activeModelRequests - 1)
      if (model) {
        const active = Math.max(0, (state.activeModels.get(modelKey(model)) ?? 1) - 1)
        if (active === 0) state.activeModels.delete(modelKey(model))
        if (active > 0) state.activeModels.set(modelKey(model), active)
      }
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
    if (rejectForPressure(snapshot().status, waiter.priority)) {
      state.rejectedModelRequests += 1
      waiter.reject(new ResourcePressureError(snapshot()))
      continue
    }
    state.activeModelRequests += 1
    waiter.resolve(permit(true, waiter.model))
  }
}

function identity(input: { readonly providerID: string; readonly apiURL?: string; readonly modelID?: string }) {
  if (!input.modelID) return
  return {
    providerID: input.providerID,
    ...(input.apiURL ? { apiURL: input.apiURL } : {}),
    modelID: input.modelID,
  } satisfies ModelIdentity
}

function modelKey(input: ModelIdentity) {
  return `${input.providerID}\0${input.apiURL?.replace(/\/$/, "") ?? ""}\0${input.modelID}`
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
  const availableBytes = availableMemory(totalBytes)
  return {
    totalBytes,
    availableBytes,
    availablePercent: totalBytes ? Math.round((availableBytes / totalBytes) * 1_000) / 10 : 100,
    processRssBytes: usage.rss,
    processHeapBytes: usage.heapUsed,
  }
}

function availableMemory(totalBytes: number) {
  const fallback = os.freemem()
  if (process.platform !== "darwin") return fallback
  if (macMemory.expires > Date.now() && macMemory.availableBytes !== undefined) return macMemory.availableBytes

  const result = spawnSync("/usr/bin/vm_stat", { encoding: "utf8" })
  const parsed = result.status === 0 ? parseMacAvailableMemory(result.stdout) : undefined
  const availableBytes = Math.min(totalBytes, Math.max(fallback, parsed ?? fallback))
  macMemory.expires = Date.now() + MAC_MEMORY_SAMPLE_CACHE_MS
  macMemory.availableBytes = availableBytes
  return availableBytes
}

export function parseMacAvailableMemory(input: string) {
  const pageSize = Number(input.match(/page size of (\d+) bytes/i)?.[1])
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) return
  const pages = Object.fromEntries(
    [...input.matchAll(/^(Pages free|File-backed pages):\s+(\d+)\./gim)].map((match) => [match[1], Number(match[2])]),
  )
  if (![pages["Pages free"], pages["File-backed pages"]].every(Number.isSafeInteger)) return
  // Activity Monitor exposes file-backed cache as reclaimable memory. Anonymous
  // inactive pages may still require compression or swap, so excluding them keeps
  // model admission conservative while avoiding os.freemem()'s false critical state.
  return (pages["Pages free"] + pages["File-backed pages"]) * pageSize
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
