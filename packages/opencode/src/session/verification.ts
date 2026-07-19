export * as SessionVerification from "./verification"

import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { isRecord } from "@/util/record"
import { MessageV2 } from "./message-v2"

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
    "When you change project files, use the verification tool before your final answer. Select only the smallest repository-native checks that cover the changed files; do not run the entire test suite unless the user explicitly requests it or no narrower check exists. If verification fails, repair the relevant cause and rerun verification. Do not use the tool for read-only or explanation tasks. A synthetic verification checkpoint is an internal control instruction, not a new user request; continue from the current changes and verification evidence instead of restarting or repeating the task.",
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
      messages.flatMap((message) =>
        message.info.role === "assistant"
          ? message.parts.flatMap((part) =>
              part.type === "patch" ? part.files.map((file) => normalize(input.directory, file)) : [],
            )
          : [],
      ),
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
    ? messages.some(
        (message) =>
          message.info.role === "assistant" &&
          message.info.id > latest.messageID &&
          message.parts.some((part) => part.type === "patch" && part.files.length > 0),
      )
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
  return {
    type: latest && !latest.passed && !laterPatch ? "repair" : "verify",
    files,
    attempt: prompts + 1,
    maxAttempts,
  } satisfies Decision
}

export function prompt(decision: Extract<Decision, { type: "verify" | "repair" }>) {
  const final = decision.attempt === decision.maxAttempts
  return [
    decision.type === "repair"
      ? "The latest verification did not pass. Repair only the relevant causes, then rerun the verification tool."
      : "Verification is required before completing this change. Use the verification tool with the smallest relevant repository-native checks.",
    `Changed files:\n${decision.files.map((file) => `- ${file}`).join("\n")}`,
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
