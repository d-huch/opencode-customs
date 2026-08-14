import { describe, expect, test } from "bun:test"
import { SessionChatMode } from "../../src/session/chat-mode"

describe("session chat mode", () => {
  test("recognizes only the dedicated chat workspace", () => {
    expect(SessionChatMode.enabled("/Users/user/Documents/OpenCode Customs Chat")).toBe(true)
    expect(SessionChatMode.enabled("/Users/user/Documents/project")).toBe(false)
  })

  test("disables tools for ordinary conversation", () => {
    expect(SessionChatMode.tools({ read: 1, websearch: 2 })).toEqual({})
  })

  test("uses a bounded per-model context for chat sessions", () => {
    const model = { id: "gemma", api: { id: "gemma-instance" }, limit: { context: 91_648 } }
    expect(SessionChatMode.contextLimit({ model })).toBe(32_768)
    expect(
      SessionChatMode.contextLimit({
        model,
        models: { alias: { id: "gemma", chat_context: 16_384 } },
      }),
    ).toBe(16_384)
  })

  test("keeps only general-purpose web tools after explicit opt-in", () => {
    expect(SessionChatMode.tools({ read: 1, grep: 2, websearch: 3, webfetch: 4, bash: 5 }, true)).toEqual({
      websearch: 3,
      webfetch: 4,
    })
  })

  test("requires an explicit web marker or URL", () => {
    expect(SessionChatMode.webEnabled("Хто зараз президент?")).toBe(false)
    expect(SessionChatMode.webEnabled("/web хто зараз президент?")).toBe(true)
    expect(SessionChatMode.webEnabled("Перевір https://example.com")).toBe(true)
  })

  test("sends only the latest user message for a stateful continuation", () => {
    const messages = [
      { role: "user" as const, content: "one" },
      { role: "assistant" as const, content: "two" },
      { role: "user" as const, content: "three" },
    ]
    expect(SessionChatMode.messages(messages, true)).toEqual([{ role: "user", content: "three" }])
  })

  test("continues a matching bounded provider chain", () => {
    expect(
      SessionChatMode.providerChain(
        [
          {
            info: {
              id: "msg_2",
              role: "assistant",
              providerID: "lmstudio",
              modelID: "gemma",
              tokens: { input: 2_000, output: 100, reasoning: 50, cache: { read: 3_000, write: 0 } },
            },
            parts: [
              {
                type: "text",
                metadata: { openai: { responseId: "resp_123" }, opencode: { chatContextLimit: 16_384 } },
              },
            ],
          },
        ],
        { providerID: "lmstudio", id: "gemma" },
        16_384,
        300,
      ),
    ).toEqual({ messageID: "msg_2", previousResponseID: "resp_123", providerTokens: 5_150, cachedTokens: 3_000 })
  })

  test("rebases when chat context changes or cached tokens exhaust the chain", () => {
    const message = {
      info: {
        id: "msg_2",
        role: "assistant",
        providerID: "lmstudio",
        modelID: "gemma",
        tokens: { input: 2_000, output: 100, reasoning: 0, cache: { read: 11_000, write: 0 } },
      },
      parts: [
        {
          type: "text",
          metadata: { openai: { responseId: "resp_123" }, opencode: { chatContextLimit: 16_384 } },
        },
      ],
    }
    expect(SessionChatMode.providerChain([message], { providerID: "lmstudio", id: "gemma" }, 32_768, 100)).toEqual({
      messageID: "msg_2",
      providerTokens: 13_100,
      cachedTokens: 11_000,
      reason: "context_changed",
    })
    expect(SessionChatMode.providerChain([message], { providerID: "lmstudio", id: "gemma" }, 16_384, 2_000)).toEqual({
      messageID: "msg_2",
      providerTokens: 13_100,
      cachedTokens: 11_000,
      reason: "context_exhausted",
    })
  })

  test("rebases with the latest compact summary instead of the entire provider chain", () => {
    const messages = [
      { role: "user" as const, content: "old" },
      { role: "assistant" as const, content: "old response" },
      { role: "user" as const, content: "current" },
    ]
    expect(SessionChatMode.messages(messages, false, "The user is Denis.")).toEqual([
      { role: "assistant", content: "Previous conversation summary:\nThe user is Denis." },
      ...messages,
    ])
  })

  test("requests a new compact summary only when the current chain is newer", () => {
    const chain = {
      messageID: "msg_2",
      providerTokens: 14_000,
      cachedTokens: 10_000,
      reason: "context_exhausted" as const,
    }
    expect(SessionChatMode.requiresCompaction(chain, undefined)).toBe(true)
    expect(SessionChatMode.requiresCompaction(chain, "msg_1")).toBe(true)
    expect(SessionChatMode.requiresCompaction(chain, "msg_3")).toBe(false)
    expect(
      SessionChatMode.requiresCompaction(
        { messageID: "msg_2", providerTokens: 1_000, cachedTokens: 500, reason: "context_changed" as const },
        undefined,
      ),
    ).toBe(false)
  })

  test("does not continue a provider chain from a compaction response", () => {
    expect(
      SessionChatMode.providerChain(
        [
          {
            info: {
              id: "msg_summary",
              role: "assistant",
              summary: true,
              providerID: "lmstudio",
              modelID: "gemma",
              tokens: { input: 100, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
            },
            parts: [
              {
                type: "text",
                metadata: { openai: { responseId: "resp_summary" }, opencode: { chatContextLimit: 16_384 } },
              },
            ],
          },
        ],
        { providerID: "lmstudio", id: "gemma" },
        16_384,
        100,
      ),
    ).toEqual({ messageID: undefined, providerTokens: 0, cachedTokens: 0, reason: "missing_response_metadata" })
  })
})
