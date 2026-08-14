import { describe, expect, test } from "bun:test"
import {
  discoverLmStudioContextLimits,
  findLmStudioModel,
  lmStudioDiscoveredChatModels,
  lmStudioReasoningVariants,
  probeLmStudio,
} from "../../src/provider/lmstudio"
import { loadedLmStudioDefaultModelID } from "../../src/provider/provider"

describe("discoverLmStudioContextLimits", () => {
  test("exposes every OpenAI-compatible reasoning effort when reasoning is supported", () => {
    expect(lmStudioReasoningVariants(true)).toEqual({
      none: { reasoningEffort: "none" },
      minimal: { reasoningEffort: "minimal" },
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
      xhigh: { reasoningEffort: "xhigh" },
    })
    expect(lmStudioReasoningVariants(false)).toBeUndefined()
  })

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

    expect(requests).toEqual(["http://127.0.0.1:1234/api/v1/models"])
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
                reasoning: { allowed_options: ["on", "off"], default: "on" },
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

    expect(requests).toHaveLength(1)
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
      capabilities: {
        tools: true,
        vision: true,
        reasoning: true,
        reasoningOptions: ["on", "off"],
        embeddings: false,
      },
    })
    expect(findLmStudioModel(result, "nomic-embed")?.capabilities.embeddings).toBe(true)
    expect(
      loadedLmStudioDefaultModelID(
        {
          models: {
            coder: { id: "coder", api: { id: "qwen-local" } },
            embeddings: { id: "embeddings", api: { id: "nomic-embed" } },
          },
        },
        result,
      ),
    ).toBe("coder")
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

  test("discovers native chat models without exposing embeddings or duplicating configured aliases", async () => {
    const result = await probeLmStudio({
      baseURL: "http://127.0.0.1:1234/v1",
      apiKey: undefined,
      request: async (input) => {
        if (String(input).endsWith("/v1/models") && !String(input).includes("/api/")) return Response.json({ data: [] })
        return Response.json({
          models: [
            {
              key: "google/gemma-4-e4b",
              display_name: "Gemma 4 E4B",
              type: "llm",
              loaded_instances: [{ id: "gemma-loaded", config: { context_length: 32_768 } }],
              capabilities: { vision: true, trained_for_tool_use: true, reasoning: true },
            },
            { key: "qwen/coder", display_name: "Qwen Coder", type: "llm", loaded_instances: [] },
            { key: "nomic-embed", display_name: "Nomic Embed", type: "embedding", loaded_instances: [] },
          ],
        })
      },
    })

    expect(
      lmStudioDiscoveredChatModels(result, {
        gemma: { id: "google/gemma-4-e4b", name: "Configured Gemma", auto_route: false },
      }),
    ).toEqual({
      "qwen/coder": {
        id: "qwen/coder",
        name: "Qwen Coder",
        attachment: false,
        reasoning: false,
        tool_call: false,
      },
    })
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

  test("coalesces ordinary and explicit refresh probes for the same requester", async () => {
    const requests: string[] = []
    const request = async (input: string | URL | RequestInfo) => {
      requests.push(String(input))
      if (String(input).endsWith("/api/v1/models")) return Response.json({ models: [] })
      return Response.json({ data: [] })
    }
    const input = {
      baseURL: "http://127.0.0.1:1234/v1",
      apiKey: undefined,
      request,
    }

    await Promise.all([probeLmStudio(input), probeLmStudio(input)])
    await probeLmStudio(input)
    expect(requests).toHaveLength(1)

    await Promise.all([probeLmStudio({ ...input, refresh: true }), probeLmStudio({ ...input, refresh: true })])
    await probeLmStudio({ ...input, refresh: true })
    expect(requests).toHaveLength(2)
  })
})
