export * as SessionEvidence from "./evidence"

import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { isRecord } from "@/util/record"
import { MessageV2 } from "./message-v2"
import { SessionMutation } from "./mutation"

export const TOOL_ID = "evidence"

const researchTools = new Set(["read", "grep", "glob", "lsp"])

export const systemPrompt = (finalAttempt = false) =>
  [
    "Ground repository analysis in successful tool results. Do not say that a file, symbol, relationship, or behavior was found or verified unless a successful repository tool result supports it.",
    "For a read-only repository investigation, use discovery tools and read the relevant files. Treat the first lexical match as a candidate, not a conclusion. Compare candidates with the current request and trace enough observed relationships to explain the requested behavior. Never infer that a path, component, or relationship exists merely because a framework or repository convention would normally place it there. After the repository router supplies bounded files or snippets, inspect those before starting another search and use at most one targeted search for a specific missing relationship. Immediately before the final answer, call the evidence tool exactly once. Every completed finding must cite files actually read in the current user turn. If the requested conclusion cannot be established, submit blocked evidence with the unresolved points instead of guessing.",
    "A synthetic user message can be either a compaction surrogate for the latest genuine request or an internal evidence checkpoint. Follow an evidence checkpoint as a control instruction without treating it as a new request. Continue from existing evidence; do not restart from a historical Objective or Next Move. Always answer in the language of the latest genuine request.",
    finalAttempt
      ? "This is the final bounded evidence attempt. If evidence is still incomplete, report the unresolved result honestly in the user's language."
      : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n\n")

type Declaration = {
  readonly partID: string
  readonly status: "complete" | "blocked"
  readonly files: readonly string[]
  readonly findings: number
  readonly unresolved: number
}

export type Decision =
  | { readonly type: "none" }
  | { readonly type: "accepted"; readonly status: Declaration["status"] }
  | {
      readonly type: "continue"
      readonly attempt: number
      readonly maxAttempts: number
      readonly reason: "missing" | "ungrounded" | "stale"
    }
  | { readonly type: "exhausted" }

export function prompt(decision: Extract<Decision, { type: "continue" }>) {
  const reason =
    decision.reason === "missing"
      ? "No evidence declaration was submitted for the current investigation."
      : decision.reason === "stale"
        ? "Repository research continued after the last evidence declaration."
        : "The last evidence declaration was not grounded in files read during the current investigation."
  return [
    "<evidence-checkpoint>",
    "Continue the existing active request from the current repository evidence. Do not restart the task, repeat the user's request, or repeat a previous answer.",
    reason,
    "Read only the specific missing files or relationships, then call the evidence tool exactly once before answering.",
    `Evidence attempt ${decision.attempt} of ${decision.maxAttempts}.`,
    "</evidence-checkpoint>",
  ].join("\n")
}

export function inspect(input: {
  readonly messages: readonly SessionV1.WithParts[]
  readonly directory: string
  readonly followupAttempts: number
  readonly attempts?: number
}) {
  const messages = currentTurn(input.messages)
  if (!messages || changedRepository(messages)) return { type: "none" } satisfies Decision
  const research = completedResearch(messages)
  if (research.length === 0) return { type: "none" } satisfies Decision

  const readFiles = new Set(
    research.flatMap((part) => {
      if (part.tool !== "read" || !isRecord(part.state.metadata)) return []
      const display = part.state.metadata.display
      if (!isRecord(display) || display.type !== "file" || typeof display.path !== "string") return []
      return [normalize(input.directory, display.path)]
    }),
  )
  const declarations = messages
    .flatMap((message) =>
      message.info.role === "assistant"
        ? message.parts.flatMap((part): Declaration[] => {
            if (part.type !== "tool" || part.tool !== TOOL_ID || part.state.status !== "completed") return []
            if (!isRecord(part.state.metadata) || part.state.metadata.evidence !== true) return []
            const status = part.state.metadata.status
            if (status !== "complete" && status !== "blocked") return []
            return [
              {
                partID: part.id,
                status,
                files: Array.isArray(part.state.metadata.files)
                  ? part.state.metadata.files
                      .filter((file): file is string => typeof file === "string")
                      .map((file) => normalize(input.directory, file))
                  : [],
                findings: typeof part.state.metadata.findings === "number" ? part.state.metadata.findings : 0,
                unresolved: typeof part.state.metadata.unresolved === "number" ? part.state.metadata.unresolved : 0,
              },
            ]
          })
        : [],
    )
    .toSorted((left, right) => left.partID.localeCompare(right.partID))
  const latest = declarations.at(-1)
  const laterResearch = latest ? research.some((part) => part.id > latest.partID) : false
  const complete =
    latest?.status === "complete" &&
    latest.findings > 0 &&
    latest.files.length > 0 &&
    latest.files.every((file) => readFiles.has(file))
  const blocked = latest?.status === "blocked" && latest.unresolved > 0 && research.length > 0
  if ((complete || blocked) && !laterResearch) return { type: "accepted", status: latest.status } satisfies Decision

  const prompts =
    input.attempts ??
    messages.flatMap((message) =>
      message.info.role === "user"
        ? message.parts.filter(
            (part) => part.type === "text" && part.synthetic === true && part.metadata?.evidence_continue === true,
          )
        : [],
    ).length
  const maxAttempts = Math.max(1, input.followupAttempts + 1)
  if (prompts >= maxAttempts) return { type: "exhausted" } satisfies Decision
  return {
    type: "continue",
    attempt: prompts + 1,
    maxAttempts,
    reason: !latest ? "missing" : laterResearch ? "stale" : "ungrounded",
  } satisfies Decision
}

export function attempt(messages: readonly SessionV1.WithParts[]) {
  return (
    messages.flatMap((message) =>
      message.info.role === "user"
        ? message.parts.filter(
            (part) => part.type === "text" && part.synthetic === true && part.metadata?.evidence_continue === true,
          )
        : [],
    ).length + 1
  )
}

export function requiresDeclaration(messages: readonly SessionV1.WithParts[]) {
  const scoped = currentTurn(messages)
  if (!scoped || changedRepository(scoped)) return false
  return completedResearch(scoped).length > 0
}

function currentTurn(messages: readonly SessionV1.WithParts[]) {
  const request = MessageV2.latestUserRequest(messages) ?? MessageV2.activeUserRequest(messages)
  if (!request) return
  const start = messages.findIndex((message) => message.info.id === request.info.id)
  return start === -1 ? messages : messages.slice(start)
}

function changedRepository(messages: readonly SessionV1.WithParts[]) {
  return messages.some((message) => {
    if (message.info.role !== "assistant") return false
    const root = message.info.path.root
    const owned = new Set(SessionMutation.messageFiles(message, root))
    return message.parts.some(
      (part) => part.type === "patch" && SessionMutation.filter(root, part.files, owned).length > 0,
    )
  })
}

function completedResearch(messages: readonly SessionV1.WithParts[]) {
  return messages
    .flatMap((message) =>
      message.info.role === "assistant"
        ? message.parts.filter(
            (part): part is SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted } =>
              part.type === "tool" && part.state.status === "completed" && researchTools.has(part.tool),
          )
        : [],
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
}

function normalize(directory: string, file: string) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(directory, file)
  return path.relative(directory, absolute).replaceAll("\\", "/") || path.basename(absolute)
}
