export * as EvaluationHarness from "./harness"

import fs from "fs/promises"
import path from "path"

const sourceExtensions =
  "php|blade\\.php|vue|ts|tsx|js|jsx|mjs|cjs|cs|py|java|kt|kts|go|rs|swift|sql|json|ya?ml|toml|md|css|scss|html|xml"
const pathPattern = new RegExp(
  `(?:[A-Za-z]:)?(?:[./~]|[A-Za-z0-9_-]+/)[^\\s"'\\x60<>]+\\.(?:${sourceExtensions})`,
  "gi",
)

export type Category =
  | "conversation"
  | "memory-session"
  | "memory-project"
  | "symbol-search"
  | "concept-search"
  | "repository-analysis"
  | "local-fix"
  | "cross-module-change"
  | "vision-code"
  | "tool-firewall"
  | "recovery"
  | "resource-pressure"
  | "model-unavailable"

export type Workspace = {
  readonly path?: string
  readonly env?: string
  readonly copy?: boolean
}

export type Step = {
  readonly id: string
  readonly prompt: string
  readonly workspace?: Workspace
  readonly session?: "new" | "previous"
  readonly files?: ReadonlyArray<string>
  readonly model?: string
  readonly agent?: string
  readonly env?: Readonly<Record<string, string>>
}

export type Expectations = {
  readonly answer?: {
    readonly all?: ReadonlyArray<string>
    readonly any?: ReadonlyArray<string>
    readonly none?: ReadonlyArray<string>
    readonly patterns?: ReadonlyArray<string>
  }
  readonly files?: {
    readonly required?: ReadonlyArray<string>
  }
  readonly rag?: {
    readonly relevant: ReadonlyArray<string>
    readonly minRecallAt5?: number
    readonly minRecallAt10?: number
  }
  readonly events?: {
    readonly required?: ReadonlyArray<string>
    readonly forbidden?: ReadonlyArray<string>
  }
  readonly metrics?: {
    readonly maxProviderTurns?: number
    readonly maxToolCalls?: number
    readonly maxCompactions?: number
    readonly maxLoops?: number
    readonly maxRepetitions?: number
    readonly maxErrors?: number
    readonly maxDurationMs?: number
  }
  readonly process?: {
    readonly exitCode?: number
  }
  readonly tests?: {
    readonly required?: boolean
  }
}

export type Scenario = {
  readonly id: string
  readonly title: string
  readonly category: Category
  readonly workspace?: Workspace
  readonly steps: ReadonlyArray<Step>
  readonly verification?: {
    readonly command: ReadonlyArray<string>
    readonly workspace?: Workspace
    readonly timeoutMs?: number
  }
  readonly expect: Expectations
  readonly timeoutMs?: number
  readonly tags?: ReadonlyArray<string>
  readonly disabled?: boolean
}

export type Suite = {
  readonly version: 1
  readonly name: string
  readonly scenarios: ReadonlyArray<Scenario>
}

export type Tokens = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export type Trial = {
  readonly scenarioID: string
  readonly revision: string
  readonly startedAt: string
  readonly completedAt: string
  readonly answer: string
  readonly filesFound: ReadonlyArray<string>
  readonly ragTopFiles: ReadonlyArray<string>
  readonly events: ReadonlyArray<string>
  readonly models: ReadonlyArray<string>
  readonly exitCode: number
  readonly metrics: {
    readonly providerTurns: number
    readonly toolCalls: number
    readonly compactions: number
    readonly tokens: Tokens
    readonly phaseMs: Readonly<Record<string, number>>
    readonly tests: {
      readonly ran: boolean
      readonly passed: boolean
      readonly exitCode?: number
      readonly durationMs?: number
    }
    readonly loops: number
    readonly repetitions: number
    readonly errors: number
    readonly durationMs: number
  }
  readonly artifacts?: {
    readonly directory: string
    readonly sessionLogs: ReadonlyArray<string>
  }
  readonly skipped?: string
}

export type Check = {
  readonly name: string
  readonly passed: boolean
  readonly actual?: unknown
  readonly expected?: unknown
}

