import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect } from "effect"
import { lmStudioEmbeddingProvider } from "@/local-agent-runtime/embeddings"

describe("LM Studio embedding provider", () => {
  test("discovers a loaded embedding model and calls the OpenAI-compatible endpoint", async () => {
    const requests: string[] = []
    const provider = lmStudioEmbeddingProvider(
      () => Effect.succeed(config()),
      async (input) => {
        const url = String(input)
        requests.push(url)
        if (url.endsWith("/api/v1/models"))
          return Response.json({
            models: [
              {
                key: "nomic-embed-text",
                display_name: "Nomic Embed Text",
                type: "embedding",
                loaded_instances: [{ id: "nomic-embed-text@q8", config: { context_length: 8_192 } }],
              },
            ],
          })
        if (url.endsWith("/v1/models")) return Response.json({ data: [] })
        if (url.endsWith("/v1/embeddings")) return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] })
        return new Response("not found", { status: 404 })
      },
      async (input) => {
        expect(input.priority).toBe("background")
        return { governed: true, release: async () => {} }
      },
    )

    const model = await Effect.runPromise(provider.model())
    expect(model?.name).toBe("nomic-embed-text")
    const vectors = await Effect.runPromise(provider.embed({ model: model!, texts: ["navigation journal"] }))

    expect(vectors).toEqual([[1, 0, 0]])
    expect(requests.some((url) => url === "http://127.0.0.1:1234/v1/embeddings")).toBe(true)
  })

  test("does not auto-load an embedding model into LM Studio", async () => {
    const provider = lmStudioEmbeddingProvider(
      () => Effect.succeed(config()),
      async (input) => {
        if (String(input).endsWith("/api/v1/models"))
          return Response.json({ models: [{ key: "embed", type: "embedding", loaded_instances: [] }] })
        return Response.json({ data: [] })
      },
    )

    expect(await Effect.runPromise(provider.model())).toBeUndefined()
  })

  test("does not choose an embedding model blocked from automatic routing", async () => {
    const provider = lmStudioEmbeddingProvider(
      () =>
        Effect.succeed({
          ...config(),
          provider: {
            lmstudio: {
              ...config().provider?.lmstudio,
              models: { blocked: { id: "blocked", auto_route: false } },
            },
          },
        }),
      async (input) => {
        if (String(input).endsWith("/api/v1/models"))
          return Response.json({
            models: [
              {
                key: "blocked",
                type: "embedding",
                loaded_instances: [{ id: "blocked@q8", config: { context_length: 8_192 } }],
              },
              {
                key: "allowed",
                type: "embedding",
                loaded_instances: [{ id: "allowed@q8", config: { context_length: 8_192 } }],
              },
            ],
          })
        return Response.json({ data: [] })
      },
    )

    expect((await Effect.runPromise(provider.model()))?.name).toBe("allowed")
    expect((await Effect.runPromise(provider.model("blocked")))?.name).toBe("blocked")
  })
})

function config(): ConfigV1.Info {
  return {
    provider: {
      lmstudio: {
        options: {
          baseURL: "http://127.0.0.1:1234/v1",
          apiKey: "lm-studio",
        },
      },
    },
  }
}
