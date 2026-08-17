import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { asSchema, type ModelMessage, type Tool } from "ai"
import { Cause, Effect, FiberSet, Queue } from "effect"
import * as Stream from "effect/Stream"
import { FetchHttpClient } from "effect/unstable/http"
import {
  LLMRequest,
  Tool as NativeTool,
  ToolFailure,
  ToolRuntime,
  toDefinitions,
  type JsonSchema,
  type LLMEvent,
} from "@opencode-ai/llm"
import type { LLMClientShape } from "@opencode-ai/llm/route"
import { LLMNative } from "./native-request"
import { LmStudioChatTransport } from "@/local-agent-runtime/lmstudio-chat-transport"
import { SessionLog } from "@/local-agent-runtime/session-log"

export type RuntimeStatus =
  | { readonly type: "supported"; readonly apiKey: string; readonly baseURL?: string }
  | { readonly type: "unsupported"; readonly reason: string }
export type StreamResult =
  | { readonly type: "supported"; readonly stream: Stream.Stream<LLMEvent, unknown> }
  | { readonly type: "unsupported"; readonly reason: string }

type StreamInput = {
  readonly model: Provider.Model
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly llmClient: LLMClientShape
  readonly messages: ModelMessage[]
  readonly continuationMessages?: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly toolChoice?: "auto" | "required" | "none"
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly maxOutputTokens?: number
  readonly providerOptions?: Record<string, any>
  readonly headers: Record<string, string>
  readonly abort: AbortSignal
  readonly statefulResponses?: boolean
  readonly previousResponseID?: string
  readonly previousSystemFingerprint?: string
  readonly systemFingerprint?: string
  readonly sessionID?: string
  readonly resolveChatTransport?: typeof LmStudioChatTransport.resolve
  readonly rememberChatFallback?: typeof LmStudioChatTransport.rememberFallback
}

export function status(
  input: Pick<StreamInput, "model" | "provider" | "auth"> & Partial<Pick<StreamInput, "statefulResponses">>,
): RuntimeStatus {
  return statusWithFetch(input, providerFetch(input))
}

function statusWithFetch(
  input: Pick<StreamInput, "model" | "provider" | "auth"> & Partial<Pick<StreamInput, "statefulResponses">>,
  fetch: typeof globalThis.fetch | undefined,
): RuntimeStatus {
  const providerID = input.model.providerID
  const lmStudioResponses = input.statefulResponses === true && providerID === "lmstudio"
  if (!lmStudioResponses && providerID !== "openai" && providerID !== "anthropic" && !providerID.startsWith("opencode"))
    return { type: "unsupported", reason: "provider is not openai, opencode, or anthropic" }
  const npm = input.model.api.npm
  if (npm !== "@ai-sdk/openai" && npm !== "@ai-sdk/openai-compatible" && npm !== "@ai-sdk/anthropic")
    return { type: "unsupported", reason: "provider package is not OpenAI, OpenAI-compatible, or Anthropic" }
  if (input.auth?.type === "oauth" && !(input.provider.id === "openai" && fetch)) {
    return { type: "unsupported", reason: "OAuth auth requires a provider fetch override" }
  }

  const apiKey =
    typeof input.provider.options.apiKey === "string"
      ? input.provider.options.apiKey
      : (input.provider.key ?? (lmStudioResponses ? "lm-studio" : undefined))
  if (!apiKey) return { type: "unsupported", reason: "API key is not configured" }

  return {
    type: "supported",
    apiKey,
    baseURL: typeof input.provider.options.baseURL === "string" ? input.provider.options.baseURL : undefined,
  }
}

