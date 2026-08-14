export * as ModelSwitcher from "./model-switcher"

import { ModelCapabilityRouter } from "@opencode-ai/core/model-capability-router"
import { ModelV2 } from "@opencode-ai/core/model"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { Provider } from "@/provider/provider"
import { CapabilityRouter } from "./capability-router"
import {
  findLmStudioModel,
  loadLmStudioModel,
  probeLmStudio,
  unloadLmStudioModel,
  type LmStudioRequest,
} from "./lmstudio"
import { activeRequestsForModel, contextBudget, snapshot } from "./resource-governor"

const serial = new Map<string, Promise<unknown>>()
const managed = new Map<string, Set<string>>()
const active = new Map<string, { readonly modelID: string; readonly instanceID: string }>()

export type Result = {
  readonly model: Provider.Model
  readonly plan: ModelCapabilityRouter.Plan
  readonly telemetry?: {
    readonly capabilityProbeStartedAt: number
    readonly capabilityProbeCompletedAt: number
    readonly capabilityProbeMs: number
    readonly activationStartedAt: number
    readonly activationCompletedAt: number
    readonly modelActivationMs: number
    readonly probeCache: "hit" | "miss" | "bypass"
  }
}

export async function activate(input: {
  readonly config: ConfigV1.Info
  readonly preferredModel: Provider.Model
  readonly requestShape: ModelCapabilityRouter.RequestShape
  readonly role?: "utility" | "coding" | "vision"
  readonly request?: LmStudioRequest
  readonly signal?: AbortSignal
  readonly resources?: ReturnType<typeof snapshot>
  readonly vision?: ModelCapabilityRouter.Vision
  readonly contextLimit?: number
}): Promise<Result> {
  if (!CapabilityRouter.automaticRoutingEnabled(input.config)) return manual(input)
  const baseURL = input.config.provider?.lmstudio?.options?.baseURL
  if (typeof baseURL !== "string" || !URL.canParse(baseURL)) {
    const plan = await CapabilityRouter.route({
      config: input.config,
      preferredModelID: input.preferredModel.id,
      requestShape: input.requestShape,
      request: input.request,
      record: false,
    })
    return withVision(
      input.config,
      failed(
        input.config,
        plan,
        input.preferredModel,
        input.role ?? (input.requestShape.images > 0 ? "vision" : "coding"),
        ["switch.unconfigured"],
      ),
      input.vision,
    )
  }

  const key = baseURL.replace(/\/$/, "")
  const previous = serial.get(key) ?? Promise.resolve()
  const execution = previous.catch(() => undefined).then(() => activateNow({ ...input, baseURL: key }))
  const guarded = execution.finally(() => {
    if (serial.get(key) === guarded) serial.delete(key)
  })
  serial.set(key, guarded)
  return guarded.then((result) => withVision(input.config, result, input.vision))
}

