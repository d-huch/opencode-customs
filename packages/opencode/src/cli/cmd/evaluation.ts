import path from "path"
import { cmd } from "./cmd"
import { EvaluationHarness } from "@/evaluation/harness"

const EvaluationRunCommand = cmd({
  command: "run <suite>",
  describe: "run repeatable agent evaluation scenarios",
  builder: (yargs) =>
    yargs
      .positional("suite", {
        describe: "path to the evaluation suite JSON",
        type: "string",
        demandOption: true,
      })
      .option("revision", {
        describe: "label for the evaluated agent version",
        type: "string",
        demandOption: true,
      })
      .option("scenario", {
        alias: "s",
        describe: "scenario ID to run; repeat to select multiple scenarios",
        type: "string",
        array: true,
      })
      .option("binary", {
        describe: "OpenCode executable to run",
        type: "string",
      })
      .option("model", {
        describe: "model override for agent scenarios",
        type: "string",
      })
      .option("agent", {
        describe: "agent override for agent scenarios",
        type: "string",
      })
      .option("artifacts", {
        describe: "directory for raw stdout, stderr, and session logs",
        type: "string",
      })
      .option("output", {
        alias: "o",
        describe: "path for the JSON evaluation report",
        type: "string",
      }),
  async handler(args) {
    const suite = path.resolve(args.suite)
    const artifacts = path.resolve(
      args.artifacts ?? path.join(process.cwd(), "eval-results", `${safeName(args.revision)}-artifacts`),
    )
    const output = path.resolve(
      args.output ?? path.join(process.cwd(), "eval-results", `${safeName(args.revision)}.json`),
    )
    const report = await EvaluationHarness.run(suite, {
      revision: args.revision,
      scenarioIDs: args.scenario,
      binary: args.binary,
      model: args.model,
      agent: args.agent,
      artifactDirectory: artifacts,
    })
    await EvaluationHarness.write(output, report)
    printReport(report)
    console.log(`Report: ${output}`)
    console.log(`Artifacts: ${artifacts}`)
    if (report.summary.failed) process.exitCode = 1
  },
})

const EvaluationScoreCommand = cmd({
  command: "score <suite> <trial>",
  describe: "score a recorded trial without running a model",
  builder: (yargs) =>
    yargs
      .positional("suite", {
        describe: "path to the evaluation suite JSON",
        type: "string",
        demandOption: true,
      })
      .positional("trial", {
        describe: "path to a recorded trial JSON",
        type: "string",
        demandOption: true,
      })
      .option("output", {
        alias: "o",
        describe: "path for the JSON evaluation report",
        type: "string",
      }),
  async handler(args) {
    const suite = await EvaluationHarness.loadSuite(path.resolve(args.suite))
    const trial = await EvaluationHarness.loadTrial(path.resolve(args.trial))
    const report = EvaluationHarness.report(suite, trial.revision, [trial])
    if (args.output) await EvaluationHarness.write(path.resolve(args.output), report)
    printReport(report)
    if (report.summary.failed) process.exitCode = 1
  },
})

const EvaluationCompareCommand = cmd({
  command: "compare <baseline> <candidate>",
  describe: "compare two evaluation reports",
  builder: (yargs) =>
    yargs
      .positional("baseline", {
        describe: "path to the baseline report",
        type: "string",
        demandOption: true,
      })
      .positional("candidate", {
        describe: "path to the candidate report",
        type: "string",
        demandOption: true,
      })
      .option("output", {
        alias: "o",
        describe: "path for the JSON comparison report",
        type: "string",
      })
      .option("fail-on-regression", {
        describe: "exit with an error when a scenario regresses",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    const comparison = EvaluationHarness.compare(
      await EvaluationHarness.loadReport(path.resolve(args.baseline)),
      await EvaluationHarness.loadReport(path.resolve(args.candidate)),
    )
    if (args.output) await EvaluationHarness.write(path.resolve(args.output), comparison)
    console.table(
      comparison.scenarios.map((scenario) => ({
        scenario: scenario.scenarioID,
        pass: `${scenario.baselinePassed ?? "-"} → ${scenario.candidatePassed ?? "-"}`,
        score: signed(scenario.scoreDelta),
        recall5: signed(scenario.recallAt5Delta),
        turns: signed(scenario.providerTurnsDelta),
        tools: signed(scenario.toolCallsDelta),
        tokens: signed(scenario.tokenDelta),
        timeMs: signed(scenario.durationMsDelta),
        regression: scenario.regression ? "yes" : "",
      })),
    )
    console.log(
      `Score ${signed(comparison.summary.scoreDelta)}, passes ${signed(comparison.summary.passDelta)}, regressions ${comparison.summary.regressions.length}`,
    )
    if (args.output) console.log(`Comparison: ${path.resolve(args.output)}`)
    if (args.failOnRegression && comparison.summary.regressions.length) process.exitCode = 1
  },
})

export const EvaluationCommand = cmd({
  command: "eval",
  describe: "run and compare agent evaluation scenarios",
  builder: (yargs) =>
    yargs
      .command(EvaluationRunCommand)
      .command(EvaluationScoreCommand)
      .command(EvaluationCompareCommand)
      .demandCommand(),
  async handler() {},
})

function printReport(report: EvaluationHarness.Report) {
  console.table(
    report.results.map((result) => ({
      scenario: result.scenarioID,
      status: result.trial.skipped ? "skipped" : result.passed ? "passed" : "failed",
      score: result.score,
      recall5: result.recallAt5 ?? "-",
      turns: result.trial.metrics.providerTurns,
      tools: result.trial.metrics.toolCalls,
      compactions: result.trial.metrics.compactions,
      tokens: totalTokens(result.trial.metrics.tokens),
      timeMs: result.trial.metrics.durationMs,
      loops: result.trial.metrics.loops,
      errors: result.trial.metrics.errors,
    })),
  )
  console.log(
    `${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped, score ${report.summary.score}`,
  )
}

function totalTokens(value: EvaluationHarness.Tokens) {
  return value.input + value.output + value.reasoning + value.cacheRead + value.cacheWrite
}

function signed(value?: number) {
  if (value === undefined) return "-"
  return value > 0 ? `+${Math.round(value * 100) / 100}` : `${Math.round(value * 100) / 100}`
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9_.-]/gi, "_") || "evaluation"
}
