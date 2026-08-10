export * as ModelCapabilityRouter from "./model-capability-router"

import { Schema } from "effect"

// `fallback` remains decodable for checkpoints created by older OpenCode Customs
// builds. New routing plans never emit it: interactive turns fail closed instead.
export const Role = Schema.Literals(["embedding", "utility", "coding", "vision", "fallback"])
export type Role = typeof Role.Type

export const Complexity = Schema.Literals(["low", "medium", "high"])
export type Complexity = typeof Complexity.Type

export const Pressure = Schema.Literals(["healthy", "pressured", "critical"])
export type Pressure = typeof Pressure.Type

export const Candidate = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  instanceID: Schema.optionalKey(Schema.String),
  name: Schema.String,
  loaded: Schema.Boolean,
  type: Schema.Literals(["llm", "embedding", "unknown"]),
  context: Schema.optionalKey(Schema.Number),
  sizeBytes: Schema.optionalKey(Schema.Number),
  capabilities: Schema.Struct({
    tools: Schema.Boolean,
    vision: Schema.Boolean,
    reasoning: Schema.Boolean,
    embeddings: Schema.Boolean,
  }),
}).annotate({ identifier: "ModelCapabilityRouterCandidate" })
export type Candidate = typeof Candidate.Type

export const Selection = Schema.Struct({
  role: Role,
  providerID: Schema.String,
  modelID: Schema.String,
  instanceID: Schema.optionalKey(Schema.String),
  name: Schema.String,
  score: Schema.Number,
  context: Schema.optionalKey(Schema.Number),
  sizeBytes: Schema.optionalKey(Schema.Number),
  capabilities: Candidate.fields.capabilities,
  reason: Schema.Array(Schema.String),
}).annotate({ identifier: "ModelCapabilityRouterSelection" })
export type Selection = typeof Selection.Type

export const Activation = Schema.Struct({
  status: Schema.Literals(["ready", "switched", "failed", "rolled_back", "degraded"]),
  checkedAt: Schema.Number,
  role: Role,
  requestedModelID: Schema.String,
  activeModelID: Schema.String,
  activeInstanceID: Schema.optionalKey(Schema.String),
  previousModelID: Schema.optionalKey(Schema.String),
  previousInstanceID: Schema.optionalKey(Schema.String),
  attempts: Schema.Number,
  failover: Schema.Boolean,
  rollback: Schema.Boolean,
  reason: Schema.Array(Schema.String),
}).annotate({ identifier: "ModelCapabilityRouterActivation" })
export type Activation = typeof Activation.Type

export const VisionArtifact = Schema.Struct({
  fileURL: Schema.String,
  filename: Schema.String,
  mime: Schema.String,
  originalWidth: Schema.Number,
  originalHeight: Schema.Number,
  originalBytes: Schema.Number,
  preparedWidth: Schema.Number,
  preparedHeight: Schema.Number,
  preparedBytes: Schema.Number,
  compressed: Schema.Boolean,
  estimatedTokens: Schema.Number,
  reason: Schema.Array(Schema.String),
}).annotate({ identifier: "ModelCapabilityRouterVisionArtifact" })
export type VisionArtifact = typeof VisionArtifact.Type

export const Vision = Schema.Struct({
  status: Schema.Literals(["prepared", "completed", "failed"]),
  checkedAt: Schema.Number,
  modelID: Schema.optionalKey(Schema.String),
  instanceID: Schema.optionalKey(Schema.String),
  imageCount: Schema.Number,
  originalBytes: Schema.Number,
  preparedBytes: Schema.Number,
  estimatedTokens: Schema.Number,
  requestTokens: Schema.optionalKey(Schema.Number),
  assistantMessageID: Schema.optionalKey(Schema.String),
  failover: Schema.Boolean,
  reason: Schema.Array(Schema.String),
  artifacts: Schema.Array(VisionArtifact),
}).annotate({ identifier: "ModelCapabilityRouterVision" })
export type Vision = typeof Vision.Type

export const Plan = Schema.Struct({
  status: Schema.Literals(["ready", "degraded", "unavailable"]),
  checkedAt: Schema.Number,
  providerID: Schema.String,
  complexity: Complexity,
  pressure: Pressure,
  candidateCount: Schema.Number,
  selections: Schema.Array(Selection),
  reason: Schema.Array(Schema.String),
  activation: Schema.optionalKey(Activation),
  vision: Schema.optionalKey(Vision),
}).annotate({ identifier: "ModelCapabilityRouterPlan" })
export type Plan = typeof Plan.Type

export type RequestShape = {
  readonly textCharacters: number
  readonly files: number
  readonly images: number
  readonly tools: number
}

export function complexity(input: RequestShape): Complexity {
  if (input.images > 0 || input.files > 4 || input.tools > 8 || input.textCharacters > 4_000) return "high"
  if (input.files > 0 || input.tools > 2 || input.textCharacters > 800) return "medium"
  return "low"
}