async function manual(input: Parameters<typeof activate>[0]): Promise<Result> {
  const role = input.role ?? (input.requestShape.images > 0 ? "vision" : "coding")
  const baseURL = input.config.provider?.lmstudio?.options?.baseURL
  const probe = await probeLmStudio({
    baseURL,
    apiKey: input.config.provider?.lmstudio?.options?.apiKey,
    request: input.request,
  })
  const selected =
    findLmStudioModel(probe, input.preferredModel.api.id) ?? findLmStudioModel(probe, input.preferredModel.id)
  const requiresPrimary = role !== "utility"
  const reasons = [
    ...(!selected?.loaded ? ["manual.model_not_loaded"] : []),
    ...(requiresPrimary && selected?.loaded && selected.sizeBytes === undefined ? ["manual.primary_size_unknown"] : []),
    ...(requiresPrimary &&
    selected?.sizeBytes !== undefined &&
    selected.sizeBytes < CapabilityRouter.minimumPrimarySizeBytes(input.config)
      ? ["manual.primary_too_small"]
      : []),
    ...(input.requestShape.tools > 0 && !(selected?.capabilities.tools ?? input.preferredModel.capabilities.toolcall)
      ? ["manual.tools_unsupported"]
      : []),
    ...(role === "vision" && !(selected?.capabilities.vision ?? input.preferredModel.capabilities.input.image)
      ? ["manual.vision_unsupported"]
      : []),
  ]
  const compatible = reasons.length === 0
  const selection = {
    role,
    providerID: String(input.preferredModel.providerID),
    modelID: String(input.preferredModel.id),
    instanceID: selected?.instances[0] ?? input.preferredModel.api.id,
    name: selected?.name ?? input.preferredModel.name,
    score: 0,
    context: selected?.context.active ?? selected?.context.supported ?? input.preferredModel.limit.context,
    ...(selected?.sizeBytes ? { sizeBytes: selected.sizeBytes } : {}),
    capabilities: {
      tools: selected?.capabilities.tools ?? input.preferredModel.capabilities.toolcall,
      vision: selected?.capabilities.vision ?? input.preferredModel.capabilities.input.image,
      reasoning: selected?.capabilities.reasoning ?? input.preferredModel.capabilities.reasoning,
      embeddings: false,
    },
    reason: ["preference.explicit", "routing.disabled"],
  } satisfies ModelCapabilityRouter.Selection
  return {
    model: withContextLimit(input.preferredModel, input.contextLimit),
    plan: CapabilityRouter.record(input.config, {
      status: compatible ? "ready" : "unavailable",
      checkedAt: Date.now(),
      providerID: String(input.preferredModel.providerID),
      complexity: ModelCapabilityRouter.complexity(input.requestShape),
      pressure: input.resources?.status ?? snapshot().status,
      candidateCount: selected ? 1 : 0,
      selections: [selection],
      reason: ["routing.disabled", ...reasons],
      activation: {
        status: compatible ? "ready" : "failed",
        checkedAt: Date.now(),
        role,
        requestedModelID: String(input.preferredModel.id),
        activeModelID: String(input.preferredModel.id),
        ...(compatible ? { activeInstanceID: selection.instanceID } : {}),
        attempts: 0,
        failover: false,
        rollback: false,
        reason: ["routing.disabled", ...reasons],
      },
      ...(input.vision ? { vision: input.vision } : {}),
    }),
  }
}

export function completeVision(
  config: ConfigV1.Info,
  plan: ModelCapabilityRouter.Plan,
  input: { status: "completed" | "failed"; requestTokens: number; assistantMessageID: string },
) {
  if (!plan.vision) return plan
  return CapabilityRouter.record(config, {
    ...plan,
    vision: {
      ...plan.vision,
      status: input.status,
      checkedAt: Date.now(),
      requestTokens: input.requestTokens,
      assistantMessageID: input.assistantMessageID,
      reason: [...plan.vision.reason, input.status === "completed" ? "vision.completed" : "vision.failed"],
    },
  })
}

export function failureMessage(result: Result) {
  const activation = result.plan.activation
  const role = activation?.role ?? "coding"
  const selection = CapabilityRouter.selection(result.plan, role)
  const model = selection?.name ?? activation?.requestedModelID ?? String(result.model.id)
  const reasons = activation?.reason ?? []
  const providerError = reasons.find((reason) => reason.startsWith("switch.error:"))?.slice("switch.error:".length)
  const detail = providerError
    ? providerError
    : reasons.includes("switch.primary.memory")
      ? "the Resource Governor refused the launch because there is not enough free memory. Unload another LM Studio model or reduce its context, then retry"
      : reasons.includes("manual.primary_too_small")
        ? "automatic model routing is disabled and the selected model is below the configured minimum size for primary answers. Select a stronger loaded model or enable automatic routing"
        : reasons.includes("manual.primary_size_unknown")
          ? "automatic model routing is disabled and LM Studio did not report the selected model size required by the primary-model policy. Refresh LM Studio metadata or enable automatic routing"
          : reasons.includes("manual.model_not_loaded")
            ? "automatic model routing is disabled and the selected model is not loaded in LM Studio. Load it explicitly or select a loaded model"
            : reasons.includes("manual.tools_unsupported")
              ? "automatic model routing is disabled and the selected model does not support the tools required by this request. Select a tool-capable model or enable automatic routing"
              : reasons.includes("manual.vision_unsupported")
                ? "automatic model routing is disabled and the selected model cannot process images. Select a vision-capable model or enable automatic routing"
                : reasons.includes("switch.no_candidate")
                  ? `no allowed ${role === "vision" ? "vision-capable " : ""}LM Studio model satisfies the request capabilities`
                  : reasons.includes("switch.unconfigured")
                    ? "the LM Studio base URL is missing or invalid"
                    : result.plan.vision?.status === "failed"
                      ? "no allowed vision-capable LM Studio model is available"
                      : "LM Studio did not make the selected model ready"
  const preserved =
    activation?.status === "rolled_back" ? " The previously loaded model was preserved but not used." : ""
  return `LM Studio could not activate "${model}": ${detail}.${preserved} No fallback model was used.`
}

