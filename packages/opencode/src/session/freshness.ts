export * as SessionFreshness from "./freshness"

import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Hash } from "@opencode-ai/core/util/hash"
import { generateText } from "ai"
import { ResearchBrowser } from "@opencode-ai/core/tool/research-browser"

const CLASSIFIER_PROMPT = `You are an epistemic routing and durable-memory classifier. Route the latest genuine user request to exactly one execution scope.

Return EXTERNAL when a high-confidence answer requires facts about the external world, current or potentially changed information, exact specifications, availability, prices, schedules, laws, current people or organizations, recent events, quotations, source attribution, or a named entity or version that may postdate model knowledge. EXTERNAL takes priority over incidental vocabulary that may also occur in the workspace.

Return REPOSITORY when the user asks to find, inspect, explain, change, create, run, or verify something in the current project, workspace, local files, or local development environment. Do not choose REPOSITORY merely because words from a general question happen to resemble symbols or filenames in a project.

Return LOCAL when the answer follows entirely from the supplied conversation, is pure calculation or logic, creative writing, translation, editing, or subjective discussion that needs neither workspace access nor external facts.

The input may include several preceding user messages solely to resolve repeated short follow-ups, direct answers, or mode changes. Route the latest request in that conversational chain, not a stale unrelated objective. A request to remember information, a direct answer about the user, or a question answerable from conversation is LOCAL even when an older message mentioned an external person or product.

Also decide whether the latest genuine user message directly supplies durable information that is likely to be useful in a later session. Durable information includes identity details, preferences, standing constraints, decisions, and deliberately taught facts or answers. The user does not need to say "remember". Use the supplied dialogue context to understand short direct answers.

Store only information asserted by the user. Do not store questions, tasks, requests to change or inspect something, guesses, secrets, credentials, transient work state, tool output, project search results, or facts stated or inferred by the assistant. A correction must use the same semantic topic as the older fact so it replaces it. Confidence must reflect whether the information is explicit, durable, and self-contained. Use NO_MEMORY below 0.80 confidence.

Choose GLOBAL for personal identity, language, and general preferences. Choose CROSS-PROJECT for universal working rules that should apply in multiple repositories. Choose PROJECT for facts and decisions specific to the current repository. Choose SESSION only when the user explicitly limits the information to the current conversation; session memory expires automatically. Choose PATTERN for a reusable verified solution that may be proposed in another repository only as an analogy, never as a fact about that repository.

Do not answer the request. Do not infer a domain, language, framework, product, or project type. Output exactly:
line 1: EXTERNAL, REPOSITORY, or LOCAL
line 2: one short routing reason
line 3: RESEARCH_DEPTH: quick or deep
line 4: MEMORY or NO_MEMORY
after MEMORY only:
line 5: CATEGORY: identity, preference, constraint, decision, or context
line 6: SCOPE: global, cross-project, project, session, or pattern
line 7: TOPIC: a short stable semantic key
line 8: CORRECTION: yes or no
line 9: CONFIDENCE: a number from 0 to 1
line 10: TEXT: one concise standalone memory in the user's language.`

export type Scope = "external" | "repository" | "local"
export type MemoryCategory = "identity" | "preference" | "constraint" | "decision" | "context"
export type MemoryScope = "global" | "cross-project" | "project" | "session" | "pattern"

export type Decision = {
  readonly scope: Scope
  readonly required: boolean
  readonly reason: string
  readonly query: string
  readonly researchDepth?: ResearchBrowser.Depth
  readonly source: "model" | "conservative"
  readonly memory?: string
  readonly memoryCategory?: MemoryCategory
  readonly memoryTopic?: string
  readonly memoryConfidence?: number
  readonly memoryScope?: MemoryScope
  readonly memoryCorrection?: boolean
}

export type EvidenceState = "missing" | "completed" | "failed"

export function classifierModel<T extends { readonly providerID: string; readonly id: string }>(input: {
  readonly primary: T
  readonly utility: T | undefined
}) {
  if (input.utility && (input.utility.providerID !== input.primary.providerID || input.utility.id !== input.primary.id))
    return input.utility
  if (input.primary.providerID === "lmstudio") return
  return input.primary
}

const memoryCategories = new Set<MemoryCategory>(["identity", "preference", "constraint", "decision", "context"])
const memoryScopes = new Set<MemoryScope>(["global", "cross-project", "project", "session", "pattern"])
const classifierCache = new Map<string, { readonly expires: number; readonly decision: Decision }>()
const CLASSIFIER_CACHE_MS = 2 * 60 * 1_000
const CLASSIFIER_CACHE_SIZE = 64

