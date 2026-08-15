import { Token } from "@/util/token"
import { Hash } from "@opencode-ai/core/util/hash"
import type { ModelMessage, Tool } from "ai"

export type Source =
  | "stable_system_prefix"
  | "dynamic_system_tail"
  | "tool_schemas"
  | "current_user_prompt"
  | "recent_dialogue"
  | "checkpoint_summary"
  | "memory"
  | "repository_evidence"
  | "tool_results"

export type SystemFragment = {
  readonly source: Exclude<Source, "tool_schemas" | "current_user_prompt" | "recent_dialogue" | "tool_results">
  readonly provenance: string
  readonly content: string
}

export type PreviewFragment = {
  readonly source: Source
  readonly provenance: readonly string[]
  readonly tokens: number
  readonly budget: number
  readonly included: boolean
  readonly truncated: boolean
  readonly deduplicated: number
  readonly preview: string
}

export type Preview = {
  readonly version: 1
  readonly estimator: "canonical_serialized_conservative"
  readonly tokens: number
  readonly limit: number
  readonly usage: number
  readonly compressed: boolean
  readonly overflow: boolean
  readonly cache: {
    readonly prefixHash: string
    readonly prefixTokens: number
    readonly dynamicTokens: number
  }
  readonly fragments: readonly PreviewFragment[]
  readonly tools: readonly {
    readonly name: string
    readonly tokens: number
    readonly required: boolean
    readonly included: boolean
  }[]
}

export type Input = {
  readonly fixedSystem: readonly string[]
  readonly system: readonly SystemFragment[]
  readonly messages: readonly ModelMessage[]
  readonly tools: Readonly<Record<string, Tool>>
  readonly requiredTools?: readonly string[]
  readonly currentUserText?: string
  readonly checkpointSummary?: string
  readonly limit: number
}

export type Output = {
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly tokens: number
  readonly limit: number
  readonly usage: number
  readonly compressed: boolean
  readonly overflow: boolean
  readonly preview: Preview
}

const HEADROOM = 128
const ESTIMATE_MULTIPLIER = 1.35
const PREVIEW_MAX_CHARS = 2_000
const SOURCE_RATIOS: Record<Source, number> = {
  stable_system_prefix: 0.24,
  dynamic_system_tail: 0.1,
  tool_schemas: 0.2,
  current_user_prompt: 0.16,
  recent_dialogue: 0.16,
  checkpoint_summary: 0.08,
  memory: 0.07,
  repository_evidence: 0.12,
  tool_results: 0.18,
}