async function activateNow(
  input: Parameters<typeof activate>[0] & {
    readonly baseURL: string
  },
): Promise<Result> {
  if (input.signal?.aborted) throw input.signal.reason
  const provider = input.config.provider?.lmstudio
  const apiKey = provider?.options?.apiKey
  const capabilityProbeStartedAt = Date.now()
  let probeCache = "miss" as "hit" | "miss" | "bypass"
  const probe = await probeLmStudio({
    baseURL: input.baseURL,
    apiKey,
    request: input.request,
    onCache: (status) => {
      probeCache = status
    },
  })
  const capabilityProbeCompletedAt = Date.now()
  const activationStartedAt = capabilityProbeCompletedAt
  const complete = (result: Result): Result => {
    const activationCompletedAt = Date.now()
    return {
      ...result,
      telemetry: {
        capabilityProbeStartedAt,
        capabilityProbeCompletedAt,
        capabilityProbeMs: Math.max(0, capabilityProbeCompletedAt - capabilityProbeStartedAt),
        activationStartedAt,
        activationCompletedAt,
        modelActivationMs: Math.max(0, activationCompletedAt - activationStartedAt),
        probeCache,
      },
    }
  }
  const requested =
    findLmStudioModel(probe, input.preferredModel.api.id) ?? findLmStudioModel(probe, input.preferredModel.id)
  const requestedModelID = requested?.id ?? input.preferredModel.api.id
  // Some LM Studio versions expose only loaded instances from their model list.
  // Keep the model explicitly selected in the composer routable so OpenCode can
  // load it again instead of silently handing a coding turn to a utility model.
  const routingProbe = requested
    ? probe
    : {
        ...probe,
        models: [
          ...probe.models,
          {
            id: requestedModelID,
            name: input.preferredModel.name,
            type: "llm" as const,
            loaded: false,
            instances: [],
            context: { supported: input.preferredModel.limit.context },
            capabilities: {
              tools: input.preferredModel.capabilities.toolcall,
              vision: input.preferredModel.capabilities.input.image,
              reasoning: input.preferredModel.capabilities.reasoning,
              embeddings: false,
            },
          },
        ],
      }
  const plan = await CapabilityRouter.route({
    config: input.config,
    preferredModelID: requestedModelID,
    requestShape: input.requestShape,
    request: input.request,
    probe: routingProbe,
    allowUnloaded: true,
    pressure: input.resources?.status,
    record: false,
  })
  const role = input.role ?? (input.requestShape.images > 0 ? "vision" : "coding")
  const primary = CapabilityRouter.selection(plan, role)
  const selections = [primary]
    .filter((selection): selection is ModelCapabilityRouter.Selection => selection !== undefined)
    .filter((selection) => role !== "vision" || selection.capabilities.vision)
  if (selections.length === 0)
    return complete(failed(input.config, plan, input.preferredModel, role, ["switch.no_candidate"]))

  const activeModel = active.get(input.baseURL)
  const previous =
    (activeModel ? findLmStudioModel(probe, activeModel.instanceID) : undefined) ??
    findLmStudioModel(probe, input.preferredModel.api.id) ??
    findLmStudioModel(probe, input.preferredModel.id)
  const previousInstanceID =
    (activeModel && previous?.instances.includes(activeModel.instanceID) ? activeModel.instanceID : undefined) ??
    previous?.instances.find((instance) => instance === input.preferredModel.api.id) ??
    previous?.instances[0]
  const reasons: string[] = []

  for (const selection of selections) {
    if (input.signal?.aborted) throw input.signal.reason
    const before = findLmStudioModel(probe, selection.modelID)
    const loadedInstanceID = selection.instanceID ?? before?.instances[0]
    if (loadedInstanceID) {
      const result = routed(
        input.preferredModel,
        selection,
        loadedInstanceID,
        before?.context.active,
        input.contextLimit,
      )
      const cleanup =
        role === "utility"
          ? ["switch.previous.preserved"]
          : await unloadPrevious({
              baseURL: input.baseURL,
              apiKey,
              previousInstanceID,
              activeInstanceID: loadedInstanceID,
              request: input.request,
              signal: input.signal,
            })
      if (role !== "utility") active.set(input.baseURL, { modelID: selection.modelID, instanceID: loadedInstanceID })
      return complete(success(input.config, plan, result, role, selection, previous, previousInstanceID, cleanup))
    }

    const resources = input.resources ?? snapshot()
    if (
      resources.status === "critical" ||
      (selection.sizeBytes !== undefined &&
        selection.sizeBytes > Math.max(0, resources.memory.availableBytes - resources.limits.minFreeBytes))
    ) {
      reasons.push("switch.primary.memory")
      continue
    }

    let loaded: Awaited<ReturnType<typeof loadLmStudioModel>> | undefined
    try {
      const preserveContext =
        input.contextLimit === undefined &&
        input.config.provider?.lmstudio?.models?.[selection.modelID]?.preserve_context === true
      const budget = preserveContext
        ? undefined
        : await contextBudget({
            providerID: "lmstudio",
            modelID: selection.modelID,
            requestedContext: input.contextLimit ?? selection.context ?? input.preferredModel.limit.context,
            outputTokens: input.preferredModel.limit.output,
            baseURL: input.baseURL,
            apiKey,
            request: input.request,
          })
      loaded = await loadLmStudioModel({
        baseURL: input.baseURL,
        apiKey,
        modelID: selection.modelID,
        contextLength: budget?.hardContext,
        request: input.request,
        signal: input.signal,
      })
      managedInstances(input.baseURL).add(loaded.instanceID)
      const verifiedProbe = await probeLmStudio({
        baseURL: input.baseURL,
        apiKey,
        request: input.request,
        refresh: true,
      })
      const verified = findLmStudioModel(verifiedProbe, loaded.instanceID)
      if (!verified?.loaded || !verified.instances.includes(loaded.instanceID))
        throw new Error("LM Studio did not report the new instance as ready")
      const result = routed(
        input.preferredModel,
        selection,
        loaded.instanceID,
        verified.context.active ?? loaded.contextLength,
        input.contextLimit,
      )
      const cleanup =
        role === "utility"
          ? ["switch.previous.preserved", ...(preserveContext ? ["switch.context.preserved"] : [])]
          : await unloadPrevious({
              baseURL: input.baseURL,
              apiKey,
              previousInstanceID,
              activeInstanceID: loaded.instanceID,
              request: input.request,
              signal: input.signal,
            }).then((reason) => [...reason, ...(preserveContext ? ["switch.context.preserved"] : [])])
      if (role !== "utility") active.set(input.baseURL, { modelID: selection.modelID, instanceID: loaded.instanceID })
      return complete(success(input.config, plan, result, role, selection, previous, previousInstanceID, cleanup))
    } catch (error) {
      reasons.push("switch.primary.failed")
      reasons.push(`switch.error:${errorMessage(error)}`)
      if (loaded) {
        await unloadLmStudioModel({
          baseURL: input.baseURL,
          apiKey,
          instanceID: loaded.instanceID,
          request: input.request,
          signal: input.signal,
        }).catch(() => undefined)
        managedInstances(input.baseURL).delete(loaded.instanceID)
      }
    }
  }

  return complete(
    failed(input.config, plan, input.preferredModel, role, reasons, previous, previousInstanceID, selections.length),
  )
}

