import { isRecord } from "@/util/record"
import { Schema } from "effect"

type Request = (input: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>

const ProbeStatus = Schema.Literals(["unconfigured", "ready", "degraded", "offline", "unauthorized"])
const ModelType = Schema.Literals(["llm", "embedding", "unknown"])

export const LmStudioProbe = Schema.Struct({
  provider: Schema.Literal("lmstudio"),
  status: ProbeStatus,
  baseURL: Schema.String,
  checkedAt: Schema.Number,
  latencyMs: Schema.Number,
  api: Schema.Struct({
    native: Schema.Boolean,
    openai: Schema.Boolean,
    chatCompletions: Schema.Boolean,
    responses: Schema.Boolean,
    embeddings: Schema.Boolean,
  }),
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      type: ModelType,
      loaded: Schema.Boolean,
      instances: Schema.Array(Schema.String),
      context: Schema.Struct({
        active: Schema.optionalKey(Schema.Number),
        supported: Schema.optionalKey(Schema.Number),
      }),
      capabilities: Schema.Struct({
        tools: Schema.Boolean,
        vision: Schema.Boolean,
        reasoning: Schema.Boolean,
        embeddings: Schema.Boolean,
      }),
    }),
  ),
  error: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "LmStudioProbe" })
export type LmStudioProbe = typeof LmStudioProbe.Type
export type LmStudioModel = LmStudioProbe["models"][number]

const cache = new Map<string, { expires: number; value: Promise<LmStudioProbe> }>()