export function compile(input: Input): Output {
  const budget = Math.max(0, input.limit - HEADROOM)
  const required = new Set(input.requiredTools ?? [])
  const split = splitMessages(input.messages, input.currentUserText, input.checkpointSummary)
  const fixed = unique(
    input.fixedSystem.map((content) => ({
      source: "stable_system_prefix" as const,
      provenance: "provider_or_agent_system",
      content,
    })),
  )
  const rawSystem = input.system.map((item) =>
    item.source === "checkpoint_summary" ? { ...item, content: stripStalePlan(item.content) } : item,
  )
  const fixedKeys = new Set(fixed.items.map((item) => normalized(item.content)))
  const filteredSystem = rawSystem.filter((item) => !fixedKeys.has(normalized(item.content)))
  const system = unique(filteredSystem)
  system.deduplicated += rawSystem.length - filteredSystem.length
  const groups = {
    stable_system_prefix: [...fixed.items, ...system.items.filter((item) => item.source === "stable_system_prefix")],
    dynamic_system_tail: system.items.filter((item) => item.source === "dynamic_system_tail"),
    checkpoint_summary: system.items.filter((item) => item.source === "checkpoint_summary"),
    memory: system.items.filter((item) => item.source === "memory"),
    repository_evidence: system.items.filter((item) => item.source === "repository_evidence"),
  }
  const stable = fitText(groups.stable_system_prefix, sourceBudget(budget, "stable_system_prefix"), false)
  const dynamic = fitText(groups.dynamic_system_tail, sourceBudget(budget, "dynamic_system_tail"), true)
  const checkpoint = fitText(groups.checkpoint_summary, sourceBudget(budget, "checkpoint_summary"), true)
  const memory = fitText(groups.memory, sourceBudget(budget, "memory"), true)
  const repository = fitText(groups.repository_evidence, sourceBudget(budget, "repository_evidence"), true)
  const current = { items: [...split.current], omitted: 0 }
  const recent = fitMessages(split.recent, sourceBudget(budget, "recent_dialogue"))
  const results = { items: [...split.toolResults], omitted: 0 }
  const selectedSystem = () =>
    [...stable.items, ...checkpoint.items, ...memory.items, ...repository.items, ...dynamic.items].map(
      (item) => item.content,
    )
  const messages = () => [...recent.items, ...current.items, ...results.items]
  // Tool schemas receive the real space left after the selected instructions and
  // dialogue, while retaining the ratio as a minimum. This keeps the full coding
  // toolset available in large contexts without letting schemas starve the prompt.
  const selectedTools = fitTools(
    input.tools,
    required,
    Math.max(
      sourceBudget(budget, "tool_schemas"),
      budget - estimate({ system: selectedSystem(), messages: messages(), tools: {} }),
    ),
  )
  const size = () => estimate({ system: selectedSystem(), messages: messages(), tools: selectedTools.tools })
  while (input.limit > 0 && size() >= input.limit) {
    if (recent.items.length > 0) {
      recent.items.shift()
      recent.omitted++
      continue
    }
    if (repository.items.length > 0) {
      repository.items.pop()
      repository.omitted++
      continue
    }
    if (memory.items.length > 0) {
      memory.items.pop()
      memory.omitted++
      continue
    }
    if (checkpoint.items.length > 0) {
      checkpoint.items.pop()
      checkpoint.omitted++
      continue
    }
    const optionalTool = Object.keys(selectedTools.tools)
      .filter((name) => !required.has(name))
      .toSorted(
        (left, right) =>
          estimateValue({ [right]: selectedTools.tools[right] }) - estimateValue({ [left]: selectedTools.tools[left] }),
      )[0]
    if (optionalTool) {
      delete selectedTools.tools[optionalTool]
      selectedTools.omitted++
      continue
    }
    if (stable.items.length > fixed.items.length) {
      stable.items.pop()
      stable.omitted++
      continue
    }
    if (dynamic.items.length > 0) {
      dynamic.items.pop()
      dynamic.omitted++
      continue
    }
    break
  }
  const tokens = size()
  const prefixSystem = stable.items.map((item) => item.content)
  const prefixTokens = estimate({ system: prefixSystem, messages: [], tools: selectedTools.tools })
  const cache = {
    prefixHash: Hash.fast(canonical({ system: prefixSystem, tools: selectedTools.tools })),
    prefixTokens,
    dynamicTokens: Math.max(0, tokens - prefixTokens),
  }
  const compressed =
    fixed.deduplicated +
      system.deduplicated +
      selectedTools.omitted +
      stable.omitted +
      dynamic.omitted +
      checkpoint.omitted +
      memory.omitted +
      repository.omitted +
      recent.omitted +
      current.omitted +
      results.omitted >
      0 ||
    [...stable.items, ...checkpoint.items, ...memory.items, ...repository.items, ...dynamic.items].some((item) =>
      item.content.includes("[Context fragment truncated]"),
    )
  const overflow = input.limit > 0 && tokens >= input.limit
  const preview = makePreview({
    input,
    groups,
    split,
    selected: { stable, dynamic, checkpoint, memory, repository },
    selectedTools,
    current,
    recent,
    results,
    tokens,
    compressed,
    overflow,
    deduplicated: fixed.deduplicated + system.deduplicated,
    cache,
  })
  return {
    system: selectedSystem(),
    messages: messages(),
    tools: selectedTools.tools,
    tokens,
    limit: input.limit,
    usage: input.limit ? Math.min(100, Math.round((tokens / input.limit) * 100)) : 0,
    compressed,
    overflow,
    preview,
  }
}