export function read(request: SessionV1.WithParts | undefined): Decision | undefined {
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
  if (stored.memory !== undefined && typeof stored.memory !== "string") return
  if (stored.memoryCategory !== undefined && !memoryCategories.has(stored.memoryCategory as MemoryCategory)) return
  if (stored.memoryTopic !== undefined && typeof stored.memoryTopic !== "string") return
  if (stored.memoryConfidence !== undefined && typeof stored.memoryConfidence !== "number") return
  if (stored.memoryScope !== undefined && !memoryScopes.has(stored.memoryScope as MemoryScope)) return
  if (stored.memoryCorrection !== undefined && typeof stored.memoryCorrection !== "boolean") return
  if (stored.researchDepth !== undefined && stored.researchDepth !== "quick" && stored.researchDepth !== "deep") return
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

export function memoryContext(
  messages: ReadonlyArray<SessionV1.WithParts>,
  requestID: SessionV1.MessageID | undefined,
) {
  if (!requestID) return
  const request = messages.find((message) => message.info.id === requestID)
  if (!request || request.info.role !== "user" || request.parts.some((part) => part.type === "compaction")) return
  const latest = request.parts
    .flatMap((part) =>
      part.type === "text" && part.synthetic !== true && part.text.trim().length > 0 ? [part.text.trim()] : [],
    )
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
  if (!latest) return
  const assistant = messages
    .filter(
      (message) =>
        message.info.role === "assistant" &&
        message.info.id < requestID &&
        message.info.finish !== undefined &&
        message.info.error === undefined &&
        message.info.summary !== true,
    )
    .toSorted((left, right) => left.info.id.localeCompare(right.info.id))
    .at(-1)
  if (!assistant) return `Latest user message:\n${latest.slice(-500)}`
  const question = assistant.parts
    .flatMap((part) =>
      part.type === "text" && part.ignored !== true && part.synthetic !== true && part.text.trim().length > 0
        ? [part.text.trim()]
        : [],
    )
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
  if (!question) return `Latest user message:\n${latest.slice(-500)}`
  return [`Previous assistant message:`, question.slice(-500), "", "Latest user message:", latest.slice(-500)].join(
    "\n",
  )
}

export function classify(input: {
  readonly model: Parameters<typeof generateText>[0]["model"]
  readonly request: string
  readonly memoryContext?: string
  readonly memoryAdmission?: "automatic" | "explicit" | "off"
  readonly signal?: AbortSignal
  readonly providerOptions?: Parameters<typeof generateText>[0]["providerOptions"]
}) {
  const query = input.request.trim().slice(-1_000)
  const admission =
    input.memoryAdmission === "off"
      ? "Memory admission is disabled. Always output NO_MEMORY."
      : input.memoryAdmission === "explicit"
        ? "Memory admission is explicit-only. Output MEMORY only when the latest user message clearly asks to remember the information."
        : "Memory admission is automatic. Apply the durable-information rules without requiring a remember command."
  const key = Hash.fast(
    JSON.stringify([
      typeof input.model === "string" ? input.model : input.model.provider,
      typeof input.model === "string" ? input.model : input.model.modelId,
      query,
      input.memoryContext ?? "",
      admission,
      input.providerOptions ?? {},
    ]),
  )
  const cached = classifierCache.get(key)
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.decision)
  return generateText({
    model: input.model,
    system: `${CLASSIFIER_PROMPT}\n\n${admission}`,
    prompt: input.memoryContext ? `${query}\n\nDurable-memory dialogue context:\n${input.memoryContext}` : query,
    temperature: 0,
    maxOutputTokens: 140,
    abortSignal: input.signal,
    providerOptions: input.providerOptions,
  }).then((result): Decision => {
    const decision = parse(result.text, query)
    if (decision.source !== "model") return decision
    classifierCache.set(key, { expires: Date.now() + CLASSIFIER_CACHE_MS, decision })
    if (classifierCache.size > CLASSIFIER_CACHE_SIZE) classifierCache.delete(classifierCache.keys().next().value!)
    return decision
  })
}

