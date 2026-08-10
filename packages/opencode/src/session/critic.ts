export * as SessionCritic from "./critic"

import path from "path"
import { CriticPass } from "@opencode-ai/core/critic-pass"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Snapshot } from "@/snapshot"
import { isRecord } from "@/util/record"
import { MessageV2 } from "./message-v2"

export const TOOL_ID = "critic"

export const systemPrompt = [
  "You are performing exactly one evidence-based review after implementation and verification.",
  "Review only the supplied original task, patch, changed files, verification results, and known limitations. Do not use prior conversation, repository recall, memory, external knowledge, or unstated assumptions.",
  "Do not edit code, run commands, request more context, or start another review. Report only concrete defects supported by the supplied evidence.",
  "For every finding, provide a precise changed file, the best available line number, the consequence, and direct evidence from the patch or verification result. Do not report praise, style preferences, speculation, or issues outside the changed patch.",
  "Call the critic tool exactly once. Use status=clean with no findings when the supplied evidence contains no concrete defect. After the tool result, give a short final completion summary in the natural language and script of the original task.",
].join("\n")

export type Payload = {
  readonly task: string
  readonly files: readonly string[]
  readonly patch: string
  readonly verification: string
  readonly limitations: readonly string[]
}

export type Decision =
  | { readonly type: "review" }
  | { readonly type: "completed"; readonly review: CriticPass.Review }
  | { readonly type: "exhausted" }

export function inspect(input: {
  readonly messages: readonly SessionV1.WithParts[]
  readonly requestMessageID: string
  readonly model: { readonly providerID: string; readonly modelID: string }
  readonly files: readonly string[]
  readonly attempts: number
}) {
  const start = input.messages.findIndex((message) => message.info.id === input.requestMessageID)
  const messages = start === -1 ? input.messages : input.messages.slice(start)
  const result = messages.flatMap((message) =>
    message.info.role === "assistant"
      ? message.parts.flatMap((part) => {
          if (part.type !== "tool" || part.tool !== TOOL_ID || part.state.status !== "completed") return []
          if (!isRecord(part.state.metadata) || part.state.metadata.critic !== true) return []
          const findings = Array.isArray(part.state.metadata.findings)
            ? part.state.metadata.findings.filter(isFinding)
            : []
          const status = part.state.metadata.status === "findings" ? "findings" : "clean"
          return [
            {
              requestMessageID: input.requestMessageID,
              status,
              model: input.model,
              files: input.files,
              findings,
              startedAt:
                typeof part.state.metadata.startedAt === "number"
                  ? part.state.metadata.startedAt
                  : part.state.time.start,
              completedAt: part.state.time.end,
            } satisfies CriticPass.Review,
          ]
        })
      : [],
  ).at(-1)
  if (result) return { type: "completed", review: result } satisfies Decision
  if (input.attempts >= 1) return { type: "exhausted" } satisfies Decision
  return { type: "review" } satisfies Decision
}

export function build(input: {
  readonly task: string
  readonly files: readonly string[]
  readonly diffs: readonly Snapshot.FileDiff[]
  readonly messages: readonly SessionV1.WithParts[]
}) {
  const patchBudget = 20_000
  const rendered = input.diffs
    .map(
      (diff) =>
        `--- ${diff.file ?? "(unknown file)"} (${diff.status ?? "modified"}; +${diff.additions} -${diff.deletions}) ---\n${diff.patch?.trim() || "(empty patch)"}`,
    )
    .join("\n\n")
  const patch = rendered.slice(0, patchBudget)
  const truncated = rendered.length > patch.length
  const verification = input.messages
    .flatMap((message) =>
      message.info.role === "assistant"
        ? message.parts.flatMap((part) => {
            if (part.type !== "tool" || part.tool !== "verification" || part.state.status !== "completed") return []
            if (!isRecord(part.state.metadata) || part.state.metadata.verification !== true) return []
            return [compactVerification(part.state.metadata)]
          })
        : [],
    )
    .at(-1)
  const limitations = [
    ...(truncated
      ? [`Patch was truncated to ${patchBudget} characters from ${rendered.length} characters for reviewer context.`]
      : []),
    ...verificationLimitations(verification?.metadata),
  ]
  return {
    task: input.task.trim().slice(0, 8_000),
    files: Array.from(new Set(input.files)).sort(),
    patch: patch || "(No textual patch was available.)",
    verification: verification?.text ?? "(No compact verification result was available.)",
    limitations,
  } satisfies Payload
}

