import { describe, expect, test } from "bun:test"
import { SessionChatMode } from "../../src/session/chat-mode"

describe("session chat mode", () => {
  test("uses semantic intent without language-specific phrase rules or invented voice input", () => {
    expect(SessionChatMode.systemPrompt).toContain("Determine intent from meaning and conversational context")
    expect(SessionChatMode.systemPrompt).toContain("colloquial, abbreviated, and grammatically incomplete wording")
    expect(SessionChatMode.systemPrompt).not.toContain("по чому/почому")
    expect(SessionChatMode.systemPrompt).toContain("unless the active user message contains an explicit instruction")
    expect(SessionChatMode.systemPrompt).not.toContain("Web access is disabled unless")
  })

  test("recognizes only the dedicated chat workspace", () => {
    expect(SessionChatMode.enabled("/Users/user/Documents/OpenCode Customs Chat")).toBe(true)
    expect(SessionChatMode.enabled("/Users/user/Documents/project")).toBe(false)
  })

  test("keeps safe network tools without repository access", () => {
    expect(SessionChatMode.tools({ read: 1, websearch: 2, avatar_control: 3 })).toEqual({
      websearch: 2,
      avatar_control: 3,
    })
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
    expect(
      SessionChatMode.contextLimit({
        model,
        models: { alias: { id: "gemma", chat_context: 8_192 } },
      }),
    ).toBe(16_384)
    expect(
      SessionChatMode.contextLimit({
        model,
        models: { alias: { id: "gemma", chat_context: 65_536 } },
      }),
    ).toBe(32_768)
  })

  test("exposes only web and MCP tool schemas in chat mode", () => {
    expect(SessionChatMode.tools({ read: 1, grep: 2, websearch: 3, webfetch: 4, avatar_control: 6, bash: 5 })).toEqual({
      websearch: 3,
      webfetch: 4,
      avatar_control: 6,
    })
    expect(SessionChatMode.tools({ mcp_serviceman_search: 1, task: 2 })).toEqual({ mcp_serviceman_search: 1 })
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
                metadata: {
                  openai: { responseId: "resp_123" },
                  opencode: { chatContextLimit: 16_384, chatSystemFingerprint: "system_1" },
                },
              },
            ],
          },
        ],
        { providerID: "lmstudio", id: "gemma" },
        16_384,
        300,
      ),
    ).toEqual({
      messageID: "msg_2",
      previousResponseID: "resp_123",
      systemFingerprint: "system_1",
      providerTokens: 5_150,
      cachedTokens: 3_000,
    })
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
          metadata: {
            openai: { responseId: "resp_123" },
            opencode: { chatContextLimit: 16_384, chatSystemFingerprint: "system_1" },
          },
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

  test("removes provider replay state and non-leading system messages", () => {
    expect(
      SessionChatMode.messages(
        [
          { role: "system", content: "old system" },
          { role: "user", content: "hello" },
          {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                text: "hidden",
                providerOptions: { openai: { itemId: "rs_1" } },
              },
              {
                type: "text",
                text: "hi",
                providerOptions: { openai: { itemId: "msg_1" } },
              },
            ],
            providerOptions: { openai: { responseId: "resp_1" } },
          },
        ],
        false,
      ),
    ).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ])
  })

  test("skips failed assistants when resolving a provider chain", () => {
    const successful = {
      info: {
        id: "msg_ok",
        role: "assistant",
        providerID: "lmstudio",
        modelID: "gemma",
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          type: "text",
          metadata: {
            openai: { responseId: "resp_ok" },
            opencode: { chatContextLimit: 16_384, chatSystemFingerprint: "system_1" },
          },
        },
      ],
    }
    const failed = {
      info: {
        id: "msg_failed",
        role: "assistant",
        finish: "error",
        error: { name: "APIError" },
        providerID: "lmstudio",
        modelID: "gemma",
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [],
    }

    expect(
      SessionChatMode.providerChain([successful, failed], { providerID: "lmstudio", id: "gemma" }, 16_384, 100),
    ).toMatchObject({ previousResponseID: "resp_ok", systemFingerprint: "system_1" })
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
                metadata: {
                  openai: { responseId: "resp_summary" },
                  opencode: { chatContextLimit: 16_384, chatSystemFingerprint: "system_1" },
                },
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