export function stream(input: StreamInput): StreamResult {
  const fetch = providerFetch(input)
  const current = statusWithFetch(input, fetch)
  if (current.type === "unsupported") return current

  // Integration point with @opencode-ai/llm: native-request lowers session data
  // into an LLMRequest, then LLMClient handles route selection and transport.
  //
  // ProviderTransform.providerOptions builds AI-SDK-shaped options for the
  // selected SDK key (e.g. "openai") and the native LLM SDK reads the same
  // keys via OpenAIOptions.* (store, reasoningEffort, reasoningSummary,
  // include, textVerbosity, promptCacheKey). Both sides intentionally use
  // OpenAI's official wire field names, so this is identity, not translation
  // — if a field ever needs to differ between the two surfaces, the
  // translation belongs here, not split across both packages.
  const tools = nativeTools(input.tools, input)
  const openai = isRecord(input.providerOptions?.openai) ? input.providerOptions.openai : {}
  const providerOptions = ProviderTransform.providerOptions(input.model, input.providerOptions ?? {})
  const makeRequest = (messages: ModelMessage[], responses: boolean, previousResponseID?: string) =>
    LLMNative.request({
      model: input.model,
      apiKey: current.apiKey,
      baseURL: current.baseURL,
      messages: ProviderTransform.message(messages, input.model, input.providerOptions ?? {}),
      toolChoice: input.toolChoice,
      temperature: input.temperature,
      topP: input.topP,
      topK: input.topK,
      maxOutputTokens: input.maxOutputTokens,
      providerOptions: responses
        ? {
            ...providerOptions,
            openai: {
              ...openai,
              store: true,
              ...(previousResponseID ? { previousResponseId: previousResponseID } : {}),
            },
          }
        : providerOptions,
      headers: { ...providerHeaders(input.provider.options.headers), ...input.headers },
      responses,
    })
  const execute = (request: LLMRequest) =>
    Stream.scoped(
      Stream.unwrap(
        Effect.gen(function* () {
          const settlements = yield* FiberSet.make<void>()
          const results = yield* Queue.unbounded<LLMEvent, Cause.Done>()
          const provider = input.llmClient
            .stream(
              LLMRequest.update(request, {
                tools: [...request.tools, ...toDefinitions(tools)],
              }),
            )
            .pipe(
              Stream.flatMap((event) =>
                event.type !== "tool-call" || event.providerExecuted
                  ? Stream.make(event)
                  : Stream.make(event).pipe(
                      Stream.concat(
                        Stream.fromEffectDrain(
                          ToolRuntime.dispatch(tools, event).pipe(
                            Effect.flatMap((dispatched) => Queue.offerAll(results, dispatched.events)),
                            Effect.catchCause((cause) => Queue.failCause(results, cause)),
                            Effect.asVoid,
                            FiberSet.run(settlements, { startImmediately: true }),
                          ),
                        ),
                      ),
                    ),
              ),
              Stream.concat(
                Stream.fromEffectDrain(
                  FiberSet.awaitEmpty(settlements).pipe(Effect.andThen(Queue.end(results)), Effect.asVoid),
                ),
              ),
            )
          return provider.pipe(Stream.concat(Stream.fromQueue(results)))
        }),
      ),
    )
  const annotate = (
    source: Stream.Stream<LLMEvent, unknown>,
    transport: "responses" | "chat_completions",
    reason?: LmStudioChatTransport.FallbackReason,
  ) =>
    source.pipe(
      Stream.map((event) => {
        if (event.type !== "finish") return event
        const metadata = event.providerMetadata?.opencode
        return {
          ...event,
          providerMetadata: {
            ...event.providerMetadata,
            opencode: {
              ...(isRecord(metadata) ? metadata : {}),
              chatTransport: transport,
              ...(input.systemFingerprint ? { chatSystemFingerprint: input.systemFingerprint } : {}),
              ...(reason ? { chatFallbackReason: reason } : {}),
            },
          },
        }
      }),
    )
  const identity = LmStudioChatTransport.identity({
    baseURL: current.baseURL ?? input.model.api.url,
    modelID: input.model.id,
    instanceID: input.model.api.id,
  })
  const chatRequest = makeRequest(input.messages, false)
  const stream = input.statefulResponses
    ? Stream.unwrap(
        Effect.promise(() => (input.resolveChatTransport ?? LmStudioChatTransport.resolve)(identity)).pipe(
          Effect.map((selected) => {
            if (selected.transport === "chat_completions") {
              if (input.sessionID)
                void SessionLog.write({
                  sessionID: input.sessionID,
                  type: "provider.transport.cached_fallback",
                  data: { ...identity, reason: selected.reason },
                })
              return annotate(execute(chatRequest), "chat_completions", selected.reason)
            }

            const continued =
              Boolean(input.previousResponseID) &&
              Boolean(input.systemFingerprint) &&
              input.previousSystemFingerprint === input.systemFingerprint
            const responsesRequest = makeRequest(
              continued ? (input.continuationMessages ?? input.messages) : input.messages,
              true,
              continued ? input.previousResponseID : undefined,
            )
            if (input.sessionID)
              void SessionLog.write({
                sessionID: input.sessionID,
                type: continued ? "provider.chain.continued" : "provider.chain.rebased",
                data: { ...identity, systemFingerprint: input.systemFingerprint },
              })

            let committed = false
            const primary = annotate(execute(responsesRequest), "responses").pipe(
              Stream.tap((event) => {
                if (
                  event.type === "text-delta" ||
                  event.type === "reasoning-delta" ||
                  event.type === "tool-call" ||
                  event.type === "tool-result" ||
                  event.type === "tool-error"
                ) {
                  committed = true
                  return Effect.void
                }
                if (event.type !== "provider-error") return Effect.void
                const reason = LmStudioChatTransport.fallbackReason(event.message)
                if (reason && !committed) return Effect.fail(new Error(`${reason}: ${event.message}`))
                return Effect.void
              }),
            )
            return primary.pipe(
              Stream.catchCause((cause) => {
                const reason = LmStudioChatTransport.fallbackReason(Cause.squash(cause))
                if (!reason || committed) return Stream.failCause(cause)
                let recorded = false
                return annotate(execute(chatRequest), "chat_completions", reason).pipe(
                  Stream.tap((event) => {
                    if (recorded || event.type !== "finish") return Effect.void
                    recorded = true
                    return Effect.promise(async () => {
                      await (input.rememberChatFallback ?? LmStudioChatTransport.rememberFallback)(identity, reason)
                      if (!input.sessionID) return
                      await SessionLog.write({
                        sessionID: input.sessionID,
                        type: "provider.transport.fallback",
                        data: { ...identity, reason },
                      })
                    }).pipe(Effect.catchCause(() => Effect.void))
                  }),
                )
              }),
            )
          }),
        ),
      )
    : execute(chatRequest)

  return {
    ...current,
    stream: fetch ? stream.pipe(Stream.provideService(FetchHttpClient.Fetch, fetch)) : stream,
  }
}

