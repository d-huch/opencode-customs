import path from "path"
import type { ModelMessage } from "ai"
import { isRecord } from "@/util/record"
import PROMPT_CHAT from "@/agent/prompt/chat.txt"
import { providerContextBudget } from "@/local-agent-runtime/resource-governor"

export namespace SessionChatMode {
  export const DIRECTORY = "OpenCode Customs Chat"
  export const MIN_CONTEXT_LIMIT = 16_384
  export const DEFAULT_CONTEXT_LIMIT = 32_768

  export const systemPrompt = PROMPT_CHAT

  export function enabled(directory: string) {
    return path.basename(path.normalize(directory)) === DIRECTORY
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

  export function tools<T>(_available: Record<string, T>) {
    return {} as Record<string, T>
  }

  export function messages(messages: ModelMessage[], continued: boolean, summary?: string) {
    if (continued) {
      const current = messages.findLast((message) => message.role === "user")
      return current ? [current] : []
    }
    const tail = messages.slice(-8)
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
        message.info.providerID === model.providerID &&
        message.info.modelID === model.id,
    )
    const text = assistant?.parts.findLast((part) => part.type === "text")
    const tokens = assistant?.info.tokens
    const cachedTokens = tokens ? tokens.cache.read + tokens.cache.write : 0
    const providerTokens = tokens ? tokens.input + tokens.output + tokens.reasoning + cachedTokens : 0
    const budget = providerContextBudget({ contextLimit, providerTokens, cachedTokens, currentTokens })
    if (!text || !isRecord(text.metadata))
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "missing_response_metadata" as const }
    const openai = text.metadata.openai
    if (!isRecord(openai) || typeof openai.responseId !== "string")
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "missing_response_id" as const }
    const opencode = text.metadata.opencode
    if (!isRecord(opencode) || typeof opencode.chatContextLimit !== "number")
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "unversioned_chain" as const }
    if (opencode.chatContextLimit !== contextLimit)
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "context_changed" as const }
    if (!budget.allowed)
      return { messageID: assistant?.info.id, providerTokens, cachedTokens, reason: "context_exhausted" as const }
    return { messageID: assistant?.info.id, previousResponseID: openai.responseId, providerTokens, cachedTokens }
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