function success(
  config: ConfigV1.Info,
  plan: ModelCapabilityRouter.Plan,
  model: Provider.Model,
  role: ModelCapabilityRouter.Role,
  selection: ModelCapabilityRouter.Selection,
  previous: ReturnType<typeof findLmStudioModel>,
  previousInstanceID: string | undefined,
  cleanup: string[],
): Result {
  const routedPlan = {
    ...plan,
    activation: {
      status: selection.modelID === previous?.id && model.api.id === previousInstanceID ? "ready" : "switched",
      checkedAt: Date.now(),
      role,
      requestedModelID: selection.modelID,
      activeModelID: selection.modelID,
      activeInstanceID: model.api.id,
      ...(previous ? { previousModelID: previous.id } : {}),
      ...(previousInstanceID ? { previousInstanceID } : {}),
      attempts: 1,
      failover: false,
      rollback: false,
      reason: ["switch.ready", ...cleanup],
    },
  } satisfies ModelCapabilityRouter.Plan
  return {
    model,
    plan: role === "utility" ? routedPlan : CapabilityRouter.record(config, routedPlan),
  }
}

function failed(
  config: ConfigV1.Info,
  plan: ModelCapabilityRouter.Plan,
  preferredModel: Provider.Model,
  role: ModelCapabilityRouter.Role,
  reason: string[],
  previous?: ReturnType<typeof findLmStudioModel>,
  previousInstanceID?: string,
  attempts = 0,
): Result {
  const routedPlan = {
    ...plan,
    activation: {
      status: previousInstanceID ? "rolled_back" : "failed",
      checkedAt: Date.now(),
      role,
      requestedModelID: CapabilityRouter.selection(plan, role)?.modelID ?? preferredModel.api.id,
      activeModelID: previous?.id ?? preferredModel.api.id,
      ...(previousInstanceID ? { activeInstanceID: previousInstanceID } : {}),
      ...(previous ? { previousModelID: previous.id } : {}),
      ...(previousInstanceID ? { previousInstanceID } : {}),
      attempts,
      failover: false,
      rollback: previousInstanceID !== undefined,
      reason,
    },
  } satisfies ModelCapabilityRouter.Plan
  return {
    model: preferredModel,
    plan: role === "utility" ? routedPlan : CapabilityRouter.record(config, routedPlan),
  }
}

