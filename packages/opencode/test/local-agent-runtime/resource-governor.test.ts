import { describe, expect, test } from "bun:test"
import {
  evaluateMemoryPressure,
  isLocalModelCrash,
  safeContextBudget,
  type MemorySample,
  type Policy,
} from "../../src/local-agent-runtime/resource-governor"

const gib = 1024 ** 3

const limits: Policy = {
  modelConcurrency: 1,
  contextPercent: 90,
  pressureAvailablePercent: 12,
  criticalAvailablePercent: 6,
  minFreeBytes: 2 * gib,
  criticalFreeBytes: gib,
}

function memory(availableBytes: number, processRssBytes = 512 * 1024 ** 2): MemorySample {
  return {
    totalBytes: 32 * gib,
    availableBytes,
    availablePercent: Math.round((availableBytes / (32 * gib)) * 1_000) / 10,
    processRssBytes,
    processHeapBytes: 256 * 1024 ** 2,
  }
}

describe("Local Agent Runtime resource governor", () => {
  test("classifies healthy, pressured, and critical host memory", () => {
    expect(evaluateMemoryPressure(memory(16 * gib), limits)).toBe("healthy")
    expect(evaluateMemoryPressure(memory(3 * gib), limits)).toBe("pressured")
    expect(evaluateMemoryPressure(memory(768 * 1024 ** 2), limits)).toBe("critical")
  })

  test("treats runaway OpenCode RSS as pressure even with free host memory", () => {
    expect(evaluateMemoryPressure(memory(16 * gib, 9 * gib), limits)).toBe("pressured")
    expect(evaluateMemoryPressure(memory(16 * gib, 14 * gib), limits)).toBe("critical")
  })

  test("clamps a configured context to the loaded LM Studio context", () => {
    expect(
      safeContextBudget({
        requestedContext: 32_768,
        runtimeContext: 4_096,
        outputTokens: 1_024,
        status: "healthy",
        contextPercent: 90,
      }),
    ).toEqual({ hardContext: 4_096, safeInputTokens: 2_662, percent: 90 })
  })

  test("reduces the safe context before inference under memory pressure", () => {
    const healthy = safeContextBudget({
      requestedContext: 16_384,
      runtimeContext: 16_384,
      outputTokens: 4_096,
      status: "healthy",
      contextPercent: 90,
    })
    const pressured = safeContextBudget({
      requestedContext: 16_384,
      runtimeContext: 16_384,
      outputTokens: 4_096,
      status: "pressured",
      contextPercent: 90,
    })
    const critical = safeContextBudget({
      requestedContext: 16_384,
      runtimeContext: 16_384,
      outputTokens: 4_096,
      status: "critical",
      contextPercent: 90,
    })

    expect(healthy.safeInputTokens).toBe(10_649)
    expect(pressured.safeInputTokens).toBe(8_192)
    expect(critical.safeInputTokens).toBe(4_915)
  })

  test("recognizes an LM Studio model process crash without classifying unrelated failures", () => {
    expect(
      isLocalModelCrash(new Error("The model has crashed without additional information. (Exit code: null)")),
    ).toBe(true)
    expect(isLocalModelCrash({ data: { message: "model process crashed" } })).toBe(true)
    expect(isLocalModelCrash(new Error("Request timed out"))).toBe(false)
  })
})
