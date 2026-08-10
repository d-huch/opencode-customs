import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { EvaluationHarness } from "../../src/evaluation/harness"

const root = path.join(import.meta.dir, ".tmp-evaluation")

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe("evaluation scoring", () => {
  test("loads the standard cross-stack reliability suite", async () => {
    const suite = await EvaluationHarness.loadSuite(
      path.resolve(import.meta.dir, "../../../../evals/agent-reliability.json"),
    )

    expect(suite.scenarios.map((scenario) => scenario.category)).toContain("vision-code")
    expect(suite.scenarios.map((scenario) => scenario.category)).toContain("recovery")
    expect(suite.scenarios.map((scenario) => scenario.category)).toContain("resource-pressure")
    expect(suite.scenarios).toHaveLength(16)
  })

  test("scores answer correctness, files, Recall@5/10, budgets, and verification", () => {
    const scenario = sampleScenario()
    const result = EvaluationHarness.score(scenario, sampleTrial())

    expect(result.passed).toBe(true)
    expect(result.answerCorrect).toBe(true)
    expect(result.filesCorrect).toBe(true)
    expect(result.recallAt5).toBe(1)
    expect(result.recallAt10).toBe(1)
    expect(result.score).toBe(100)
  })

  test("detects loops, repetition, missing files, and budget regressions", () => {
    const result = EvaluationHarness.score(sampleScenario(), {
      ...sampleTrial(),
      answer: "wrong answer",
      filesFound: [],
      ragTopFiles: [],
      metrics: {
        ...sampleTrial().metrics,
        providerTurns: 8,
        loops: 2,
        repetitions: 3,
        errors: 1,
        tests: { ran: true, passed: false, exitCode: 1 },
      },
    })

    expect(result.passed).toBe(false)
    expect(result.score).toBeLessThan(50)
    expect(result.checks.filter((check) => !check.passed).map((check) => check.name)).toContain(
      "provider turns within budget",
    )
  })

  test("compares two revisions and reports scenario regressions", () => {
    const suite = sampleSuite()
    const baseline = EvaluationHarness.report(suite, "baseline", [sampleTrial()])
    const candidate = EvaluationHarness.report(suite, "candidate", [
      {
        ...sampleTrial(),
        revision: "candidate",
        answer: "incorrect",
        metrics: { ...sampleTrial().metrics, providerTurns: 7, durationMs: 5_000 },
      },
    ])

    const comparison = EvaluationHarness.compare(baseline, candidate)

    expect(comparison.summary.regressions).toEqual(["conversation"])
    expect(comparison.summary.passDelta).toBe(-1)
    expect(comparison.summary.providerTurnsDelta).toBe(5)
    expect(comparison.summary.durationMsDelta).toBe(4_000)
  })
})

describe("evaluation runner", () => {
  test("runs one scenario repeatedly through the OpenCode JSON stream and session logs", async () => {
    await fs.mkdir(path.join(root, "workspace", "app"), { recursive: true })
    await Bun.write(path.join(root, "workspace", "app", "answer.ts"), "export const answer = 'green'\n")
    const binary = path.join(root, "fake-opencode")
    await Bun.write(
      binary,
      `#!/bin/sh
mkdir -p "$OPENCODE_SESSION_LOG_DIR"
printf '%s\\n' \\
'{"timestamp":"2026-07-25T09:00:00.000Z","sessionID":"ses_eval","type":"prompt.received"}' \\
'{"timestamp":"2026-07-25T09:00:00.100Z","sessionID":"ses_eval","type":"repository.recalled","data":{"files":["app/answer.ts"]}}' \\
'{"timestamp":"2026-07-25T09:00:00.200Z","sessionID":"ses_eval","type":"model.request","data":{"modelID":"evaluation-model"}}' \\
'{"timestamp":"2026-07-25T09:00:00.300Z","sessionID":"ses_eval","type":"tool.call","data":{"tool":"read","input":{"filePath":"app/answer.ts"}}}' \\
'{"timestamp":"2026-07-25T09:00:00.400Z","sessionID":"ses_eval","type":"execution.finished","data":{"tokens":{"input":100,"output":20,"reasoning":5,"cache":{"read":10,"write":0}}}}' \\
> "$OPENCODE_SESSION_LOG_DIR/ses_eval.jsonl"
printf '%s\\n' \\
'{"type":"text","timestamp":1,"sessionID":"ses_eval","part":{"type":"text","text":"The answer is green in app/answer.ts"}}'
`,
    )
    await fs.chmod(binary, 0o755)
    const suiteFile = path.join(root, "suite.json")
    await Bun.write(
      suiteFile,
      JSON.stringify({
        ...sampleSuite(),
        scenarios: [{ ...sampleScenario(), workspace: { path: "workspace" } }],
      }),
    )

    const result = await EvaluationHarness.run(suiteFile, {
      revision: "test-revision",
      scenarioIDs: ["conversation"],
      binary,
      artifactDirectory: path.join(root, "artifacts"),
    })

    expect(result.summary.passed).toBe(1)
    expect(result.results[0]?.trial.models).toEqual(["evaluation-model"])
    expect(result.results[0]?.trial.metrics.tokens).toEqual({
      input: 100,
      output: 20,
      reasoning: 5,
      cacheRead: 10,
      cacheWrite: 0,
    })
    expect(result.results[0]?.trial.metrics.phaseMs).toEqual({
      prompt: 100,
      recall: 100,
      provider: 100,
      tools: 100,
    })
  })
})

function sampleSuite(): EvaluationHarness.Suite {
  return {
    version: 1,
    name: "sample",
    scenarios: [sampleScenario()],
  }
}

function sampleScenario(): EvaluationHarness.Scenario {
  return {
    id: "conversation",
    title: "Conversation",
    category: "conversation",
    steps: [{ id: "ask", prompt: "What color?" }],
    verification: { command: ["true"] },
    expect: {
      answer: { all: ["green"], none: ["unknown"] },
      files: { required: ["app/answer.ts"] },
      rag: { relevant: ["app/answer.ts"], minRecallAt5: 1, minRecallAt10: 1 },
      events: { required: ["model.request"], forbidden: ["model.error"] },
      metrics: {
        maxProviderTurns: 3,
        maxToolCalls: 4,
        maxCompactions: 0,
        maxLoops: 0,
        maxRepetitions: 0,
        maxErrors: 0,
        maxDurationMs: 2_000,
      },
      process: { exitCode: 0 },
      tests: { required: true },
    },
  }
}

function sampleTrial(): EvaluationHarness.Trial {
  return {
    scenarioID: "conversation",
    revision: "baseline",
    startedAt: "2026-07-25T09:00:00.000Z",
    completedAt: "2026-07-25T09:00:01.000Z",
    answer: "The answer is green.",
    filesFound: ["/tmp/project/app/answer.ts"],
    ragTopFiles: ["app/answer.ts"],
    events: ["prompt.received", "repository.recalled", "model.request", "execution.finished"],
    models: ["coding-model"],
    exitCode: 0,
    metrics: {
      providerTurns: 2,
      toolCalls: 1,
      compactions: 0,
      tokens: { input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 0 },
      phaseMs: { prompt: 10, recall: 20, provider: 900 },
      tests: { ran: true, passed: true, exitCode: 0, durationMs: 50 },
      loops: 0,
      repetitions: 0,
      errors: 0,
      durationMs: 1_000,
    },
  }
}
