import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Database } from "@opencode-ai/core/database/database"
import { SessionExecutionCheckpoint } from "@opencode-ai/core/session/execution-checkpoint"
import { VerificationMatrix } from "@opencode-ai/core/verification-matrix"
import { InstanceState } from "@/effect/instance-state"
import { LSP } from "@/lsp/lsp"
import { attempt, TOOL_ID } from "@/session/verification"
import { ShellTool } from "./shell"
import { Tool } from "./tool"

const Check = Schema.Struct({
  name: Schema.String.annotate({ description: "Short label for the check" }),
  command: Schema.String.annotate({ description: "Repository-native verification command" }),
  kinds: Schema.Array(
    Schema.Literals([
      "formatter",
      "typecheck",
      "unit_test",
      "feature_test",
      "component_test",
      "migration_validation",
      "build",
      "lint",
      "api_contract_generation",
      "screenshot_comparison",
      "git_diff_inspection",
    ]),
  ).annotate({ description: "Verification Matrix check types covered by this command" }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in milliseconds" }),
})

const Omission = Schema.Struct({
  kind: Schema.Literals([
    "formatter",
    "typecheck",
    "unit_test",
    "feature_test",
    "component_test",
    "migration_validation",
    "build",
    "lint",
    "api_contract_generation",
    "screenshot_comparison",
    "git_diff_inspection",
  ]),
  reason: Schema.String.annotate({ description: "Concrete reason this check type cannot run in the current project" }),
})

const Parameters = Schema.Struct({
  files: Schema.Array(Schema.String).annotate({
    description: "Every project file changed by the current task, relative to the project when possible",
  }),
  checks: Schema.Array(Check).annotate({
    description: "The smallest repository-native commands covering the selected Verification Matrix check types",
  }),
  omissions: Schema.Array(Omission).annotate({
    description: "Selected conditional checks that are unavailable, with a concrete reason. Required checks remain unverified.",
  }),
})

export const VerificationTool = Tool.define(
  TOOL_ID,
  Effect.gen(function* () {
    const shell = yield* ShellTool
    const lsp = yield* LSP.Service
    const database = yield* Database.Service

    return () =>
      Effect.gen(function* () {
        const command = yield* Tool.init(shell)
        return {
          description:
            "Verify project changes before the final answer. Choose repository-native commands from the project's own configuration, instructions, or existing focused test patterns; this tool does not assume a language or framework. It reuses normal shell permissions, checks active LSP diagnostics for the supplied changed files, returns compact evidence, and must be rerun after repairs.",
          parameters: Parameters,
          execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
            Effect.gen(function* () {
              if (input.files.length === 0) throw new Error("Verification requires at least one changed file")
              if (input.files.length > 50) throw new Error("Verification accepts at most 50 changed files")
              if (input.checks.length > 10) throw new Error("Verification accepts at most 10 focused checks")
              if (input.checks.some((check) => check.timeout !== undefined && check.timeout <= 0))
                throw new Error("Verification timeouts must be positive")
              if (input.checks.some((check) => check.kinds.length === 0))
                throw new Error("Every verification command must declare at least one matrix check type")

              const instance = yield* InstanceState.context
              const files = Array.from(
                new Set(
                  input.files.map((file) => {
                    const absolute = path.isAbsolute(file) ? file : path.resolve(instance.directory, file)
                    return path.relative(instance.directory, absolute).replaceAll("\\", "/") || path.basename(absolute)
                  }),
                ),
              ).sort()
              const checkpoint = yield* SessionExecutionCheckpoint.load(database.db, ctx.sessionID)
              const matrix =
                checkpoint?.verification_plan &&
                checkpoint.verification_plan.files.length === files.length &&
                checkpoint.verification_plan.files.every((file) => files.includes(file))
                  ? checkpoint.verification_plan
                  : VerificationMatrix.select({ files })
              const covered = new Set(input.checks.flatMap((check) => check.kinds))
              const omitted = new Map(input.omissions.map((omission) => [omission.kind, omission.reason]))
              const coverage = VerificationMatrix.audit(matrix, {
                covered: Array.from(covered),
                omissions: input.omissions,
              })
              if (coverage.unrelated.length)
                throw new Error(`Verification includes unrelated check types: ${coverage.unrelated.join(", ")}`)
              const checks = yield* Effect.forEach(
                input.checks,
                (check) =>
                  command
                    .execute(
                      {
                        command: check.command,
                        workdir: instance.directory,
                        ...(check.timeout === undefined ? {} : { timeout: check.timeout }),
                      },
                      ctx,
                    )
                    .pipe(
                      Effect.map((result) => ({
                        name: check.name,
                        command: check.command,
                        kinds: check.kinds,
                        exit: result.metadata.exit,
                        passed: result.metadata.exit === 0,
                        output: result.output,
                      })),
                    ),
                { concurrency: 1 },
              )

              const lspFiles = yield* Effect.filter(
                files.slice(0, 20).map((file) => path.resolve(instance.directory, file)),
                (file) => lsp.hasClients(file),
              )
              yield* Effect.forEach(lspFiles, (file) => lsp.touchFile(file, "document"), {
                concurrency: 4,
                discard: true,
              })
              const diagnostics = yield* lsp.diagnostics()
              const errors = lspFiles.flatMap((file) =>
                (diagnostics[FSUtil.normalizePath(file)] ?? [])
                  .filter((diagnostic) => diagnostic.severity === 1)
                  .slice(0, 20)
                  .map((diagnostic) => ({
                    file: path.relative(instance.directory, file).replaceAll("\\", "/"),
                    message: LSP.Diagnostic.pretty(diagnostic),
                  })),
              )
              const executed = checks.length + lspFiles.length
              const passed =
                executed > 0 &&
                checks.every((check) => check.passed) &&
                errors.length === 0 &&
                coverage.missing.length === 0 &&
                coverage.requiredOmissions.length === 0
              const currentAttempt = attempt(ctx.messages)
              const output = [
                passed ? "Verification passed." : "Verification did not pass.",
                ...checks.map(
                  (check) =>
                    `${check.passed ? "PASS" : "FAIL"} ${check.name} (exit ${check.exit ?? "unknown"})\n${check.output}`,
                ),
                ...(lspFiles.length
                  ? [
                      errors.length
                        ? `LSP errors:\n${errors.map((error) => `- ${error.file}: ${error.message}`).join("\n")}`
                        : `PASS LSP diagnostics (${lspFiles.length} changed file${lspFiles.length === 1 ? "" : "s"})`,
                    ]
                  : []),
                `Verification Matrix:\n${matrix.checks
                  .map((check) => {
                    const status = covered.has(check.kind)
                      ? "RUN"
                      : omitted.has(check.kind)
                        ? check.requirement === "required"
                          ? "BLOCKED"
                          : "OMIT"
                        : "MISSING"
                    return `- ${status} ${check.kind} [${check.requirement}]: ${check.reasons.join(" ")}${
                      omitted.has(check.kind) ? ` Omission: ${omitted.get(check.kind)}` : ""
                    }`
                  })
                  .join("\n")}`,
                matrix.rationale,
                coverage.requiredOmissions.length
                  ? `Required checks unavailable:\n${coverage.requiredOmissions
                      .map((check) => `- ${check.kind}: ${omitted.get(check.kind)}`)
                      .join("\n")}`
                  : undefined,
                coverage.missing.length
                  ? `Selected checks not accounted for:\n${coverage.missing
                      .map((check) => `- ${check.kind}`)
                      .join("\n")}`
                  : undefined,
                executed === 0
                  ? "No executable check or active LSP coverage was provided. The change remains unverified."
                  : undefined,
              ]
                .filter((part): part is string => part !== undefined)
                .join("\n\n")

              return {
                title: passed ? "Verification passed" : "Verification failed",
                metadata: {
                  verification: true,
                  passed,
                  attempt: currentAttempt,
                  files,
                  checks: checks.map((check) => ({
                    name: check.name,
                    command: check.command,
                    kinds: check.kinds,
                    exit: check.exit,
                    passed: check.passed,
                  })),
                  matrix,
                  omissions: input.omissions,
                  missing: coverage.missing.map((check) => check.kind),
                  requiredOmissions: coverage.requiredOmissions.map((check) => check.kind),
                  lsp: { files: lspFiles.length, errors: errors.length },
                  unverified: executed === 0,
                },
                output,
              }
            }),
        }
      })
  }),
)
