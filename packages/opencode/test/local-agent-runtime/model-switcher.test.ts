import { describe, expect, test } from "bun:test"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelSwitcher } from "@/local-agent-runtime/model-switcher"
import type { LmStudioRequest } from "@/local-agent-runtime/lmstudio"
import { acquireModel } from "@/local-agent-runtime/resource-governor"
import type { Provider } from "@/provider/provider"

describe("LM Studio model switcher", () => {
  test("keeps a capable selected model without switching when global routing is disabled", async () => {
    const requests: string[] = []
    const selected = model("selected", "selected-instance")
    const result = await ModelSwitcher.activate({
      config: {
        provider: {
          lmstudio: {
            auto_route: false,
            options: { baseURL: "http://switch-disabled.test/v1" },
          },
        },
      },
      preferredModel: selected,
      requestShape: { textCharacters: 2_000, files: 1, images: 0, tools: 5 },
      resources: healthyResources(),
      request: bridge([native("selected", "selected-instance", { tools: true })], requests),
    })

    expect(result.model.api.id).toBe("selected-instance")
    expect(result.model.limit.context).toBe(32_768)
    expect(result.plan.activation).toMatchObject({
      status: "ready",
      activeModelID: "selected",
      attempts: 0,
      failover: false,
    })
    expect(result.plan.reason).toContain("routing.disabled")
    expect(requests).toEqual(["GET /api/v1/models"])
    expect(requests.some((request) => request.startsWith("POST "))).toBe(false)
  })

  test("caps a manually selected model to the independent chat context", async () => {
    const requests: string[] = []
    const cacheInitialization: Array<{
      type: "started" | "finished"
      startedAt: number
      completedAt?: number
      status?: "completed" | "failed"
    }> = []
    let instanceID = "selected-instance"
    let context = 91_648
    const request: LmStudioRequest = async (input, init) => {
      const url = new URL(String(input))
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`)
      if (url.pathname === "/v1/models") return Response.json({ data: instanceID ? [{ id: instanceID }] : [] })
      if (url.pathname === "/api/v1/models")
        return Response.json({
          models: [native("selected", instanceID || undefined, {}, context, 20 * 1024 ** 3)],
        })
      if (url.pathname === "/api/v1/models/unload") {
        instanceID = ""
        return Response.json({})
      }
      if (url.pathname === "/api/v1/models/load") {
        const body = JSON.parse(String(init?.body)) as { model: string; context_length: number }
        context = body.context_length
        instanceID = "selected-chat-instance"
        return Response.json({ instance_id: instanceID, load_config: { context_length: context } })
      }
      return Response.json({})
    }
    const result = await ModelSwitcher.activate({
      config: {
        provider: {
          lmstudio: {
            auto_route: false,
            options: { baseURL: "http://switch-chat-context.test/v1" },
          },
        },
      },
      preferredModel: {
        ...model("selected", "selected-instance"),
        limit: { context: 91_648, output: 1_024 },
      },
      contextLimit: 32_768,
      requestShape: { textCharacters: 30, files: 0, images: 0, tools: 0 },
      resources: healthyResources(),
      request,
      onCacheInitialization: async (event) => {
        cacheInitialization.push(event)
      },
    })

    expect(result.model.limit.context).toBe(32_768)
    expect(result.model.api.id).toBe("selected-chat-instance")
    expect(result.plan.activation).toMatchObject({ status: "switched", failover: false })
    expect(result.telemetry).toMatchObject({ cacheInitializationStatus: "completed" })
    expect(cacheInitialization).toEqual([
      { type: "started", startedAt: expect.any(Number) },
      {
        type: "finished",
        startedAt: cacheInitialization[0]!.startedAt,
        completedAt: expect.any(Number),
        status: "completed",
      },
    ])
    expect(requests).toContain("POST /api/v1/models/unload")
    expect(requests).toContain("POST /api/v1/models/load")
  })

  test("reapplies a chat context cap to a model restored from a durable checkpoint", () => {
    expect(
      ModelSwitcher.withContextLimit(
        {
          ...model("selected", "selected-instance"),
          limit: { context: 91_648, input: 80_000, output: 8_192 },
        },
        16_384,
      ).limit,
    ).toEqual({ context: 16_384, input: 16_384, output: 4_096 })
  })

  test("rejects a weak primary model instead of silently using it when routing is disabled", async () => {
    const requests: string[] = []
    const result = await ModelSwitcher.activate({
      config: {
        provider: {
          lmstudio: {
            auto_route: false,
            options: { baseURL: "http://switch-disabled-weak.test/v1" },
          },
        },
      },
      preferredModel: model("small", "small-instance"),
      requestShape: { textCharacters: 2_000, files: 1, images: 0, tools: 5 },
      resources: healthyResources(),
      request: bridge([native("small", "small-instance", { tools: true }, 16_384, 4 * 1024 ** 3)], requests),
    })

    expect(result.plan.activation).toMatchObject({ status: "failed", attempts: 0, failover: false })
    expect(result.plan.activation?.reason).toContain("routing.disabled")
    expect(result.plan.activation?.reason).toContain("manual.primary_too_small")
    expect(ModelSwitcher.failureMessage(result)).toContain("below the configured minimum size")
    expect(requests.some((request) => request.startsWith("POST "))).toBe(false)
  })

  test("hands a session to an already loaded compatible model without a load request", async () => {
    const requests: string[] = []
    const result = await ModelSwitcher.activate({
      config: config("http://switch-loaded.test/v1"),
      preferredModel: model("target", "target-instance"),
      requestShape: { textCharacters: 2_000, files: 1, images: 0, tools: 5 },
      resources: healthyResources(),
      request: bridge(
        [native("old", "old-instance"), native("target", "target-instance", { tools: true, reasoning: true })],
        requests,
      ),
    })

    expect(String(result.model.id)).toBe("target")
    expect(result.model.api.id).toBe("target-instance")
    expect(result.plan.activation).toMatchObject({ status: "ready", attempts: 1, failover: false })
    expect(requests.some((request) => request === "POST /api/v1/models/load")).toBe(false)
  })

  test("keeps the selected coding instance when a smaller loaded model advertises a larger context", async () => {
    const requests: string[] = []
    const result = await ModelSwitcher.activate({
      config: config("http://switch-preferred.test/v1"),
      preferredModel: model("catalog-alias", "large-instance"),
      requestShape: { textCharacters: 1_200, files: 0, images: 0, tools: 1 },
      resources: healthyResources(),
      request: bridge(
        [
          native("small-utility", "small-instance", { tools: true, reasoning: true }, 40_960, 2 * 1024 ** 3),
          native("large-coder", "large-instance", { tools: true }, 8_192, 20 * 1024 ** 3),
        ],
        requests,
      ),
    })

    expect(String(result.model.id)).toBe("large-coder")
    expect(result.model.api.id).toBe("large-instance")
    expect(result.model.limit.context).toBe(8_192)
    expect(result.plan.selections.find((selection) => selection.role === "utility")?.modelID).toBe("small-utility")
    expect(result.plan.activation).toMatchObject({ status: "ready", activeModelID: "large-coder" })
  })

  test("uses the small utility model only for an explicit utility turn", async () => {
    const requests: string[] = []
    const result = await ModelSwitcher.activate({
      config: config("http://switch-utility.test/v1"),
      preferredModel: model("catalog-alias", "large-coder"),
      role: "utility",
      requestShape: { textCharacters: 0, files: 0, images: 0, tools: 0 },
      resources: healthyResources(),
      request: bridge(
        [
          native("small-utility", "small-instance", { reasoning: true }, 40_960, 2 * 1024 ** 3),
          native("large-coder", "large-instance", { tools: true }, 8_192, 20 * 1024 ** 3),
        ],
        requests,
      ),
    })

    expect(String(result.model.id)).toBe("small-utility")
    expect(result.model.api.id).toBe("small-instance")
    expect(result.plan.activation).toMatchObject({ role: "utility", activeModelID: "small-utility" })
    expect(result.plan.activation?.reason).toContain("switch.previous.preserved")
    expect(requests.some((request) => request === "POST /api/v1/models/unload")).toBe(false)
  })

  test("reloads the selected coding model when LM Studio reports only the loaded utility model", async () => {
    const requests: string[] = []
    const loaded = new Map<string, string>([["small-utility", "small-instance"]])
    const request: LmStudioRequest = async (input, init) => {
      const url = new URL(String(input))
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`)
      if (url.pathname === "/v1/models") return Response.json({ data: [...loaded.values()].map((id) => ({ id })) })
      if (url.pathname === "/api/v1/models")
        return Response.json({
          models: [
            native("small-utility", loaded.get("small-utility"), { tools: true, reasoning: true }, 40_960),
            ...(loaded.has("large-coder")
              ? [native("large-coder", loaded.get("large-coder"), { tools: true }, 8_192)]
              : []),
          ],
        })
      if (url.pathname === "/api/v1/models/load") {
        const body = JSON.parse(String(init?.body)) as { model: string; context_length: number }
        loaded.set(body.model, `${body.model}-instance`)
        return Response.json({
          instance_id: `${body.model}-instance`,
          load_config: { context_length: body.context_length },
        })
      }
      return Response.json({})
    }
    const result = await ModelSwitcher.activate({
      config: config("http://switch-reload-selected.test/v1"),
      preferredModel: model("catalog-alias", "large-coder"),
      requestShape: { textCharacters: 2_000, files: 1, images: 0, tools: 5 },
      resources: healthyResources(),
      request,
    })

    expect(String(result.model.id)).toBe("large-coder")
    expect(result.model.api.id).toBe("large-coder-instance")
    expect(result.plan.candidateCount).toBe(2)
    expect(result.plan.activation).toMatchObject({ status: "switched", failover: false })
    expect(requests.filter((item) => item === "POST /api/v1/models/load")).toHaveLength(1)
  })

  test("does not override LM Studio context when the selected model context is locked", async () => {
    const loaded = new Map<string, string>()
    let loadBody: Record<string, unknown> | undefined
    const request: LmStudioRequest = async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === "/v1/models") return Response.json({ data: [...loaded.values()].map((id) => ({ id })) })
      if (url.pathname === "/api/v1/models")
        return Response.json({
          models: [native("target", loaded.get("target"), { tools: true, reasoning: true }, 12_288)],
        })
      if (url.pathname === "/api/v1/models/load") {
        loadBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        loaded.set("target", "target-instance")
        return Response.json({ instance_id: "target-instance", load_config: { context_length: 12_288 } })
      }
      return Response.json({})
    }
    const result = await ModelSwitcher.activate({
      config: {
        provider: {
          lmstudio: {
            options: { baseURL: "http://switch-preserve-context.test/v1" },
            models: { target: { preserve_context: true } },
          },
        },
      },
      preferredModel: model("target", "target"),
      requestShape: { textCharacters: 2_000, files: 1, images: 0, tools: 5 },
      resources: healthyResources(),
      request,
    })

    expect(loadBody).toEqual({ model: "target", echo_load_config: true })
    expect(result.model.limit.context).toBe(12_288)
    expect(result.plan.activation?.reason).toContain("switch.context.preserved")
  })

  test("fails closed after the selected coding model fails to load", async () => {
    const requests: string[] = []
    const loaded = new Map<string, string>([["old", "old-instance"]])
    const request: LmStudioRequest = async (input, init) => {
      const url = new URL(String(input))
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`)
      if (url.pathname === "/v1/models") return Response.json({ data: [...loaded.values()].map((id) => ({ id })) })
      if (url.pathname === "/api/v1/models")
        return Response.json({
          models: [
            native("old", loaded.get("old")),
            native("primary", loaded.get("primary"), { tools: true, reasoning: true }),
            native("backup", loaded.get("backup"), { tools: true }),
          ],
        })
      if (url.pathname === "/api/v1/models/load") {
        const body = JSON.parse(String(init?.body)) as { model: string; context_length: number }
        if (body.model === "primary") return Response.json({ error: "load failed" }, { status: 500 })
        loaded.set(body.model, `${body.model}-instance`)
        return Response.json({
          instance_id: `${body.model}-instance`,
          load_config: { context_length: body.context_length },
        })
      }
      return Response.json({})
    }
    const result = await ModelSwitcher.activate({
      config: config("http://switch-fallback.test/v1"),
      preferredModel: model("primary", "primary-instance"),
      requestShape: { textCharacters: 5_000, files: 2, images: 0, tools: 6 },
      resources: healthyResources(),
      request,
    })

    expect(String(result.model.id)).toBe("primary")
    expect(result.plan.activation).toMatchObject({ status: "failed", attempts: 1, failover: false, rollback: false })
    expect(result.plan.activation?.reason).toContain("switch.primary.failed")
    expect(ModelSwitcher.failureMessage(result)).toContain('LM Studio could not activate "primary"')
    expect(ModelSwitcher.failureMessage(result)).toContain("load failed")
    expect(ModelSwitcher.failureMessage(result)).toContain("No fallback model was used")
    expect(requests.filter((request) => request === "POST /api/v1/models/load")).toHaveLength(1)
    expect(loaded.has("backup")).toBe(false)
    expect(requests.some((request) => request === "POST /api/v1/models/unload")).toBe(false)
  })

  test("does not substitute another model when the selected model lacks a required capability", async () => {
    const requests: string[] = []
    const request: LmStudioRequest = async (input, init) => {
      const url = new URL(String(input))
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`)
      if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "old-instance" }] })
      if (url.pathname === "/api/v1/models")
        return Response.json({
          models: [
            native("old", "old-instance"),
            native("primary", undefined, { tools: true, reasoning: true }),
            native("backup", undefined, { tools: true }),
          ],
        })
      if (url.pathname === "/api/v1/models/load") return Response.json({ error: "cannot load" }, { status: 500 })
      return Response.json({})
    }
    const result = await ModelSwitcher.activate({
      config: config("http://switch-rollback.test/v1"),
      preferredModel: model("old", "old-instance"),
      requestShape: { textCharacters: 5_000, files: 2, images: 0, tools: 6 },
      resources: healthyResources(),
      request,
    })

    expect(String(result.model.id)).toBe("old")
    expect(result.model.api.id).toBe("old-instance")
    expect(result.plan.activation).toMatchObject({ status: "failed", attempts: 0, failover: false, rollback: false })
    expect(result.plan.activation?.reason).toContain("switch.no_candidate")
    expect(ModelSwitcher.failureMessage(result)).toContain("no allowed LM Studio model satisfies")
    expect(requests.filter((request) => request === "POST /api/v1/models/load")).toHaveLength(0)
    expect(requests.some((request) => request === "POST /api/v1/models/unload")).toBe(false)
  })

  test("reports the Resource Governor reason when memory prevents model activation", async () => {
    const resources = healthyResources()
    const result = await ModelSwitcher.activate({
      config: config("http://switch-memory.test/v1"),
      preferredModel: model("large-coder", "large-coder"),
      requestShape: { textCharacters: 2_000, files: 1, images: 0, tools: 5 },
      resources: {
        ...resources,
        status: "pressured",
        memory: { ...resources.memory, availableBytes: 3 * 1024 ** 3, availablePercent: 5 },
      },
      request: bridge([native("large-coder", undefined, { tools: true }, 8_192, 16 * 1024 ** 3)], []),
    })

    expect(result.plan.activation?.reason).toContain("switch.primary.memory")
    expect(ModelSwitcher.failureMessage(result)).toContain("Resource Governor refused the launch")
    expect(ModelSwitcher.failureMessage(result)).toContain("Unload another LM Studio model")
  })

  test("unloads only a previous instance managed by OpenCode after the replacement is ready", async () => {
    const requests: string[] = []
    const loaded = new Map<string, string>([["old", "old-instance"]])
    let exposeVision = false
    const request: LmStudioRequest = async (input, init) => {
      const url = new URL(String(input))
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`)
      if (url.pathname === "/v1/models") return Response.json({ data: [...loaded.values()].map((id) => ({ id })) })
      if (url.pathname === "/api/v1/models")
        return Response.json({
          models: [
            native("old", loaded.get("old")),
            native("coding", loaded.get("coding"), { tools: true, reasoning: true }),
            ...(exposeVision
              ? [native("vision", loaded.get("vision"), { tools: true, reasoning: true, vision: true })]
              : []),
          ],
        })
      if (url.pathname === "/api/v1/models/load") {
        const body = JSON.parse(String(init?.body)) as { model: string; context_length: number }
        loaded.set(body.model, `${body.model}-instance`)
        return Response.json({
          instance_id: `${body.model}-instance`,
          load_config: { context_length: body.context_length },
        })
      }
      if (url.pathname === "/api/v1/models/unload") {
        const body = JSON.parse(String(init?.body)) as { instance_id: string }
        for (const [modelID, instanceID] of loaded) if (instanceID === body.instance_id) loaded.delete(modelID)
        return Response.json({ instance_id: body.instance_id })
      }
      return Response.json({})
    }
    const runtime = config("http://switch-cleanup.test/v1")
    const coding = await ModelSwitcher.activate({
      config: runtime,
      preferredModel: model("coding", "coding-instance"),
      requestShape: { textCharacters: 3_000, files: 1, images: 0, tools: 5 },
      resources: healthyResources(),
      request,
    })
    exposeVision = true
    const vision = await ModelSwitcher.activate({
      config: runtime,
      preferredModel: coding.model,
      requestShape: { textCharacters: 100, files: 1, images: 1, tools: 5 },
      vision: visionReport(),
      resources: healthyResources(),
      request,
    })

    expect(coding.model.api.id).toBe("coding-instance")
    expect(vision.model.api.id).toBe("vision-instance")
    expect(vision.plan.activation?.reason).toContain("switch.previous.unloaded")
    expect(vision.plan.vision).toMatchObject({
      status: "prepared",
      modelID: "vision",
      instanceID: "vision-instance",
      imageCount: 1,
      failover: false,
    })
    expect(loaded.has("coding")).toBe(false)
    expect(requests.filter((item) => item === "POST /api/v1/models/unload")).toHaveLength(1)
  })

  test("marks a screenshot request failed when no vision-capable model exists", async () => {
    const result = await ModelSwitcher.activate({
      config: config("http://switch-no-vision.test/v1"),
      preferredModel: model("text", "text-instance"),
      requestShape: { textCharacters: 100, files: 1, images: 1, tools: 1 },
      vision: visionReport(),
      resources: healthyResources(),
      request: bridge([native("text", "text-instance", { tools: true })], []),
    })

    expect(result.plan.activation).toMatchObject({ status: "failed", role: "vision" })
    expect(result.plan.vision).toMatchObject({
      status: "failed",
      modelID: "text",
      imageCount: 1,
      failover: false,
    })
    expect(result.plan.vision?.reason).toContain("vision.model.unavailable")
    expect(ModelSwitcher.failureMessage(result)).toContain("vision-capable")
  })

  test("fails closed when the selected vision model fails to load", async () => {
    const loaded = new Map<string, string>([["text", "text-instance"]])
    const request: LmStudioRequest = async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === "/v1/models") return Response.json({ data: [...loaded.values()].map((id) => ({ id })) })
      if (url.pathname === "/api/v1/models")
        return Response.json({
          models: [
            native("text", loaded.get("text"), { tools: true }),
            native(
              "vision-primary",
              loaded.get("vision-primary"),
              {
                tools: true,
                reasoning: true,
                vision: true,
              },
              65_536,
            ),
            native("vision-backup", loaded.get("vision-backup"), { tools: true, vision: true }, 32_768),
          ],
        })
      if (url.pathname === "/api/v1/models/load") {
        const body = JSON.parse(String(init?.body)) as { model: string; context_length: number }
        if (body.model === "vision-primary") return Response.json({ error: "load failed" }, { status: 500 })
        loaded.set(body.model, `${body.model}-instance`)
        return Response.json({
          instance_id: `${body.model}-instance`,
          load_config: { context_length: body.context_length },
        })
      }
      return Response.json({})
    }
    const result = await ModelSwitcher.activate({
      config: config("http://switch-vision-fallback.test/v1"),
      preferredModel: model("text", "text-instance"),
      requestShape: { textCharacters: 100, files: 1, images: 1, tools: 1 },
      vision: visionReport(),
      resources: healthyResources(),
      request,
    })

    expect(String(result.model.id)).toBe("text")
    expect(result.plan.activation).toMatchObject({
      status: "rolled_back",
      role: "vision",
      attempts: 1,
      failover: false,
    })
    expect(result.plan.vision).toMatchObject({ status: "failed", modelID: "text", failover: false })
    expect(result.plan.vision?.reason).not.toContain("vision.fallback")
    expect(loaded.has("vision-backup")).toBe(false)
  })

  test("keeps a managed previous instance while another session is using it", async () => {
    const requests: string[] = []
    const loaded = new Map<string, string>([["old", "old-instance"]])
    let exposeVision = false
    const request: LmStudioRequest = async (input, init) => {
      const url = new URL(String(input))
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`)
      if (url.pathname === "/v1/models") return Response.json({ data: [...loaded.values()].map((id) => ({ id })) })
      if (url.pathname === "/api/v1/models")
        return Response.json({
          models: [
            native("old", loaded.get("old")),
            native("coding", loaded.get("coding"), { tools: true, reasoning: true }),
            ...(exposeVision
              ? [native("vision", loaded.get("vision"), { tools: true, reasoning: true, vision: true })]
              : []),
          ],
        })
      if (url.pathname === "/api/v1/models/load") {
        const body = JSON.parse(String(init?.body)) as { model: string; context_length: number }
        loaded.set(body.model, `${body.model}-instance`)
        return Response.json({
          instance_id: `${body.model}-instance`,
          load_config: { context_length: body.context_length },
        })
      }
      if (url.pathname === "/api/v1/models/unload") return Response.json({})
      return Response.json({})
    }
    const baseURL = "http://switch-busy.test/v1"
    const runtime = config(baseURL)
    const coding = await ModelSwitcher.activate({
      config: runtime,
      preferredModel: model("coding", "coding-instance"),
      requestShape: { textCharacters: 3_000, files: 1, images: 0, tools: 5 },
      resources: healthyResources(),
      request,
    })
    const permit = await acquireModel({ providerID: "lmstudio", apiURL: baseURL, modelID: coding.model.api.id })
    exposeVision = true
    const vision = await ModelSwitcher.activate({
      config: runtime,
      preferredModel: coding.model,
      requestShape: { textCharacters: 100, files: 1, images: 1, tools: 5 },
      resources: healthyResources(),
      request,
    })
    await permit.release()

    expect(vision.plan.activation?.reason).toContain("switch.previous.busy")
    expect(loaded.has("coding")).toBe(true)
    expect(requests.some((item) => item === "POST /api/v1/models/unload")).toBe(false)
  })
})