export function probeLmStudio(input: {
  baseURL: unknown
  apiKey: unknown
  request?: Request
  timeoutMs?: number
  cacheMs?: number
  refresh?: boolean
}) {
  const endpoints = endpointsFor(input.baseURL)
  if (!endpoints) return Promise.resolve(unconfigured())
  if (input.request || input.refresh) return executeProbe(endpoints, input)

  const key = `${endpoints.baseURL}\0${typeof input.apiKey === "string" ? input.apiKey : ""}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value

  const value = executeProbe(endpoints, input)
  cache.set(key, { expires: Date.now() + (input.cacheMs ?? 5_000), value })
  return value
}

export function findLmStudioModel(probe: LmStudioProbe | undefined, modelID: string) {
  return probe?.models.find((model) => model.id === modelID || model.instances.includes(modelID))
}

export function lmStudioContextLimits(probe: LmStudioProbe | undefined) {
  return Object.fromEntries(
    (probe?.models ?? []).flatMap((model) => {
      const limit = model.context.active ?? model.context.supported
      if (!limit) return []
      return [
        [model.id, limit] as const,
        ...model.instances.map((instance) => [instance, limit] as const),
      ]
    }),
  )
}

async function executeProbe(
  endpoints: NonNullable<ReturnType<typeof endpointsFor>>,
  input: { apiKey: unknown; request?: Request; timeoutMs?: number },
) {
  const started = Date.now()
  const headers = typeof input.apiKey === "string" ? { Authorization: `Bearer ${input.apiKey}` } : undefined
  const [native, openai] = await Promise.all([
    requestJSON(endpoints.native, headers, input.request, input.timeoutMs),
    requestJSON(endpoints.openai, headers, input.request, input.timeoutMs),
  ])
  const nativeModels = parseNativeModels(native.body)
  const known = new Set(nativeModels.flatMap((model) => [model.id, ...model.instances]))
  const models = [
    ...nativeModels,
    ...parseOpenAIModels(openai.body)
      .filter((id) => !known.has(id))
      .map((id) => ({
        id,
        name: id,
        type: "unknown" as const,
        loaded: false,
        instances: [],
        context: {},
        capabilities: { tools: false, vision: false, reasoning: false, embeddings: false },
      })),
  ]
  const available = native.ok || openai.ok
  const unauthorized = !available && [native.status, openai.status].some((status) => status === 401 || status === 403)
  const status = native.ok && openai.ok ? "ready" : available ? "degraded" : unauthorized ? "unauthorized" : "offline"

  return {
    provider: "lmstudio" as const,
    status,
    baseURL: endpoints.baseURL,
    checkedAt: Date.now(),
    latencyMs: Date.now() - started,
    api: {
      native: native.ok,
      openai: openai.ok,
      chatCompletions: openai.ok,
      responses: openai.ok,
      embeddings: openai.ok,
    },
    models,
    ...(!available ? { error: responseError(native, openai) } : {}),
  } satisfies LmStudioProbe
}

function requestJSON(url: URL, headers: HeadersInit | undefined, request: Request | undefined, timeoutMs = 1_000) {
  return (request ?? fetch)(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(async (response) => ({
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => undefined),
    }))
    .catch((error: unknown) => ({
      ok: false,
      status: undefined,
      body: undefined,
      error: error instanceof Error ? error.message : String(error),
    }))
}

function parseNativeModels(body: unknown): LmStudioModel[] {
  if (!isRecord(body) || !Array.isArray(body.models)) return []
  return body.models.flatMap((value) => {
    if (!isRecord(value) || typeof value.key !== "string") return []
    const loaded = Array.isArray(value.loaded_instances) ? value.loaded_instances.filter(isRecord) : []
    const active = loaded
      .flatMap((instance) => (isRecord(instance.config) ? [positiveInt(instance.config.context_length)] : []))
      .filter((limit): limit is number => limit !== undefined)
      .sort((a, b) => a - b)[0]
    const capabilities = isRecord(value.capabilities) ? value.capabilities : undefined
    const reasoning = capabilities && isRecord(capabilities.reasoning) ? capabilities.reasoning : undefined
    const type = value.type === "llm" || value.type === "embedding" ? value.type : "unknown"
    const supported = positiveInt(value.max_context_length)
    return [
      {
        id: value.key,
        name: typeof value.display_name === "string" ? value.display_name : value.key,
        type,
        loaded: loaded.length > 0,
        instances: loaded.flatMap((instance) => (typeof instance.id === "string" ? [instance.id] : [])),
        context: {
          ...(active ? { active } : {}),
          ...(supported ? { supported } : {}),
        },
        capabilities: {
          tools: capabilities?.trained_for_tool_use === true,
          vision: capabilities?.vision === true,
          reasoning: Array.isArray(reasoning?.allowed_options) && reasoning.allowed_options.length > 0,
          embeddings: type === "embedding",
        },
      },
    ]
  })
}

function parseOpenAIModels(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.data)) return []
  return body.data.flatMap((model) => (isRecord(model) && typeof model.id === "string" ? [model.id] : []))
}

function endpointsFor(baseURL: unknown) {
  if (typeof baseURL !== "string") return
  if (!URL.canParse(baseURL)) return
  return normalizeEndpoints(new URL(baseURL))
}

function normalizeEndpoints(input: URL) {
  const url = new URL(input)
  const path = url.pathname.replace(/\/$/, "").replace(/\/(?:api\/)?v1$/, "")
  url.pathname = path || "/"
  url.search = ""
  url.hash = ""
  const baseURL = url.toString().replace(/\/$/, "")
  const native = new URL(baseURL)
  native.pathname = `${path}/api/v1/models`.replace(/\/+/g, "/")
  const openai = new URL(baseURL)
  openai.pathname = `${path}/v1/models`.replace(/\/+/g, "/")
  return { baseURL, native, openai }
}

function unconfigured(): LmStudioProbe {
  return {
    provider: "lmstudio",
    status: "unconfigured",
    baseURL: "",
    checkedAt: Date.now(),
    latencyMs: 0,
    api: { native: false, openai: false, chatCompletions: false, responses: false, embeddings: false },
    models: [],
  }
}

function responseError(...responses: Array<{ status?: number; error?: string }>) {
  const status = responses.find((response) => response.status)?.status
  if (status) return `HTTP ${status}`
  return responses.find((response) => response.error)?.error ?? "LM Studio is unavailable"
}

function positiveInt(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return
  return value
}
