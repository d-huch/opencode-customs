import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { checksum } from "@opencode-ai/core/util/encode"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ResearchBrowser } from "@opencode-ai/core/tool/research-browser"
import { SessionLog } from "@/local-agent-runtime/session-log"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  queries: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional related queries for a deeper research pass (maximum 4 total queries)",
  }),
  language: Schema.optional(Schema.String).annotate({ description: "Preferred search language or locale" }),
  timeRange: Schema.optional(Schema.Literals(["day", "week", "month", "year"])).annotate({
    description: "Optional recency filter",
  }),
  maxSources: Schema.optional(Schema.Number).annotate({
    description: "Maximum sources to read (default: 3 for fast search, 6 for deep research; maximum: 8)",
  }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum evidence characters (default: 12000 for fast search, 40000 for deep research)",
  }),
})

const WebSearchProviderSchema = Schema.Literals(["exa", "parallel"])
export type WebSearchProvider = Schema.Schema.Type<typeof WebSearchProviderSchema>

export function selectWebSearchProvider(sessionID: string, flags = { exa: false, parallel: false }): WebSearchProvider {
  const override = process.env.OPENCODE_WEBSEARCH_PROVIDER
  if (override === "exa" || override === "parallel") return override
  if (flags.parallel) return "parallel"
  if (flags.exa) return "exa"

  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "local-browser") return "Research Browser"
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

export function webSearchModelName(extra: Tool.Context["extra"]) {
  const model = extra?.model
  if (!model || typeof model !== "object") return undefined
  const api = "api" in model && model.api && typeof model.api === "object" ? model.api : undefined
  const apiID = api && "id" in api && typeof api.id === "string" ? api.id : undefined
  const id = "id" in model && typeof model.id === "string" ? model.id : undefined
  return (apiID ?? id)?.slice(0, 100)
}

