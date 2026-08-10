import { describe, expect, test } from "bun:test"
import { ToolCallRepair } from "@/session/tool-call-repair"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

async function read(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const chunks: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) return chunks
    chunks.push(chunk.value)
  }
}

describe("tool call repair", () => {
  test("repairs fenced JSON, trailing commas, and literal controls", () => {
    expect(ToolCallRepair.input('```json\n{"pattern":"journal\nsick",}\n```')).toBe(
      JSON.stringify({ pattern: "journal\nsick" }),
    )
  })

  test("does not invent the missing end of a truncated string", () => {
    expect(ToolCallRepair.input('{"pattern":"journal|sick|.')).toBeUndefined()
  })

  test("does not rewrite valid JSON or non-object inputs", () => {
    expect(ToolCallRepair.input('{"pattern":"journal"}')).toBeUndefined()
    expect(ToolCallRepair.input('["journal",]')).toBeUndefined()
  })

  test("converts streamed OpenAI tool-call snapshots into one executable tool call", async () => {
    const middleware = ToolCallRepair.compatibilityMiddleware()
    const wrap = middleware.wrapStream
    expect(wrap).toBeDefined()
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-start" as const, id: "text-1" })
        controller.enqueue({ type: "text-delta" as const, id: "text-1", delta: "Перевіряю файли.\n\n" })
        controller.enqueue({
          type: "text-delta" as const,
          id: "text-1",
          delta:
            '[{"id":"call-1","function":{"arguments":"{\\"path\\":\\"/tmp\\"}","name":"glob"},"type":"function","index":0}]',
        })
        controller.enqueue({
          type: "text-delta" as const,
          id: "text-1",
          delta:
            ' [{"id":"call-1","function":{"arguments":"{\\"path\\":\\"/tmp\\",\\"pattern\\":\\"*.ts\\"}","name":"glob"},"type":"function","index":0}]',
        })
        controller.enqueue({ type: "text-end" as const, id: "text-1" })
        controller.close()
      },
    })
    const result = await wrap!({
      doStream: async () => ({ stream: source }),
      doGenerate: async () => {
        throw new Error("not used")
      },
      params: {} as never,
      model: {} as never,
    })
    const chunks = await read(result.stream)

    expect(chunks).toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Перевіряю файли.\n\n", providerMetadata: undefined },
      { type: "text-end", id: "text-1" },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "glob",
        input: '{"path":"/tmp","pattern":"*.ts"}',
      },
    ])
  })

  test("leaves ordinary JSON arrays visible", async () => {
    const middleware = ToolCallRepair.compatibilityMiddleware()
    const result = await middleware.wrapStream!({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start" as const, id: "text-1" })
            controller.enqueue({ type: "text-delta" as const, id: "text-1", delta: '[{"id":"item-1"}]' })
            controller.enqueue({ type: "text-end" as const, id: "text-1" })
            controller.close()
          },
        }),
      }),
      doGenerate: async () => {
        throw new Error("not used")
      },
      params: {} as never,
      model: {} as never,
    })
    const chunks = await read(result.stream)
    expect(chunks).toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: '[{"id":"item-1"}]', providerMetadata: undefined },
      { type: "text-end", id: "text-1" },
    ])
  })

  test("blocks malformed tool-like JSON before it can appear or execute", async () => {
    const middleware = ToolCallRepair.compatibilityMiddleware()
    const result = await middleware.wrapStream!({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start" as const, id: "text-1" })
            controller.enqueue({
              type: "text-delta" as const,
              id: "text-1",
              delta: '[{"id":"call-1","function":,}]',
            })
            controller.enqueue({ type: "text-end" as const, id: "text-1" })
            controller.close()
          },
        }),
      }),
      doGenerate: async () => {
        throw new Error("not used")
      },
      params: {} as never,
      model: {} as never,
    })
    expect(read(result.stream)).rejects.toThrow(
      "Model emitted a malformed serialized tool call. The call was blocked before execution.",
    )
  })
})