export type Result = {
  readonly scenarioID: string
  readonly title: string
  readonly category: Category
  readonly passed: boolean
  readonly score: number
  readonly answerCorrect?: boolean
  readonly filesCorrect?: boolean
  readonly recallAt5?: number
  readonly recallAt10?: number
  readonly checks: ReadonlyArray<Check>
  readonly trial: Trial
}

export type Report = {
  readonly version: 1
  readonly suite: string
  readonly revision: string
  readonly createdAt: string
  readonly results: ReadonlyArray<Result>
  readonly summary: {
    readonly passed: number
    readonly failed: number
    readonly skipped: number
    readonly score: number
    readonly recallAt5?: number
    readonly recallAt10?: number
    readonly providerTurns: number
    readonly toolCalls: number
    readonly compactions: number
    readonly tokens: Tokens
    readonly durationMs: number
    readonly loops: number
    readonly repetitions: number
    readonly errors: number
  }
}

export type Comparison = {
  readonly version: 1
  readonly baseline: string
  readonly candidate: string
  readonly createdAt: string
  readonly scenarios: ReadonlyArray<{
    readonly scenarioID: string
    readonly baselinePassed?: boolean
    readonly candidatePassed?: boolean
    readonly scoreDelta?: number
    readonly recallAt5Delta?: number
    readonly recallAt10Delta?: number
    readonly providerTurnsDelta?: number
    readonly toolCallsDelta?: number
    readonly compactionsDelta?: number
    readonly tokenDelta?: number
    readonly durationMsDelta?: number
    readonly regression: boolean
  }>
  readonly summary: {
    readonly scoreDelta: number
    readonly passDelta: number
    readonly recallAt5Delta?: number
    readonly recallAt10Delta?: number
    readonly providerTurnsDelta: number
    readonly toolCallsDelta: number
    readonly compactionsDelta: number
    readonly tokenDelta: number
    readonly durationMsDelta: number
    readonly regressions: ReadonlyArray<string>
  }
}

type RunOptions = {
  readonly revision: string
  readonly scenarioIDs?: ReadonlyArray<string>
  readonly binary?: string
  readonly model?: string
  readonly agent?: string
  readonly artifactDirectory: string
}

type ProcessResult = {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly durationMs: number
  readonly timedOut: boolean
}

type LogRecord = {
  readonly timestamp: string
  readonly type: string
  readonly data?: unknown
}

export async function loadSuite(file: string) {
  return requireSuite(await Bun.file(file).json(), file)
}

export async function loadTrial(file: string) {
  return requireTrial(await Bun.file(file).json(), file)
}

export async function loadReport(file: string) {
  const value: unknown = await Bun.file(file).json()
  if (!isReport(value)) throw new Error(`Invalid evaluation report: ${file}`)
  return value
}

export async function run(suiteFile: string, options: RunOptions): Promise<Report> {
  const suite = await loadSuite(suiteFile)
  const selected = options.scenarioIDs?.length
    ? suite.scenarios.filter((scenario) => options.scenarioIDs?.includes(scenario.id))
    : suite.scenarios.filter((scenario) => !scenario.disabled)
  const missing = options.scenarioIDs?.filter((id) => !suite.scenarios.some((scenario) => scenario.id === id)) ?? []
  if (missing.length) throw new Error(`Unknown evaluation scenarios: ${missing.join(", ")}`)
  if (!selected.length) throw new Error("No evaluation scenarios selected")
  await fs.mkdir(options.artifactDirectory, { recursive: true })
  const trials = []
  for (const scenario of selected) {
    trials.push(await runScenario(suiteFile, scenario, options))
  }
  return report(suite, options.revision, trials)
}

