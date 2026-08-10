export * as SessionLog from "./session-log"

import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import path from "path"
import type { Preview } from "@/session/context-compiler"

const MAX_STRING_LENGTH = 32 * 1024
const MAX_ARRAY_LENGTH = 100
const MAX_DEPTH = 6
const MAX_INSPECTION_EVENTS = 200
const pending = new Map<string, Promise<void>>()

export type LatencyPhase =
  | "admission"
  | "classifier"
  | "rag"
  | "memory"
  | "capability_probe"
  | "model_activation"
  | "context_compilation"
  | "prompt_processing"
  | "generation"
  | "tool_execution"
  | "verification"
  | "background_bookkeeping"

export type PipelineState = {
  readonly phase:
    | "prompt_admission"
    | "classification"
    | "repository_recall"
    | "memory_recall"
    | "model_readiness"
    | "context_compilation"
    | "execution"
    | "verification"
    | "critic_review"
    | "memory_admission"
    | "completion"
  readonly status: "pending" | "running" | "completed" | "skipped" | "timed_out" | "cancelled" | "failed"
  readonly startedAt?: number
  readonly completedAt?: number
  readonly detail?: string
}

export type Event = {
  readonly sessionID: string
  readonly type: string
  readonly messageID?: string
  readonly executionID?: string
  readonly data?: unknown
}

export type InspectionEvent = {
  readonly timestamp: string
  readonly type: string
  readonly stage: "prompt" | "classify" | "recall" | "model" | "tool" | "compaction" | "recovery" | "error"
  readonly status: "info" | "error"
  readonly messageID?: string
  readonly executionID?: string
  readonly detail?: string
}

export type Inspection = {
  readonly path: string
  readonly exists: boolean
  readonly requestMessageID?: string
  readonly startedAt?: string
  readonly completedAt?: string
  readonly durationMs?: number
  readonly events: readonly InspectionEvent[]
  readonly stats: {
    readonly events: number
    readonly modelRequests: number
    readonly toolCalls: number
    readonly toolErrors: number
    readonly compactions: number
    readonly errors: number
  }
  readonly latency: {
    readonly phases: readonly {
      readonly phase: LatencyPhase
      readonly status: "pending" | "running" | "completed" | "skipped" | "timed_out" | "cancelled" | "failed"
      readonly startedAt?: string
      readonly completedAt?: string
      readonly durationMs?: number
      readonly blocking: boolean
      readonly cache: "hit" | "miss" | "bypass" | "unknown"
      readonly detail?: string
    }[]
    readonly criticalPathMs: number
    readonly backgroundMs: number
    readonly parallelSavingsMs: number
    readonly potentialSavingsMs: number
    readonly blocker?: {
      readonly phase: LatencyPhase
      readonly durationMs: number
      readonly detail?: string
    }
    readonly parallel: readonly {
      readonly phases: readonly LatencyPhase[]
      readonly overlapMs: number
    }[]
    readonly model?: {
      readonly providerID?: string
      readonly modelID?: string
      readonly instanceID?: string
      readonly context?: number
      readonly reasoningEffort?: string
    }
    readonly providerCache: "hit" | "miss" | "unknown"
    readonly promptCache: {
      readonly readTokens: number
      readonly writeTokens: number
      readonly inputTokens: number
      readonly promptTokens: number
      readonly reusePercent: number
      readonly prefixHash?: string
      readonly prefixPreserved?: boolean
      readonly compactionPreserved?: boolean
    }
  }
  readonly context?: Preview
}

type LatencyMetric = {
  readonly phase: LatencyPhase
  readonly status: PipelineState["status"]
  readonly startedAt?: number
  readonly completedAt?: number
  readonly durationMs?: number
  readonly blocking: boolean
  readonly cache: "hit" | "miss" | "bypass" | "unknown"
  readonly detail?: string
}

