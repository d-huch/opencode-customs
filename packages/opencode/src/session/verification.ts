export * as SessionVerification from "./verification"

import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { isRecord } from "@/util/record"
import { MessageV2 } from "./message-v2"
import { SessionMutation } from "./mutation"
import type { ChangeRisk } from "@opencode-ai/core/change-risk"
import { VerificationMatrix } from "@opencode-ai/core/verification-matrix"

export const TOOL_ID = "verification"
export const systemPrompt = (
  checks: readonly {
    readonly name: string
    readonly command: string
    readonly when?: string
    readonly timeout?: number
  }[] = [],
) =>
  [
    "When you change project files, use the verification tool before your final answer. A deterministic Verification Matrix selects the minimum relevant check types from the changed artifacts and risk assessment. Map only those types to repository-native focused commands; do not run the entire test suite unless the user explicitly requests it or no narrower check exists. Every selected type must be executed or explicitly omitted with a concrete availability reason. In the final answer, briefly explain which checks ran and why. If verification fails, repair the relevant cause and rerun verification. Do not use the tool for read-only or explanation tasks. A synthetic verification checkpoint is an internal control instruction, not a new user request; continue from the current changes and verification evidence instead of restarting or repeating the task.",
    "A deterministic change-risk classifier evaluates every write before execution. For high or critical changes, present a concise implementation plan before the first mutation, wait for the classifier's approval boundary, and keep the change within the approved scope. Never bypass or retry around a risk rejection.",
    checks.length
      ? `Configured project checks (select only those relevant to the changed files):\n${checks
          .map(
            (check) =>
              `- ${check.name}: ${check.command}${check.when ? ` (when: ${check.when})` : ""}${check.timeout ? ` (timeout: ${check.timeout} ms)` : ""}`,
          )
          .join("\n")}`
      : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n\n")

type Evidence = {
  readonly messageID: string
  readonly passed: boolean
  readonly files: readonly string[]
  readonly attempt: number
}

export type Decision =
  | { readonly type: "none" }
  | { readonly type: "passed"; readonly evidence: Evidence }
  | {
      readonly type: "verify" | "repair"
      readonly files: readonly string[]
      readonly attempt: number
      readonly maxAttempts: number
      readonly risk?: ChangeRisk.Assessment
      readonly matrix: VerificationMatrix.Plan
    }
  | { readonly type: "exhausted"; readonly evidence?: Evidence }

export function inspect(input: {
  readonly messages: readonly SessionV1.WithParts[]
  readonly directory: string
  readonly repairAttempts: number
}) {
  const request = MessageV2.latestUserRequest(input.messages) ?? MessageV2.activeUserRequest(input.messages)
  if (!request) return { type: "none" } satisfies Decision
  const start = input.messages.findIndex((message) => message.info.id === request.info.id)
  const messages = start === -1 ? input.messages : input.messages.slice(start)
  const files = Array.from(
    new Set(
      messages.flatMap((message) => {
        if (message.info.role !== "assistant") return []
        const owned = new Set(SessionMutation.messageFiles(message, input.directory))
        return message.parts.flatMap((part) =>
          part.type === "patch"
            ? SessionMutation.filter(input.directory, part.files, owned).map((file) => normalize(input.directory, file))
            : [],
        )
      }),
    ),
  ).sort()
  if (files.length === 0) return { type: "none" } satisfies Decision

  const evidence = messages.flatMap((message) =>
    message.info.role === "assistant"
      ? message.parts.flatMap((part) => {
          if (part.type !== "tool" || part.tool !== TOOL_ID || part.state.status !== "completed") return []
          if (!isRecord(part.state.metadata) || part.state.metadata.verification !== true) return []
          return [
            {
              messageID: message.info.id,
              passed: part.state.metadata.passed === true,
              files: Array.isArray(part.state.metadata.files)
                ? part.state.metadata.files
                    .filter((file): file is string => typeof file === "string")
                    .map((file) => normalize(input.directory, file))
                : [],
              attempt:
                typeof part.state.metadata.attempt === "number" && Number.isSafeInteger(part.state.metadata.attempt)
                  ? part.state.metadata.attempt
                  : 1,
            },
          ]
        })
      : [],
  )
  const latest = evidence.at(-1)
  const laterPatch = latest
    ? messages.some((message) => {
        if (message.info.role !== "assistant" || message.info.id <= latest.messageID) return false
        const owned = new Set(SessionMutation.messageFiles(message, input.directory))
        return message.parts.some(
          (part) => part.type === "patch" && SessionMutation.filter(input.directory, part.files, owned).length > 0,
        )
      })
    : false
  const covered = latest ? files.every((file) => latest.files.includes(file)) : false
  if (latest?.passed && covered && !laterPatch) return { type: "passed", evidence: latest } satisfies Decision

  const prompts = messages.flatMap((message) =>
    message.info.role === "user"
      ? message.parts.filter(
          (part) => part.type === "text" && part.synthetic === true && part.metadata?.verification_continue === true,
        )
      : [],
  ).length
  const maxAttempts = Math.max(1, input.repairAttempts + 1)
  if (prompts >= maxAttempts) return { type: "exhausted", ...(latest ? { evidence: latest } : {}) } satisfies Decision
  const risk = highestRisk(
    messages.flatMap((message) =>
      message.info.role === "assistant"
        ? message.parts.flatMap((part) => {
            if (part.type !== "tool" || part.state.status !== "completed") return []
            if (!isRecord(part.state.metadata) || !isRecord(part.state.metadata.planner)) return []
            const assessment = part.state.metadata.planner.risk
            return isRiskAssessment(assessment) ? [assessment] : []
          })
        : [],
    ),
  )
  const matrix = VerificationMatrix.select({ files, ...(risk ? { risk } : {}) })
  return {
    type: latest && !latest.passed && !laterPatch ? "repair" : "verify",
    files,
    attempt: prompts + 1,
    maxAttempts,
    ...(risk ? { risk } : {}),
    matrix,
  } satisfies Decision
}

export function prompt(decision: Extract<Decision, { type: "verify" | "repair" }>) {
  const final = decision.attempt === decision.maxAttempts
  return [
    decision.type === "repair"
      ? "The latest verification did not pass. Repair only the relevant causes, then rerun the verification tool."
      : "Verification is required before completing this change. Use the verification tool with the smallest relevant repository-native checks.",
    `Changed files:\n${decision.files.map((file) => `- ${file}`).join("\n")}`,
    decision.risk
      ? `Change risk: ${decision.risk.level} (${decision.risk.categories.join(", ")}). Required verification depth: ${decision.risk.policy.verification}.`
      : undefined,
    `Verification Matrix (${decision.matrix.depth}):\n${decision.matrix.checks
      .map(
        (check) =>
          `- ${check.kind} [${check.requirement}]: ${check.reasons.join(" ")}${
            check.files.length ? ` Files: ${check.files.join(", ")}` : ""
          }`,
      )
      .join("\n")}`,
    decision.matrix.rationale,
    "Pass these exact check kinds to the verification tool. Use focused repository-native commands. If a conditional check is unavailable, omit it with a concrete reason. A required check that cannot run leaves the change unverified.",
    `Verification attempt ${decision.attempt} of ${decision.maxAttempts}.`,
    final
      ? "This is the final bounded attempt. If verification still cannot pass, clearly report the failed or unavailable checks in the user's language instead of claiming success."
      : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n\n")
}

export function attempt(messages: readonly SessionV1.WithParts[]) {
  return (
    messages.flatMap((message) =>
      message.info.role === "assistant"
        ? message.parts.filter(
            (part) => part.type === "tool" && part.tool === TOOL_ID && part.state.status === "completed",
          )
        : [],
    ).length + 1
  )
}

function normalize(directory: string, file: string) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(directory, file)
  return path.relative(directory, absolute).replaceAll("\\", "/") || path.basename(absolute)
}

function isRiskAssessment(value: unknown): value is ChangeRisk.Assessment {
  if (!isRecord(value) || !isRecord(value.policy)) return false
  return (
    ["low", "medium", "high", "critical"].includes(String(value.level)) &&
    typeof value.score === "number" &&
    Array.isArray(value.categories) &&
    Array.isArray(value.files)
  )
}

function highestRisk(assessments: readonly ChangeRisk.Assessment[]) {
  const levels: Record<ChangeRisk.Level, number> = { low: 1, medium: 2, high: 3, critical: 4 }
  return assessments.toSorted((left, right) => levels[right.level] - levels[left.level])[0]
}