export function score(scenario: Scenario, trial: Trial): Result {
  if (trial.skipped)
    return {
      scenarioID: scenario.id,
      title: scenario.title,
      category: scenario.category,
      passed: false,
      score: 0,
      checks: [{ name: "scenario available", passed: false, actual: trial.skipped, expected: "available" }],
      trial,
    }

  const answer = trial.answer.toLocaleLowerCase()
  const answerChecks = [
    ...(scenario.expect.answer?.all ?? []).map((value) => ({
      name: `answer contains ${value}`,
      passed: answer.includes(value.toLocaleLowerCase()),
      actual: trial.answer,
      expected: value,
    })),
    ...((scenario.expect.answer?.any?.length ?? 0) > 0
      ? [
          {
            name: "answer contains any expected phrase",
            passed: scenario.expect.answer?.any?.some((value) => answer.includes(value.toLocaleLowerCase())) ?? false,
            actual: trial.answer,
            expected: scenario.expect.answer?.any,
          },
        ]
      : []),
    ...(scenario.expect.answer?.none ?? []).map((value) => ({
      name: `answer excludes ${value}`,
      passed: !answer.includes(value.toLocaleLowerCase()),
      actual: trial.answer,
      expected: `not ${value}`,
    })),
    ...(scenario.expect.answer?.patterns ?? []).map((value) => ({
      name: `answer matches ${value}`,
      passed: new RegExp(value, "iu").test(trial.answer),
      actual: trial.answer,
      expected: value,
    })),
  ]
  const fileChecks = (scenario.expect.files?.required ?? []).map((value) => ({
    name: `found file ${value}`,
    passed: trial.filesFound.some((file) => samePath(file, value)),
    actual: trial.filesFound,
    expected: value,
  }))
  const recallAt5 = scenario.expect.rag
    ? scenario.expect.rag.relevant.filter((file) => trial.ragTopFiles.slice(0, 5).some((item) => samePath(item, file)))
        .length / scenario.expect.rag.relevant.length
    : undefined
  const recallAt10 = scenario.expect.rag
    ? scenario.expect.rag.relevant.filter((file) =>
        trial.ragTopFiles.slice(0, 10).some((item) => samePath(item, file)),
      ).length / scenario.expect.rag.relevant.length
    : undefined
  const checks: Check[] = [
    ...answerChecks,
    ...fileChecks,
    ...(scenario.expect.rag
      ? [
          {
            name: "RAG Recall@5",
            passed: (recallAt5 ?? 0) >= (scenario.expect.rag.minRecallAt5 ?? 1),
            actual: recallAt5,
            expected: scenario.expect.rag.minRecallAt5 ?? 1,
          },
          {
            name: "RAG Recall@10",
            passed: (recallAt10 ?? 0) >= (scenario.expect.rag.minRecallAt10 ?? 1),
            actual: recallAt10,
            expected: scenario.expect.rag.minRecallAt10 ?? 1,
          },
        ]
      : []),
    ...(scenario.expect.events?.required ?? []).map((value) => ({
      name: `event emitted ${value}`,
      passed: trial.events.includes(value),
      actual: trial.events,
      expected: value,
    })),
    ...(scenario.expect.events?.forbidden ?? []).map((value) => ({
      name: `event not emitted ${value}`,
      passed: !trial.events.includes(value),
      actual: trial.events,
      expected: `not ${value}`,
    })),
    ...metricChecks(scenario, trial),
    ...(scenario.expect.process?.exitCode === undefined
      ? []
      : [
          {
            name: "process exit code",
            passed: trial.exitCode === scenario.expect.process.exitCode,
            actual: trial.exitCode,
            expected: scenario.expect.process.exitCode,
          },
        ]),
    ...(scenario.expect.tests?.required
      ? [
          {
            name: "verification passed",
            passed: trial.metrics.tests.ran && trial.metrics.tests.passed,
            actual: trial.metrics.tests,
            expected: { ran: true, passed: true },
          },
        ]
      : []),
  ]
  if (!checks.length) throw new Error(`Scenario ${scenario.id} has no scoreable expectations`)
  return {
    scenarioID: scenario.id,
    title: scenario.title,
    category: scenario.category,
    passed: checks.every((check) => check.passed),
    score: Math.round((checks.filter((check) => check.passed).length / checks.length) * 10_000) / 100,
    answerCorrect: answerChecks.length ? answerChecks.every((check) => check.passed) : undefined,
    filesCorrect: fileChecks.length ? fileChecks.every((check) => check.passed) : undefined,
    recallAt5,
    recallAt10,
    checks,
    trial,
  }
}