export function estimate(input: { system: readonly string[]; messages: readonly ModelMessage[]; tools: object }) {
  return Math.ceil(Token.estimate(canonical(input)) * ESTIMATE_MULTIPLIER)
}

export function sanitizePreview(input: string) {
  return input
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/g, "[BINARY_DATA_REDACTED]")
    .replace(/\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{16,}\b/gi, "[SECRET_REDACTED]")
    .replace(
      /((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*)[^\s,}"']+/gi,
      "$1[SECRET_REDACTED]",
    )
    .slice(0, PREVIEW_MAX_CHARS)
}

export function stripStalePlan(input: string) {
  const protocol = new Set([
    "objective",
    "important details",
    "work state",
    "completed",
    "active",
    "blocked",
    "next move",
    "relevant files",
  ])
  const stale = new Set(["objective", "active", "blocked", "next move"])
  const result: string[] = []
  let dropping = false
  for (const line of input.split("\n")) {
    const heading = line
      .replace(/^#+\s*/, "")
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .replace(/:$/, "")
      .trim()
      .toLowerCase()
    if (protocol.has(heading)) {
      dropping = stale.has(heading)
      if (!dropping) result.push(line)
      continue
    }
    if (!dropping) result.push(line)
  }
  return result.join("\n").trim()
}

function splitMessages(messages: readonly ModelMessage[], currentUserText?: string, checkpointSummary?: string) {
  const currentIndex = messages.findLastIndex((message) => {
    if (message.role !== "user") return false
    if (!currentUserText?.trim()) return true
    return text(message).includes(currentUserText.trim())
  })
  const fallback = currentIndex < 0 ? messages.findLastIndex((message) => message.role === "user") : currentIndex
  const recent = messages
    .slice(0, Math.max(0, fallback))
    .filter((message) => !checkpointSummary || !text(message).includes(checkpointSummary.trim().slice(0, 200)))
    .flatMap(stripHistoricalTools)
  return {
    recent,
    current: fallback < 0 ? [] : [messages[fallback]!],
    toolResults: fallback < 0 ? [] : messages.slice(fallback + 1),
  }
}

function stripHistoricalTools(message: ModelMessage): ModelMessage[] {
  if (message.role === "tool") return []
  if (message.role !== "assistant" || typeof message.content === "string") return [message]
  const content = message.content.filter((part) => part.type !== "tool-call")
  if (content.length === 0) return []
  return [{ ...message, content }]
}

function unique(input: readonly SystemFragment[]) {
  const seen = new Set<string>()
  const items = input.filter((item) => {
    const key = normalized(item.content)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { items, deduplicated: input.length - items.length }
}

function normalized(input: string) {
  return input.trim().replace(/\s+/g, " ")
}

function fitText(input: readonly SystemFragment[], budget: number, truncate: boolean) {
  const items: SystemFragment[] = []
  let used = 0
  let omitted = 0
  for (const item of input) {
    const tokens = estimateValue(item.content)
    if (used + tokens <= budget) {
      items.push(item)
      used += tokens
      continue
    }
    const remaining = Math.max(0, budget - used)
    if (!truncate || remaining < 32) {
      omitted++
      continue
    }
    items.push({ ...item, content: truncateText(item.content, remaining) })
    used = budget
  }
  return { items, omitted }
}

function fitMessages(input: readonly ModelMessage[], budget: number) {
  const items: ModelMessage[] = []
  let used = 0
  const candidates = input.toReversed()
  for (const item of candidates) {
    const tokens = estimateValue(item)
    if (used + tokens > budget) continue
    items.push(item)
    used += tokens
  }
  items.reverse()
  return { items, omitted: input.length - items.length }
}

function fitTools(input: Readonly<Record<string, Tool>>, required: ReadonlySet<string>, budget: number) {
  const compact = Object.fromEntries(
    Object.entries(input).map(([name, item]) => [
      name,
      {
        ...item,
        description:
          typeof item.description === "string"
            ? item.description.trim().split("\n").find(Boolean)?.slice(0, 160)
            : item.description,
        inputSchema: compactSchema(item.inputSchema),
      } as Tool,
    ]),
  )
  const ordered = Object.keys(input).toSorted((left, right) => {
    const requiredOrder = Number(required.has(right)) - Number(required.has(left))
    if (requiredOrder) return requiredOrder
    const sizeOrder = estimateValue({ [left]: compact[left] }) - estimateValue({ [right]: compact[right] })
    if (sizeOrder) return sizeOrder
    return left.localeCompare(right)
  })
  const selectedTools: Record<string, Tool> = {}
  let used = 0
  for (const name of ordered) {
    const selected = compact[name]!
    const tokens = estimateValue({ [name]: selected })
    if (!required.has(name) && used + tokens > budget) continue
    selectedTools[name] = selected
    used += tokens
  }
  for (const name of Object.keys(selectedTools).toSorted((left, right) => {
    const requiredOrder = Number(required.has(right)) - Number(required.has(left))
    if (requiredOrder) return requiredOrder
    return (
      estimateValue({ [left]: input[left] }) -
      estimateValue({ [left]: compact[left] }) -
      (estimateValue({ [right]: input[right] }) - estimateValue({ [right]: compact[right] }))
    )
  })) {
    const compactTokens = estimateValue({ [name]: compact[name] })
    const fullTokens = estimateValue({ [name]: input[name] })
    if (used + fullTokens - compactTokens > budget) continue
    selectedTools[name] = input[name]!
    used += fullTokens - compactTokens
  }
  const tools = Object.fromEntries(
    Object.entries(selectedTools).toSorted(([left], [right]) => left.localeCompare(right)),
  )
  const names = Object.keys(input).toSorted((left, right) => left.localeCompare(right))
  return {
    tools,
    omitted: ordered.length - Object.keys(tools).length,
    details: names.map((name) => ({
      name,
      tokens: estimateValue({ [name]: tools[name] ?? compact[name] }),
      required: required.has(name),
      included: tools[name] !== undefined,
    })),
  }
}

function compactSchema(input: Tool["inputSchema"]) {
  if (!input || typeof input !== "object" || !("jsonSchema" in input)) return input
  return {
    ...input,
    jsonSchema: compactDescription(input.jsonSchema),
  }
}

function compactDescription(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(compactDescription)
  if (!input || typeof input !== "object") return input
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      key === "description" && typeof value === "string" ? value.slice(0, 160) : compactDescription(value),
    ]),
  )
}