export function prompt(payload: Payload) {
  return [
    "<original_task>",
    payload.task,
    "</original_task>",
    "<changed_files>",
    ...payload.files.map((file) => `- ${file}`),
    "</changed_files>",
    "<patch>",
    payload.patch,
    "</patch>",
    "<verification_results>",
    payload.verification,
    "</verification_results>",
    "<known_limitations>",
    ...(payload.limitations.length ? payload.limitations.map((item) => `- ${item}`) : ["- None reported."]),
    "</known_limitations>",
  ].join("\n")
}

export function continuation(message: SessionV1.WithParts | undefined) {
  if (!message || message.info.role !== "user") return false
  return message.parts.some(
    (part) => part.type === "text" && part.synthetic === true && part.metadata?.critic_continue === true,
  )
}

export function completed(messages: readonly SessionV1.WithParts[]) {
  const start = messages.findLastIndex(
    (message) =>
      message.info.role === "user" &&
      message.parts.some(
        (part) => part.type === "text" && part.synthetic === true && part.metadata?.critic_continue === true,
      ),
  )
  return (start === -1 ? [] : messages.slice(start)).some(
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
}

export function compactMessages(messages: readonly SessionV1.WithParts[], messageID: string) {
  const start = messages.findIndex((message) => message.info.id === messageID)
  return start === -1 ? [] : messages.slice(start)
}

function compactVerification(metadata: Record<string, unknown>) {
  const checks = Array.isArray(metadata.checks)
    ? metadata.checks
        .filter(isRecord)
        .map(
          (check) =>
            `${check.passed === true ? "PASS" : "FAIL"} ${String(check.name ?? "check")}: ${String(check.command ?? "")} (exit ${String(check.exit ?? "unknown")})`,
        )
    : []
  const lsp = isRecord(metadata.lsp)
    ? `LSP: ${String(metadata.lsp.files ?? 0)} files, ${String(metadata.lsp.errors ?? 0)} errors`
    : undefined
  return {
    text: [
      metadata.passed === true ? "Verification passed." : "Verification did not pass.",
      ...checks,
      lsp,
      Array.isArray(metadata.omissions) && metadata.omissions.length
        ? `Omissions: ${metadata.omissions.map((item) => JSON.stringify(item)).join("; ")}`
        : undefined,
    ]
      .filter((item): item is string => item !== undefined)
      .join("\n"),
    metadata,
  }
}

function verificationLimitations(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return ["Verification metadata was unavailable."]
  const limitations = [
    ...(Array.isArray(metadata.omissions)
      ? metadata.omissions
          .filter(isRecord)
          .map((item) => `${String(item.kind ?? "check")} omitted: ${String(item.reason ?? "reason unavailable")}`)
      : []),
    ...(Array.isArray(metadata.missing) && metadata.missing.length
      ? [`Missing verification kinds: ${metadata.missing.map(String).join(", ")}`]
      : []),
    ...(metadata.unverified === true ? ["The verification result is marked unverified."] : []),
  ]
  return limitations
}

function isFinding(value: unknown): value is CriticPass.Finding {
  if (!isRecord(value)) return false
  return (
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.title === "string" &&
    typeof value.file === "string" &&
    (value.line === undefined || (typeof value.line === "number" && Number.isSafeInteger(value.line))) &&
    typeof value.consequence === "string" &&
    typeof value.evidence === "string"
  )
}

export function normalize(directory: string, file: string) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(directory, file)
  return path.relative(directory, absolute).replaceAll("\\", "/") || path.basename(absolute)
}
