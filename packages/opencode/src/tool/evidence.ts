import { Effect, Schema } from "effect"
import { TOOL_ID } from "@/session/evidence"
import { Tool } from "./tool"

const Finding = Schema.Struct({
  claim: Schema.String.annotate({ description: "Concise factual conclusion supported by the cited files" }),
  files: Schema.Array(Schema.String).annotate({
    description: "Project files actually read during the current user turn that support this finding",
  }),
})

const Parameters = Schema.Struct({
  status: Schema.Literals(["complete", "blocked"]),
  findings: Schema.Array(Finding).annotate({
    description: "Grounded findings. Required for complete status and empty for blocked status.",
  }),
  unresolved: Schema.Array(Schema.String).annotate({
    description: "Questions that available repository evidence could not resolve. Required for blocked status.",
  }),
})

export const EvidenceTool = Tool.define(
  TOOL_ID,
  Effect.succeed({
    description:
      "Submit grounded evidence immediately before the final answer to a read-only repository investigation, but only after successful repository research tools have run for the current genuine user request. Never call this tool for casual conversation or before repository research. This tool is stack-independent. Complete findings must cite project files actually read during the current user turn. Use blocked status with concrete unresolved points when searches cannot establish the requested conclusion. The session gate validates the submission against recorded tool results.",
    parameters: Parameters,
    execution: { access: "control", completesEvidence: true } as const,
    execute: (input: Schema.Schema.Type<typeof Parameters>) =>
      Effect.sync(() => {
        if (input.findings.length > 12) throw new Error("Evidence accepts at most 12 findings")
        if (input.unresolved.length > 12) throw new Error("Evidence accepts at most 12 unresolved points")
        if (input.findings.some((finding) => !finding.claim.trim() || finding.files.length === 0))
          throw new Error("Every evidence finding requires a claim and at least one supporting file")
        if (input.findings.some((finding) => finding.files.length > 8))
          throw new Error("An evidence finding accepts at most 8 supporting files")
        if (input.status === "complete" && input.findings.length === 0)
          throw new Error("Complete evidence requires at least one finding")
        if (input.status === "complete" && input.unresolved.length > 0)
          throw new Error("Complete evidence cannot contain unresolved points")
        if (input.status === "blocked" && input.unresolved.length === 0)
          throw new Error("Blocked evidence requires at least one unresolved point")
        if (input.status === "blocked" && input.findings.length > 0)
          throw new Error("Blocked evidence cannot contain completed findings")

        const files = Array.from(new Set(input.findings.flatMap((finding) => finding.files))).sort()
        return {
          title: input.status === "complete" ? "Evidence submitted" : "Evidence blocked",
          metadata: {
            evidence: true,
            status: input.status,
            files,
            findings: input.findings.length,
            unresolved: input.unresolved.length,
          },
          output: [
            `status=${input.status}`,
            `findings=${input.findings.length}`,
            `files=${files.length}`,
            `unresolved=${input.unresolved.length}`,
          ].join("\n"),
        }
      }),
  }),
)
