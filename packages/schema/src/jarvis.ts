export * as Jarvis from "./jarvis"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"

export const Mode = Schema.Literals(["chat", "unity"]).annotate({ identifier: "Jarvis.Mode" })
export type Mode = typeof Mode.Type

export const SessionMetadata = Schema.Struct({
  profileID: optional(Schema.String),
  profileRevision: optional(NonNegativeInt),
  mode: optional(Mode),
  inbox: optional(Schema.Boolean),
}).annotate({ identifier: "Jarvis.SessionMetadata" })
export interface SessionMetadata extends Schema.Schema.Type<typeof SessionMetadata> {}

export const ModelRef = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
}).annotate({ identifier: "Jarvis.ModelRef" })
export interface ModelRef extends Schema.Schema.Type<typeof ModelRef> {}

export const ModelRoles = Schema.Struct({
  dialogue: optional(ModelRef),
  planner: optional(ModelRef),
  embedding: optional(ModelRef),
}).annotate({ identifier: "Jarvis.ModelRoles" })
export interface ModelRoles extends Schema.Schema.Type<typeof ModelRoles> {}

export const ReactorProfile = Schema.Literals(["fast", "balanced", "quality"]).annotate({
  identifier: "Jarvis.ReactorProfile",
})
export type ReactorProfile = typeof ReactorProfile.Type

export const ReasoningMode = Schema.Literals(["off", "on"]).annotate({ identifier: "Jarvis.ReasoningMode" })
export type ReasoningMode = typeof ReasoningMode.Type

export const ReactorPolicy = Schema.Struct({
  profile: ReactorProfile,
  dialogueReasoning: ReasoningMode,
  plannerReasoning: ReasoningMode,
  allowFallback: Schema.Boolean,
}).annotate({ identifier: "Jarvis.ReactorPolicy" })
export interface ReactorPolicy extends Schema.Schema.Type<typeof ReactorPolicy> {}

export const BenchmarkResult = Schema.Struct({
  model: ModelRef,
  endpoint: Schema.String,
  instance: Schema.String,
  testedAt: NonNegativeInt,
  expiresAt: NonNegativeInt,
  ttftMs: NonNegativeInt,
  totalMs: NonNegativeInt,
  tokensPerSecond: Schema.Number,
  outputTokens: NonNegativeInt,
  context: NonNegativeInt,
  memoryBytes: optional(NonNegativeInt),
  ukrainian: Schema.Boolean,
  instructions: Schema.Boolean,
  toolCalling: Schema.Boolean,
  accepted: Schema.Boolean,
  score: Schema.Number,
  error: optional(Schema.String),
}).annotate({ identifier: "Jarvis.BenchmarkResult" })
export interface BenchmarkResult extends Schema.Schema.Type<typeof BenchmarkResult> {}

export const BenchmarkState = Schema.Struct({
  status: Schema.Literals(["idle", "running", "completed", "cancelled", "error"]),
  profile: ReactorProfile,
  startedAt: optional(NonNegativeInt),
  completedAt: optional(NonNegativeInt),
  activeModel: optional(ModelRef),
  results: Schema.Array(BenchmarkResult),
  selected: optional(ModelRef),
  fallback: Schema.Array(ModelRef),
  error: optional(Schema.String),
}).annotate({ identifier: "Jarvis.BenchmarkState" })
export interface BenchmarkState extends Schema.Schema.Type<typeof BenchmarkState> {}

export const BenchmarkRun = Schema.Struct({ profile: ReactorProfile }).annotate({ identifier: "Jarvis.BenchmarkRun" })
export interface BenchmarkRun extends Schema.Schema.Type<typeof BenchmarkRun> {}