export function report(suite: Suite, revision: string, trials: ReadonlyArray<Trial>): Report {
  const results = trials.map((trial) => {
    const scenario = suite.scenarios.find((item) => item.id === trial.scenarioID)
    if (!scenario) throw new Error(`Trial references unknown scenario: ${trial.scenarioID}`)
    return score(scenario, trial)
  })
  const measured = results.filter((result) => !result.trial.skipped)
  const recall = measured.flatMap((result) => (result.recallAt5 === undefined ? [] : [result.recallAt5]))
  const recall10 = measured.flatMap((result) => (result.recallAt10 === undefined ? [] : [result.recallAt10]))
  return {
    version: 1,
    suite: suite.name,
    revision,
    createdAt: new Date().toISOString(),
    results,
    summary: {
      passed: measured.filter((result) => result.passed).length,
      failed: measured.filter((result) => !result.passed).length,
      skipped: results.length - measured.length,
      score: average(measured.map((result) => result.score)),
      recallAt5: recall.length ? average(recall) : undefined,
      recallAt10: recall10.length ? average(recall10) : undefined,
      providerTurns: sum(measured.map((result) => result.trial.metrics.providerTurns)),
      toolCalls: sum(measured.map((result) => result.trial.metrics.toolCalls)),
      compactions: sum(measured.map((result) => result.trial.metrics.compactions)),
      tokens: sumTokens(measured.map((result) => result.trial.metrics.tokens)),
      durationMs: sum(measured.map((result) => result.trial.metrics.durationMs)),
      loops: sum(measured.map((result) => result.trial.metrics.loops)),
      repetitions: sum(measured.map((result) => result.trial.metrics.repetitions)),
      errors: sum(measured.map((result) => result.trial.metrics.errors)),
    },
  }
}

export function compare(baseline: Report, candidate: Report): Comparison {
  const ids = [
    ...new Set([
      ...baseline.results.map((item) => item.scenarioID),
      ...candidate.results.map((item) => item.scenarioID),
    ]),
  ]
  const scenarios = ids.map((scenarioID) => {
    const before = baseline.results.find((item) => item.scenarioID === scenarioID)
    const after = candidate.results.find((item) => item.scenarioID === scenarioID)
    const regression =
      (!!before?.passed && !after?.passed) ||
      (!!before && !!after && after.score < before.score - 5) ||
      (!!before && !after)
    return {
      scenarioID,
      baselinePassed: before?.passed,
      candidatePassed: after?.passed,
      scoreDelta: delta(after?.score, before?.score),
      recallAt5Delta: delta(after?.recallAt5, before?.recallAt5),
      recallAt10Delta: delta(after?.recallAt10, before?.recallAt10),
      providerTurnsDelta: delta(after?.trial.metrics.providerTurns, before?.trial.metrics.providerTurns),
      toolCallsDelta: delta(after?.trial.metrics.toolCalls, before?.trial.metrics.toolCalls),
      compactionsDelta: delta(after?.trial.metrics.compactions, before?.trial.metrics.compactions),
      tokenDelta: delta(
        after ? totalTokens(after.trial.metrics.tokens) : undefined,
        before ? totalTokens(before.trial.metrics.tokens) : undefined,
      ),
      durationMsDelta: delta(after?.trial.metrics.durationMs, before?.trial.metrics.durationMs),
      regression,
    }
  })
  return {
    version: 1,
    baseline: baseline.revision,
    candidate: candidate.revision,
    createdAt: new Date().toISOString(),
    scenarios,
    summary: {
      scoreDelta: candidate.summary.score - baseline.summary.score,
      passDelta: candidate.summary.passed - baseline.summary.passed,
      recallAt5Delta: delta(candidate.summary.recallAt5, baseline.summary.recallAt5),
      recallAt10Delta: delta(candidate.summary.recallAt10, baseline.summary.recallAt10),
      providerTurnsDelta: candidate.summary.providerTurns - baseline.summary.providerTurns,
      toolCallsDelta: candidate.summary.toolCalls - baseline.summary.toolCalls,
      compactionsDelta: candidate.summary.compactions - baseline.summary.compactions,
      tokenDelta: totalTokens(candidate.summary.tokens) - totalTokens(baseline.summary.tokens),
      durationMsDelta: candidate.summary.durationMs - baseline.summary.durationMs,
      regressions: scenarios.filter((scenario) => scenario.regression).map((scenario) => scenario.scenarioID),
    },
  }
}