export function write(event: Event) {
  const file = filepath(event.sessionID)
  const previous = pending.get(file) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(directory(), { recursive: true })
      await fs.appendFile(
        file,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionID: event.sessionID,
          type: event.type,
          ...(event.messageID ? { messageID: event.messageID } : {}),
          ...(event.executionID ? { executionID: event.executionID } : {}),
          ...(event.data === undefined ? {} : { data: normalize(event.data) }),
        })}\n`,
        "utf8",
      )
    })
    .catch(() => undefined)
    .finally(() => {
      if (pending.get(file) === next) pending.delete(file)
    })
  pending.set(file, next)
  return next
}

export async function clear() {
  await Promise.allSettled(pending.values())
  await fs.rm(directory(), { recursive: true, force: true })
  await fs.mkdir(directory(), { recursive: true })
}

export function filepath(sessionID: string) {
  return path.join(directory(), `${safeName(sessionID)}.jsonl`)
}

export async function location(sessionID: string) {
  const value = filepath(sessionID)
  const exists = await fs.stat(value).then(
    () => true,
    () => false,
  )
  return { path: value, exists }
}

export async function inspect(
  sessionID: string,
  checkpoint?: {
    readonly executionID?: string
    readonly requestMessageID?: string | null
    readonly pipeline?: readonly PipelineState[]
    readonly providerID?: string | null
    readonly modelID?: string | null
    readonly instanceID?: string | null
  },
) {
  const file = filepath(sessionID)
  await pending.get(file)?.catch(() => undefined)
  const content = await fs.readFile(file, "utf8").catch(() => undefined)
  if (content === undefined) return summarize("", file, checkpoint)
  return summarize(content, file, checkpoint)
}

export function summarize(
  content: string,
  file: string,
  checkpoint?: {
    readonly executionID?: string
    readonly requestMessageID?: string | null
    readonly pipeline?: readonly PipelineState[]
    readonly providerID?: string | null
    readonly modelID?: string | null
    readonly instanceID?: string | null
  },
): Inspection {
  const records = content.split("\n").flatMap((line) => {
    if (!line.trim()) return []
    const parsed = parse(line)
    if (!parsed || typeof parsed.timestamp !== "string" || typeof parsed.type !== "string") return []
    return [parsed]
  })
  const prompt = records.findLastIndex((record) => record.type === "prompt.received")
  const selected = records.slice(prompt < 0 ? Math.max(0, records.length - MAX_INSPECTION_EVENTS) : prompt)
  const events = selected.slice(-MAX_INSPECTION_EVENTS).map(inspectEvent)
  const terminal = selected.findLast((record) => {
    if (
      [
        "execution.finished",
        "execution.error",
        "execution.budget_exhausted",
        "model.error",
        "model.empty_response",
        "model.activation_failed",
      ].includes(String(record.type))
    )
      return true
    const data = object(record.data)
    return record.type === "pipeline.phase" && data?.phase === "completion" && data.status === "completed"
  })
  const startedAt = events[0]?.timestamp
  const completedAt = typeof terminal?.timestamp === "string" ? terminal.timestamp : undefined
  const duration =
    startedAt && completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : undefined
  const latency = summarizeLatency(selected, {
    startedAt,
    completedAt,
    pipeline:
      !checkpoint?.executionID ||
      selected.some((record) => record.executionID === checkpoint.executionID) ||
      checkpoint.requestMessageID === events.find((event) => event.type === "prompt.received")?.messageID
        ? checkpoint?.pipeline
        : undefined,
    providerID: checkpoint?.providerID ?? undefined,
    modelID: checkpoint?.modelID ?? undefined,
    instanceID: checkpoint?.instanceID ?? undefined,
    previousPrefixHash: prefixHash(records.slice(0, Math.max(0, prompt))),
  })
  return {
    path: file,
    exists: content.length > 0,
    requestMessageID: events.find((event) => event.type === "prompt.received")?.messageID,
    startedAt,
    completedAt,
    durationMs: Number.isFinite(duration) ? duration : undefined,
    events,
    stats: {
      events: events.length,
      modelRequests: events.filter((event) => event.type === "model.request").length,
      toolCalls: events.filter((event) => event.type === "tool.call").length,
      toolErrors: events.filter((event) => event.type === "tool.error" || event.type === "tool.blocked").length,
      compactions: events.filter((event) => event.type === "compaction.started").length,
      errors: events.filter((event) => event.status === "error").length,
    },
    latency,
    context: contextPreview(selected),
  }
}

export function directory() {
  return process.env.OPENCODE_SESSION_LOG_DIR ?? path.join(Global.Path.log, "sessions")
}

function parse(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
    return parsed as Record<string, unknown>
  } catch {
    return
  }
}

function inspectEvent(record: Record<string, unknown>): InspectionEvent {
  const type = String(record.type)
  return {
    timestamp: String(record.timestamp),
    type,
    stage: stage(type),
    status:
      type.endsWith(".error") ||
      type.endsWith(".failed") ||
      type.endsWith(".blocked") ||
      type.endsWith(".budget_exhausted")
        ? "error"
        : "info",
    messageID: typeof record.messageID === "string" ? record.messageID : undefined,
    executionID: typeof record.executionID === "string" ? record.executionID : undefined,
    detail: detail(type, record.data),
  }
}

function summarizeLatency(
  records: readonly Record<string, unknown>[],
  input: {
    readonly startedAt?: string
    readonly completedAt?: string
    readonly pipeline?: readonly PipelineState[]
    readonly providerID?: string
    readonly modelID?: string
    readonly instanceID?: string
    readonly previousPrefixHash?: string
  },
): Inspection["latency"] {
  const pipeline: LatencyMetric[] = (input.pipeline ?? []).flatMap((item) => {
    const phase = latencyPhase(item.phase)
    if (!phase || item.status === "pending") return []
    return [
      {
        phase,
        status: item.status,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        durationMs:
          item.startedAt !== undefined && item.completedAt !== undefined
            ? Math.max(0, item.completedAt - item.startedAt)
            : item.status === "skipped"
              ? 0
              : undefined,
        blocking: phase !== "background_bookkeeping",
        cache: cacheStatus(phase, item.detail),
        detail: item.detail,
      },
    ]
  })
  const phaseRecords = records.filter((record) => record.type === "pipeline.phase")
  const phaseEvents: LatencyMetric[] = [
    ...new Set(phaseRecords.flatMap((record) => [String(object(record.data)?.phase ?? "")])),
  ].flatMap((value): LatencyMetric[] => {
    const matching = phaseRecords.filter((record) => object(record.data)?.phase === value)
    const phase = latencyPhase(value)
    if (!phase) return []
    const admission =
      phase === "admission" ? timestamp(records.find((record) => record.type === "prompt.received")) : undefined
    const state = matching.reduce<{ startedAt?: number; metrics: LatencyMetric[] }>(
      (result, record) => {
        const data = object(record.data)
        const status = pipelineStatus(data?.status)
        if (!status || status === "pending") return result
        const eventAt = timestamp(record)
        if (status === "running")
          return {
            startedAt: result.startedAt ?? number(data?.startedAt) ?? eventAt ?? admission,
            metrics: result.metrics,
          }
        const startedAt = number(data?.startedAt) ?? result.startedAt ?? admission
        const completedAt = number(data?.completedAt) ?? eventAt
        const detail = typeof data?.detail === "string" ? data.detail : undefined
        return {
          startedAt: undefined,
          metrics: [
            ...result.metrics,
            {
              phase,
              status,
              startedAt,
              completedAt,
              durationMs:
                number(data?.durationMs) ??
                (startedAt !== undefined && completedAt !== undefined
                  ? Math.max(0, completedAt - startedAt)
                  : status === "skipped"
                    ? 0
                    : undefined),
              blocking: phase !== "background_bookkeeping",
              cache: cacheStatus(phase, detail),
              detail,
            } satisfies LatencyMetric,
          ],
        }
      },
      { startedAt: undefined as number | undefined, metrics: [] as LatencyMetric[] },
    )
    if (state.startedAt === undefined) return state.metrics
    const latest = object(matching.at(-1)?.data)
    const detail = typeof latest?.detail === "string" ? latest.detail : undefined
    return [
      ...state.metrics,
      {
        phase,
        status: "running",
        startedAt: state.startedAt,
        blocking: phase !== "background_bookkeeping",
        cache: cacheStatus(phase, detail),
        detail,
      } satisfies LatencyMetric,
    ]
  })
  const eventPhases = new Set(phaseEvents.map((item) => item.phase))
  const exactPipeline = [...pipeline.filter((item) => !eventPhases.has(item.phase)), ...phaseEvents]
  const modelTelemetry = records.findLast((record) => record.type === "model.telemetry")
  const telemetry = object(modelTelemetry?.data)
  const capabilityStartedAt = number(telemetry?.capabilityProbeStartedAt)
  const capabilityCompletedAt = number(telemetry?.capabilityProbeCompletedAt)
  const activationStartedAt = number(telemetry?.activationStartedAt)
  const activationCompletedAt = number(telemetry?.activationCompletedAt)
  const readiness = exactPipeline.find((item) => item.phase === "model_activation")
  const modelPhases = telemetry
    ? [
        metric({
          phase: "capability_probe",
          startedAt: capabilityStartedAt,
          completedAt: capabilityCompletedAt,
          durationMs: number(telemetry.capabilityProbeMs),
          cache:
            telemetry.probeCache === "hit" || telemetry.probeCache === "miss" || telemetry.probeCache === "bypass"
              ? telemetry.probeCache
              : "unknown",
          detail: "LM Studio capability probe",
        }),
        metric({
          phase: "model_activation",
          startedAt: activationStartedAt,
          completedAt: activationCompletedAt,
          durationMs: number(telemetry.modelActivationMs),
          cache: telemetry.activationStatus === "ready" ? "hit" : "miss",
          detail: typeof telemetry.activationStatus === "string" ? telemetry.activationStatus : readiness?.detail,
        }),
      ]
    : readiness
      ? [readiness]
      : []
  const pipelineWithoutReadiness = exactPipeline.filter((item) => item.phase !== "model_activation")
  const execution = modelIntervals(records)
  const tools = toolIntervals(records)
  const cacheEvents = records.flatMap((record) => {
    if (record.type !== "model.cache") return []
    const data = object(record.data)
    return data ? [data] : []
  })
  const providerTokens: Record<string, unknown>[] =
    cacheEvents.length > 0
      ? cacheEvents
      : records
          .filter((record) => record.type === "execution.finished")
          .map((record) => object(object(record.data)?.tokens))
          .map((tokens) => ({
            input: number(tokens?.input) ?? 0,
            read: number(object(tokens?.cache)?.read) ?? 0,
            write: number(object(tokens?.cache)?.write) ?? 0,
          }))
  const cacheRead = providerTokens.reduce((sum, tokens) => sum + (number(tokens?.read) ?? 0), 0)
  const cacheWrite = providerTokens.reduce((sum, tokens) => sum + (number(tokens?.write) ?? 0), 0)
  const cacheInput = providerTokens.reduce((sum, tokens) => sum + (number(tokens?.input) ?? 0), 0)
  const cachePrompt = providerTokens.reduce(
    (sum, tokens) =>
      sum +
      (number(tokens?.prompt) ??
        (number(tokens?.input) ?? 0) + (number(tokens?.read) ?? 0) + (number(tokens?.write) ?? 0)),
    0,
  )
  const cacheKnown = providerTokens.length > 0
  const contextHashes = records.flatMap((record) => {
    if (record.type !== "context.compiled") return []
    const hash = prefixHash([record])
    return hash ? [hash] : []
  })
  const currentPrefixHash = contextHashes.at(-1)
  const baselinePrefixHash = contextHashes.length > 1 ? contextHashes[0] : input.previousPrefixHash
  const prefixPreserved =
    currentPrefixHash && baselinePrefixHash ? currentPrefixHash === baselinePrefixHash : undefined
  const compacted = records.some((record) => record.type === "compaction.started")
  const rawPhases: LatencyMetric[] = [
    ...pipelineWithoutReadiness,
    ...modelPhases,
    ...execution,
    ...(tools.durationMs > 0
      ? [
          metric({
            phase: "tool_execution",
            startedAt: tools.startedAt,
            completedAt: tools.completedAt,
            durationMs: tools.durationMs,
            cache: "bypass",
            detail: `${tools.calls} tool call${tools.calls === 1 ? "" : "s"}`,
          }),
        ]
      : []),
  ]
  const phases = aggregatePhases(rawPhases).toSorted(
    (left, right) => (left.startedAt ?? Number.MAX_SAFE_INTEGER) - (right.startedAt ?? Number.MAX_SAFE_INTEGER),
  )
  const blocking = phases.filter((phase) => phase.blocking && phase.durationMs !== undefined)
  const blockingRaw = rawPhases.filter((phase) => phase.blocking && phase.durationMs !== undefined)
  const blocker = blocking.toSorted((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))[0]
  const parallelCandidates = rawPhases.filter(
    (phase) =>
      ["classifier", "rag", "memory", "capability_probe", "model_activation"].includes(phase.phase) &&
      phase.startedAt !== undefined &&
      phase.completedAt !== undefined,
  )
  const parallel = parallelOverlaps(parallelCandidates)
  const parallelDuration = parallelCandidates.reduce((sum, phase) => sum + (phase.durationMs ?? 0), 0)
  const cacheable = phases.filter(
    (phase) =>
      ["classifier", "rag", "memory", "capability_probe"].includes(phase.phase) &&
      phase.cache === "miss" &&
      phase.durationMs !== undefined,
  )
  return {
    phases: phases.map((phase) => ({
      phase: phase.phase,
      status: phase.status,
      ...(phase.startedAt !== undefined ? { startedAt: new Date(phase.startedAt).toISOString() } : {}),
      ...(phase.completedAt !== undefined ? { completedAt: new Date(phase.completedAt).toISOString() } : {}),
      ...(phase.durationMs !== undefined ? { durationMs: phase.durationMs } : {}),
      blocking: phase.blocking,
      cache: phase.cache,
      ...(phase.detail ? { detail: phase.detail } : {}),
    })),
    criticalPathMs: intervalDuration(blockingRaw),
    backgroundMs: rawPhases.filter((phase) => !phase.blocking).reduce((sum, phase) => sum + (phase.durationMs ?? 0), 0),
    parallelSavingsMs: Math.max(0, parallelDuration - intervalDuration(parallelCandidates)),
    potentialSavingsMs: cacheable.reduce((sum, phase) => sum + (phase.durationMs ?? 0), 0),
    ...(blocker?.durationMs !== undefined
      ? {
          blocker: {
            phase: blocker.phase,
            durationMs: blocker.durationMs,
            ...(blocker.detail ? { detail: blocker.detail } : {}),
          },
        }
      : {}),
    parallel,
    model: modelInfo(records, input),
    providerCache: cacheKnown ? (cacheRead > 0 ? "hit" : "miss") : "unknown",
    promptCache: {
      readTokens: cacheRead,
      writeTokens: cacheWrite,
      inputTokens: cacheInput,
      promptTokens: cachePrompt,
      reusePercent: cachePrompt ? Math.round((cacheRead / cachePrompt) * 1_000) / 10 : 0,
      ...(currentPrefixHash ? { prefixHash: currentPrefixHash } : {}),
      ...(prefixPreserved !== undefined ? { prefixPreserved } : {}),
      ...(compacted && prefixPreserved !== undefined ? { compactionPreserved: prefixPreserved } : {}),
    },
  }
}

function prefixHash(records: readonly Record<string, unknown>[]) {
  const preview = object(records.findLast((record) => record.type === "context.compiled")?.data)
  const cache = object(preview?.cache)
  return typeof cache?.prefixHash === "string" ? cache.prefixHash : undefined
}

function modelIntervals(records: readonly Record<string, unknown>[]) {
  const starts = records.filter((record) => record.type === "execution.started")
  const firstOutputs = records.filter((record) => record.type === "model.first_output")
  const finishes = records.filter((record) => record.type === "execution.finished" || record.type === "execution.error")
  const prompt: ReturnType<typeof metric>[] = []
  const generation: ReturnType<typeof metric>[] = []
  for (const start of starts) {
    const startedAt = timestamp(start)
    if (startedAt === undefined) continue
    const messageID = typeof start.messageID === "string" ? start.messageID : undefined
    const first = firstOutputs.find(
      (record) => timestamp(record)! >= startedAt && (!messageID || record.messageID === messageID),
    )
    const finish = finishes.find(
      (record) => timestamp(record)! >= startedAt && (!messageID || record.messageID === messageID),
    )
    const firstAt = timestamp(first)
    const completedAt = timestamp(finish)
    prompt.push(
      metric({
        phase: "prompt_processing",
        startedAt,
        completedAt: firstAt ?? completedAt,
        cache: "unknown",
        detail: firstAt === undefined ? "No model output observed" : "Time to first model output",
      }),
    )
    if (firstAt !== undefined)
      generation.push(
        metric({
          phase: "generation",
          startedAt: firstAt,
          completedAt,
          cache: "bypass",
          detail: "Model output stream",
        }),
      )
  }
  return [aggregate("prompt_processing", prompt), aggregate("generation", generation)].filter(
    (item): item is NonNullable<typeof item> => item !== undefined,
  )
}

function toolIntervals(records: readonly Record<string, unknown>[]) {
  const calls = records.filter((record) => record.type === "tool.call")
  const completed = records.filter((record) => record.type === "tool.result" || record.type === "tool.error")
  const intervals = calls.flatMap((call) => {
    const callID = object(call.data)?.callID
    const startedAt = timestamp(call)
    if (typeof callID !== "string" || startedAt === undefined) return []
    const end = completed.find((record) => object(record.data)?.callID === callID && timestamp(record)! >= startedAt)
    const completedAt = timestamp(end)
    if (completedAt === undefined) return []
    return [{ startedAt, completedAt, durationMs: Math.max(0, completedAt - startedAt) }]
  })
  return {
    calls: intervals.length,
    durationMs: intervals.reduce((sum, item) => sum + item.durationMs, 0),
    startedAt: intervals.length ? Math.min(...intervals.map((item) => item.startedAt)) : undefined,
    completedAt: intervals.length ? Math.max(...intervals.map((item) => item.completedAt)) : undefined,
  }
}

function modelInfo(
  records: readonly Record<string, unknown>[],
  input: { readonly providerID?: string; readonly modelID?: string; readonly instanceID?: string },
): Inspection["latency"]["model"] {
  const request = object(records.findLast((record) => record.type === "model.request")?.data)
  const routed = object(records.findLast((record) => record.type === "model.routed")?.data)
  const selected = object(routed?.selected)
  const providerID =
    (typeof request?.providerID === "string" ? request.providerID : undefined) ??
    (typeof selected?.providerID === "string" ? selected.providerID : undefined) ??
    input.providerID
  const modelID =
    (typeof request?.modelID === "string" ? request.modelID : undefined) ??
    (typeof selected?.modelID === "string" ? selected.modelID : undefined) ??
    input.modelID
  const instanceID =
    (typeof request?.instanceID === "string" ? request.instanceID : undefined) ??
    (typeof selected?.instanceID === "string" ? selected.instanceID : undefined) ??
    input.instanceID
  const context = number(request?.context) ?? number(routed?.context)
  const reasoningEffort =
    typeof request?.reasoningEffort === "string"
      ? request.reasoningEffort
      : typeof request?.variant === "string"
        ? request.variant
        : undefined
  if (!providerID && !modelID && !instanceID && context === undefined && !reasoningEffort) return
  return {
    ...(providerID ? { providerID } : {}),
    ...(modelID ? { modelID } : {}),
    ...(instanceID ? { instanceID } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

function metric(input: {
  readonly phase: LatencyPhase
  readonly startedAt?: number
  readonly completedAt?: number
  readonly durationMs?: number
  readonly cache: "hit" | "miss" | "bypass" | "unknown"
  readonly detail?: string
}) {
  return {
    phase: input.phase,
    status:
      input.completedAt === undefined && input.durationMs === undefined ? ("running" as const) : ("completed" as const),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs:
      input.durationMs ??
      (input.startedAt !== undefined && input.completedAt !== undefined
        ? Math.max(0, input.completedAt - input.startedAt)
        : undefined),
    blocking: input.phase !== "background_bookkeeping",
    cache: input.cache,
    detail: input.detail,
  }
}

function aggregate(phase: LatencyPhase, items: readonly LatencyMetric[]) {
  if (!items.length) return
  const started = items.flatMap((item) => (item.startedAt === undefined ? [] : [item.startedAt]))
  const completed = items.flatMap((item) => (item.completedAt === undefined ? [] : [item.completedAt]))
  return metric({
    phase,
    startedAt: started.length ? Math.min(...started) : undefined,
    completedAt: completed.length ? Math.max(...completed) : undefined,
    durationMs: items.reduce((sum, item) => sum + (item.durationMs ?? 0), 0),
    cache: "bypass",
    detail: items.length === 1 ? items[0]?.detail : `${items.length} provider turns`,
  })
}

function aggregatePhases(items: readonly LatencyMetric[]) {
  return [...new Set(items.map((item) => item.phase))].flatMap((phase) => {
    const matching = items.filter((item) => item.phase === phase)
    const latest = matching.at(-1)
    if (!latest) return []
    const combined = aggregate(phase, matching)
    if (!combined) return []
    const cache = matching.some((item) => item.cache === "miss")
      ? "miss"
      : matching.some((item) => item.cache === "hit")
        ? "hit"
        : matching.every((item) => item.cache === "bypass")
          ? "bypass"
          : "unknown"
    return [
      {
        ...combined,
        status:
          latest.status === "skipped"
            ? (matching.findLast((item) => item.status !== "skipped")?.status ?? latest.status)
            : latest.status,
        blocking: latest.blocking,
        cache,
        detail:
          matching.length === 1
            ? latest.detail
            : `${matching.length} intervals${latest.detail ? ` · ${latest.detail}` : ""}`,
      } satisfies LatencyMetric,
    ]
  })
}

function intervalDuration(items: readonly LatencyMetric[]) {
  const intervals = items
    .flatMap((item) =>
      item.startedAt !== undefined && item.completedAt !== undefined
        ? [{ startedAt: item.startedAt, completedAt: item.completedAt }]
        : [],
    )
    .toSorted((left, right) => left.startedAt - right.startedAt)
  if (!intervals.length) return items.reduce((sum, item) => sum + (item.durationMs ?? 0), 0)
  return intervals.reduce(
    (state, item) => {
      if (item.startedAt > state.completedAt)
        return {
          durationMs: state.durationMs + Math.max(0, item.completedAt - item.startedAt),
          completedAt: item.completedAt,
        }
      return {
        durationMs: state.durationMs + Math.max(0, item.completedAt - state.completedAt),
        completedAt: Math.max(state.completedAt, item.completedAt),
      }
    },
    {
      durationMs: Math.max(0, intervals[0]!.completedAt - intervals[0]!.startedAt),
      completedAt: intervals[0]!.completedAt,
    },
  ).durationMs
}

function parallelOverlaps(
  phases: readonly {
    readonly phase: LatencyPhase
    readonly startedAt?: number
    readonly completedAt?: number
  }[],
): Inspection["latency"]["parallel"] {
  return phases.flatMap((left, index) =>
    phases.slice(index + 1).flatMap((right) => {
      if (
        left.startedAt === undefined ||
        left.completedAt === undefined ||
        right.startedAt === undefined ||
        right.completedAt === undefined
      )
        return []
      const overlapMs = Math.max(
        0,
        Math.min(left.completedAt, right.completedAt) - Math.max(left.startedAt, right.startedAt),
      )
      if (!overlapMs) return []
      return [{ phases: [left.phase, right.phase], overlapMs }]
    }),
  )
}

function latencyPhase(value: string): LatencyPhase | undefined {
  return {
    prompt_admission: "admission",
    classification: "classifier",
    repository_recall: "rag",
    memory_recall: "memory",
    model_readiness: "model_activation",
    context_compilation: "context_compilation",
    verification: "verification",
    critic_review: "verification",
    memory_admission: "background_bookkeeping",
    completion: "background_bookkeeping",
  }[value] as LatencyPhase | undefined
}

function pipelineStatus(value: unknown): PipelineState["status"] | undefined {
  if (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "skipped" ||
    value === "timed_out" ||
    value === "cancelled" ||
    value === "failed"
  )
    return value
}

function cacheStatus(phase: LatencyPhase, detail: string | undefined) {
  if (phase === "background_bookkeeping" || phase === "context_compilation" || phase === "verification")
    return "bypass" as const
  if (!detail) return "unknown" as const
  if (/reused|cached/i.test(detail)) return "hit" as const
  if (/disabled|outside|no genuine|no repository|skipped/i.test(detail)) return "bypass" as const
  return "miss" as const
}

function timestamp(record: Record<string, unknown> | undefined) {
  if (!record || typeof record.timestamp !== "string") return
  const value = new Date(record.timestamp).getTime()
  return Number.isFinite(value) ? value : undefined
}

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stage(type: string): InspectionEvent["stage"] {
  if (type.startsWith("prompt.")) return "prompt"
  if (type === "context.compiled") return "prompt"
  if (type.startsWith("freshness.")) return "classify"
  if (type.startsWith("repository.") || type.startsWith("memory.")) return "recall"
  if (type.startsWith("verification.")) return "tool"
  if (type.startsWith("tool.")) return "tool"
  if (type.startsWith("compaction.")) return "compaction"
  if (type.startsWith("execution.recovered")) return "recovery"
  if (type.startsWith("execution.") && (type.endsWith(".error") || type.endsWith(".budget_exhausted"))) return "error"
  if (type.startsWith("model.") && (type.endsWith(".error") || type.endsWith(".failed"))) return "error"
  return "model"
}

function contextPreview(records: readonly Record<string, unknown>[]) {
  const value = object(records.findLast((record) => record.type === "context.compiled")?.data)
  if (
    value?.version !== 1 ||
    typeof value.tokens !== "number" ||
    typeof value.limit !== "number" ||
    !Array.isArray(value.fragments) ||
    !Array.isArray(value.tools)
  )
    return
  const cache = object(value.cache)
  return {
    ...value,
    cache:
      typeof cache?.prefixHash === "string" &&
      typeof cache.prefixTokens === "number" &&
      typeof cache.dynamicTokens === "number"
        ? cache
        : {
            prefixHash: "legacy",
            prefixTokens: 0,
            dynamicTokens: value.tokens,
          },
  } as unknown as Preview
}

function detail(type: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const data = value as Record<string, unknown>
  const values =
    type === "prompt.received"
      ? [data.text]
      : type === "model.cache"
        ? [data.read, data.write, data.reusePercent]
        : type === "freshness.routed"
        ? [data.scope, data.reason]
        : type === "repository.recalled"
          ? [
              data.cached === true ? "cached" : "retrieved",
              data.available === true ? "available" : "empty",
              data.characters,
            ]
          : type === "memory.recalled"
            ? [data.count]
            : type.startsWith("model.")
              ? [data.modelID, data.instanceID, errorText(data.error)]
              : type.startsWith("tool.")
                ? [data.tool, data.callID, data.reason, errorText(data.error)]
                : type.startsWith("compaction.")
                  ? [data.reason, data.result]
                  : type.startsWith("execution.")
                    ? [data.result, data.counter, errorText(data.error)]
                    : []
  const text = values
    .filter((item) => item !== undefined && item !== null && item !== "")
    .map(String)
    .join(" · ")
  if (!text) return
  return text.length <= 320 ? text : `${text.slice(0, 317)}...`
}

function errorText(value: unknown) {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const error = value as Record<string, unknown>
  return typeof error.message === "string" ? error.message : undefined
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9_.-]/gi, "_") || "unknown-session"
}

function normalize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value
    return `${value.slice(0, MAX_STRING_LENGTH)}\n[session log truncated ${value.length - MAX_STRING_LENGTH} characters]`
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "symbol" || typeof value === "function") return String(value)
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  if (depth >= MAX_DEPTH) return "[session log depth limit]"
  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[session log circular reference]"
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_LENGTH).map((item) => normalize(item, depth + 1, seen))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item, depth + 1, seen)]))
}
