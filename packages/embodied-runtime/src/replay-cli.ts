#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { applyReplayFaults, compareReplays, evaluateReplay, replayAuditBundle, replayJUnit, verifyReplayAuditBundle, type ReplayAuditBundle, type ReplayFixture } from "./replay"

const optionNames = ["--junit", "--baseline", "--json", "--audit", "--sign-key", "--verify-audit", "--verify-key"]
const inputs = process.argv.slice(2).filter((value, index, values) =>
  !value.startsWith("--") && !optionNames.includes(values[index - 1] ?? ""),
)
const junit = option("--junit")
const baseline = option("--baseline")
const json = option("--json")
const audit = option("--audit")
const signKey = option("--sign-key")
const verifyAudit = option("--verify-audit")
const verifyKey = option("--verify-key")
if (verifyAudit) {
  const bundle = await Bun.file(resolve(verifyAudit)).json() as ReplayAuditBundle
  const result = verifyReplayAuditBundle(bundle, verifyKey ? await Bun.file(resolve(verifyKey)).text() : undefined)
  console.log(`${result.valid ? "PASS" : "FAIL"} audit: ${result.detail}`)
  if (!result.valid) process.exit(1)
  process.exit(0)
}
if (inputs.length === 0) {
  console.error("Usage: embodied-replay <fixture.json> [...] [--baseline baseline.json] [--junit report.xml] [--json report.json] [--audit audit.json] [--sign-key private.pem] | --verify-audit audit.json [--verify-key public.pem]")
  process.exit(2)
}

const fixtures = (await Promise.all(inputs.map(readFixture))).map((fixture) => fixture.faults?.length ? applyReplayFaults(fixture) : fixture)
const evaluations = fixtures.map(evaluateReplay)
for (const evaluation of evaluations) {
  console.log(`${evaluation.passed ? "PASS" : "FAIL"} ${evaluation.fixtureID}`)
  for (const assertion of evaluation.assertions)
    console.log(`  ${assertion.passed ? "ok" : "not ok"} ${assertion.id}: ${assertion.detail}`)
}
if (baseline) {
  const expected = await readFixture(baseline)
  for (const fixture of fixtures) {
    const comparison = compareReplays(expected, fixture)
    console.log(`${comparison.passed ? "MATCH" : "DIFF"} ${fixture.id}: ${comparison.firstDifference?.detail ?? "baseline preserved"}`)
  }
}
if (junit) {
  await mkdir(dirname(resolve(junit)), { recursive: true })
  await Bun.write(resolve(junit), replayJUnit(evaluations))
}
if (json) {
  await mkdir(dirname(resolve(json)), { recursive: true })
  await Bun.write(resolve(json), JSON.stringify({ generatedAt: new Date().toISOString(), evaluations }, null, 2))
}
if (audit) {
  if (fixtures.length !== 1) throw new Error("Audit export requires exactly one fixture")
  const privateKey = signKey ? await Bun.file(resolve(signKey)).text() : undefined
  await mkdir(dirname(resolve(audit)), { recursive: true })
  await Bun.write(resolve(audit), JSON.stringify(replayAuditBundle(fixtures[0]!, privateKey), null, 2))
}
if (evaluations.some((evaluation) => !evaluation.passed)) process.exit(1)

function option(name: string) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

async function readFixture(path: string) {
  const value = await Bun.file(resolve(path)).json()
  if (!value || typeof value !== "object" || !Array.isArray(value.events)) throw new Error(`Invalid replay fixture: ${path}`)
  return value as ReplayFixture
}