function makePreview(input: {
  input: Input
  groups: Record<
    "stable_system_prefix" | "dynamic_system_tail" | "checkpoint_summary" | "memory" | "repository_evidence",
    readonly SystemFragment[]
  >
  split: { recent: readonly ModelMessage[]; current: readonly ModelMessage[]; toolResults: readonly ModelMessage[] }
  selected: {
    stable: ReturnType<typeof fitText>
    dynamic: ReturnType<typeof fitText>
    checkpoint: ReturnType<typeof fitText>
    memory: ReturnType<typeof fitText>
    repository: ReturnType<typeof fitText>
  }
  selectedTools: ReturnType<typeof fitTools>
  current: ReturnType<typeof fitMessages>
  recent: ReturnType<typeof fitMessages>
  results: ReturnType<typeof fitMessages>
  tokens: number
  compressed: boolean
  overflow: boolean
  deduplicated: number
  cache: Preview["cache"]
}): Preview {
  const fragment = (
    source: Source,
    value: unknown,
    selected: unknown,
    provenance: readonly string[],
    omitted: number,
  ): PreviewFragment => ({
    source,
    provenance,
    tokens: estimateValue(selected),
    budget: sourceBudget(Math.max(0, input.input.limit - HEADROOM), source),
    included: estimateValue(selected) > 0,
    truncated: omitted > 0 || estimateValue(selected) < estimateValue(value),
    deduplicated: source === "stable_system_prefix" ? input.deduplicated : 0,
    preview: sanitizePreview(render(selected)),
  })
  return {
    version: 1,
    estimator: "canonical_serialized_conservative",
    tokens: input.tokens,
    limit: input.input.limit,
    usage: input.input.limit ? Math.min(100, Math.round((input.tokens / input.input.limit) * 100)) : 0,
    compressed: input.compressed,
    overflow: input.overflow,
    cache: input.cache,
    fragments: [
      fragment(
        "stable_system_prefix",
        input.groups.stable_system_prefix,
        input.selected.stable.items,
        input.groups.stable_system_prefix.map((item) => item.provenance),
        input.selected.stable.omitted,
      ),
      fragment(
        "tool_schemas",
        input.input.tools,
        input.selectedTools.tools,
        ["tool_registry"],
        input.selectedTools.omitted,
      ),
      fragment(
        "current_user_prompt",
        input.split.current,
        input.current.items,
        ["active_user_message"],
        input.current.omitted,
      ),
      fragment("recent_dialogue", input.split.recent, input.recent.items, ["session_history"], input.recent.omitted),
      fragment(
        "checkpoint_summary",
        input.groups.checkpoint_summary,
        input.selected.checkpoint.items,
        input.groups.checkpoint_summary.map((item) => item.provenance),
        input.selected.checkpoint.omitted,
      ),
      fragment(
        "memory",
        input.groups.memory,
        input.selected.memory.items,
        input.groups.memory.map((item) => item.provenance),
        input.selected.memory.omitted,
      ),
      fragment(
        "repository_evidence",
        input.groups.repository_evidence,
        input.selected.repository.items,
        input.groups.repository_evidence.map((item) => item.provenance),
        input.selected.repository.omitted,
      ),
      fragment(
        "tool_results",
        input.split.toolResults,
        input.results.items,
        ["current_provider_turn"],
        input.results.omitted,
      ),
      fragment(
        "dynamic_system_tail",
        input.groups.dynamic_system_tail,
        input.selected.dynamic.items,
        input.groups.dynamic_system_tail.map((item) => item.provenance),
        input.selected.dynamic.omitted,
      ),
    ],
    tools: input.selectedTools.details.map((item) => ({
      ...item,
      included: input.selectedTools.tools[item.name] !== undefined,
    })),
  }
}

