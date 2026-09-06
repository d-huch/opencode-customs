#!/usr/bin/env bun
import { resolve } from "node:path"
import { scenarioReportHTML, scenarioReportJUnit, type ScenarioQualityReport } from "./validation"

const input = process.argv[2]
if (!input) throw new Error("Usage: embodied-validate <report.json> [--json output] [--html output] [--junit output]")
const report = await Bun.file(resolve(input)).json() as ScenarioQualityReport
if (!report?.id || !report.scenarioID || !["ready", "needs_work", "not_ready"].includes(report.readiness)) throw new Error("Invalid Scenario Quality Report")
await writeOption("--json", JSON.stringify(report, null, 2))
await writeOption("--html", scenarioReportHTML(report))
await writeOption("--junit", scenarioReportJUnit(report))
console.log(JSON.stringify({ reportID: report.id, scenarioID: report.scenarioID, readiness: report.readiness, findings: report.findings.length }))
if (report.readiness === "not_ready") process.exit(1)

async function writeOption(option: string, value: string) {
  const index = process.argv.indexOf(option)
  if (index < 0) return
  const path = process.argv[index + 1]
  if (!path) throw new Error(`${option} requires an output path`)
  await Bun.write(resolve(path), value)
}