export async function write(file: string, value: Report | Comparison | Trial) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, `${JSON.stringify(value, null, 2)}\n`)
  return file
}

async function runScenario(suiteFile: string, scenario: Scenario, options: RunOptions): Promise<Trial> {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  const artifacts = path.join(options.artifactDirectory, safeName(scenario.id))
  const logs = path.join(artifacts, "session-logs")
  await fs.mkdir(logs, { recursive: true })
  if (scenario.disabled) return skippedTrial(scenario, options.revision, startedAt, "scenario is disabled", artifacts)
  const workspace = await resolveWorkspace(suiteFile, scenario.workspace, artifacts)
  if (!workspace) {
    const name = scenario.workspace?.env ?? scenario.workspace?.path ?? "workspace"
    return skippedTrial(scenario, options.revision, startedAt, `${name} is not configured`, artifacts)
  }

  const outputs: ProcessResult[] = []
  const answers: string[] = []
  const found = new Set<string>()
  let previousSession: string | undefined
  for (const step of scenario.steps) {
    const cwd = (await resolveWorkspace(suiteFile, step.workspace, artifacts, workspace)) ?? workspace
    const command = [
      ...binary(options.binary),
      "run",
      step.prompt,
      "--format",
      "json",
      "--dir",
      cwd,
      ...(step.session === "previous" && previousSession ? ["--session", previousSession] : []),
      ...((step.model ?? options.model) ? ["--model", step.model ?? options.model ?? ""] : []),
      ...((step.agent ?? options.agent) ? ["--agent", step.agent ?? options.agent ?? ""] : []),
      ...(step.files ?? []).flatMap((file) => ["--file", path.resolve(cwd, file)]),
    ]
    const output = await execute(command, cwd, scenario.timeoutMs ?? 180_000, {
      ...step.env,
      OPENCODE_SESSION_LOG_DIR: logs,
    })
    outputs.push(output)
    await Bun.write(path.join(artifacts, `${safeName(step.id)}.stdout.jsonl`), output.stdout)
    await Bun.write(path.join(artifacts, `${safeName(step.id)}.stderr.log`), output.stderr)
    const parsed = output.stdout.split("\n").flatMap((line) => {
      const value = parse(line)
      return value ? [value] : []
    })
    const session = parsed.find((event) => typeof event.sessionID === "string")
    previousSession = typeof session?.sessionID === "string" ? session.sessionID : undefined
    const text = parsed
      .flatMap((event) => {
        if (event.type !== "text" || !isRecord(event.part) || typeof event.part.text !== "string") return []
        return [event.part.text]
      })
      .join("\n")
      .trim()
    const errors = parsed
      .filter((event) => event.type === "error")
      .map((event) => JSON.stringify(event.error ?? event))
      .join("\n")
    if (text || errors) answers.push(text || errors)
    extractPaths(output.stdout, found)
  }

  const verification = scenario.verification
    ? await execute(
        [...scenario.verification.command],
        (await resolveWorkspace(suiteFile, scenario.verification.workspace, artifacts, workspace)) ?? workspace,
        scenario.verification.timeoutMs ?? 120_000,
      )
    : undefined
  if (verification) {
    await Bun.write(path.join(artifacts, "verification.stdout.log"), verification.stdout)
    await Bun.write(path.join(artifacts, "verification.stderr.log"), verification.stderr)
  }
  const records = await readLogs(logs)
  records.forEach((record) => {
    extractPaths(JSON.stringify(record.data ?? ""), found)
  })
  const answer = answers.at(-1) ?? ""
  const metrics = metricsFrom(records, outputs, answer, verification)
  const logFiles = await fs.readdir(logs).catch(() => [])
  return {
    scenarioID: scenario.id,
    revision: options.revision,
    startedAt,
    completedAt: new Date().toISOString(),
    answer,
    filesFound: [...found].sort(),
    ragTopFiles: records
      .filter((record) => record.type === "repository.recalled")
      .flatMap((record) => (isRecord(record.data) && Array.isArray(record.data.files) ? record.data.files : []))
      .filter((file): file is string => typeof file === "string")
      .slice(0, 5),
    events: records.map((record) => record.type),
    models: [
      ...new Set(
        records.flatMap((record) => {
          if (record.type !== "model.request" || !isRecord(record.data) || typeof record.data.modelID !== "string")
            return []
          return [record.data.modelID]
        }),
      ),
    ],
    exitCode: outputs.find((output) => output.exitCode !== 0)?.exitCode ?? 0,
    metrics,
    artifacts: {
      directory: artifacts,
      sessionLogs: logFiles.map((file) => path.join(logs, file)),
    },
  }
}