function parallelAuthHeaders() {
  const headers = { "User-Agent": `opencode/${InstallationVersion}` }
  if (!process.env.PARALLEL_API_KEY) return headers
  return { ...headers, Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
) {
  if (provider === "parallel") {
    return McpWebSearch.call(
      http,
      McpWebSearch.PARALLEL_URL,
      "web_search",
      McpWebSearch.ParallelSearchArgs,
      {
        objective: params.query,
        search_queries: [params.query],
        session_id: ctx.sessionID,
        model_name: webSearchModelName(ctx.extra),
      },
      "25 seconds",
      parallelAuthHeaders(),
    )
  }

  return McpWebSearch.call(
    http,
    McpWebSearch.EXA_URL,
    "web_search_exa",
    McpWebSearch.SearchArgs,
    {
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 8,
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    },
    "25 seconds",
  )
}

type WebSearchMetadata = {
  provider: string
  engine?: ResearchBrowser.Engine
  depth?: ResearchBrowser.Depth
  sources?: number
  status?: string
  stage?: string
  fallbackFrom?: string
}

export const WebSearchTool = Tool.define<
  typeof Parameters,
  WebSearchMetadata,
  HttpClient.HttpClient | RuntimeFlags.Service
>(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execution: { access: "read", cache: true } as const,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const provider = selectWebSearchProvider(ctx.sessionID, {
            exa: flags.enableExa,
            parallel: flags.enableParallel,
          })
          const local = ResearchBrowser.available()
          const activeProvider = local ? "local-browser" : provider
          const title = webSearchProviderLabel(activeProvider)
          yield* ctx.metadata({ title: `${title} "${params.query}"`, metadata: { provider: activeProvider } })

          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              provider: activeProvider,
            },
          })

          if (local) {
            const depth = ResearchBrowser.inferDepth(params.query, params.type)
            const queries = ResearchBrowser.expandQueries(params.query, params.queries ?? [], depth)
            const maxSources = Math.max(1, Math.min(Math.floor(params.maxSources ?? (depth === "deep" ? 6 : 3)), 8))
            yield* Effect.promise(() =>
              SessionLog.write({
                sessionID: ctx.sessionID,
                messageID: ctx.messageID,
                type: "research.started",
                data: { depth, queries, provider: activeProvider },
              }),
            )
            const search = yield* Effect.tryPromise({
              try: () =>
                ResearchBrowser.search({
                  queries,
                  language: params.language,
                  timeRange: params.timeRange,
                  maxResults: Math.max(maxSources, params.numResults ?? 8),
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
            yield* Effect.promise(() =>
              SessionLog.write({
                sessionID: ctx.sessionID,
                messageID: ctx.messageID,
                type: search.status === "requires_user" ? "research.challenge" : "research.serp",
                data: { engine: search.engine, status: search.status, results: results.length },
              }),
            )
            if (search.status === "ready" && results.length) {
              yield* ctx.metadata({
                title: `Research Browser · ${results.length} sources`,
                metadata: {
                  provider: activeProvider,
                  engine: search.engine,
                  depth,
                  stage: "reading",
                  sources: results.length,
                },
              })
              yield* ctx.ask({
                permission: "webfetch",
                patterns: results.map((item) => item.url),
                always: ["*"],
                metadata: { provider: activeProvider, query: params.query, urls: results.map((item) => item.url) },
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
              yield* Effect.forEach(sources, (source, index) =>
                Effect.promise(() =>
                  SessionLog.write({
                    sessionID: ctx.sessionID,
                    messageID: ctx.messageID,
                    type: "research.source_read",
                    data: { sourceID: `S${index + 1}`, url: source.url, mode: source.fetchMode },
                  }),
                ),
              )
              if (sources.some((source) => source.requiresUser)) {
                yield* Effect.promise(() =>
                  SessionLog.write({
                    sessionID: ctx.sessionID,
                    messageID: ctx.messageID,
                    type: "research.user_takeover",
                    data: { engine: search.engine, reason: "page_challenge" },
                  }),
                )
                return {
                  output:
                    "Research Browser requires user attention. Complete the sign-in or challenge in the opened browser, then retry the search.",
                  title: `Research Browser: ${params.query}`,
                  metadata: {
                    provider: activeProvider,
                    engine: search.engine,
                    depth,
                    sources: sources.filter((source) => !source.requiresUser).length,
                    status: "requires_user",
                  },
                }
              }
              return {
                output: ResearchBrowser.evidencePacket({
                  query: params.query,
                  depth,
                  engine: search.engine,
                  sources,
                  maxCharacters: params.contextMaxCharacters,
                }),
                title: `Research Browser: ${params.query}`,
                metadata: {
                  provider: activeProvider,
                  engine: search.engine,
                  depth,
                  sources: sources.length,
                  status: "ready",
                },
              }
            }
            if (!search.externalFallback) {
              if (search.status === "requires_user")
                yield* Effect.promise(() =>
                  SessionLog.write({
                    sessionID: ctx.sessionID,
                    messageID: ctx.messageID,
                    type: "research.user_takeover",
                    data: { engine: search.engine, reason: "search_challenge" },
                  }),
                )
              const message =
                search.status === "requires_user"
                  ? (search.message ?? "Research Browser requires user attention. Open it and retry.")
                  : (search.message ?? "Local Research Browser did not return results.")
              return {
                output: message,
                title: `Research Browser: ${params.query}`,
                metadata: { provider: activeProvider, engine: search.engine, depth, sources: 0, status: search.status },
              }
            }
            yield* ctx.metadata({
              title: `${title} fallback · ${webSearchProviderLabel(provider)}`,
              metadata: { provider, fallbackFrom: activeProvider, reason: search.status },
            })
            yield* Effect.promise(() =>
              SessionLog.write({
                sessionID: ctx.sessionID,
                messageID: ctx.messageID,
                type: "research.external_fallback",
                data: { provider, reason: search.status },
              }),
            )
          }

          const result = yield* callProvider(http, provider, params, ctx)

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${webSearchProviderLabel(provider)}: ${params.query}`,
            metadata: { provider, fallbackFrom: local ? "local-browser" : undefined },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
