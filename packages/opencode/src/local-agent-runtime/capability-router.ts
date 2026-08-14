export * as CapabilityRouter from "./capability-router"

import { ModelCapabilityRouter } from "@opencode-ai/core/model-capability-router"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { probeLmStudio } from "./lmstudio"
import type { LmStudioProbe, LmStudioRequest } from "./lmstudio"
import { snapshot } from "./resource-governor"

const current = new Map<string, { policy: string; plan: ModelCapabilityRouter.Plan }>()
const DEFAULT_PRIMARY_MIN_SIZE_GB = 12

export function minimumPrimarySizeBytes(config: ConfigV1.Info) {
  return Math.max(0, config.provider?.lmstudio?.primary_min_size_gb ?? DEFAULT_PRIMARY_MIN_SIZE_GB) * 1024 ** 3
}

export async function route(input: {
  readonly config: ConfigV1.Info
  readonly requestShape: ModelCapabilityRouter.RequestShape
  readonly preferredModelID?: string
  readonly request?: LmStudioRequest
  readonly probe?: LmStudioProbe
  readonly refresh?: boolean
  readonly allowUnloaded?: boolean
  readonly pressure?: ModelCapabilityRouter.Pressure
  readonly record?: boolean
}) {
  const provider = input.config.provider?.lmstudio
  const probe =
    input.probe ??
    (await probeLmStudio({
      baseURL: provider?.options?.baseURL,
      apiKey: provider?.options?.apiKey,
      request: input.request,
      refresh: input.refresh,
    }))
  const plan = ModelCapabilityRouter.plan({
    providerID: "lmstudio",
    pressure: input.pressure ?? snapshot().status,
    complexity: ModelCapabilityRouter.complexity(input.requestShape),
    ...(input.preferredModelID ? { preferredModelID: input.preferredModelID } : {}),
    needsVision: input.requestShape.images > 0,
    needsTools: input.requestShape.tools > 0,
    allowUnloaded: input.allowUnloaded,
    minimumPrimarySizeBytes: minimumPrimarySizeBytes(input.config),
    disabledModelIDs: Object.entries(provider?.models ?? {}).flatMap(([modelID, model]) =>
      model.auto_route === false ? [modelID, ...(model.id ? [model.id] : [])] : [],
    ),
    candidates: probe.models.map((model) => ({
      providerID: "lmstudio",
      modelID: model.id,
      ...(model.instances[0] ? { instanceID: model.instances[0] } : {}),
      name: model.name,
      loaded: model.loaded,
      type: model.type,
      ...((model.context.active ?? model.context.supported)
        ? { context: model.context.active ?? model.context.supported }
        : {}),
      ...(model.sizeBytes ? { sizeBytes: model.sizeBytes } : {}),
      capabilities: model.capabilities,
    })),
  })
  const visible = withoutLegacyFallback(plan)
  if (input.record !== false)
    current.set(runtimeKey(input.config), { policy: routingPolicy(input.config), plan: visible })
  return visible
}

export function allowsAutomaticRoute(config: ConfigV1.Info, modelID: string) {
  const configured = Object.entries(config.provider?.lmstudio?.models ?? {}).find(
    ([id, model]) => id === modelID || model.id === modelID,
  )
  return configured?.[1].auto_route !== false
}

export function automaticRoutingEnabled(config: ConfigV1.Info) {
  return config.provider?.lmstudio?.auto_route !== false
}

export function latest(config: ConfigV1.Info) {
  const item = current.get(runtimeKey(config))
  if (!item || item.policy !== routingPolicy(config)) return undefined
  return withoutLegacyFallback(item.plan)
}

export function record(config: ConfigV1.Info, plan: ModelCapabilityRouter.Plan) {
  const visible = withoutLegacyFallback(plan)
  current.set(runtimeKey(config), { policy: routingPolicy(config), plan: visible })
  return visible
}

export function selection(plan: ModelCapabilityRouter.Plan, role: ModelCapabilityRouter.Role) {
  return plan.selections.find((item) => item.role === role)
}

function runtimeKey(config: ConfigV1.Info) {
  const baseURL = config.provider?.lmstudio?.options?.baseURL
  return typeof baseURL === "string" ? baseURL : "unconfigured"
}

function routingPolicy(config: ConfigV1.Info) {
  return [
    `global:${automaticRoutingEnabled(config)}`,
    `primary:${config.provider?.lmstudio?.primary_min_size_gb ?? DEFAULT_PRIMARY_MIN_SIZE_GB}`,
    ...Object.entries(config.provider?.lmstudio?.models ?? {})
      .filter(([, model]) => model.auto_route === false)
      .map(([modelID, model]) => `${modelID}:${model.id ?? ""}`)
      .toSorted(),
  ].join("|")
}

function withoutLegacyFallback(plan: ModelCapabilityRouter.Plan): ModelCapabilityRouter.Plan {
  const selections = plan.selections.filter((selection) => selection.role !== "fallback")
  const activation = plan.activation?.role === "fallback" ? undefined : plan.activation
  if (selections.length === plan.selections.length && activation === plan.activation) return plan
  return { ...plan, selections, ...(activation ? { activation } : { activation: undefined }) }
}