function metricsFrom(
  records: ReadonlyArray<LogRecord>,
  outputs: ReadonlyArray<ProcessResult>,
  answer: string,
  verification?: ProcessResult,
): Trial["metrics"] {
  const calls = records.filter((record) => record.type === "tool.call")
  const signatures = calls.map((record) => {
    if (!isRecord(record.data)) return record.type
    const tool = typeof record.data.tool === "string" ? record.data.tool : ""
    return `${tool}:${JSON.stringify(record.data.input ?? "")}`
  })
  const counts = new Map<string, number>()
  signatures.forEach((signature) => counts.set(signature, (counts.get(signature) ?? 0) + 1))
  const blocked = records.filter(
    (record) => record.type === "tool.blocked" && isRecord(record.data) && record.data.reason === "repeated",
  ).length
  const repetitions = repeatedText(answer)
  return {
    providerTurns: records.filter((record) => record.type === "model.request").length,
    toolCalls: calls.length,
    compactions: records.filter((record) => record.type === "compaction.started").length,
    tokens: sumTokens(
      records.flatMap((record) => {
        if (record.type !== "execution.finished" || !isRecord(record.data) || !isRecord(record.data.tokens)) return []
        return [tokens(record.data.tokens)]
      }),
    ),
    phaseMs: phaseTimings(records),
    tests: {
      ran: !!verification,
      passed: !!verification && verification.exitCode === 0 && !verification.timedOut,
      exitCode: verification?.exitCode,
      durationMs: verification?.durationMs,
    },
    loops: blocked + [...counts.values()].filter((count) => count >= 3).length,
    repetitions,
    errors:
      records.filter((record) => errorEvent(record.type)).length +
      outputs.filter((output) => output.exitCode !== 0 || output.timedOut).length,
    durationMs: sum(outputs.map((output) => output.durationMs)) + (verification?.durationMs ?? 0),
  }
}

function phaseTimings(records: ReadonlyArray<LogRecord>) {
  const result: Record<string, number> = {}
  records.forEach((record, index) => {
    const next = records[index + 1]
    if (!next) return
    const duration = new Date(next.timestamp).getTime() - new Date(record.timestamp).getTime()
    if (!Number.isFinite(duration) || duration < 0) return
    const name = phase(record.type)
    result[name] = (result[name] ?? 0) + duration
  })
  return result
}

