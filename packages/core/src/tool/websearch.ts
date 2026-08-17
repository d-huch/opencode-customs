export * as WebSearchTool from "./websearch"

import { ToolFailure } from "@opencode-ai/llm"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { makeLocationNode } from "../effect/app-node"
import { LayerNodePlatform } from "../effect/app-node-platform"
import { truthy } from "../flag/flag"
import { InstallationVersion } from "../installation/version"
import { PositiveInt } from "../schema"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { collectBoundedResponseBody } from "./http-body"
import { checksum } from "../util/encode"
import { ToolRegistry } from "./registry"
import { ResearchBrowser } from "./research-browser"

export const name = "websearch"
export const NO_RESULTS = "No search results found. Please try a different query."
export const EXA_URL = "https://mcp.exa.ai/mcp"
export const PARALLEL_URL = "https://search.parallel.ai/mcp"
export const MAX_NUM_RESULTS = 20
export const MAX_CONTEXT_CHARACTERS = 50_000
export const MAX_RESPONSE_BYTES = 256 * 1024

export const description = `Search the web using the session's local web search provider. Use this for current information beyond knowledge cutoff.

Native Desktop uses an isolated local Research Browser first. It searches, reads relevant sources, and returns untrusted evidence with exact URLs. Exa or Parallel may be used once only when the user explicitly enabled external fallback. Remote and WSL servers retain their configured server-side provider.

Use fast for a quick current fact and deep for comparisons, recommendations, high-risk topics, disputed claims, and explicit source verification. Related queries, language, recency, source count, and maximum context characters are optional.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  queries: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional related queries for a deeper research pass (maximum 4 total queries)",
  }),
  language: Schema.optional(Schema.String).annotate({ description: "Preferred search language or locale" }),
  timeRange: Schema.optional(Schema.Literals(["day", "week", "month", "year"])).annotate({
    description: "Optional recency filter",
  }),
  maxSources: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(8))).annotate({
    description: "Maximum sources to read (default: 3 for fast search, 6 for deep research; maximum: 8)",
  }),
  numResults: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_NUM_RESULTS))).annotate({
    description: `Number of search results to return (default: 8, maximum: ${MAX_NUM_RESULTS})`,
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_CONTEXT_CHARACTERS))).annotate(
    {
      description: `Maximum evidence characters (default: 12000 for fast, 40000 for deep, maximum: ${MAX_CONTEXT_CHARACTERS})`,
    },
  ),
})

export const ExternalProvider = Schema.Literals(["exa", "parallel"])
export type ExternalProvider = typeof ExternalProvider.Type
export const Provider = Schema.Literals(["local-browser", "exa", "parallel"])
export type Provider = typeof Provider.Type

export interface Config {
  readonly provider?: ExternalProvider
  readonly enableExa: boolean
  readonly enableParallel: boolean
  readonly exaApiKey?: string
  readonly parallelApiKey?: string
}

export class ConfigService extends Context.Service<ConfigService, Config>()("@opencode/v2/WebSearchConfig") {}

/** Isolates the retained product environment contract from the generic tool implementation. */
export const defaultConfigLayer = Layer.sync(ConfigService, () =>
  ConfigService.of({
    provider:
      process.env.OPENCODE_WEBSEARCH_PROVIDER === "exa" || process.env.OPENCODE_WEBSEARCH_PROVIDER === "parallel"
        ? process.env.OPENCODE_WEBSEARCH_PROVIDER
        : undefined,
    enableExa: truthy("OPENCODE_EXPERIMENTAL") || truthy("OPENCODE_ENABLE_EXA") || truthy("OPENCODE_EXPERIMENTAL_EXA"),
    enableParallel: truthy("OPENCODE_ENABLE_PARALLEL") || truthy("OPENCODE_EXPERIMENTAL_PARALLEL"),
    exaApiKey: process.env.EXA_API_KEY,
    parallelApiKey: process.env.PARALLEL_API_KEY,
  }),
)

export const configNode = makeLocationNode({ service: ConfigService, layer: defaultConfigLayer, deps: [] })

export function selectProvider(
  sessionID: string,
  flags: Pick<Config, "enableExa" | "enableParallel"> = { enableExa: false, enableParallel: false },
  override?: ExternalProvider,
): ExternalProvider {
  if (override) return override
  if (flags.enableParallel) return "parallel"
  if (flags.enableExa) return "exa"
  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
  }),
})
const decodeMcpResult = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))

const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    return (yield* decodeMcpResult(trimmed)).result.content.find((item) => item.text)?.text
  })

export const parseResponse = Effect.fn("WebSearchTool.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* parsePayload(line.substring(6))
    if (data) return data
  }
  return undefined
})

const ExaArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})
const ParallelArgs = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.String,
})
const McpRequest = <F extends Schema.Struct.Fields>(args: Schema.Struct<F>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Literal(1),
    method: Schema.Literal("tools/call"),
    params: Schema.Struct({ name: Schema.String, arguments: args }),
  })

const exaUrl = (apiKey: string | undefined) => {
  if (!apiKey) return EXA_URL
  const url = new URL(EXA_URL)
  url.searchParams.set("exaApiKey", apiKey)
  return url.toString()
}

const callMcp = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  headers: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(McpRequest(args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    return yield* Effect.gen(function* () {
      const response = yield* HttpClient.filterStatusOk(http).execute(request)
      const body = yield* collectBoundedResponseBody(
        response,
        MAX_RESPONSE_BYTES,
        () => new Error(`${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes`),
      )
      return yield* parseResponse(body.toString("utf8"))
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(25),
        orElse: () => Effect.fail(new Error(`${tool} request timed out`)),
      }),
    )
  })

const Output = Schema.Struct({
  provider: Provider,
  text: Schema.String,
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const http = yield* HttpClient.HttpClient
    const config = yield* ConfigService
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
          execute: (input, context) => {
            const provider = selectProvider(context.sessionID, config, config.provider)
            return Effect.gen(function* () {
              const local = ResearchBrowser.available()
              yield* permission.assert({
                action: name,
                resources: [input.query, ...(input.queries ?? [])],
                save: ["*"],
                metadata: { ...input, provider: local ? "local-browser" : provider },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              if (local) {
                const depth = ResearchBrowser.inferDepth(input.query, input.type)
                const queries = ResearchBrowser.expandQueries(input.query, input.queries ?? [], depth)
                const maxSources = input.maxSources ?? (depth === "deep" ? 6 : 3)
                const search = yield* Effect.tryPromise({
                  try: () =>
                    ResearchBrowser.search({
                      queries,
                      language: input.language,
                      timeRange: input.timeRange,
                      maxResults: Math.max(maxSources, input.numResults ?? 8),
                      depth,
                    }),
                  catch: (error) => error,
                }).pipe(
                  Effect.catch(() =>
                    Effect.succeed({
                      status: "failed" as const,
                      engine: "duckduckgo" as const,
                      results: [],
                      externalFallback: false,
                      message: "Local Research Browser is unavailable. External fallback was not used.",
                    }),
                  ),
                )
                const results = ResearchBrowser.normalizeResults(search.results, maxSources)
                if (search.status === "ready" && results.length) {
                  yield* permission.assert({
                    action: "webfetch",
                    resources: results.map((item) => item.url),
                    save: ["*"],
                    metadata: { provider: "local-browser", query: input.query },
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                  })
                  const sources = yield* Effect.forEach(
                    results,
                    (result) =>
                      Effect.tryPromise({
                        try: () => ResearchBrowser.read({ url: result.url, allowAuthenticated: true }),
                        catch: () => undefined,
                      }).pipe(
                        Effect.map((read) => ({
                          ...result,
                          byline: read?.byline,
                          publishedTime: read?.publishedTime,
                          text: read?.status === "ready" && read.text ? read.text : result.snippet,
                          fetchMode: read?.status === "ready" && read.text ? read.fetchMode : ("snippet" as const),
                          requiresUser: read?.status === "requires_user",
                        })),
                        Effect.catch(() =>
                          Effect.succeed({
                            ...result,
                            text: result.snippet,
                            fetchMode: "snippet" as const,
                            requiresUser: false,
                          }),
                        ),
                      ),
                    { concurrency: 3 },
                  )
                  if (sources.some((source) => source.requiresUser))
                    return {
                      provider: "local-browser" as const,
                      text: "Research Browser requires user attention. Complete the sign-in or challenge in the opened browser, then retry the search.",
                    }
                  return {
                    provider: "local-browser" as const,
                    text: ResearchBrowser.evidencePacket({
                      query: input.query,
                      depth,
                      engine: search.engine,
                      sources,
                      maxCharacters: input.contextMaxCharacters,
                    }),
                  }
                }
                if (!search.externalFallback)
                  return {
                    provider: "local-browser" as const,
                    text:
                      search.status === "requires_user"
                        ? (search.message ?? "Research Browser requires user attention. Open it and retry.")
                        : (search.message ?? NO_RESULTS),
                  }
              }

              const text =
                provider === "exa"
                  ? yield* callMcp(http, exaUrl(config.exaApiKey), "web_search_exa", ExaArgs, {
                      query: input.query,
                      type: input.type || "auto",
                      numResults: input.numResults || 8,
                      livecrawl: input.livecrawl || "fallback",
                      contextMaxCharacters: input.contextMaxCharacters,
                    })
                  : yield* callMcp(
                      http,
                      PARALLEL_URL,
                      "web_search",
                      ParallelArgs,
                      {
                        objective: input.query,
                        search_queries: [input.query],
                        session_id: context.sessionID,
                        // V2 invocation context does not safely expose the model yet.
                      },
                      {
                        "User-Agent": `opencode/${InstallationVersion}`,
                        ...(config.parallelApiKey ? { Authorization: `Bearer ${config.parallelApiKey}` } : {}),
                      },
                    )
              return {
                provider,
                text: text ?? NO_RESULTS,
              }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to search the web for ${input.query}` })))
          },
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/websearch",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, LayerNodePlatform.httpClient, configNode],
})
