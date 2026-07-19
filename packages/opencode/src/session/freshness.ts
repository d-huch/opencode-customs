export * as SessionFreshness from "./freshness"

import { SessionV1 } from "@opencode-ai/core/v1/session"
import { generateText } from "ai"

const CLASSIFIER_PROMPT = `You are an epistemic routing classifier. Decide whether a high-confidence answer to the latest user request requires external web evidence.

Return VERIFY when the answer would make concrete claims about the external world that may have changed since model training, when exact specifications, availability, prices, schedules, laws, current people or organizations, recent events, quotations, or source attribution are needed, or when a named entity or version may postdate the model's knowledge.

Return LOCAL when the answer follows entirely from the supplied conversation or files, is pure calculation or logic, is creative writing, translation, editing, or subjective discussion that does not require external factual claims.

Do not answer the request. Do not infer a domain, language, framework, product, or project type. On the first line output exactly VERIFY or LOCAL. On the second line give one short reason.`

export type Decision = {
  readonly required: boolean
  readonly reason: string
  readonly query: string
  readonly source: "model" | "conservative"
}

export type EvidenceState = "missing" | "completed" | "failed"

export function read(request: SessionV1.WithParts | undefined) {
  const part = request?.parts.find(
    (item): item is SessionV1.TextPart => item.type === "text" && item.synthetic !== true,
  )
  const stored = part?.metadata?.freshness
  if (!isRecord(stored)) return
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
  const query = input.request.trim().slice(0, 1_000)
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
      const local = lines[0]?.toUpperCase() === "LOCAL"
      return {
        required: !local,
        reason:
          lines.slice(1).join(" ").slice(0, 300) ||
          (local ? "Request is locally answerable" : "External evidence required"),
        query,
        source: "model",
      }
    },
    () => conservative(query),
  )
}

export function conservative(request: string): Decision {
  return {
    required: true,
    reason: "Freshness classification was unavailable; external evidence is required conservatively",
    query: request.trim().slice(0, 1_000),
    source: "conservative",
  }
}

export function evidence(messages: readonly SessionV1.WithParts[], requestID: string | undefined): EvidenceState {
  const index = messages.findIndex((message) => message.info.id === requestID)
  if (index < 0) return "missing"
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

export function route<T>(input: {
  readonly decision: Decision | undefined
  readonly evidence: EvidenceState
  readonly tools: Record<string, T>
}) {
  if (!input.decision?.required)
    return {
      tools: input.tools,
      requiredTools: [] as string[],
      toolChoice: undefined as "required" | "none" | undefined,
      unavailable: false,
    }
  if (input.evidence === "completed")
    return {
      tools: input.tools,
      requiredTools: [] as string[],
      toolChoice: undefined as "required" | "none" | undefined,
      unavailable: false,
    }
  if (input.evidence === "failed" || !input.tools.websearch)
    return {
      tools: input.tools,
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
    return `External evidence is required before answering this request. Use the websearch tool now. Search for the user's actual subject, prefer current primary or authoritative sources, and never invent a source or URL. Do not answer from model memory before the search completes.`
  return `External evidence was obtained for this request. Base concrete factual claims on the retrieved sources, prefer primary or authoritative sources, distinguish source-backed facts from inference, include direct source links in the user's language, and explicitly disclose anything the sources did not verify.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