function providerFetch(input: Pick<StreamInput, "provider" | "auth">): typeof globalThis.fetch | undefined {
  if (input.provider.id !== "openai" || input.auth?.type !== "oauth") return undefined
  const value: unknown = input.provider.options.fetch
  if (typeof value !== "function") return undefined
  return value as typeof globalThis.fetch
}

function providerHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function nativeSchema(value: unknown): JsonSchema {
  if (!value || typeof value !== "object") return { type: "object", properties: {} }
  if ("jsonSchema" in value && value.jsonSchema && typeof value.jsonSchema === "object")
    return value.jsonSchema as JsonSchema
  return asSchema(value as Parameters<typeof asSchema>[0]).jsonSchema as JsonSchema
}

export function nativeTools(tools: Record<string, Tool>, input: Pick<StreamInput, "messages" | "abort">) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, item]) => [
      name,
      // Tool execution remains opencode-owned. The native runtime only adapts
      // the @opencode-ai/llm tool call back into the AI SDK Tool.execute shape.
      NativeTool.make({
        description: item.description ?? "",
        jsonSchema: nativeSchema(item.inputSchema),
        execute: (args: unknown, ctx) =>
          Effect.tryPromise({
            try: () => {
              if (!item.execute) throw new Error(`Tool has no execute handler: ${name}`)
              return item.execute(args, {
                toolCallId: ctx?.id ?? name,
                messages: input.messages,
                abortSignal: input.abort,
              })
            },
            catch: (error) => new ToolFailure({ message: errorMessage(error), error }),
          }),
      }),
    ]),
  )
}

export * as LLMNativeRuntime from "./native-runtime"
