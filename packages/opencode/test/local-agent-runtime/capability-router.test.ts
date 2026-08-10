import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { CapabilityRouter } from "@/local-agent-runtime/capability-router"
import { LmStudioProbe } from "@/local-agent-runtime/lmstudio"

describe("LM Studio capability router", () => {
  test("adapts loaded model metadata without model-name or project vocabulary", async () => {
    const config = {
      provider: { lmstudio: { options: { baseURL: "http://router.test/v1" } } },
    } satisfies ConfigV1.Info
    const plan = await CapabilityRouter.route({
      config,
      preferredModelID: "model-b",
      requestShape: { textCharacters: 1_200, files: 2, images: 1, tools: 5 },
      probe: {
        provider: "lmstudio",
        status: "ready",
        baseURL: "http://router.test",
        checkedAt: 1,
        latencyMs: 1,
        api: { native: true, openai: true, chatCompletions: true, responses: true, embeddings: true },
        models: [
          model("model-a", "llm", 2 * 1024 ** 3, { tools: true, vision: true }),
          model("model-b", "llm", 8 * 1024 ** 3, { tools: true, reasoning: true }),
          model("model-c", "embedding", 512 * 1024 ** 2, { embeddings: true }),
        ],
      },
    })

    expect(plan.complexity).toBe("high")
    expect(CapabilityRouter.selection(plan, "coding")?.modelID).toBe("model-b")
    expect(CapabilityRouter.selection(plan, "vision")?.modelID).toBe("model-a")
    expect(CapabilityRouter.selection(plan, "embedding")?.sizeBytes).toBe(512 * 1024 ** 2)
    expect(CapabilityRouter.latest(config)).toEqual(plan)
  })

  test("does not let a background route replace the last interactive selection", async () => {
    const config = {
      provider: { lmstudio: { options: { baseURL: "http://router-background.test/v1" } } },
    } satisfies ConfigV1.Info
    const probe = {
      provider: "lmstudio",
      status: "ready",
      baseURL: "http://router-background.test",
      checkedAt: 1,
      latencyMs: 1,
      api: { native: true, openai: true, chatCompletions: true, responses: true, embeddings: true },
      models: [
        model("small", "llm", 2 * 1024 ** 3, { tools: true }),
        model("large", "llm", 16 * 1024 ** 3, { tools: true, reasoning: true }),
      ],
    } satisfies LmStudioProbe
    const interactive = await CapabilityRouter.route({
      config,
      preferredModelID: "large",
      requestShape: { textCharacters: 500, files: 0, images: 0, tools: 1 },
      probe,
    })

    await CapabilityRouter.route({
      config,
      requestShape: { textCharacters: 0, files: 0, images: 0, tools: 0 },
      probe,
      record: false,
    })

    expect(CapabilityRouter.selection(CapabilityRouter.latest(config)!, "coding")?.modelID).toBe("large")
    expect(CapabilityRouter.latest(config)).toEqual(interactive)
  })

  test("removes legacy fallback selections before publishing runtime state", async () => {
    const config = {
      provider: { lmstudio: { options: { baseURL: "http://router-legacy.test/v1" } } },
    } satisfies ConfigV1.Info
    const plan = await CapabilityRouter.route({
      config,
      preferredModelID: "large",
      requestShape: { textCharacters: 500, files: 0, images: 0, tools: 1 },
      probe: {
        provider: "lmstudio",
        status: "ready",
        baseURL: "http://router-legacy.test",
        checkedAt: 1,
        latencyMs: 1,
        api: { native: true, openai: true, chatCompletions: true, responses: true, embeddings: false },
        models: [model("large", "llm", 16 * 1024 ** 3, { tools: true, reasoning: true })],
      },
    })
    const coding = CapabilityRouter.selection(plan, "coding")!
    CapabilityRouter.record(config, { ...plan, selections: [...plan.selections, { ...coding, role: "fallback" }] })

    expect(CapabilityRouter.latest(config)?.selections.some((selection) => selection.role === "fallback")).toBe(false)
  })

  test("honors automatic route blocks without overriding an explicit coding model", async () => {
    const config = {
      provider: {
        lmstudio: {
          options: { baseURL: "http://router-blocked.test/v1" },
          models: {
            manual: { id: "manual", auto_route: false },
            vision: { id: "blocked-vision", auto_route: false },
          },
        },
      },
    } satisfies ConfigV1.Info
    const plan = await CapabilityRouter.route({
      config,
      preferredModelID: "manual",
      requestShape: { textCharacters: 1_000, files: 0, images: 1, tools: 1 },
      probe: {
        provider: "lmstudio",
        status: "ready",
        baseURL: "http://router-blocked.test",
        checkedAt: 1,
        latencyMs: 1,
        api: { native: true, openai: true, chatCompletions: true, responses: true, embeddings: false },
        models: [
          model("manual", "llm", 16 * 1024 ** 3, { tools: true, reasoning: true }),
          model("blocked-vision", "llm", 10 * 1024 ** 3, { tools: true, vision: true, reasoning: true }),
          model("allowed-vision", "llm", 8 * 1024 ** 3, { tools: true, vision: true }),
        ],
      },
    })

    expect(CapabilityRouter.selection(plan, "coding")?.modelID).toBe("manual")
    expect(CapabilityRouter.selection(plan, "vision")?.modelID).toBe("allowed-vision")
    expect(CapabilityRouter.allowsAutomaticRoute(config, "manual")).toBe(false)
    expect(CapabilityRouter.allowsAutomaticRoute(config, "allowed-vision")).toBe(true)
  })

  test("invalidates the visible route when automatic routing policy changes", async () => {
    const config = {
      provider: { lmstudio: { options: { baseURL: "http://router-policy.test/v1" } } },
    } satisfies ConfigV1.Info
    await CapabilityRouter.route({
      config,
      preferredModelID: "model",
      requestShape: { textCharacters: 100, files: 0, images: 0, tools: 1 },
      probe: {
        provider: "lmstudio",
        status: "ready",
        baseURL: "http://router-policy.test",
        checkedAt: 1,
        latencyMs: 1,
        api: { native: true, openai: true, chatCompletions: true, responses: true, embeddings: false },
        models: [model("model", "llm", 8 * 1024 ** 3, { tools: true })],
      },
    })
    const blocked = {
      provider: {
        lmstudio: {
          options: { baseURL: "http://router-policy.test/v1" },
          models: { model: { auto_route: false } },
        },
      },
    } satisfies ConfigV1.Info

    expect(CapabilityRouter.latest(config)).toBeDefined()
    expect(CapabilityRouter.latest(blocked)).toBeUndefined()
  })

  test("exposes a provider-wide routing switch without disabling embedding eligibility", () => {
    const config = {
      provider: {
        lmstudio: {
          auto_route: false,
          models: { embedding: { auto_route: true } },
        },
      },
    } satisfies ConfigV1.Info

    expect(CapabilityRouter.automaticRoutingEnabled(config)).toBe(false)
    expect(CapabilityRouter.allowsAutomaticRoute(config, "embedding")).toBe(true)
  })
})

function model(
  id: string,
  type: "llm" | "embedding",
  sizeBytes: number,
  capabilities: Partial<LmStudioProbe["models"][number]["capabilities"]>,
): LmStudioProbe["models"][number] {
  return {
    id,
    name: id,
    type,
    loaded: true,
    instances: [`${id}@loaded`],
    context: { active: 16_384, supported: 32_768 },
    sizeBytes,
    capabilities: { tools: false, vision: false, reasoning: false, embeddings: false, ...capabilities },
  }
}
