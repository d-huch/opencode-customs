import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { SessionLog } from "../../src/local-agent-runtime/session-log"

const root = path.join(import.meta.dir, ".tmp-session-log")

afterEach(async () => {
  delete process.env.OPENCODE_SESSION_LOG_DIR
  await fs.rm(root, { recursive: true, force: true })
})

describe("session log", () => {
  test("writes one structured JSONL file per session", async () => {
    process.env.OPENCODE_SESSION_LOG_DIR = root

    await Promise.all([
      SessionLog.write({ sessionID: "ses_one", type: "prompt.received", data: { text: "Привіт" } }),
      SessionLog.write({ sessionID: "ses_one", type: "model.request", data: { modelID: "coding" } }),
      SessionLog.write({ sessionID: "ses_two", type: "prompt.received", data: { text: "Hello" } }),
    ])

    const first = (await Bun.file(path.join(root, "ses_one.jsonl")).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(first.map((entry) => entry.type)).toEqual(["prompt.received", "model.request"])
    expect(first[0].data.text).toBe("Привіт")
    expect(await Bun.file(path.join(root, "ses_two.jsonl")).exists()).toBe(true)
  })

  test("clears every session log", async () => {
    process.env.OPENCODE_SESSION_LOG_DIR = root
    await SessionLog.write({ sessionID: "ses_one", type: "prompt.received" })
    await SessionLog.write({ sessionID: "ses_two", type: "prompt.received" })

    await SessionLog.clear()

    expect(await fs.readdir(root)).toEqual([])
  })

  test("reports the safe local path and whether the log exists", async () => {
    process.env.OPENCODE_SESSION_LOG_DIR = root

    expect(await SessionLog.location("ses_one")).toEqual({
      path: path.join(root, "ses_one.jsonl"),
      exists: false,
    })

    await SessionLog.write({ sessionID: "ses_one", type: "prompt.received" })

    expect(await SessionLog.location("ses_one")).toEqual({
      path: path.join(root, "ses_one.jsonl"),
      exists: true,
    })
  })

  test("does not invent unsafe filenames and bounds large strings", async () => {
    process.env.OPENCODE_SESSION_LOG_DIR = root
    await SessionLog.write({ sessionID: "../unsafe", type: "tool.result", data: { output: "x".repeat(40_000) } })

    const files = await fs.readdir(root)
    expect(files).toEqual([".._unsafe.jsonl"])
    const entry = JSON.parse(await Bun.file(path.join(root, files[0]!)).text())
    expect(entry.data.output.length).toBeLessThan(40_000)
    expect(entry.data.output).toContain("session log truncated")
  })
})

describe("session turn inspection", () => {
  test("returns only the latest prompt timeline with bounded diagnostics", () => {
    const content = [
      JSON.stringify({
        timestamp: "2026-07-24T09:00:00.000Z",
        sessionID: "session-1",
        type: "prompt.received",
        messageID: "message-old",
        data: { text: "old request" },
      }),
      JSON.stringify({
        timestamp: "2026-07-24T09:00:01.000Z",
        sessionID: "session-1",
        type: "execution.finished",
      }),
      JSON.stringify({
        timestamp: "2026-07-24T09:01:00.000Z",
        sessionID: "session-1",
        type: "prompt.received",
        messageID: "message-new",
        executionID: "execution-1",
        data: { text: "new request" },
      }),
      JSON.stringify({
        timestamp: "2026-07-24T09:01:01.000Z",
        sessionID: "session-1",
        type: "repository.recalled",
        executionID: "execution-1",
        data: { cached: true, available: true, characters: 1200 },
      }),
      JSON.stringify({
        timestamp: "2026-07-24T09:01:02.000Z",
        sessionID: "session-1",
        type: "model.request",
        executionID: "execution-1",
        data: { modelID: "coding-model" },
      }),
      JSON.stringify({
        timestamp: "2026-07-24T09:01:03.000Z",
        sessionID: "session-1",
        type: "tool.call",
        executionID: "execution-1",
        data: { tool: "grep", callID: "call-1", input: { private: "not exposed by the inspector" } },
      }),
      JSON.stringify({
        timestamp: "2026-07-24T09:01:04.000Z",
        sessionID: "session-1",
        type: "tool.blocked",
        executionID: "execution-1",
        data: { tool: "grep", callID: "call-2", reason: "repeated" },
      }),
      JSON.stringify({
        timestamp: "2026-07-24T09:01:05.000Z",
        sessionID: "session-1",
        type: "execution.finished",
        executionID: "execution-1",
        data: { result: "stop" },
      }),
    ].join("\n")

    const result = SessionLog.summarize(content, "/tmp/session-1.jsonl")

    expect(result.requestMessageID).toBe("message-new")
    expect(result.durationMs).toBe(5000)
    expect(result.stats).toEqual({
      events: 6,
      modelRequests: 1,
      toolCalls: 1,
      toolErrors: 1,
      compactions: 0,
      errors: 1,
    })
    expect(result.events[0]?.detail).toBe("new request")
    expect(result.events.find((event) => event.type === "repository.recalled")?.detail).toBe(
      "cached · available · 1200",
    )
    expect(result.events.find((event) => event.type === "tool.call")?.detail).toBe("grep · call-1")
  })

  test("ignores malformed JSONL records", () => {
    const result = SessionLog.summarize('not-json\n{"timestamp":"2026-07-24T09:00:00.000Z","type":"model.error"}', "x")
    expect(result.events).toHaveLength(1)
    expect(result.stats.errors).toBe(1)
  })

  test("exposes the latest sanitized context compiler preview", () => {
    const content = [
      JSON.stringify({
        timestamp: "2026-07-24T09:00:00.000Z",
        type: "prompt.received",
        messageID: "message-1",
      }),
      JSON.stringify({
        timestamp: "2026-07-24T09:00:01.000Z",
        type: "context.compiled",
        messageID: "message-1",
        data: {
          version: 1,
          estimator: "canonical_serialized_conservative",
          tokens: 1200,
          limit: 8192,
          usage: 15,
          compressed: false,
          overflow: false,
          cache: {
            prefixHash: "prefix-1",
            prefixTokens: 600,
            dynamicTokens: 600,
          },
          fragments: [
            {
              source: "current_user_prompt",
              provenance: ["active_user_message"],
              tokens: 12,
              budget: 1000,
              included: true,
              truncated: false,
              deduplicated: 0,
              preview: "hello",
            },
          ],
          tools: [{ name: "read", tokens: 100, required: true, included: true }],
        },
      }),
    ].join("\n")

    const result = SessionLog.summarize(content, "/tmp/session-1.jsonl")

    expect(result.context?.tokens).toBe(1200)
    expect(result.context?.cache).toEqual({ prefixHash: "prefix-1", prefixTokens: 600, dynamicTokens: 600 })
    expect(result.context?.fragments[0]?.source).toBe("current_user_prompt")
    expect(result.context?.tools[0]).toMatchObject({ name: "read", required: true, included: true })
  })

  test("builds a critical path with parallel savings, cache state, and model telemetry", () => {
    const at = (milliseconds: number) => new Date(Date.UTC(2026, 6, 24, 9, 0, 0, milliseconds)).toISOString()
    const phase = (
      name: string,
      status: "running" | "completed",
      milliseconds: number,
      startedAt?: number,
      detail?: string,
    ) =>
      JSON.stringify({
        timestamp: at(milliseconds),
        sessionID: "session-1",
        type: "pipeline.phase",
        executionID: "execution-1",
        data: {
          phase: name,
          status,
          ...(status === "running"
            ? { startedAt: Date.parse(at(milliseconds)) }
            : { completedAt: Date.parse(at(milliseconds)) }),
          ...(startedAt === undefined
            ? {}
            : { startedAt: Date.parse(at(startedAt)), durationMs: milliseconds - startedAt }),
          detail,
        },
      })
    const content = [
      JSON.stringify({
        timestamp: at(0),
        sessionID: "session-1",
        type: "prompt.received",
        messageID: "message-user",
        executionID: "execution-1",
        data: { text: "inspect latency" },
      }),
      phase("prompt_admission", "completed", 100, 0),
      phase("classification", "running", 100),
      phase("repository_recall", "running", 100),
      phase("memory_recall", "running", 100),
      phase("classification", "completed", 300, 100, "Epistemic request routing"),
      phase("repository_recall", "completed", 400, 100, "Repository RAG"),
      phase("memory_recall", "completed", 500, 100, "Durable memory recall"),
      phase("model_readiness", "running", 300),
      JSON.stringify({
        timestamp: at(500),
        sessionID: "session-1",
        type: "model.telemetry",
        executionID: "execution-1",
        data: {
          capabilityProbeStartedAt: Date.parse(at(300)),
          capabilityProbeCompletedAt: Date.parse(at(350)),
          capabilityProbeMs: 50,
          activationStartedAt: Date.parse(at(350)),
          activationCompletedAt: Date.parse(at(500)),
          modelActivationMs: 150,
          probeCache: "miss",
          activationStatus: "ready",
        },
      }),
      phase("model_readiness", "completed", 500, 300),
      phase("context_compilation", "running", 500),
      phase("context_compilation", "completed", 700, 500, "3200/8192 tokens"),
      JSON.stringify({
        timestamp: at(700),
        sessionID: "session-1",
        type: "model.request",
        data: {
          providerID: "lmstudio",
          modelID: "coding-model",
          instanceID: "coding-instance",
          context: 8192,
          reasoningEffort: "medium",
        },
      }),
      JSON.stringify({
        timestamp: at(700),
        sessionID: "session-1",
        type: "execution.started",
        messageID: "message-assistant",
        executionID: "execution-1",
      }),
      JSON.stringify({
        timestamp: at(1000),
        sessionID: "session-1",
        type: "model.first_output",
        messageID: "message-assistant",
        executionID: "execution-1",
      }),
      JSON.stringify({
        timestamp: at(1200),
        sessionID: "session-1",
        type: "tool.call",
        messageID: "message-assistant",
        data: { callID: "call-1", tool: "grep" },
      }),
      JSON.stringify({
        timestamp: at(1400),
        sessionID: "session-1",
        type: "tool.result",
        messageID: "message-assistant",
        data: { callID: "call-1", tool: "grep" },
      }),
      JSON.stringify({
        timestamp: at(1800),
        sessionID: "session-1",
        type: "execution.finished",
        messageID: "message-assistant",
        executionID: "execution-1",
        data: { tokens: { cache: { read: 128, write: 0 } } },
      }),
      phase("verification", "running", 1800),
      phase("verification", "completed", 2000, 1800),
      phase("memory_admission", "running", 2000),
      phase("memory_admission", "completed", 2050, 2000),
      phase("completion", "completed", 2100, 2100),
    ].join("\n")

    const result = SessionLog.summarize(content, "/tmp/session-1.jsonl")
    const latency = result.latency

    expect(result.durationMs).toBe(2100)
    expect(latency.criticalPathMs).toBe(2000)
    expect(latency.backgroundMs).toBe(50)
    expect(latency.parallelSavingsMs).toBe(700)
    expect(latency.potentialSavingsMs).toBe(950)
    expect(latency.blocker).toMatchObject({ phase: "generation", durationMs: 800 })
    expect(latency.providerCache).toBe("hit")
    expect(latency.promptCache).toMatchObject({
      readTokens: 128,
      writeTokens: 0,
      promptTokens: 128,
      reusePercent: 100,
    })
    expect(latency.model).toEqual({
      providerID: "lmstudio",
      modelID: "coding-model",
      instanceID: "coding-instance",
      context: 8192,
      reasoningEffort: "medium",
    })
    expect(latency.phases.find((item) => item.phase === "prompt_processing")?.durationMs).toBe(300)
    expect(latency.phases.find((item) => item.phase === "tool_execution")?.durationMs).toBe(200)
    expect(latency.phases.find((item) => item.phase === "background_bookkeeping")?.durationMs).toBe(50)
    expect(latency.parallel.some((item) => item.phases.includes("rag") && item.phases.includes("memory"))).toBe(true)
  })

  test("reports whether compaction preserved the cacheable prefix", () => {
    const content = [
      {
        timestamp: "2026-07-24T09:00:00.000Z",
        type: "prompt.received",
        messageID: "message-1",
      },
      {
        timestamp: "2026-07-24T09:00:01.000Z",
        type: "context.compiled",
        data: {
          version: 1,
          tokens: 2000,
          limit: 8192,
          fragments: [],
          tools: [],
          cache: { prefixHash: "stable-prefix", prefixTokens: 1000, dynamicTokens: 1000 },
        },
      },
      {
        timestamp: "2026-07-24T09:00:02.000Z",
        type: "compaction.started",
      },
      {
        timestamp: "2026-07-24T09:00:03.000Z",
        type: "context.compiled",
        data: {
          version: 1,
          tokens: 1400,
          limit: 8192,
          fragments: [],
          tools: [],
          cache: { prefixHash: "stable-prefix", prefixTokens: 1000, dynamicTokens: 400 },
        },
      },
      {
        timestamp: "2026-07-24T09:00:04.000Z",
        type: "model.cache",
        data: { input: 250, read: 750, write: 0, prompt: 1000, reusePercent: 75 },
      },
      {
        timestamp: "2026-07-24T09:00:05.000Z",
        type: "execution.finished",
      },
    ]
      .map((item) => JSON.stringify(item))
      .join("\n")

    const result = SessionLog.summarize(content, "/tmp/session-1.jsonl")

    expect(result.latency.promptCache).toMatchObject({
      prefixHash: "stable-prefix",
      prefixPreserved: true,
      compactionPreserved: true,
      readTokens: 750,
      inputTokens: 250,
      reusePercent: 75,
    })
  })

  test("separates inferred LM Studio cache restore from prompt processing", () => {
    const at = (milliseconds: number) => new Date(Date.UTC(2026, 6, 24, 9, 0, 0, milliseconds)).toISOString()
    const startedAt = Date.parse(at(200))
    const content = [
      {
        timestamp: at(0),
        type: "prompt.received",
        messageID: "message-user",
      },
      {
        timestamp: at(200),
        type: "execution.started",
        messageID: "message-assistant",
        executionID: "execution-1",
      },
      {
        timestamp: at(1700),
        type: "model.cache_restore.started",
        messageID: "message-assistant",
        executionID: "execution-1",
        data: { startedAt, thresholdMs: 1500, inferred: true },
      },
      {
        timestamp: at(97_200),
        type: "model.cache_restore.finished",
        messageID: "message-assistant",
        executionID: "execution-1",
        data: { startedAt, durationMs: 97_000, outcome: "first_output", inferred: true },
      },
      {
        timestamp: at(97_200),
        type: "model.first_output",
        messageID: "message-assistant",
        executionID: "execution-1",
      },
      {
        timestamp: at(99_200),
        type: "execution.finished",
        messageID: "message-assistant",
        executionID: "execution-1",
      },
    ]
      .map((item) => JSON.stringify(item))
      .join("\n")

    const result = SessionLog.summarize(content, "/tmp/session-1.jsonl")

    expect(result.latency.phases.find((item) => item.phase === "cache_restore")).toMatchObject({
      durationMs: 97_000,
      cache: "unknown",
    })
    expect(result.latency.phases.find((item) => item.phase === "prompt_processing")?.durationMs).toBe(0)
    expect(result.latency.phases.find((item) => item.phase === "generation")?.durationMs).toBe(2_000)
    expect(result.latency.blocker).toMatchObject({ phase: "cache_restore", durationMs: 97_000 })
    expect(result.events.find((event) => event.type === "model.cache_restore.finished")?.detail).toBe(
      "97000 · first_output",
    )
  })
})