export function plan(input: {
  readonly providerID: string
  readonly candidates: readonly Candidate[]
  readonly pressure: Pressure
  readonly complexity: Complexity
  readonly preferredModelID?: string
  readonly needsVision?: boolean
  readonly needsTools?: boolean
  readonly allowUnloaded?: boolean
  readonly disabledModelIDs?: readonly string[]
}): Plan {
  const eligible = input.candidates.filter(
    (candidate) => candidate.loaded || (input.allowUnloaded === true && input.pressure !== "critical"),
  )
  const disabled = new Set(input.disabledModelIDs ?? [])
  const automatic = eligible.filter((candidate) => !disabled.has(candidate.modelID))
  const llms = automatic.filter((candidate) => candidate.type !== "embedding" && !candidate.capabilities.embeddings)
  const coding = eligible.filter((candidate) => candidate.type !== "embedding" && !candidate.capabilities.embeddings)
  const selections = [
    select("embedding", automatic, input),
    select("utility", llms, input),
    ...(input.preferredModelID ? [select("coding", coding, input)] : []),
    ...(input.needsVision ? [select("vision", llms, input)] : []),
  ].filter((selection) => selection !== undefined)

  const required = input.needsVision ? ["coding", "vision"] : ["coding"]
  const missing = required.filter((role) => !selections.some((selection) => selection.role === role))
  const expected = input.needsVision ? 4 : 3
  const status = missing.length > 0 ? "unavailable" : selections.length < expected ? "degraded" : "ready"
  return {
    status,
    checkedAt: Date.now(),
    providerID: input.providerID,
    complexity: input.complexity,
    pressure: input.pressure,
    candidateCount: automatic.length,
    selections,
    reason: [
      eligible.length > 0
        ? input.allowUnloaded === true
          ? "candidates.available"
          : "candidates.loaded"
        : "candidates.none",
      ...(missing.length > 0 ? ["roles.missing"] : []),
      ...(automatic.length < eligible.length ? ["candidates.blocked"] : []),
      input.pressure === "healthy" ? "resources.healthy" : "resources.pressure",
    ],
  }
}

function select(
  role: Role,
  candidates: readonly Candidate[],
  input: {
    readonly pressure: Pressure
    readonly complexity: Complexity
    readonly preferredModelID?: string
    readonly needsVision?: boolean
    readonly needsTools?: boolean
  },
): Selection | undefined {
  const suitable = candidates.filter((candidate) =>
    supports(role, candidate, input.needsTools === true, input.needsVision === true),
  )
  const largest = Math.max(...suitable.map((candidate) => candidate.sizeBytes ?? 0), 1)
  const ranked = suitable
    .map((candidate) => score(role, candidate, input, largest))
    .toSorted(
      (left, right) => right.score - left.score || left.candidate.modelID.localeCompare(right.candidate.modelID),
    )
  // The selected coding model is an explicit user choice. Context size and memory
  // efficiency rank auxiliary roles, but must not silently replace that choice.
  const selected =
    role === "coding" && input.preferredModelID
      ? ranked.find((candidate) => candidate.candidate.modelID === input.preferredModelID)
      : ranked[0]
  if (!selected) return
  return {
    role,
    providerID: selected.candidate.providerID,
    modelID: selected.candidate.modelID,
    ...(selected.candidate.instanceID ? { instanceID: selected.candidate.instanceID } : {}),
    name: selected.candidate.name,
    score: Math.round(selected.score * 10) / 10,
    ...(selected.candidate.context ? { context: selected.candidate.context } : {}),
    ...(selected.candidate.sizeBytes ? { sizeBytes: selected.candidate.sizeBytes } : {}),
    capabilities: selected.candidate.capabilities,
    reason: selected.reason,
  } satisfies Selection
}

function supports(role: Role, candidate: Candidate, needsTools: boolean, needsVision: boolean) {
  if (role === "embedding") return candidate.type === "embedding" || candidate.capabilities.embeddings
  if (role === "vision") return candidate.capabilities.vision && (!needsTools || candidate.capabilities.tools)
  if (role === "fallback" && needsVision)
    return candidate.capabilities.vision && (!needsTools || candidate.capabilities.tools)
  if ((role === "coding" || role === "fallback") && needsTools) return candidate.capabilities.tools
  return candidate.type !== "embedding" && !candidate.capabilities.embeddings
}

function score(
  role: Role,
  candidate: Candidate,
  input: {
    readonly pressure: Pressure
    readonly complexity: Complexity
    readonly preferredModelID?: string
    readonly needsVision?: boolean
    readonly needsTools?: boolean
  },
  largest: number,
) {
  const context = Math.min(24, Math.log2(Math.max(1, candidate.context ?? 1)) * 1.5)
  const memoryRatio = candidate.sizeBytes ? candidate.sizeBytes / largest : 0.5
  const pressurePenalty =
    input.pressure === "critical" ? memoryRatio * 35 : input.pressure === "pressured" ? memoryRatio * 15 : 0
  const reason: string[] = []
  const roleScore = (() => {
    if (role === "embedding") {
      reason.push("role.embedding")
      return 80 + context
    }
    if (role === "vision") {
      reason.push("role.vision")
      return 70 + context + Number(candidate.capabilities.tools) * 10
    }
    if (role === "utility") {
      reason.push("role.utility")
      return 35 + (1 - memoryRatio) * 35 + Math.min(context, 12)
    }
    if (role === "fallback") {
      reason.push("role.fallback")
      return 30 + context + Number(candidate.capabilities.tools) * 20
    }
    reason.push("role.coding")
    return (
      35 +
      context +
      Number(candidate.capabilities.tools) * 25 +
      Number(candidate.capabilities.reasoning) * 12 +
      Number(input.needsVision === true && candidate.capabilities.vision) * 8 +
      Number(input.complexity === "high") * context * 0.5 +
      Number(candidate.modelID === input.preferredModelID) * 12
    )
  })()
  reason.push(candidate.loaded ? "candidate.loaded" : "candidate.unloaded")
  if (candidate.context) reason.push("capability.context")
  if (candidate.capabilities.tools) reason.push("capability.tools")
  if (candidate.capabilities.reasoning) reason.push("capability.reasoning")
  if (candidate.capabilities.vision) reason.push("capability.vision")
  if (candidate.capabilities.embeddings) reason.push("capability.embeddings")
  if (candidate.modelID === input.preferredModelID) reason.push("preference.explicit")
  if (pressurePenalty > 0) reason.push("resources.pressure")
  return { candidate, score: roleScore + Number(candidate.loaded) * 12 - pressurePenalty, reason }
}