function routed(
  preferred: Provider.Model,
  selection: ModelCapabilityRouter.Selection,
  instanceID: string,
  context: number | undefined,
  contextLimit?: number,
): Provider.Model {
  const available = Math.max(1, context ?? selection.context ?? preferred.limit.context)
  const limit = Math.min(available, Math.max(1, contextLimit ?? available))
  return {
    ...preferred,
    id: ModelV2.ID.make(selection.modelID),
    api: { ...preferred.api, id: instanceID },
    name: selection.name,
    capabilities: {
      ...preferred.capabilities,
      reasoning: selection.capabilities.reasoning,
      attachment: selection.capabilities.vision,
      toolcall: selection.capabilities.tools,
      input: { ...preferred.capabilities.input, image: selection.capabilities.vision },
    },
    limit: {
      ...preferred.limit,
      context: limit,
      input: preferred.limit.input ? Math.min(preferred.limit.input, limit) : undefined,
      output: Math.min(preferred.limit.output, Math.max(1, Math.floor(limit / 4))),
    },
  }
}

export function withContextLimit(model: Provider.Model, contextLimit: number | undefined): Provider.Model {
  if (contextLimit === undefined || contextLimit >= model.limit.context) return model
  const context = Math.max(1, contextLimit)
  return {
    ...model,
    limit: {
      ...model.limit,
      context,
      input: model.limit.input ? Math.min(model.limit.input, context) : undefined,
      output: Math.min(model.limit.output, Math.max(1, Math.floor(context / 4))),
    },
  }
}

async function unloadPrevious(input: {
  readonly baseURL: string
  readonly apiKey: unknown
  readonly previousInstanceID?: string
  readonly activeInstanceID: string
  readonly request?: LmStudioRequest
  readonly signal?: AbortSignal
}) {
  if (!input.previousInstanceID || input.previousInstanceID === input.activeInstanceID) return []
  if (!managedInstances(input.baseURL).has(input.previousInstanceID)) return ["switch.previous.external"]
  if (
    activeRequestsForModel({
      providerID: "lmstudio",
      apiURL: input.baseURL,
      modelID: input.previousInstanceID,
    }) > 0
  )
    return ["switch.previous.busy"]
  return unloadLmStudioModel({
    baseURL: input.baseURL,
    apiKey: input.apiKey,
    instanceID: input.previousInstanceID,
    request: input.request,
    signal: input.signal,
  })
    .then(() => {
      managedInstances(input.baseURL).delete(input.previousInstanceID!)
      return ["switch.previous.unloaded"]
    })
    .catch(() => ["switch.previous.cleanup_failed"])
}

function managedInstances(baseURL: string) {
  const key = baseURL.replace(/\/$/, "")
  const existing = managed.get(key)
  if (existing) return existing
  const created = new Set<string>()
  managed.set(key, created)
  return created
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, " ").slice(0, 180)
}

function withVision(config: ConfigV1.Info, result: Result, vision: ModelCapabilityRouter.Vision | undefined): Result {
  if (!vision) return result
  const ready = result.model.capabilities.input.image
  const activation = result.plan.activation
  const plan = CapabilityRouter.record(config, {
    ...result.plan,
    vision: {
      ...vision,
      status: ready ? "prepared" : "failed",
      checkedAt: Date.now(),
      modelID: String(result.model.id),
      instanceID: result.model.api.id,
      failover: activation?.failover ?? false,
      reason: [
        ...vision.reason,
        ready ? "vision.model.selected" : "vision.model.unavailable",
        ...(activation?.rollback ? ["vision.rollback"] : []),
      ],
    },
  })
  return { ...result, plan }
}
