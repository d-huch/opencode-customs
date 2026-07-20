export * as SessionFreshness from "./freshness"

import { SessionV1 } from "@opencode-ai/core/v1/session"
import { generateText } from "ai"

const CLASSIFIER_PROMPT = `You are an epistemic routing classifier. Route the latest genuine user request to exactly one execution scope.

Return EXTERNAL when a high-confidence answer requires facts about the external world, current or potentially changed information, exact specifications, availability, prices, schedules, laws, current people or organizations, recent events, quotations, source attribution, or a named entity or version that may postdate model knowledge. EXTERNAL takes priority over incidental vocabulary that may also occur in the workspace.

Return REPOSITORY when the user asks to find, inspect, explain, change, create, run, or verify something in the current project, workspace, local files, or local development environment. Do not choose REPOSITORY merely because words from a general question happen to resemble symbols or filenames in a project.

Return LOCAL when the answer follows entirely from the supplied conversation, is pure calculation or logic, creative writing, translation, editing, or subjective discussion that needs neither workspace access nor external facts.

The input may include several preceding user messages solely to resolve repeated short follow-ups or mode changes. Route the latest request in that conversational chain, not a stale unrelated objective. Do not answer the request. Do not infer a domain, language, framework, product, or project type. On the first line output exactly EXTERNAL, REPOSITORY, or LOCAL. On the second line give one short reason.`

export type Scope = "external" | "repository" | "local"

export type Decision = {
  readonly scope: Scope
  readonly required: boolean
  readonly reason: string
  readonly query: string
  readonly source: "model" | "conservative"
}

export type EvidenceState = "missing" | "completed" | "failed"

export function read(request: SessionV1.WithParts | undefined) {
  const part = request?.parts.find(
    (item): item is SessionV1.TextPart =>
      item.type === "text" && (item.synthetic !== true || item.metadata?.compaction_continue === true),
  )
  const stored = part?.metadata?.freshness
  if (!isRecord(stored)) return
  if (stored.scope !== "external" && stored.scope !== "repository" && stored.scope !== "local") return
  if (typeof stored.required !== "boolean") return
  if (typeof stored.reason !== "string") return
  if (typeof stored.query !== "string") return
  if (stored.source !== "model" && stored.source !== "conservative") return
  return stored as Decision
}

export function write(part: SessionV1.TextPart, decision: Decision) {
  return {
    ...part,
    metadata: {
      ...part.metadata,
      freshness: decision,
    },
  }
}

export function classify(input: {
  readonly model: Parameters<typeof generateText>[0]["model"]
  readonly request: string
  readonly signal?: AbortSignal
}) {
  const query = input.request.trim().slice(-1_000)
  return generateText({
    model: input.model,
    system: CLASSIFIER_PROMPT,
    prompt: query,
    temperature: 0,
    maxOutputTokens: 80,
    abortSignal: input.signal,
  }).then(
    (result): Decision => {
      const lines = result.text
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const label = lines[0]?.toUpperCase()
      const scope: Scope =
        label === "REPOSITORY" ? "repository" : label === "LOCAL" ? "local" : "external"
      return {
        scope,
        required: scope === "external",
        reason:
          lines.slice(1).join(" ").slice(0, 300) ||
          (scope === "external"
            ? "External evidence required"
            : scope === "repository"
              ? "Workspace evidence required"
              : "Request is locally answerable"),
        query,
        source: "model",
      }
    },
    () => conservative(query),
  )
}

export function conservative(request: string): Decision {
  return {
    scope: "external",
    required: true,
    reason: "Freshness classification was unavailable; external evidence is required conservatively",
    query: request.trim().slice(0, 1_000),
    source: "conservative",
  }
}

export function repository(request: string): Decision {
  return {
    scope: "repository",
    required: false,
    reason: "The request includes an explicit workspace file",
    query: request.trim().slice(0, 1_000),
    source: "conservative",
  }
}

export function evidence(messages: readonly SessionV1.WithParts[], requestID: string | undefined): EvidenceState {
  const index = messages.findIndex((message) => message.info.id === requestID)
  if (index < 0) return "missing"
  const stored = messages[index]?.parts.find(
    (part): part is SessionV1.TextPart =>
      part.type === "text" && part.metadata?.compaction_continue === true,
  )?.metadata?.freshness_evidence
  if (stored === "missing" || stored === "completed" || stored === "failed") return stored
  const attempts = messages
    .slice(index + 1)
    .flatMap((message) =>
      message.info.role === "assistant"
        ? message.parts.filter(
            (part): part is SessionV1.ToolPart =>
              part.type === "tool" && (part.tool === "websearch" || part.tool === "webfetch"),
          )
        : [],
    )
  if (attempts.some((part) => part.state.status === "completed")) return "completed"
  if (attempts.length > 0) return "failed"
  return "missing"
}

export function continuationMetadata(input: {
  readonly messages: readonly SessionV1.WithParts[]
  readonly request: SessionV1.WithParts | undefined
}) {
  const decision = read(input.request)
  return {
    compaction_continue: true,
    ...(decision
      ? {
          freshness: decision,
          freshness_evidence: evidence(input.messages, input.request?.info.id),
        }
      : {}),
  }
}

export function route<T>(input: {
  readonly decision: Decision | undefined
  readonly evidence: EvidenceState
  readonly tools: Record<string, T>
}) {
  if (!input.decision)
    return {
      tools: input.tools,
      requiredTools: [] as string[],
      toolChoice: undefined as "required" | "none" | undefined,
      unavailable: false,
    }
  if (input.decision.scope === "local")
    return {
      tools: {} as Record<string, T>,
      requiredTools: [] as string[],
      toolChoice: "none" as const,
      unavailable: false,
    }
  if (input.decision.scope === "repository")
    return {
      tools: input.tools,
      requiredTools: [] as string[],
      toolChoice: undefined as "required" | "none" | undefined,
      unavailable: false,
    }
  if (input.evidence === "completed")
    return {
      tools: externalTools(input.tools),
      requiredTools: [] as string[],
      toolChoice: undefined as "required" | "none" | undefined,
      unavailable: false,
    }
  if (input.evidence === "failed" || !input.tools.websearch)
    return {
      tools: {} as Record<string, T>,
      requiredTools: [] as string[],
      toolChoice: "none" as const,
      unavailable: true,
    }
  return {
    tools: { websearch: input.tools.websearch },
    requiredTools: ["websearch"],
    toolChoice: "required" as const,
    unavailable: false,
  }
}

export function systemPrompt(decision: Decision | undefined, evidence: EvidenceState, unavailable: boolean) {
  if (!decision?.required) return
  if (unavailable)
    return `External verification was required for this request but is unavailable or failed. Do not retry automatically. Do not provide exact or current factual claims from memory. Explain in the user's language that the facts could not be verified and state what source access is needed.`
  if (evidence === "missing")
    return `External evidence is required before answering this request. Call the websearch tool now, including in planning mode. Search for the user's actual subject, prefer current primary or authoritative sources, and never invent a source or URL. Do not inspect the workspace, print or propose shell commands, simulate a search in prose, or answer from model memory before the tool completes.`
  return `External evidence was obtained for this request. Base concrete factual claims on the retrieved sources, prefer primary or authoritative sources, distinguish source-backed facts from inference, include direct source links in the user's language, and explicitly disclose anything the sources did not verify.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function externalTools<T>(tools: Record<string, T>) {
  return Object.fromEntries(
    ["websearch", "webfetch"].flatMap((name) => (tools[name] === undefined ? [] : [[name, tools[name]] as const])),
  ) as Record<string, T>
}
