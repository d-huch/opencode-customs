import { Schema } from "effect"
import { isRecord } from "@/util/record"

export type LlamaServerRequest = (input: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>

const ProbeStatus = Schema.Literals(["unconfigured", "loading", "ready", "degraded", "offline", "unauthorized"])
const ServerMode = Schema.Literals(["single", "router", "unknown"])
const ModelStatus = Schema.Literals(["loaded", "loading", "unloaded", "sleeping", "failed", "unknown"])

export const LlamaServerProbe = Schema.Struct({
  provider: Schema.Literal("llama-server"),
  status: ProbeStatus,
  serverMode: ServerMode,
  baseURL: Schema.String,
  checkedAt: Schema.Number,
  latencyMs: Schema.Number,
  api: Schema.Struct({
    health: Schema.Boolean,
    openai: Schema.Boolean,
    chatCompletions: Schema.Boolean,
    router: Schema.Boolean,
    props: Schema.Boolean,
  }),
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: ModelStatus,
      context: Schema.Struct({
        active: Schema.optionalKey(Schema.Number),
        supported: Schema.optionalKey(Schema.Number),
      }),
      sizeBytes: Schema.optionalKey(Schema.Number),
      parameters: Schema.optionalKey(Schema.Number),
      modalities: Schema.Struct({ input: Schema.Array(Schema.String), output: Schema.Array(Schema.String) }),
      capabilities: Schema.Struct({ tools: Schema.Boolean }),
    }),
  ),
  error: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "LlamaServerProbe" })
export type LlamaServerProbe = typeof LlamaServerProbe.Type
export type LlamaServerModel = LlamaServerProbe["models"][number]

export function probeLlamaServer(input: {
  baseURL: unknown
  apiKey: unknown
  request?: LlamaServerRequest
  timeoutMs?: number
}) {
  const endpoints = endpointsFor(input.baseURL)
  if (!endpoints) return Promise.resolve(unconfigured())
  return executeProbe(endpoints, input)
}

export function llamaServerContextLimits(probe: LlamaServerProbe | undefined) {
  return Object.fromEntries(
    (probe?.models ?? []).flatMap((model) => {
      const limit = model.context.active ?? model.context.supported
      return limit ? [[model.id, limit]] : []
    }),
  )
}

export function findLlamaServerModel(probe: LlamaServerProbe | undefined, modelID: string) {
  return probe?.models.find((model) => model.id === modelID)
}

async function executeProbe(
  endpoints: NonNullable<ReturnType<typeof endpointsFor>>,
  input: { apiKey: unknown; request?: LlamaServerRequest; timeoutMs?: number },
) {
  const started = Date.now()
  const headers =
    typeof input.apiKey === "string" && input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined
  const [rootHealth, v1Health, openai, router, props] = await Promise.all([
    requestJSON(endpoints.health, headers, input.request, input.timeoutMs),
    requestJSON(endpoints.v1Health, headers, input.request, input.timeoutMs),
    requestJSON(endpoints.models, headers, input.request, input.timeoutMs),
    requestJSON(endpoints.router, headers, input.request, input.timeoutMs),
    requestJSON(endpoints.props, headers, input.request, input.timeoutMs),
  ])
  const health = rootHealth.ok || v1Health.ok
  const openaiModels = parseOpenAIModels(openai.body)
  const routerModels = parseRouterModels(router.body)
  const propsModel = props.ok ? parseProps(props.body, openaiModels[0]?.id) : undefined
  const byID = new Map<string, LlamaServerModel>()
  for (const model of [...openaiModels, ...routerModels, ...(propsModel ? [propsModel] : [])]) {
    const previous = byID.get(model.id)
    byID.set(model.id, previous ? mergeModel(previous, model) : model)
  }
  const models = [...byID.values()]
  const available = health || openai.ok || router.ok || props.ok
  const protectedEndpoints = [openai, router, props]
  const unauthorized =
    !protectedEndpoints.some((item) => item.ok) &&
    protectedEndpoints.some((item) => item.status === 401 || item.status === 403)
  const loading =
    [rootHealth, v1Health].some((item) => item.status === 503) ||
    (models.some((model) => model.status === "loading") && !models.some((model) => model.status === "loaded"))
  const failed = models.some((model) => model.status === "failed")
  const status = unauthorized
    ? "unauthorized"
    : loading
      ? "loading"
      : !available
        ? "offline"
        : health && openai.ok && !failed
          ? "ready"
          : "degraded"
  return {
    provider: "llama-server" as const,
    status,
    serverMode: router.ok ? ("router" as const) : openai.ok ? ("single" as const) : ("unknown" as const),
    baseURL: endpoints.baseURL,
    checkedAt: Date.now(),
    latencyMs: Date.now() - started,
    api: {
      health,
      openai: openai.ok,
      chatCompletions: openai.ok,
      router: router.ok,
      props: props.ok,
    },
    models,
    ...(!available ? { error: boundedError(rootHealth, v1Health, openai, router, props) } : {}),
  } satisfies LlamaServerProbe
}