function sourceBudget(total: number, source: Source) {
  return Math.max(64, Math.floor(total * SOURCE_RATIOS[source]))
}

function estimateValue(input: unknown) {
  return Math.ceil(Token.estimate(canonical(input)) * ESTIMATE_MULTIPLIER)
}

function truncateText(input: string, tokens: number) {
  const chars = Math.max(0, Math.floor((tokens / ESTIMATE_MULTIPLIER) * 4) - 40)
  return `${input.slice(0, chars).trimEnd()}\n[Context fragment truncated]`
}

function text(input: ModelMessage) {
  if (typeof input.content === "string") return input.content
  return input.content
    .flatMap((part) => {
      if ("text" in part && typeof part.text === "string") return [part.text]
      return []
    })
    .join("\n")
}

function render(input: unknown) {
  if (Array.isArray(input) && input.every((item) => typeof item === "string")) return input.join("\n\n")
  return canonical(input)
}

function canonical(input: unknown): string {
  if (input === null || typeof input === "number" || typeof input === "boolean") return JSON.stringify(input)
  if (typeof input === "string") return JSON.stringify(input)
  if (typeof input === "function" || input === undefined) return ""
  if (Array.isArray(input)) return `[${input.map(canonical).join(",")}]`
  if (typeof input !== "object") return JSON.stringify(String(input))
  return `{${Object.entries(input)
    .filter(([, value]) => value !== undefined && typeof value !== "function")
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
    .join(",")}}`
}

export const ContextCompiler = {
  compile,
  estimate,
  sanitizePreview,
  stripStalePlan,
}