function metricChecks(scenario: Scenario, trial: Trial): Check[] {
  const expected = scenario.expect.metrics
  if (!expected) return []
  return [
    ["provider turns", trial.metrics.providerTurns, expected.maxProviderTurns],
    ["tool calls", trial.metrics.toolCalls, expected.maxToolCalls],
    ["compactions", trial.metrics.compactions, expected.maxCompactions],
    ["loops", trial.metrics.loops, expected.maxLoops],
    ["repetitions", trial.metrics.repetitions, expected.maxRepetitions],
    ["errors", trial.metrics.errors, expected.maxErrors],
    ["duration", trial.metrics.durationMs, expected.maxDurationMs],
  ].flatMap(([name, actual, limit]) =>
    typeof limit === "number"
      ? [{ name: `${name} within budget`, passed: Number(actual) <= limit, actual, expected: `<= ${limit}` }]
      : [],
  )
}

async function resolveWorkspace(
  suiteFile: string,
  value: Workspace | undefined,
  artifacts: string,
  fallback?: string,
): Promise<string | undefined> {
  if (!value) return fallback ?? path.dirname(suiteFile)
  const configured = value.env ? process.env[value.env] : value.path
  if (!configured) return undefined
  const source = path.resolve(path.dirname(suiteFile), configured)
  const exists = await fs.stat(source).then(
    () => true,
    () => false,
  )
  if (!exists) return undefined
  if (!value.copy) return source
  const target = path.join(artifacts, "workspace")
  await fs.rm(target, { recursive: true, force: true })
  await fs.cp(source, target, { recursive: true })
  return target
}

