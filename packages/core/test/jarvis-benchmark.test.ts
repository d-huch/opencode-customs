import { describe, expect, test } from "bun:test"
import { JarvisBenchmark } from "@opencode-ai/core/jarvis-benchmark"

describe("Jarvis benchmark scoring", () => {
  test("fast rewards low TTFT while quality rewards available context", () => {
    const fastLowLatency = JarvisBenchmark.benchmarkScore("fast", {
      ttftMs: 300,
      totalMs: 2_000,
      tokensPerSecond: 30,
      context: 8_192,
    })
    const fastHighLatency = JarvisBenchmark.benchmarkScore("fast", {
      ttftMs: 2_000,
      totalMs: 4_000,
      tokensPerSecond: 30,
      context: 131_072,
    })
    const qualityLargeContext = JarvisBenchmark.benchmarkScore("quality", {
      ttftMs: 2_000,
      totalMs: 4_000,
      tokensPerSecond: 30,
      context: 131_072,
    })
    const qualitySmallContext = JarvisBenchmark.benchmarkScore("quality", {
      ttftMs: 2_000,
      totalMs: 4_000,
      tokensPerSecond: 30,
      context: 8_192,
    })

    expect(fastLowLatency).toBeGreaterThan(fastHighLatency)
    expect(qualityLargeContext).toBeGreaterThan(qualitySmallContext)
  })

  test("rejects models that miss Ukrainian, instruction, tool, or context gates", () => {
    expect(
      JarvisBenchmark.benchmarkPassesGates({ ukrainian: true, instructions: true, toolCalling: true, context: 8_192 }),
    ).toBe(true)
    expect(
      JarvisBenchmark.benchmarkPassesGates({ ukrainian: true, instructions: true, toolCalling: false, context: 131_072 }),
    ).toBe(false)
    expect(
      JarvisBenchmark.benchmarkPassesGates({ ukrainian: false, instructions: true, toolCalling: true, context: 131_072 }),
    ).toBe(false)
  })
})
