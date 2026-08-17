import type { ModelMessage } from "ai"
import { Hash } from "@opencode-ai/core/util/hash"
import { isRecord } from "@/util/record"
import PROMPT_CHAT from "@/agent/prompt/chat.txt"
import { providerContextBudget } from "@/local-agent-runtime/resource-governor"
import { SessionMode } from "./mode"

export namespace SessionChatMode {
  export const DIRECTORY = "OpenCode Customs Chat"
  export const MIN_CONTEXT_LIMIT = 16_384
  export const DEFAULT_CONTEXT_LIMIT = 32_768

  export const systemPrompt = PROMPT_CHAT

  export function enabled(directory: string, mode?: SessionMode.Value, metadata?: Record<string, unknown>) {
    return SessionMode.resolve({ mode, metadata, directory }) === "chat"
  }

  export function contextLimit(input: {
    model: { readonly id: string; readonly api: { readonly id: string }; readonly limit: { readonly context: number } }
    models?: Record<string, { readonly id?: string; readonly chat_context?: number }>
  }) {
    const configured = Object.entries(input.models ?? {}).find(
      ([id, model]) =>
        id === input.model.id ||
        id === input.model.api.id ||
        model.id === input.model.id ||
        model.id === input.model.api.id,
    )?.[1].chat_context
    const maximum = Math.max(1, Math.min(DEFAULT_CONTEXT_LIMIT, Math.floor(input.model.limit.context)))
    const minimum = Math.min(MIN_CONTEXT_LIMIT, maximum)
    return Math.min(maximum, Math.max(minimum, Math.floor(configured ?? DEFAULT_CONTEXT_LIMIT)))
  }

  export function tools<T>(available: Record<string, T>) {
    return Object.fromEntries(
      Object.entries(available).filter(
        ([id]) =>
          id === "websearch" ||
          id === "webfetch" ||
          id === "avatar_control" ||
          id === "game_observe" ||
          id === "game_goal" ||
          id === "game_act" ||
          id === "list_mcp_resources" ||
          id === "list_mcp_resource_templates" ||
          id === "read_mcp_resource" ||
          id.startsWith("mcp_"),
      ),
    ) as Record<string, T>
  }

  export function messages(messages: ModelMessage[], continued: boolean, summary?: string) {
    const sanitized = sanitize(messages)
    if (continued) {
      const current = sanitized.findLast((message) => message.role === "user")
      return current ? [current] : []
    }
    const tail = sanitized.slice(-8)
    const firstUser = tail.findIndex((message) => message.role === "user")
    const recent = firstUser < 0 ? tail : tail.slice(firstUser)
    if (!summary?.trim()) return recent
    return [
      {
        role: "assistant" as const,
        content: `Previous conversation summary:\n${summary.trim()}`,
      },
      ...recent,
    ]
  }

  export function providerChain(
    messages: ReadonlyArray<{
      readonly info: {
        readonly id: string
        readonly role: string
        readonly summary?: unknown
        readonly finish?: unknown
        readonly error?: unknown
        readonly providerID?: string
        readonly modelID?: string
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
      }
      readonly parts: ReadonlyArray<{ readonly type: string; readonly metadata?: unknown }>
    }>,
    model: { readonly providerID: string; readonly id: string },
    contextLimit: number,
    currentTokens: number,
  ) {
    const assistant = messages.findLast(
      (message) =>
        message.info.role === "assistant" &&
        message.info.summary !== true &&
        message.info.finish !== "error" &&
        message.info.error === undefined &&
        message.info.providerID === model.providerID &&
        message.info.modelID === model.id,
    )
    const text = assistant?.parts.findLast((part) => part.type === "text")
    const tokens = assistant?.info.tokens
    const cachedTokens = tokens ? tokens.cache.read + tokens.cache.write : 0
    const providerTokens = tokens ? tokens.input + tokens.output + tokens.reasoning + cachedTokens : 0
    const budget = providerContextBudget({ contextLimit, providerTokens, cachedTokens, currentTokens })
    if (!text || !isRecord(text.metadata))
      return {
        messageID: assistant?.info.id,
        providerTokens,
        cachedTokens,
        reason: "missing_response_metadata" as const,
      }
    const openai = text.metadata.openai
    if (!isRecord(openai) || typeof openai.responseId !== "string")
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "missing_response_id" as const }
    const opencode = text.metadata.opencode
    if (!isRecord(opencode) || typeof opencode.chatContextLimit !== "number")
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "unversioned_chain" as const }
    if (typeof opencode.chatSystemFingerprint !== "string")
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "unversioned_chain" as const }
    if (opencode.chatContextLimit !== contextLimit)
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "context_changed" as const }
    if (!budget.allowed)
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "context_exhausted" as const }
    return {
      messageID: assistant?.info.id,
      previousResponseID: openai.responseId,
      systemFingerprint: opencode.chatSystemFingerprint,
      providerTokens,
      cachedTokens,
    }
  }

  export function systemFingerprint(system: readonly string[]) {
    return Hash.fast(JSON.stringify(system))
  }

  export function requiresCompaction(
    chain: ReturnType<typeof providerChain> | undefined,
    summaryMessageID: string | undefined,
  ) {
    return Boolean(
      chain &&
        "reason" in chain &&
        chain.reason === "context_exhausted" &&
        chain.messageID &&
        (!summaryMessageID || summaryMessageID.localeCompare(chain.messageID) <= 0),
    )
  }
}

function sanitize(messages: ModelMessage[]) {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === "system") return []
    if (!Array.isArray(message.content)) return [stripProviderState(message)]
    const content = message.content.filter(
      (part) => part.type !== "reasoning" && (!("providerExecuted" in part) || part.providerExecuted !== true),
    )
    if (content.length === 0) return []
    return [stripProviderState({ ...message, content } as ModelMessage)]
  })
}

function stripProviderState<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripProviderState) as T
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "providerMetadata" && key !== "providerOptions")
      .map(([key, item]) => [key, stripProviderState(item)]),
  ) as T
}