export function parse(value: string, query: string): Decision {
  const lines = value
    .trim()
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replaceAll("**", "")
        .replaceAll("`", "")
        .replace(/^[-*#\s]+|[-*#\s]+$/g, ""),
    )
    .filter(Boolean)
  const labelIndex = lines.findIndex((line) => /^(EXTERNAL|REPOSITORY|LOCAL)$/i.test(line))
  if (labelIndex < 0) return conservative(query)
  const label = lines[labelIndex]!.toUpperCase()
  const scope: Scope = label === "EXTERNAL" ? "external" : label === "REPOSITORY" ? "repository" : "local"
  const depth = field(lines.slice(labelIndex + 1), "RESEARCH_DEPTH")?.toLocaleLowerCase()
  const memoryIndex = lines.findIndex((line, index) => index > labelIndex && /^(MEMORY|NO_MEMORY)$/i.test(line))
  const memoryLines = memoryIndex >= 0 ? lines.slice(memoryIndex + 1) : []
  const categoryValue = field(memoryLines, "CATEGORY")?.toLocaleLowerCase()
  const category = memoryCategories.has(categoryValue as MemoryCategory) ? (categoryValue as MemoryCategory) : undefined
  const topic = field(memoryLines, "TOPIC")?.replace(/\s+/g, " ").trim().slice(0, 120)
  const scopeValue = field(memoryLines, "SCOPE")?.toLocaleLowerCase()
  const memoryScope = memoryScopes.has(scopeValue as MemoryScope) ? (scopeValue as MemoryScope) : undefined
  const correctionValue = field(memoryLines, "CORRECTION")?.toLocaleLowerCase()
  const correction = correctionValue === "yes" ? true : correctionValue === "no" ? false : undefined
  const confidenceValue = Number(field(memoryLines, "CONFIDENCE"))
  const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : undefined
  const text = field(memoryLines, "TEXT")?.replace(/\s+/g, " ").trim().slice(0, 500)
  const memory =
    lines[memoryIndex]?.toUpperCase() === "MEMORY" &&
    category &&
    memoryScope &&
    correction !== undefined &&
    topic &&
    confidence !== undefined &&
    confidence >= 0.8 &&
    text
      ? text
      : undefined
  const reason = lines
    .slice(labelIndex + 1, memoryIndex < 0 ? labelIndex + 2 : memoryIndex)
    .filter((line) => !line.toUpperCase().startsWith("RESEARCH_DEPTH:"))
    .join(" ")
    .slice(0, 300)
  return {
    scope,
    required: scope === "external",
    reason:
      reason ||
      (scope === "external"
        ? "External evidence required"
        : scope === "repository"
          ? "Workspace evidence required"
          : "Request is locally answerable"),
    query: query.trim().slice(0, 1_000),
    researchDepth: depth === "deep" ? "deep" : ResearchBrowser.inferDepth(query),
    source: "model",
    ...(memory
      ? {
          memory,
          memoryCategory: category,
          memoryTopic: topic,
          memoryConfidence: confidence,
          memoryScope,
          memoryCorrection: correction,
        }
      : {}),
  }
}

function field(lines: ReadonlyArray<string>, name: string) {
  return lines
    .find((line) => line.toUpperCase().startsWith(`${name}:`))
    ?.slice(name.length + 1)
    .trim()
}

export function conservative(request: string): Decision {
  return {
    scope: "local",
    required: false,
    reason: "Freshness classification was unavailable; no external tools were forced",
    query: request.trim().slice(0, 1_000),
    researchDepth: ResearchBrowser.inferDepth(request),
    source: "conservative",
  }
}

export function repository(request: string): Decision {
  return {
    scope: "repository",
    required: false,
    reason: "The request includes an explicit workspace file",
    query: request.trim().slice(0, 1_000),
    researchDepth: "quick",
    source: "conservative",
  }
}

export function heuristic(request: string): Decision | undefined {
  const query = request.trim().slice(0, 1_000)
  if (!query) return
  // URLs are structural, language-independent evidence. Natural-language intent is
  // deliberately left to the utility classifier or the primary model with web tools.
  if (!/https?:\/\/[^\s]+/iu.test(query)) return
  return {
    scope: "external",
    required: true,
    reason: "The request includes an external source URL",
    query,
    researchDepth: ResearchBrowser.inferDepth(query),
    source: "conservative",
  }
}

export function evidence(messages: readonly SessionV1.WithParts[], requestID: string | undefined): EvidenceState {
  const index = messages.findIndex((message) => message.info.id === requestID)
  if (index < 0) return "missing"
  const stored = messages[index]?.parts.find(
    (part): part is SessionV1.TextPart => part.type === "text" && part.metadata?.compaction_continue === true,
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
    requiredTools: [] as string[],
    toolChoice: undefined as "required" | "none" | undefined,
    unavailable: false,
  }
}

export function systemPrompt(decision: Decision | undefined, evidence: EvidenceState, unavailable: boolean) {
  if (!decision?.required) return
  if (unavailable)
    return "External verification was required for this request but is unavailable or failed. Do not retry automatically. Do not provide exact or current factual claims from memory. Explain in the user's language that the facts could not be verified and state what source access is needed."
  if (evidence === "missing")
    return `External evidence is required before answering this request. Call the websearch tool now with type: "${decision.researchDepth === "deep" ? "deep" : "fast"}", including in planning mode. Search for the user's actual subject, prefer current primary or authoritative sources, and never invent a source or URL. Do not inspect the workspace, print or propose shell commands, simulate a search in prose, or answer from model memory before the tool completes.`
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