function config(baseURL: string) {
  return { provider: { lmstudio: { options: { baseURL } } } } satisfies ConfigV1.Info
}

function model(id: string, apiID: string): Provider.Model {
  return {
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.make("lmstudio"),
    api: { id: apiID, url: "", npm: "@ai-sdk/openai-compatible" },
    name: id,
    family: "",
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 16_384, output: 1_024 },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
    variants: {},
  }
}

function native(
  key: string,
  instanceID?: string,
  capabilities: { tools?: boolean; reasoning?: boolean; vision?: boolean } = {},
  context = 32_768,
  sizeBytes = 16 * 1024 ** 3,
) {
  return {
    key,
    display_name: key,
    type: "llm",
    max_context_length: context,
    size_bytes: sizeBytes,
    loaded_instances: instanceID ? [{ id: instanceID, config: { context_length: context } }] : [],
    capabilities: {
      trained_for_tool_use: capabilities.tools === true,
      vision: capabilities.vision === true,
      reasoning: capabilities.reasoning ? { allowed_options: ["low"] } : undefined,
    },
  }
}

function bridge(models: ReturnType<typeof native>[], requests: string[]): LmStudioRequest {
  return async (input, init) => {
    const url = new URL(String(input))
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`)
    if (url.pathname === "/api/v1/models") return Response.json({ models })
    if (url.pathname === "/v1/models")
      return Response.json({
        data: models.flatMap((item) => item.loaded_instances.map((instance) => ({ id: instance.id }))),
      })
    return Response.json({})
  }
}

function healthyResources() {
  return {
    status: "healthy" as const,
    checkedAt: 1,
    memory: {
      totalBytes: 64 * 1024 ** 3,
      availableBytes: 48 * 1024 ** 3,
      availablePercent: 75,
      processRssBytes: 256 * 1024 ** 2,
      processHeapBytes: 128 * 1024 ** 2,
    },
    limits: {
      modelConcurrency: 1,
      contextPercent: 90,
      pressureAvailablePercent: 12,
      criticalAvailablePercent: 6,
      minFreeBytes: 2 * 1024 ** 3,
      criticalFreeBytes: 1 * 1024 ** 3,
    },
    activity: { activeModelRequests: 0, waitingModelRequests: 0 },
    counters: { contextAdjustments: 0, throttledModelRequests: 0, rejectedModelRequests: 0 },
  }
}

function visionReport() {
  return {
    status: "prepared" as const,
    checkedAt: 1,
    imageCount: 1,
    originalBytes: 2_048,
    preparedBytes: 1_024,
    estimatedTokens: 170,
    failover: false,
    reason: ["vision.file_reference", "vision.compressed"],
    artifacts: [
      {
        fileURL: "file:///tmp/screenshot.jpg",
        filename: "screenshot.jpg",
        mime: "image/jpeg",
        originalWidth: 1_024,
        originalHeight: 768,
        originalBytes: 2_048,
        preparedWidth: 512,
        preparedHeight: 384,
        preparedBytes: 1_024,
        compressed: true,
        estimatedTokens: 170,
        reason: ["vision.file_reference", "vision.compressed"],
      },
    ],
  }
}
