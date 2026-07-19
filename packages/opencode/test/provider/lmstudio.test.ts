import { describe, expect, test } from "bun:test"
import { discoverLmStudioContextLimits, findLmStudioModel, probeLmStudio } from "../../src/provider/lmstudio"

describe("discoverLmStudioContextLimits", () => {
  test("uses the active instance context and maps its identifier", async () => {
    const requests: string[] = []
    const result = await discoverLmStudioContextLimits({
      baseURL: "http://127.0.0.1:1234/v1",
      apiKey: undefined,
      request: async (input) => {
        requests.push(String(input))
        return Response.json({
          models: [
            {
              key: "qwen/qwen3-coder",
              max_context_length: 262_144,
              loaded_instances: [{ id: "qwen-local", config: { context_length: 65_536 } }],
            },
          ],
        })
      },
    })

    expect(requests).toEqual(["http://127.0.0.1:1234/api/v1/models", "http://127.0.0.1:1234/v1/models"])
    expect(result).toEqual({
      "qwen/qwen3-coder": 65_536,
      "qwen-local": 65_536,
    })
  })

  test("uses the supported maximum when the model is not loaded", async () => {
    const result = await discoverLmStudioContextLimits({
      baseURL: "http://127.0.0.1:1234/api/v1",
      apiKey: "secret",
      request: async (_input, init) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret")
        return Response.json({
          models: [{ key: "gemma", max_context_length: 131_072, loaded_instances: [] }],
        })
      },
    })

    expect(result).toEqual({ gemma: 131_072 })
  })

  test("falls back silently when discovery is unavailable", async () => {
    expect(
      await discoverLmStudioContextLimits({
        baseURL: "not a URL",
        apiKey: undefined,
      }),
    ).toEqual({})
  })

  test("probes loaded models and native capabilities without inference", async () => {
    const requests: string[] = []
    const result = await probeLmStudio({
      baseURL: "http://127.0.0.1:1234/v1",
      apiKey: undefined,
      request: async (input) => {
        requests.push(String(input))
        if (String(input).endsWith("/v1/models") && !String(input).includes("/api/")) {
          return Response.json({ data: [{ id: "qwen-local" }] })
        }
        return Response.json({
          models: [
            {
              key: "qwen/qwen3-coder",
              display_name: "Qwen 3 Coder",
              type: "llm",
              max_context_length: 262_144,
              loaded_instances: [
                {
                  id: "qwen-local",
                  config: { context_length: 65_536 },
                },
              ],
              capabilities: {
                vision: true,
                trained_for_tool_use: true,
                reasoning: { allowed_options: ["low", "high"], default: "low" },
              },
            },
            {
              key: "nomic-embed",
              display_name: "Nomic Embed",
              type: "embedding",
              max_context_length: 8_192,
              loaded_instances: [],
            },
          ],
        })
      },
    })

    expect(requests).toHaveLength(2)
    expect(result.status).toBe("ready")
    expect(result.api).toEqual({
      native: true,
      openai: true,
      chatCompletions: true,
      responses: true,
      embeddings: true,
    })
    expect(findLmStudioModel(result, "qwen-local")).toMatchObject({
      id: "qwen/qwen3-coder",
      loaded: true,
      context: { active: 65_536, supported: 262_144 },
      capabilities: { tools: true, vision: true, reasoning: true, embeddings: false },
    })
    expect(findLmStudioModel(result, "nomic-embed")?.capabilities.embeddings).toBe(true)
  })

  test("detects vision from native VLM and structured image-input metadata", async () => {
    const result = await probeLmStudio({
      baseURL: "http://127.0.0.1:1234/v1",
      apiKey: undefined,
      request: async (input) => {
        if (String(input).endsWith("/v1/models") && !String(input).includes("/api/")) return Response.json({ data: [] })
        return Response.json({
          models: [
            { key: "visual", type: "vlm", loaded_instances: [] },
            {
              key: "structured",
              type: "llm",
              loaded_instances: [],
              capabilities: { input: { image: { supported: true } } },
            },
            { key: "text", type: "llm", loaded_instances: [], capabilities: { vision: false } },
          ],
        })
      },
    })

    expect(findLmStudioModel(result, "visual")).toMatchObject({
      type: "llm",
      visionCapabilitySource: "native_type",
      capabilities: { vision: true },
    })
    expect(findLmStudioModel(result, "structured")).toMatchObject({
      visionCapabilitySource: "native_input",
      capabilities: { vision: true },
    })
    expect(findLmStudioModel(result, "text")?.capabilities.vision).toBe(false)
  })

  test("reports an unauthorized bridge without throwing", async () => {
    const result = await probeLmStudio({
      baseURL: "http://127.0.0.1:1234/v1",
      apiKey: "bad-token",
      request: async () => Response.json({ error: "unauthorized" }, { status: 401 }),
    })

    expect(result.status).toBe("unauthorized")
    expect(result.error).toBe("HTTP 401")
    expect(result.models).toEqual([])
  })
})
