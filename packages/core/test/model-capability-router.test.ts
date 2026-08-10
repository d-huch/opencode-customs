import { describe, expect, test } from "bun:test"
import { ModelCapabilityRouter } from "../src/model-capability-router"

const gib = 1024 ** 3

describe("ModelCapabilityRouter", () => {
  test("derives task complexity from request shape without domain vocabulary", () => {
    expect(ModelCapabilityRouter.complexity({ textCharacters: 100, files: 0, images: 0, tools: 0 })).toBe("low")
    expect(ModelCapabilityRouter.complexity({ textCharacters: 900, files: 0, images: 0, tools: 0 })).toBe("medium")
    expect(ModelCapabilityRouter.complexity({ textCharacters: 20, files: 0, images: 1, tools: 0 })).toBe("high")
  })

  test("routes auxiliary, coding, vision, and embedding roles without an interactive fallback", () => {
    const plan = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "healthy",
      complexity: "high",
      needsVision: true,
      preferredModelID: "code",
      candidates: [
        candidate("embed", "embedding", 1 * gib, { embeddings: true }),
        candidate("utility", "llm", 2 * gib),
        candidate("code", "llm", 12 * gib, { tools: true, reasoning: true }),
        candidate("vision", "llm", 8 * gib, { tools: true, vision: true }),
        candidate("vision-backup", "llm", 7 * gib, { tools: true, vision: true }),
      ],
    })

    expect(plan.status).toBe("ready")
    expect(Object.fromEntries(plan.selections.map((selection) => [selection.role, selection.modelID]))).toEqual({
      embedding: "embed",
      utility: "utility",
      coding: "code",
      vision: "vision",
    })
    expect(plan.selections.some((selection) => selection.role === "fallback")).toBe(false)
  })

  test("critical pressure favors a smaller capable utility model and excludes unloaded models", () => {
    const plan = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "critical",
      complexity: "medium",
      candidates: [
        candidate("small", "llm", 2 * gib),
        candidate("large", "llm", 20 * gib, { tools: true, reasoning: true }),
        { ...candidate("unloaded", "llm", 1 * gib), loaded: false },
      ],
    })

    expect(plan.selections.find((selection) => selection.role === "utility")?.modelID).toBe("small")
    expect(plan.selections.some((selection) => selection.role === "coding")).toBe(false)
    expect(plan.selections.some((selection) => selection.modelID === "unloaded")).toBe(false)
  })

  test("can recommend an unloaded model for guarded activation without doing so under critical pressure", () => {
    const candidates = [
      candidate("loaded", "llm", 4 * gib),
      { ...candidate("available", "llm", 8 * gib, { tools: true, reasoning: true }), loaded: false },
    ]
    const healthy = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "healthy",
      complexity: "high",
      candidates,
      allowUnloaded: true,
      preferredModelID: "available",
    })
    const critical = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "critical",
      complexity: "high",
      candidates,
      allowUnloaded: true,
      preferredModelID: "available",
    })

    expect(healthy.selections.find((selection) => selection.role === "coding")?.modelID).toBe("available")
    expect(healthy.selections.find((selection) => selection.role === "coding")?.reason).toContain("candidate.unloaded")
    expect(critical.selections.some((selection) => selection.modelID === "available")).toBe(false)
  })

  test("does not invent a coding selection without an explicit model choice", () => {
    const plan = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "healthy",
      complexity: "low",
      candidates: [candidate("small", "llm", 2 * gib, { tools: true, reasoning: true })],
    })

    expect(plan.status).toBe("unavailable")
    expect(plan.selections.find((selection) => selection.role === "utility")?.modelID).toBe("small")
    expect(plan.selections.some((selection) => selection.role === "coding")).toBe(false)
  })

  test("keeps an explicit compatible coding model even when a small utility model advertises more context", () => {
    const plan = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "healthy",
      complexity: "medium",
      preferredModelID: "large-coder",
      needsTools: true,
      candidates: [
        { ...candidate("small-utility", "llm", 2 * gib, { tools: true, reasoning: true }), context: 40_960 },
        { ...candidate("large-coder", "llm", 20 * gib, { tools: true }), context: 8_192 },
      ],
    })

    expect(plan.selections.find((selection) => selection.role === "utility")?.modelID).toBe("small-utility")
    expect(plan.selections.find((selection) => selection.role === "coding")?.modelID).toBe("large-coder")
    expect(plan.selections.find((selection) => selection.role === "coding")?.reason).toContain("preference.explicit")
  })

  test("fails closed when the explicitly selected coding model cannot handle the turn", () => {
    const plan = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "healthy",
      complexity: "low",
      preferredModelID: "chat-only",
      needsTools: true,
      candidates: [candidate("chat-only", "llm", 1 * gib), candidate("tool-model", "llm", 4 * gib, { tools: true })],
    })

    expect(plan.status).toBe("unavailable")
    expect(plan.selections.some((selection) => selection.role === "coding")).toBe(false)
    expect(plan.selections.some((selection) => selection.modelID === "tool-model")).toBe(false)
  })

  test("does not emit a fallback selection for screenshot requests", () => {
    const plan = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "healthy",
      complexity: "high",
      preferredModelID: "coding",
      needsVision: true,
      needsTools: true,
      candidates: [
        candidate("coding", "llm", 4 * gib, { tools: true }),
        candidate("vision-primary", "llm", 6 * gib, { tools: true, vision: true, reasoning: true }),
        candidate("text-backup", "llm", 1 * gib, { tools: true }),
        candidate("vision-backup", "llm", 5 * gib, { tools: true, vision: true }),
      ],
    })

    expect(plan.selections.find((selection) => selection.role === "vision")?.capabilities.vision).toBe(true)
    expect(plan.selections.some((selection) => selection.role === "fallback")).toBe(false)
  })

  test("excludes blocked models from automatic roles but keeps an explicit coding choice", () => {
    const plan = ModelCapabilityRouter.plan({
      providerID: "lmstudio",
      pressure: "healthy",
      complexity: "high",
      preferredModelID: "manual-coder",
      needsVision: true,
      needsTools: true,
      disabledModelIDs: ["manual-coder", "blocked-vision", "blocked-embed"],
      candidates: [
        candidate("manual-coder", "llm", 16 * gib, { tools: true, reasoning: true }),
        candidate("utility", "llm", 2 * gib, { tools: true }),
        candidate("blocked-vision", "llm", 12 * gib, { tools: true, vision: true, reasoning: true }),
        candidate("allowed-vision", "llm", 8 * gib, { tools: true, vision: true }),
        candidate("blocked-embed", "embedding", 1 * gib, { embeddings: true }),
        candidate("allowed-embed", "embedding", 2 * gib, { embeddings: true }),
      ],
    })

    expect(plan.selections.find((selection) => selection.role === "coding")?.modelID).toBe("manual-coder")
    expect(plan.selections.find((selection) => selection.role === "utility")?.modelID).toBe("utility")
    expect(plan.selections.find((selection) => selection.role === "vision")?.modelID).toBe("allowed-vision")
    expect(plan.selections.find((selection) => selection.role === "embedding")?.modelID).toBe("allowed-embed")
    expect(plan.candidateCount).toBe(3)
    expect(plan.reason).toContain("candidates.blocked")
  })
})

function candidate(
  modelID: string,
  type: "llm" | "embedding",
  sizeBytes: number,
  capabilities: Partial<ModelCapabilityRouter.Candidate["capabilities"]> = {},
): ModelCapabilityRouter.Candidate {
  return {
    providerID: "lmstudio",
    modelID,
    name: modelID,
    loaded: true,
    type,
    context: type === "embedding" ? 8_192 : 32_768,
    sizeBytes,
    capabilities: {
      tools: false,
      vision: false,
      reasoning: false,
      embeddings: false,
      ...capabilities,
    },
  }
}
