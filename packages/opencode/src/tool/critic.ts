import { Effect, Schema } from "effect"
import { TOOL_ID } from "@/session/critic"
import { isRecord } from "@/util/record"
import { Tool } from "./tool"

const Finding = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  title: Schema.String.annotate({ description: "Short concrete defect title" }),
  file: Schema.String.annotate({ description: "Changed project file containing the defect" }),
  line: Schema.Number.pipe(Schema.optional).annotate({ description: "Best available 1-based line number" }),
  consequence: Schema.String.annotate({ description: "Concrete user, runtime, data, or compatibility impact" }),
  evidence: Schema.String.annotate({ description: "Direct evidence from the supplied patch or verification result" }),
})

const Parameters = Schema.Struct({
  status: Schema.Literals(["clean", "findings"]),
  findings: Schema.Array(Finding),
})

export const CriticTool = Tool.define(
  TOOL_ID,
  Effect.succeed({
    description:
      "Submit the single evidence-based post-verification review. Report only concrete defects in changed files that are directly supported by the supplied patch or verification results. This tool cannot modify code and must be called exactly once.",
    parameters: Parameters,
    execution: { access: "control" } as const,
    execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.sync(() => {
        if (input.findings.length > 12) throw new Error("Critic accepts at most 12 findings")
        if (input.status === "clean" && input.findings.length > 0)
          throw new Error("A clean critic pass cannot contain findings")
        if (input.status === "findings" && input.findings.length === 0)
          throw new Error("A critic pass with findings requires at least one finding")
        const start = ctx.messages.findLastIndex(
          (message) =>
            message.info.role === "user" &&
            message.parts.some(
              (part) => part.type === "text" && part.synthetic === true && part.metadata?.critic_continue === true,
            ),
        )
        if (start === -1) throw new Error("Critic pass metadata is missing for the current request")
        const messages = ctx.messages.slice(start)
        const allowed = new Set(
          messages.flatMap((message) =>
            message.info.role === "user"
              ? message.parts.flatMap((part) => {
                  if (part.type !== "text" || part.metadata?.critic_continue !== true) return []
                  const files = part.metadata.critic_files
                  return Array.isArray(files) ? files.filter((file): file is string => typeof file === "string") : []
                })
              : [],
          ),
        )
        if (
          input.findings.some(
            (finding) =>
              !allowed.has(finding.file) ||
              !finding.title.trim() ||
              !finding.consequence.trim() ||
              !finding.evidence.trim() ||
              (finding.line !== undefined && (!Number.isSafeInteger(finding.line) || finding.line < 1)),
          )
        )
          throw new Error("Every critic finding requires a changed file, valid line, consequence, and direct evidence")
        if (
          messages.some(
            (message) =>
              message.info.role === "assistant" &&
              message.parts.some(
                (part) =>
                  part.type === "tool" &&
                  part.tool === TOOL_ID &&
                  part.state.status === "completed" &&
                  isRecord(part.state.metadata) &&
                  part.state.metadata.critic === true,
              ),
          )
        )
          throw new Error("The critic pass has already been completed for this request")
        const startedAt = Date.now()
        return {
          title: input.status === "clean" ? "Critic pass clean" : `Critic found ${input.findings.length} issue(s)`,
          metadata: {
            critic: true,
            status: input.status,
            findings: input.findings,
            startedAt,
          },
          output:
            input.status === "clean"
              ? "Evidence-based critic pass completed with no concrete findings."
              : input.findings
                  .map(
                    (finding) =>
                      `${finding.severity.toUpperCase()} ${finding.file}${finding.line ? `:${finding.line}` : ""} — ${finding.title}\nConsequence: ${finding.consequence}\nEvidence: ${finding.evidence}`,
                  )
                  .join("\n\n"),
        }
      }),
  }),
)
