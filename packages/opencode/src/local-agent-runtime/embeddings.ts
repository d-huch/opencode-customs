import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { RepositoryEmbeddings } from "@opencode-ai/core/repository-embeddings"
import { Effect } from "effect"
import { isRecord } from "@/util/record"
import { probeLmStudio } from "./lmstudio"
import { acquireModel, recordModelFailure } from "./resource-governor"
import { CapabilityRouter } from "./capability-router"

const MAX_BATCH = 16
const REQUEST_TIMEOUT = 15_000
type Request = (input: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>

export function lmStudioEmbeddingProvider(
  getConfig: () => Effect.Effect<ConfigV1.Info>,
  request: Request = fetch,
  admit: typeof acquireModel = acquireModel,
) {
  return {
    supports: (model) => model.id.startsWith("lmstudio:"),
    model: (preferred?: string) =>
      Effect.gen(function* () {
        if (preferred?.includes(":") && !preferred.startsWith("lmstudio:")) return undefined
        const preferredModel = preferred?.startsWith("lmstudio:") ? preferred.slice("lmstudio:".length) : preferred
        const config = yield* getConfig()
        const provider = config.provider?.lmstudio
        const baseURL = provider?.options?.baseURL
        const probe = yield* Effect.promise(() =>
          probeLmStudio({ baseURL, apiKey: provider?.options?.apiKey, request }),
        )
        const candidates = probe.models.filter(
          (model) =>
            model.type === "embedding" &&
            model.loaded &&
            (preferredModel !== undefined || CapabilityRouter.allowsAutomaticRoute(config, model.id)),
        )
        const plan = yield* Effect.promise(() =>
          CapabilityRouter.route({
            config,
            request,
            probe,
            requestShape: { textCharacters: 0, files: 0, images: 0, tools: 0 },
            record: false,
          }),
        )
        const routed = CapabilityRouter.selection(plan, "embedding")
        const selected = preferredModel
          ? candidates.find((model) => model.id === preferredModel || model.instances.includes(preferredModel))
          : (candidates.find((model) => model.id === routed?.modelID) ?? candidates[0])
        if (!selected) return undefined
        return {
          id: `lmstudio:${probe.baseURL}:${selected.id}`,
          name: selected.id,
        } satisfies RepositoryEmbeddings.Model
      }),
    embed: (input: { readonly model: RepositoryEmbeddings.Model; readonly texts: ReadonlyArray<string> }) =>
      Effect.gen(function* () {
        const config = yield* getConfig()
        const provider = config.provider?.lmstudio
        const baseURL = provider?.options?.baseURL
        if (typeof baseURL !== "string" || !URL.canParse(baseURL))
          return yield* Effect.fail(new Error("LM Studio is not configured"))
        const endpoint = embeddingEndpoint(baseURL)
        const headers = new Headers({ "content-type": "application/json" })
        if (typeof provider?.options?.apiKey === "string")
          headers.set("authorization", `Bearer ${provider.options.apiKey}`)
        const batches = Array.from({ length: Math.ceil(input.texts.length / MAX_BATCH) }, (_, index) =>
          input.texts.slice(index * MAX_BATCH, (index + 1) * MAX_BATCH),
        )
        return yield* Effect.forEach(
          batches,
          (texts) =>
            Effect.acquireUseRelease(
              Effect.promise(() =>
                admit({
                  providerID: "lmstudio",
                  apiURL: baseURL,
                  modelID: input.model.name ?? input.model.id,
                  priority: "background",
                }),
              ),
              () =>
                Effect.tryPromise({
                  try: async (signal) => {
                    const response = await request(endpoint, {
                      method: "POST",
                      headers,
                      body: JSON.stringify({ model: input.model.name ?? input.model.id, input: texts }),
                      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)]),
                    })
                    const body: unknown = await response.json().catch(() => undefined)
                    if (!response.ok) throw new Error(embeddingError(response.status, body))
                    const vectors = parseEmbeddings(body)
                    if (vectors.length !== texts.length)
                      throw new Error("LM Studio returned an invalid embedding batch")
                    return vectors
                  },
                  catch: (cause) => cause,
                }),
              (permit) => Effect.promise(() => permit.release()),
            ).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => recordModelFailure({ providerID: "lmstudio", apiURL: baseURL, error })),
              ),
            ),
          { concurrency: 1 },
        ).pipe(Effect.map((vectors) => vectors.flat()))
      }),
  } satisfies RepositoryEmbeddings.Provider
}

export function llamaServerEmbeddingProvider(getConfig: () => Effect.Effect<ConfigV1.Info>, request: Request = fetch) {
  return {
    supports: (model) => model.id.startsWith("llama-server:"),
    model: (preferred?: string) =>
      Effect.gen(function* () {
        if (!preferred?.startsWith("llama-server:")) return undefined
        const config = yield* getConfig()
        const provider = config.provider?.["llama-server"]
        const baseURL = provider?.options?.baseURL
        if (typeof baseURL !== "string" || !URL.canParse(baseURL)) return undefined
        const name = preferred.slice("llama-server:".length)
        if (!name) return undefined
        return { id: `llama-server:${baseURL}:${name}`, name } satisfies RepositoryEmbeddings.Model
      }),
    embed: (input: { readonly model: RepositoryEmbeddings.Model; readonly texts: ReadonlyArray<string> }) =>
      Effect.gen(function* () {
        const config = yield* getConfig()
        const provider = config.provider?.["llama-server"]
        const baseURL = provider?.options?.baseURL
        if (typeof baseURL !== "string" || !URL.canParse(baseURL)) return yield* Effect.fail(new Error("llama-server is not configured"))
        const headers = new Headers({ "content-type": "application/json" })
        if (typeof provider?.options?.apiKey === "string") headers.set("authorization", `Bearer ${provider.options.apiKey}`)
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await request(embeddingEndpoint(baseURL), {
              method: "POST",
              headers,
              body: JSON.stringify({ model: input.model.name ?? input.model.id, input: input.texts }),
              signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)]),
            })
            const body: unknown = await response.json().catch(() => undefined)
            if (!response.ok) throw new Error(embeddingError(response.status, body))
            const vectors = parseEmbeddings(body)
            if (vectors.length !== input.texts.length) throw new Error("llama-server returned an invalid embedding batch")
            return vectors
          },
          catch: (cause) => cause,
        })
      }),
  } satisfies RepositoryEmbeddings.Provider
}

function embeddingEndpoint(baseURL: string) {
  const url = new URL(baseURL)
  const pathname = url.pathname.replace(/\/$/, "")
  url.pathname = pathname.endsWith("/v1") ? `${pathname}/embeddings` : `${pathname}/v1/embeddings`
  url.search = ""
  url.hash = ""
  return url
}

function parseEmbeddings(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.data)) return []
  return body.data
    .flatMap((item) =>
      isRecord(item) && Array.isArray(item.embedding) && item.embedding.every((value) => typeof value === "number")
        ? [{ index: typeof item.index === "number" ? item.index : 0, vector: item.embedding }]
        : [],
    )
    .toSorted((left, right) => left.index - right.index)
    .map((item) => item.vector)
}

function embeddingError(status: number, body: unknown) {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string")
    return `LM Studio embedding request failed (${status}): ${body.error.message}`
  return `LM Studio embedding request failed (${status})`
}
