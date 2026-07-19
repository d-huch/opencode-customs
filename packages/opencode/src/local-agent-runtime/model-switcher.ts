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
}): Promise<Result> {
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

async function activateNow(
  input: Parameters<typeof activate>[0] & {
    readonly baseURL: string
  },
): Promise<Result> {
  if (input.signal?.aborted) throw input.signal.reason
  const provider = input.config.provider?.lmstudio
  const apiKey = provider?.options?.apiKey
  const probe = await probeLmStudio({
    baseURL: input.baseURL,
    apiKey,
    request: input.request,
    refresh: true,
  })
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
  if (selections.length === 0) return failed(input.config, plan, input.preferredModel, role, ["switch.no_candidate"])

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
      const result = routed(input.preferredModel, selection, loadedInstanceID, before?.context.active)
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
      return success(input.config, plan, result, role, selection, previous, previousInstanceID, cleanup)
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
      const budget = await contextBudget({
        providerID: "lmstudio",
        modelID: selection.modelID,
        requestedContext: selection.context ?? input.preferredModel.limit.context,
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
      )
      const cleanup =
        role === "utility"
          ? ["switch.previous.preserved"]
          : await unloadPrevious({
              baseURL: input.baseURL,
              apiKey,
              previousInstanceID,
              activeInstanceID: loaded.instanceID,
              request: input.request,
              signal: input.signal,
            })
      if (role !== "utility") active.set(input.baseURL, { modelID: selection.modelID, instanceID: loaded.instanceID })
      return success(input.config, plan, result, role, selection, previous, previousInstanceID, cleanup)
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

  return failed(
    input.config,
    plan,
    input.preferredModel,
    role,
    reasons,
    previous,
    previousInstanceID,
    selections.length,
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
): Provider.Model {
  const limit = Math.max(1, context ?? selection.context ?? preferred.limit.context)
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