export const ProfileSnapshot = Schema.Struct({
  id: Schema.String,
  revision: NonNegativeInt,
  name: Schema.String,
  userName: optional(Schema.String),
  addressAs: optional(Schema.String),
  language: Schema.String,
  archetype: Schema.Literals(["natural", "military", "depressive", "clown", "jarvis", "mentor", "sarcastic"]),
  tone: Schema.String,
  detail: Schema.String,
  humor: Schema.String,
  proactivity: Schema.String,
  instructions: Schema.String,
  catchphrases: Schema.Array(Schema.String),
  primary: Schema.Boolean,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.ProfileSnapshot" })
export interface ProfileSnapshot extends Schema.Schema.Type<typeof ProfileSnapshot> {}

export const InitiativePolicy = Schema.Struct({
  enabled: Schema.Boolean,
  quietStart: Schema.String,
  quietEnd: Schema.String,
  reflectionLimit: NonNegativeInt,
  eventLimit: NonNegativeInt,
  topicCooldownMinutes: NonNegativeInt,
}).annotate({ identifier: "Jarvis.InitiativePolicy" })
export interface InitiativePolicy extends Schema.Schema.Type<typeof InitiativePolicy> {}

export const Config = Schema.Struct({
  primaryProfileID: optional(Schema.String),
  inboxSessionID: optional(Schema.String),
  models: ModelRoles,
  plannerTimeoutMs: NonNegativeInt,
  plannerIdleUnloadMs: NonNegativeInt,
  plannerEscalationMinWords: NonNegativeInt,
  reactor: ReactorPolicy,
  benchmark: BenchmarkState,
  initiative: InitiativePolicy,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.Config" })
export interface Config extends Schema.Schema.Type<typeof Config> {}

export const PlanStep = Schema.Struct({
  id: Schema.String,
  goalID: Schema.String,
  position: NonNegativeInt,
  action: Schema.String,
  arguments: Schema.Record(Schema.String, Schema.Json),
  expectedPostconditions: Schema.Array(Schema.String),
  status: Schema.Literals(["pending", "running", "completed", "failed", "suspended", "cancelled"]),
  attempts: NonNegativeInt,
  lastError: optional(Schema.String),
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.PlanStep" })
export interface PlanStep extends Schema.Schema.Type<typeof PlanStep> {}

export const Plan = Schema.Struct({
  goal: Schema.String,
  steps: Schema.Array(PlanStep),
  stopConditions: Schema.Array(Schema.String),
  riskBudget: Schema.Literals(["ambient", "interaction", "critical"]),
  replanConditions: Schema.Array(Schema.String),
}).annotate({ identifier: "Jarvis.Plan" })
export interface Plan extends Schema.Schema.Type<typeof Plan> {}

export const Goal = Schema.Struct({
  id: Schema.String,
  profileID: Schema.String,
  sessionID: optional(Schema.String),
  mode: Mode,
  gameID: optional(Schema.String),
  saveSlotID: optional(Schema.String),
  characterID: optional(Schema.String),
  objective: Schema.String,
  status: Schema.Literals(["pending", "planning", "active", "suspended", "completed", "failed", "cancelled"]),
  suspensionReason: optional(Schema.String),
  worldRevision: optional(NonNegativeInt),
  capabilityRevision: optional(Schema.String),
  actionCount: NonNegativeInt,
  cycleStartedAt: optional(NonNegativeInt),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  plan: optional(Plan),
}).annotate({ identifier: "Jarvis.Goal" })
export interface Goal extends Schema.Schema.Type<typeof Goal> {}

export const GoalOutcome = Schema.Struct({
  id: Schema.String,
  goalID: Schema.String,
  status: Schema.Literals(["completed", "failed", "cancelled"]),
  summary: Schema.String,
  changedEntityIDs: Schema.Array(Schema.String),
  createdAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.GoalOutcome" })
export interface GoalOutcome extends Schema.Schema.Type<typeof GoalOutcome> {}

export const MemoryRecord = Schema.Struct({
  id: Schema.String,
  profileID: optional(Schema.String),
  scope: Schema.Literals(["user", "profile", "game", "working"]),
  gameID: optional(Schema.String),
  saveSlotID: optional(Schema.String),
  characterID: optional(Schema.String),
  kind: Schema.Literals(["preference", "episode", "relationship", "promise", "knowledge", "correction", "plan"]),
  text: Schema.String,
  sourceID: Schema.String,
  confidence: Schema.Number,
  importance: Schema.Number,
  lifecycle: Schema.Literals(["candidate", "verified", "archived"]),
  pinned: Schema.Boolean,
  conflictsWith: Schema.Array(Schema.String),
  embedding: optional(Schema.Array(Schema.Number)),
  embeddingModel: optional(ModelRef),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  lastUsedAt: optional(NonNegativeInt),
}).annotate({ identifier: "Jarvis.MemoryRecord" })
export interface MemoryRecord extends Schema.Schema.Type<typeof MemoryRecord> {}

export const MemorySearch = Schema.Struct({
  query: Schema.String,
  profileID: optional(Schema.String),
  gameID: optional(Schema.String),
  saveSlotID: optional(Schema.String),
  characterID: optional(Schema.String),
  limit: optional(NonNegativeInt),
  embedding: optional(Schema.Array(Schema.Number)),
}).annotate({ identifier: "Jarvis.MemorySearch" })
export interface MemorySearch extends Schema.Schema.Type<typeof MemorySearch> {}

export const MemoryPatch = Schema.Struct({
  text: optional(Schema.String),
  confidence: optional(Schema.Number),
  importance: optional(Schema.Number),
  lifecycle: optional(MemoryRecord.fields.lifecycle),
  pinned: optional(Schema.Boolean),
}).annotate({ identifier: "Jarvis.MemoryPatch" })
export interface MemoryPatch extends Schema.Schema.Type<typeof MemoryPatch> {}

export const MemoryConflictResolution = Schema.Struct({
  action: Schema.Literals(["keep_both", "choose_current", "choose_other"]),
  otherMemoryID: Schema.String,
}).annotate({ identifier: "Jarvis.MemoryConflictResolution" })
export interface MemoryConflictResolution extends Schema.Schema.Type<typeof MemoryConflictResolution> {}

export const MemoryBackfillResult = Schema.Struct({
  queued: NonNegativeInt,
  remaining: NonNegativeInt,
}).annotate({ identifier: "Jarvis.MemoryBackfillResult" })
export interface MemoryBackfillResult extends Schema.Schema.Type<typeof MemoryBackfillResult> {}

export const WakeCandidate = Schema.Struct({
  id: Schema.String,
  profileID: Schema.String,
  sessionID: optional(Schema.String),
  kind: Schema.Literals(["attention", "goal", "promise", "model", "reflection", "manual"]),
  topic: Schema.String,
  text: Schema.String,
  priority: NonNegativeInt,
  status: Schema.Literals(["pending", "admitted", "dismissed", "blocked"]),
  notBefore: NonNegativeInt,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  blockedReason: optional(Schema.String),
}).annotate({ identifier: "Jarvis.WakeCandidate" })
export interface WakeCandidate extends Schema.Schema.Type<typeof WakeCandidate> {}

export const ModelRoleStatus = Schema.Struct({
  role: Schema.Literals(["dialogue", "planner", "embedding"]),
  status: Schema.Literals(["unconfigured", "ready", "loading", "offline", "unauthorized", "unsupported", "degraded"]),
  model: optional(ModelRef),
  verified: Schema.Boolean,
  detail: optional(Schema.String),
}).annotate({ identifier: "Jarvis.ModelRoleStatus" })
export interface ModelRoleStatus extends Schema.Schema.Type<typeof ModelRoleStatus> {}

export const PlannerLifecycle = Schema.Struct({
  state: Schema.Literals(["idle", "loading", "ready", "busy", "unloading", "offline"]),
  managed: Schema.Boolean,
  activeRequests: NonNegativeInt,
  lastUsedAt: optional(NonNegativeInt),
}).annotate({ identifier: "Jarvis.PlannerLifecycle" })
export interface PlannerLifecycle extends Schema.Schema.Type<typeof PlannerLifecycle> {}

export const EmbeddingBackfill = Schema.Struct({
  state: Schema.Literals(["idle", "running", "blocked", "error"]),
  remaining: NonNegativeInt,
  processed: NonNegativeInt,
  error: optional(Schema.String),
}).annotate({ identifier: "Jarvis.EmbeddingBackfill" })
export interface EmbeddingBackfill extends Schema.Schema.Type<typeof EmbeddingBackfill> {}

export const RuntimeStatus = Schema.Struct({
  state: Schema.Literals(["ready", "degraded", "suspended"]),
  primaryProfile: optional(ProfileSnapshot),
  config: Config,
  activeGoals: NonNegativeInt,
  suspendedGoals: NonNegativeInt,
  pendingInbox: NonNegativeInt,
  memoryRecords: NonNegativeInt,
  degradedReasons: Schema.Array(Schema.String),
  modelRoles: Schema.Array(ModelRoleStatus),
  planner: PlannerLifecycle,
  embeddings: EmbeddingBackfill,
}).annotate({ identifier: "Jarvis.RuntimeStatus" })
export interface RuntimeStatus extends Schema.Schema.Type<typeof RuntimeStatus> {}

export const ProfileSync = Schema.Struct({
  profiles: Schema.Array(ProfileSnapshot),
  primaryProfileID: optional(Schema.String),
}).annotate({ identifier: "Jarvis.ProfileSync" })
export interface ProfileSync extends Schema.Schema.Type<typeof ProfileSync> {}

export const GoalCreate = Schema.Struct({
  profileID: Schema.String,
  sessionID: optional(Schema.String),
  mode: Mode,
  gameID: optional(Schema.String),
  saveSlotID: optional(Schema.String),
  characterID: optional(Schema.String),
  objective: Schema.String,
  worldRevision: optional(NonNegativeInt),
  capabilityRevision: optional(Schema.String),
}).annotate({ identifier: "Jarvis.GoalCreate" })
export interface GoalCreate extends Schema.Schema.Type<typeof GoalCreate> {}

export const GoalResume = Schema.Struct({
  worldRevision: NonNegativeInt,
  capabilityRevision: Schema.String,
  gameID: optional(Schema.String),
  saveSlotID: optional(Schema.String),
  characterID: optional(Schema.String),
}).annotate({ identifier: "Jarvis.GoalResume" })
export interface GoalResume extends Schema.Schema.Type<typeof GoalResume> {}

export const GoalStepResult = Schema.Struct({
  stepID: Schema.String,
  success: Schema.Boolean,
  error: optional(Schema.String),
}).annotate({ identifier: "Jarvis.GoalStepResult" })
export interface GoalStepResult extends Schema.Schema.Type<typeof GoalStepResult> {}

export const GoalOutcomeCreate = Schema.Struct({
  status: Schema.Literals(["completed", "failed", "cancelled"]),
  summary: Schema.String,
  changedEntityIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "Jarvis.GoalOutcomeCreate" })
export interface GoalOutcomeCreate extends Schema.Schema.Type<typeof GoalOutcomeCreate> {}

export const GoalReplan = Schema.Struct({
  reason: optional(Schema.String),
}).annotate({ identifier: "Jarvis.GoalReplan" })
export interface GoalReplan extends Schema.Schema.Type<typeof GoalReplan> {}

export const GoalCancel = Schema.Struct({
  summary: optional(Schema.String),
  changedEntityIDs: optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "Jarvis.GoalCancel" })
export interface GoalCancel extends Schema.Schema.Type<typeof GoalCancel> {}

export const WakeCreate = Schema.Struct({
  sessionID: optional(Schema.String),
  kind: Schema.Literals(["attention", "goal", "promise", "model", "reflection", "manual"]),
  topic: Schema.String,
  text: Schema.String,
  priority: NonNegativeInt,
  notBefore: optional(NonNegativeInt),
}).annotate({ identifier: "Jarvis.WakeCreate" })
export interface WakeCreate extends Schema.Schema.Type<typeof WakeCreate> {}

export const MemoryMutation = Schema.Struct({ changed: NonNegativeInt }).annotate({
  identifier: "Jarvis.MemoryMutation",
})
export interface MemoryMutation extends Schema.Schema.Type<typeof MemoryMutation> {}

export const PlannerRequest = Schema.Struct({
  profileID: Schema.String,
  objective: Schema.String,
  context: Schema.String,
  riskBudget: Schema.Literals(["ambient", "interaction", "critical"]),
}).annotate({ identifier: "Jarvis.PlannerRequest" })
export interface PlannerRequest extends Schema.Schema.Type<typeof PlannerRequest> {}