function endpointsFor(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return
  try {
    const configured = new URL(value.trim())
    const root = new URL(configured)
    root.pathname = root.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") || "/"
    root.search = ""
    root.hash = ""
    const endpoint = (pathname: string) => new URL(pathname, `${root.origin}${root.pathname.replace(/\/$/, "")}/`)
    return {
      baseURL: `${root.origin}${root.pathname.replace(/\/$/, "")}/v1`,
      health: endpoint("health"),
      v1Health: endpoint("v1/health"),
      models: endpoint("v1/models"),
      router: endpoint("models"),
      props: endpoint("props"),
    }
  } catch {
    return
  }
}

function requestJSON(
  url: URL,
  headers: HeadersInit | undefined,
  request: LlamaServerRequest | undefined,
  timeoutMs = 1_500,
) {
  return (request ?? fetch)(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
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

function parseOpenAIModels(body: unknown): LlamaServerModel[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return []
  return body.data.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== "string") return []
    return [model(value.id, value.id, "loaded")]
  })
}

function parseRouterModels(body: unknown): LlamaServerModel[] {
  const values = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : []
  return values.flatMap((value) => {
    if (!isRecord(value)) return []
    const id = string(value.id) ?? string(value.model) ?? string(value.name)
    if (!id) return []
    const statusValue = isRecord(value.status) ? value.status : undefined
    const status = statusValue?.failed === true ? "failed" : modelStatus(statusValue?.value ?? value.status)
    const architecture = isRecord(value.architecture) ? value.architecture : undefined
    return [
      {
        ...model(id, string(value.name) ?? id, status),
        context: {
          active: contextFromArgs(statusValue?.args),
          supported:
            positiveInt(architecture?.n_ctx_train) ??
            positiveInt(value.n_ctx_train) ??
            positiveInt(value.context_length),
        },
        sizeBytes: positiveInt(value.size) ?? positiveInt(value.size_bytes),
        parameters: positiveInt(architecture?.n_params) ?? positiveInt(value.n_params) ?? positiveInt(value.parameters),
        modalities: {
          input: strings(architecture?.input_modalities ?? architecture?.modalities ?? value.modalities, ["text"]),
          output: strings(architecture?.output_modalities, ["text"]),
        },
      },
    ]
  })
}

function parseProps(body: unknown, fallbackID?: string): LlamaServerModel | undefined {
  if (!isRecord(body)) return
  const id = fallbackID ?? string(body.model) ?? string(body.model_path)
  if (!id) return
  const defaults = isRecord(body.default_generation_settings) ? body.default_generation_settings : undefined
  const caps = isRecord(body.chat_template_caps) ? body.chat_template_caps : undefined
  return {
    ...model(id, id, body.is_sleeping === true ? "sleeping" : "loaded"),
    context: {
      active: positiveInt(defaults?.n_ctx) ?? positiveInt(body.n_ctx),
      supported: positiveInt(body.n_ctx_train),
    },
    modalities: {
      input:
        isRecord(body.modalities) && body.modalities.vision === true
          ? ["text", "image"]
          : strings(body.modalities, ["text"]),
      output: ["text"],
    },
    capabilities: {
      tools:
        caps?.supports_tool_calls === true ||
        caps?.supports_tools === true ||
        caps?.tool_calls === true ||
        caps?.tools === true,
    },
  }
}

function model(id: string, name: string, status: LlamaServerModel["status"]): LlamaServerModel {
  return {
    id,
    name,
    status,
    context: {},
    modalities: { input: ["text"], output: ["text"] },
    capabilities: { tools: false },
  }
}

function mergeModel(left: LlamaServerModel, right: LlamaServerModel): LlamaServerModel {
  return {
    ...left,
    ...right,
    status: right.status === "unknown" ? left.status : right.status,
    context: { ...left.context, ...right.context },
    modalities: {
      input: [...new Set([...left.modalities.input, ...right.modalities.input])],
      output: [...new Set([...left.modalities.output, ...right.modalities.output])],
    },
    capabilities: { tools: left.capabilities.tools || right.capabilities.tools },
  }
}

function modelStatus(value: unknown): LlamaServerModel["status"] {
  if (value === "downloading") return "loading"
  return value === "loaded" || value === "loading" || value === "unloaded" || value === "sleeping" || value === "failed"
    ? value
    : "unknown"
}

function contextFromArgs(value: unknown) {
  if (!Array.isArray(value)) return
  const args = value.filter((item): item is string => typeof item === "string")
  const index = args.findIndex((item) => item === "-c" || item === "--ctx-size" || item === "-ctx")
  return index === -1 ? undefined : positiveInt(Number(args[index + 1]))
}

function strings(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback
}

function string(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function positiveInt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function boundedError(...results: Array<{ error?: string; status?: number }>) {
  return (
    results.find((result) => result.error)?.error?.slice(0, 500) ??
    `llama-server did not expose a reachable probe endpoint (${results.flatMap((result) => result.status ?? []).join(", ") || "no response"})`
  )
}

function unconfigured(): LlamaServerProbe {
  return {
    provider: "llama-server",
    status: "unconfigured",
    serverMode: "unknown",
    baseURL: "",
    checkedAt: Date.now(),
    latencyMs: 0,
    api: { health: false, openai: false, chatCompletions: false, router: false, props: false },
    models: [],
  }
}
