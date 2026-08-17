import { describe, expect, test } from "bun:test"
import {
  findLlamaServerModel,
  llamaServerContextLimits,
  llamaServerDiscoveredChatModels,
  probeLlamaServer,
} from "../../src/provider/llama-server"

describe("probeLlamaServer", () => {
  test("normalizes a /v1 endpoint and probes a single-model server without mutations", async () => {
    const requests: Array<{ url: string; method: string }> = []
    const result = await probeLlamaServer({
      baseURL: "http://127.0.0.1:8080/v1/",
      apiKey: "secret",
      request: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET" })
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret")
        const pathname = new URL(String(input)).pathname
        if (pathname === "/health" || pathname === "/v1/health") return Response.json({ status: "ok" })
        if (pathname === "/v1/models") return Response.json({ data: [{ id: "gemma-local" }] })
        if (pathname === "/props") {
          return Response.json({
            model_path: "/models/gemma.gguf",
            default_generation_settings: { n_ctx: 32_768 },
            n_ctx_train: 131_072,
            modalities: { vision: true },
            chat_template_caps: { tools: true },
          })
        }
        return Response.json({ error: "not found" }, { status: 404 })
      },
    })

    expect(result).toMatchObject({
      status: "ready",
      serverMode: "single",
      baseURL: "http://127.0.0.1:8080/v1",
      api: { health: true, openai: true, chatCompletions: true, router: false, props: true },
    })
    expect(findLlamaServerModel(result, "gemma-local")).toMatchObject({
      id: "gemma-local",
      status: "loaded",
      context: { active: 32_768, supported: 131_072 },
      modalities: { input: ["text", "image"] },
      capabilities: { tools: true },
    })
    expect(llamaServerContextLimits(result)).toEqual({ "gemma-local": 32_768 })
    expect(requests).toHaveLength(5)
    expect(requests.every((request) => request.method === "GET")).toBe(true)
    expect(requests.some((request) => /models\/(load|unload)/.test(request.url))).toBe(false)
  })

  test("parses official router model status, architecture, and context arguments", async () => {
    const result = await probeLlamaServer({
      baseURL: "http://router.test/llama/v1",
      apiKey: undefined,
      request: async (input) => {
        const pathname = new URL(String(input)).pathname
        if (pathname === "/llama/health" || pathname === "/llama/v1/health") {
          return Response.json({ status: "ok" })
        }
        if (pathname === "/llama/v1/models") return Response.json({ data: [{ id: "loaded-model" }] })
        if (pathname === "/llama/models") {
          return Response.json({
            data: [
              {
                id: "loaded-model",
                status: { value: "loaded", args: ["llama-server", "-ctx", "8192"] },
                size: 4_000_000,
                architecture: {
                  n_ctx_train: 65_536,
                  n_params: 8_000_000_000,
                  input_modalities: ["text", "image"],
                  output_modalities: ["text"],
                },
              },
              { id: "sleeping-model", status: { value: "sleeping" } },
              { id: "failed-model", status: { value: "unloaded", failed: true, exit_code: 1 } },
              { id: "download-model", status: { value: "downloading" } },
            ],
          })
        }
        return Response.json({ error: "not found" }, { status: 404 })
      },
    })

    expect(result.serverMode).toBe("router")
    expect(result.status).toBe("degraded")
    expect(result.baseURL).toBe("http://router.test/llama/v1")
    expect(findLlamaServerModel(result, "loaded-model")).toMatchObject({
      status: "loaded",
      context: { active: 8_192, supported: 65_536 },
      sizeBytes: 4_000_000,
      parameters: 8_000_000_000,
      modalities: { input: ["text", "image"], output: ["text"] },
    })
    expect(findLlamaServerModel(result, "sleeping-model")?.status).toBe("sleeping")
    expect(findLlamaServerModel(result, "failed-model")?.status).toBe("failed")
    expect(findLlamaServerModel(result, "download-model")?.status).toBe("loading")
  })

  test("distinguishes loading, authorization failure, offline, and unconfigured states", async () => {
    const loading = await probeLlamaServer({
      baseURL: "http://loading.test/v1",
      apiKey: undefined,
      request: async () => Response.json({ error: "loading" }, { status: 503 }),
    })
    const unauthorized = await probeLlamaServer({
      baseURL: "http://auth.test/v1",
      apiKey: "wrong",
      request: async (input) =>
        new URL(String(input)).pathname.endsWith("health")
          ? Response.json({ status: "ok" })
          : Response.json({ error: "unauthorized" }, { status: 401 }),
    })
    const offline = await probeLlamaServer({
      baseURL: "http://offline.test/v1",
      apiKey: undefined,
      request: async () => {
        throw new Error("connection refused")
      },
    })

    expect(loading.status).toBe("loading")
    expect(unauthorized.status).toBe("unauthorized")
    expect(offline.status).toBe("offline")
    expect(offline.error).toContain("connection refused")
    expect((await probeLlamaServer({ baseURL: "", apiKey: undefined })).status).toBe("unconfigured")
  })

  test("keeps manually configured models authoritative over discovery", async () => {
    const probe = await probeLlamaServer({
      baseURL: "http://models.test/v1",
      apiKey: undefined,
      request: async (input) =>
        new URL(String(input)).pathname === "/v1/models"
          ? Response.json({ data: [{ id: "configured" }, { id: "discovered" }] })
          : Response.json({ status: "ok" }),
    })

    expect(
      llamaServerDiscoveredChatModels(probe, {
        configured: { id: "configured", name: "Manual", tool_call: false },
      }),
    ).toEqual({
      discovered: { id: "discovered", name: "discovered", attachment: false, tool_call: false },
    })
  })
})
