import { describe, expect, test } from "bun:test"
import {
  evaluateMemoryPressure,
  isLocalModelCrash,
  minimumManagedContext,
  parseMacAvailableMemory,
  rejectForPressure,
  safeContextBudget,
  snapshot,
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
  test("keeps automatically managed model context at 8192 when the model supports it", () => {
    expect(minimumManagedContext(4_096)).toBe(8_192)
    expect(minimumManagedContext(4_096, 32_768)).toBe(8_192)
    expect(minimumManagedContext(16_384, 32_768)).toBe(16_384)
    expect(minimumManagedContext(4_096, 4_096)).toBe(4_096)
  })

  test("counts macOS file cache as available without counting inactive anonymous memory", () => {
    expect(
      parseMacAvailableMemory(`Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    25000.
Pages active:                                 800000.
Pages inactive:                              850000.
Pages speculative:                            10000.
Pages wired down:                            200000.
File-backed pages:                           420000.
Anonymous pages:                            1240000.`),
    ).toBe((25_000 + 420_000) * 16_384)
    expect(parseMacAvailableMemory("not vm_stat output")).toBeUndefined()
  })

  test("samples host memory through the Node-compatible runtime path", () => {
    const sample = snapshot().memory
    expect(sample.totalBytes).toBeGreaterThan(0)
    expect(sample.availableBytes).toBeGreaterThan(0)
    expect(sample.availableBytes).toBeLessThanOrEqual(sample.totalBytes)
  })

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

  test("keeps interactive requests available while background work remains pressure-gated", () => {
    expect(rejectForPressure("critical", "interactive")).toBe(false)
    expect(rejectForPressure("critical", "background")).toBe(true)
    expect(rejectForPressure("pressured", "background")).toBe(false)
  })

  test("recognizes an LM Studio model process crash without classifying unrelated failures", () => {
    expect(
      isLocalModelCrash(new Error("The model has crashed without additional information. (Exit code: null)")),
    ).toBe(true)
    expect(isLocalModelCrash({ data: { message: "model process crashed" } })).toBe(true)
    expect(isLocalModelCrash(new Error("Request timed out"))).toBe(false)
  })
})
