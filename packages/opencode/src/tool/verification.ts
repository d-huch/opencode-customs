import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { LSP } from "@/lsp/lsp"
import { attempt, TOOL_ID } from "@/session/verification"
import { ShellTool } from "./shell"
import { Tool } from "./tool"

const Check = Schema.Struct({
  name: Schema.String.annotate({ description: "Short label for the check" }),
  command: Schema.String.annotate({ description: "Repository-native verification command" }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in milliseconds" }),
})

const Parameters = Schema.Struct({
  files: Schema.Array(Schema.String).annotate({
    description: "Every project file changed by the current task, relative to the project when possible",
  }),
  checks: Schema.Array(Check).annotate({
    description: "The smallest relevant commands. May be empty when active LSP diagnostics fully cover the files.",
  }),
})

export const VerificationTool = Tool.define(
  TOOL_ID,
  Effect.gen(function* () {
    const shell = yield* ShellTool
    const lsp = yield* LSP.Service

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
              if (input.checks.length > 6) throw new Error("Verification accepts at most 6 focused checks")
              if (input.checks.some((check) => check.timeout !== undefined && check.timeout <= 0))
                throw new Error("Verification timeouts must be positive")

              const instance = yield* InstanceState.context
              const files = Array.from(
                new Set(
                  input.files.map((file) => {
                    const absolute = path.isAbsolute(file) ? file : path.resolve(instance.directory, file)
                    return path.relative(instance.directory, absolute).replaceAll("\\", "/") || path.basename(absolute)
                  }),
                ),
              ).sort()
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
              const passed = executed > 0 && checks.every((check) => check.passed) && errors.length === 0
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
                    exit: check.exit,
                    passed: check.passed,
                  })),
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