async function execute(
  command: ReadonlyArray<string>,
  cwd: string,
  timeoutMs: number,
  environment?: Readonly<Record<string, string>>,
): Promise<ProcessResult> {
  const started = Date.now()
  const process = Bun.spawn([...command], {
    cwd,
    env: { ...globalThis.process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    process.kill()
  }, timeoutMs)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  clearTimeout(timer)
  return { stdout, stderr, exitCode, timedOut, durationMs: Date.now() - started }
}

async function readLogs(directory: string) {
  const files = await fs.readdir(directory).catch(() => [])
  const records = await Promise.all(
    files
      .filter((file) => file.endsWith(".jsonl"))
      .map(async (file) =>
        (await Bun.file(path.join(directory, file)).text()).split("\n").flatMap((line) => {
          const value = parse(line)
          if (!value || typeof value.timestamp !== "string" || typeof value.type !== "string") return []
          return [{ timestamp: value.timestamp, type: value.type, data: value.data }]
        }),
      ),
  )
  return records.flat().sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function requireSuite(value: unknown, file: string): Suite {
  if (!isRecord(value) || value.version !== 1 || typeof value.name !== "string" || !Array.isArray(value.scenarios)) {
    throw new Error(`Invalid evaluation suite: ${file}`)
  }
  const scenarios = value.scenarios.map((scenario, index) => requireScenario(scenario, `${file}#${index}`))
  const duplicates = scenarios.filter(
    (scenario, index) => scenarios.findIndex((item) => item.id === scenario.id) !== index,
  )
  if (duplicates.length)
    throw new Error(`Duplicate evaluation scenario IDs: ${duplicates.map((item) => item.id).join(", ")}`)
  return { version: 1, name: value.name, scenarios }
}

function requireScenario(value: unknown, label: string): Scenario {
  if (!isScenario(value)) throw new Error(`Invalid evaluation scenario: ${label}`)
  const steps = value.steps.map((step, index) => {
    if (!isStep(step)) throw new Error(`Invalid evaluation step: ${label}#${index}`)
    return step
  })
  if (!steps.length) throw new Error(`Evaluation scenario has no steps: ${value.id}`)
  return { ...value, steps }
}

function requireTrial(value: unknown, file: string): Trial {
  if (!isTrial(value)) throw new Error(`Invalid evaluation trial: ${file}`)
  return value
}

function skippedTrial(
  scenario: Scenario,
  revision: string,
  startedAt: string,
  reason: string,
  directory: string,
): Trial {
  return {
    scenarioID: scenario.id,
    revision,
    startedAt,
    completedAt: new Date().toISOString(),
    answer: "",
    filesFound: [],
    ragTopFiles: [],
    events: [],
    models: [],
    exitCode: 0,
    metrics: {
      providerTurns: 0,
      toolCalls: 0,
      compactions: 0,
      tokens: emptyTokens(),
      phaseMs: {},
      tests: { ran: false, passed: false },
      loops: 0,
      repetitions: 0,
      errors: 0,
      durationMs: 0,
    },
    artifacts: { directory, sessionLogs: [] },
    skipped: reason,
  }
}

function binary(value?: string) {
  if (value) return [value]
  const source = process.argv[1]
  if (source?.endsWith(".ts") || source?.endsWith(".js")) return [process.execPath, path.resolve(source)]
  return [process.execPath]
}

function tokens(value: unknown): Tokens {
  if (!isRecord(value)) return emptyTokens()
  const cache = isRecord(value.cache) ? value.cache : {}
  return {
    input: number(value.input),
    output: number(value.output),
    reasoning: number(value.reasoning),
    cacheRead: number(cache.read),
    cacheWrite: number(cache.write),
  }
}

function sumTokens(values: ReadonlyArray<Tokens>): Tokens {
  return values.reduce(
    (total, value) => ({
      input: total.input + value.input,
      output: total.output + value.output,
      reasoning: total.reasoning + value.reasoning,
      cacheRead: total.cacheRead + value.cacheRead,
      cacheWrite: total.cacheWrite + value.cacheWrite,
    }),
    emptyTokens(),
  )
}

function emptyTokens(): Tokens {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
}

function totalTokens(value: Tokens) {
  return value.input + value.output + value.reasoning + value.cacheRead + value.cacheWrite
}

function repeatedText(value: string) {
  const parts = value
    .split(/\n{2,}|(?<=[.!?])\s+/u)
    .map((part) => part.trim().toLocaleLowerCase())
    .filter((part) => part.length >= 24)
  const counts = new Map<string, number>()
  parts.forEach((part) => counts.set(part, (counts.get(part) ?? 0) + 1))
  return sum([...counts.values()].map((count) => Math.max(0, count - 1)))
}

function extractPaths(value: string, output: Set<string>) {
  for (const match of value.matchAll(pathPattern)) output.add(match[0].replace(/[),.;:]+$/u, ""))
}

function phase(type: string) {
  if (type.startsWith("prompt.")) return "prompt"
  if (type.startsWith("freshness.")) return "classification"
  if (type.startsWith("repository.") || type.startsWith("memory.")) return "recall"
  if (type.startsWith("tool.")) return "tools"
  if (type.startsWith("compaction.")) return "compaction"
  if (type.startsWith("execution.recovered")) return "recovery"
  if (type.startsWith("model.")) return "provider"
  return "execution"
}

function errorEvent(type: string) {
  return (
    type.endsWith(".error") ||
    type.endsWith(".failed") ||
    type.endsWith(".blocked") ||
    type.endsWith(".budget_exhausted")
  )
}

function samePath(actual: string, expected: string) {
  const left = actual.replaceAll("\\", "/").replace(/^\.?\//u, "")
  const right = expected.replaceAll("\\", "/").replace(/^\.?\//u, "")
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9_.-]/gi, "_") || "scenario"
}

function parse(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function sum(values: ReadonlyArray<number>) {
  return values.reduce((total, value) => total + value, 0)
}

function average(values: ReadonlyArray<number>) {
  if (!values.length) return 0
  return Math.round((sum(values) / values.length) * 100) / 100
}

function delta(after?: number, before?: number): number | undefined {
  if (after === undefined || before === undefined) return undefined
  return after - before
}

function isReport(value: unknown): value is Report {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.suite === "string" &&
    typeof value.revision === "string" &&
    Array.isArray(value.results) &&
    isRecord(value.summary)
  )
}

function isScenario(value: unknown): value is Scenario {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.category === "string" &&
    Array.isArray(value.steps) &&
    isRecord(value.expect)
  )
}

function isStep(value: unknown): value is Step {
  return isRecord(value) && typeof value.id === "string" && typeof value.prompt === "string"
}

function isTrial(value: unknown): value is Trial {
  return isRecord(value) && typeof value.scenarioID === "string" && isRecord(value.metrics)
}
