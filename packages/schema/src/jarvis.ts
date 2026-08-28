export * as Jarvis from "./jarvis"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"
import { Event } from "./event"

export const Mode = Schema.Literals(["chat", "unity"]).annotate({ identifier: "Jarvis.Mode" })
export type Mode = typeof Mode.Type

export const SessionMetadata = Schema.Struct({
  profileID: optional(Schema.String),
  profileRevision: optional(NonNegativeInt),
  mode: optional(Mode),
  inbox: optional(Schema.Boolean),
}).annotate({ identifier: "Jarvis.SessionMetadata" })
export interface SessionMetadata extends Schema.Schema.Type<typeof SessionMetadata> {}

export const Surface = Schema.Literals(["desktop", "unity-editor", "pcvr", "quest"]).annotate({
  identifier: "Jarvis.Surface",
})
export type Surface = typeof Surface.Type

export const TurnPhase = Schema.Literals([
  "listening",
  "transcribing",
  "understanding",
  "planning",
  "responding",
  "speaking",
  "acting",
  "completed",
  "cancelled",
  "error",
]).annotate({ identifier: "Jarvis.TurnPhase" })
export type TurnPhase = typeof TurnPhase.Type

export const PresentationCue = Schema.Struct({
  emotion: Schema.String,
  intensity: Schema.Number,
  gestureHint: optional(Schema.String),
  gazeTarget: optional(Schema.String),
  expectedDurationMs: optional(NonNegativeInt),
}).annotate({ identifier: "Jarvis.PresentationCue" })
export interface PresentationCue extends Schema.Schema.Type<typeof PresentationCue> {}

export const TurnMetrics = Schema.Struct({
  admittedAt: optional(NonNegativeInt),
  providerStartedAt: optional(NonNegativeInt),
  firstTextAt: optional(NonNegativeInt),
  firstAudioAt: optional(NonNegativeInt),
  completedAt: optional(NonNegativeInt),
  sttMs: optional(NonNegativeInt),
  ttftMs: optional(NonNegativeInt),
  ttsMs: optional(NonNegativeInt),
  cancelMs: optional(NonNegativeInt),
}).annotate({ identifier: "Jarvis.TurnMetrics" })
export interface TurnMetrics extends Schema.Schema.Type<typeof TurnMetrics> {}

export const Turn = Schema.Struct({
  id: Schema.String,
  requestID: Schema.String,
  sessionID: Schema.String,
  profileID: optional(Schema.String),
  surface: Surface,
  responseMode: Schema.Literals(["voice", "text"]),
  phase: TurnPhase,
  sequence: NonNegativeInt,
  presentation: optional(PresentationCue),
  metrics: TurnMetrics,
  error: optional(Schema.String),
  cancelReason: optional(Schema.String),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.Turn" })
export interface Turn extends Schema.Schema.Type<typeof Turn> {}

export const TurnCreate = Schema.Struct({
  requestID: Schema.String,
  sessionID: Schema.String,
  profileID: optional(Schema.String),
  surface: Surface,
  responseMode: Schema.Literals(["voice", "text"]),
  phase: optional(TurnPhase),
}).annotate({ identifier: "Jarvis.TurnCreate" })
export interface TurnCreate extends Schema.Schema.Type<typeof TurnCreate> {}

export const TurnUpdate = Schema.Struct({
  phase: TurnPhase,
  sequence: NonNegativeInt,
  presentation: optional(PresentationCue),
  metrics: optional(TurnMetrics),
  error: optional(Schema.String),
  cancelReason: optional(Schema.String),
}).annotate({ identifier: "Jarvis.TurnUpdate" })
export interface TurnUpdate extends Schema.Schema.Type<typeof TurnUpdate> {}

export const TurnCancel = Schema.Struct({ reason: optional(Schema.String) }).annotate({
  identifier: "Jarvis.TurnCancel",
})
export interface TurnCancel extends Schema.Schema.Type<typeof TurnCancel> {}

export const Presence = Schema.Struct({
  surface: Surface,
  microphoneOwner: optional(Surface),
  playbackOwner: optional(Surface),
  turnID: optional(Schema.String),
  sessionID: optional(Schema.String),
  state: TurnPhase,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.Presence" })
export interface Presence extends Schema.Schema.Type<typeof Presence> {}

export const PresenceHandoff = Schema.Struct({
  from: optional(Surface),
  to: Surface,
  sessionID: optional(Schema.String),
  turnID: optional(Schema.String),
  microphone: Schema.Boolean,
  playback: Schema.Boolean,
}).annotate({ identifier: "Jarvis.PresenceHandoff" })
export interface PresenceHandoff extends Schema.Schema.Type<typeof PresenceHandoff> {}

export const ConversationState = Schema.Struct({
  sessionID: Schema.String,
  profileID: optional(Schema.String),
  profileRevision: optional(NonNegativeInt),
  recoveredAt: optional(NonNegativeInt),
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.ConversationState" })
export interface ConversationState extends Schema.Schema.Type<typeof ConversationState> {}

export const ConversationAdopt = Schema.Struct({
  sessionID: optional(Schema.String),
  profileID: optional(Schema.String),
  profileRevision: optional(NonNegativeInt),
  surface: Surface,
}).annotate({ identifier: "Jarvis.ConversationAdopt" })
export interface ConversationAdopt extends Schema.Schema.Type<typeof ConversationAdopt> {}

export const PartialTranscript = Schema.Struct({
  turnID: optional(Schema.String),
  requestID: Schema.String,
  surface: Surface,
  text: Schema.String,
  sequence: NonNegativeInt,
  language: optional(Schema.String),
  profileRevision: optional(NonNegativeInt),
  worldContext: optional(Schema.String),
  capturedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.PartialTranscript" })
export interface PartialTranscript extends Schema.Schema.Type<typeof PartialTranscript> {}

export const PrewarmState = Schema.Struct({
  requestID: Schema.String,
  surface: Surface,
  sequence: NonNegativeInt,
  language: optional(Schema.String),
  profileRevision: optional(NonNegativeInt),
  modelReady: Schema.Boolean,
  memoryReady: Schema.Boolean,
  worldReady: Schema.Boolean,
  expiresAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.PrewarmState" })
export interface PrewarmState extends Schema.Schema.Type<typeof PrewarmState> {}

export const FinalAdmission = Schema.Struct({
  requestID: Schema.String,
  transcript: Schema.String,
  surface: Surface,
  responseMode: Schema.Literals(["voice", "text"]),
  profileID: optional(Schema.String),
  profileRevision: optional(NonNegativeInt),
  worldContext: optional(Schema.String),
}).annotate({ identifier: "Jarvis.FinalAdmission" })
export interface FinalAdmission extends Schema.Schema.Type<typeof FinalAdmission> {}

export const FinalAdmissionResult = Schema.Struct({
  conversation: ConversationState,
  turn: Turn,
  messageID: Schema.String,
  admitted: Schema.Boolean,
  prewarm: optional(PrewarmState),
}).annotate({ identifier: "Jarvis.FinalAdmissionResult" })
export interface FinalAdmissionResult extends Schema.Schema.Type<typeof FinalAdmissionResult> {}

export const MediaState = Schema.Struct({
  turnID: optional(Schema.String),
  owner: optional(Surface),
  state: Schema.Literals(["idle", "buffering", "synthesizing", "playing", "cancelling", "error"]),
  queuedSentences: NonNegativeInt,
  activeJobs: NonNegativeInt,
  acknowledgedCancellation: Schema.Boolean,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.MediaState" })
export interface MediaState extends Schema.Schema.Type<typeof MediaState> {}

export const MediaStateUpdate = Schema.Struct({
  turnID: optional(Schema.String),
  owner: optional(Surface),
  state: MediaState.fields.state,
  queuedSentences: NonNegativeInt,
  activeJobs: NonNegativeInt,
  acknowledgedCancellation: Schema.Boolean,
}).annotate({ identifier: "Jarvis.MediaStateUpdate" })
export interface MediaStateUpdate extends Schema.Schema.Type<typeof MediaStateUpdate> {}

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

export const MemoryUse = Schema.Struct({
  id: Schema.String,
  turnID: Schema.String,
  memoryID: Schema.String,
  rank: NonNegativeInt,
  lexicalScore: Schema.Number,
  semanticScore: Schema.Number,
  reason: Schema.String,
  createdAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.MemoryUse" })
export interface MemoryUse extends Schema.Schema.Type<typeof MemoryUse> {}

export const MemoryUseCreate = Schema.Struct({
  turnID: Schema.String,
  memoryID: Schema.String,
  rank: NonNegativeInt,
  lexicalScore: optional(Schema.Number),
  semanticScore: optional(Schema.Number),
  reason: Schema.String,
}).annotate({ identifier: "Jarvis.MemoryUseCreate" })
export interface MemoryUseCreate extends Schema.Schema.Type<typeof MemoryUseCreate> {}

export const ReplayEvent = Schema.Struct({
  sequence: NonNegativeInt,
  type: Schema.String,
  timestamp: NonNegativeInt,
  data: Schema.Record(Schema.String, Schema.Json),
}).annotate({ identifier: "Jarvis.ReplayEvent" })
export interface ReplayEvent extends Schema.Schema.Type<typeof ReplayEvent> {}

export const ReplayRun = Schema.Struct({
  id: Schema.String,
  turnID: optional(Schema.String),
  sessionID: optional(Schema.String),
  surface: Surface,
  status: Schema.Literals(["recording", "completed", "cancelled", "error"]),
  events: Schema.Array(ReplayEvent),
  metrics: TurnMetrics,
  error: optional(Schema.String),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.ReplayRun" })
export interface ReplayRun extends Schema.Schema.Type<typeof ReplayRun> {}

export const ReplayCreate = Schema.Struct({
  turnID: optional(Schema.String),
  sessionID: optional(Schema.String),
  surface: Surface,
  status: optional(ReplayRun.fields.status),
  events: Schema.Array(ReplayEvent),
  metrics: optional(TurnMetrics),
  error: optional(Schema.String),
}).annotate({ identifier: "Jarvis.ReplayCreate" })
export interface ReplayCreate extends Schema.Schema.Type<typeof ReplayCreate> {}

export const ReplayMutation = Schema.Struct({ changed: NonNegativeInt }).annotate({
  identifier: "Jarvis.ReplayMutation",
})
export interface ReplayMutation extends Schema.Schema.Type<typeof ReplayMutation> {}

export const ReplayAssertion = Schema.Struct({
  id: Schema.String,
  passed: Schema.Boolean,
  detail: optional(Schema.String),
}).annotate({ identifier: "Jarvis.ReplayAssertion" })
export interface ReplayAssertion extends Schema.Schema.Type<typeof ReplayAssertion> {}

export const ReplayExecution = Schema.Struct({
  id: Schema.String,
  replayID: Schema.String,
  status: Schema.Literals(["queued", "running", "completed", "error"]),
  fixtureOnly: Schema.Boolean,
  assertions: Schema.Array(ReplayAssertion),
  metrics: TurnMetrics,
  error: optional(Schema.String),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.ReplayExecution" })
export interface ReplayExecution extends Schema.Schema.Type<typeof ReplayExecution> {}

export const ReplayExecute = Schema.Struct({
  fixtureOnly: optional(Schema.Boolean),
}).annotate({ identifier: "Jarvis.ReplayExecute" })
export interface ReplayExecute extends Schema.Schema.Type<typeof ReplayExecute> {}

export const ReplayComparison = Schema.Struct({
  baselineExecutionID: Schema.String,
  candidateExecutionID: Schema.String,
  regressions: Schema.Array(Schema.String),
  improvements: Schema.Array(Schema.String),
  passed: Schema.Boolean,
}).annotate({ identifier: "Jarvis.ReplayComparison" })
export interface ReplayComparison extends Schema.Schema.Type<typeof ReplayComparison> {}

export const ReplayCompare = Schema.Struct({
  baselineExecutionID: Schema.String,
  candidateExecutionID: Schema.String,
}).annotate({ identifier: "Jarvis.ReplayCompare" })
export interface ReplayCompare extends Schema.Schema.Type<typeof ReplayCompare> {}

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

export const DiagnosticCheck = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["ready", "degraded", "error"]),
  summary: Schema.String,
  detail: optional(Schema.String),
}).annotate({ identifier: "Jarvis.DiagnosticCheck" })
export interface DiagnosticCheck extends Schema.Schema.Type<typeof DiagnosticCheck> {}

export const Diagnostics = Schema.Struct({
  checkedAt: NonNegativeInt,
  checks: Schema.Array(DiagnosticCheck),
  recommendations: Schema.Array(Schema.String),
}).annotate({ identifier: "Jarvis.Diagnostics" })
export interface Diagnostics extends Schema.Schema.Type<typeof Diagnostics> {}

export const DailyCompanionSourceKind = Schema.Literals(["gmail", "calendar", "drive", "goal", "promise", "inbox"])
  .annotate({ identifier: "Jarvis.DailyCompanionSourceKind" })
export type DailyCompanionSourceKind = typeof DailyCompanionSourceKind.Type

export const DailyCompanionConfig = Schema.Struct({
  enabled: Schema.Boolean,
  schedule: Schema.String,
  timezone: Schema.String,
  catchUpUntil: Schema.String,
  sources: Schema.Struct({
    gmail: Schema.Boolean,
    calendar: Schema.Boolean,
    drive: Schema.Boolean,
    goals: Schema.Boolean,
    promises: Schema.Boolean,
    inbox: Schema.Boolean,
  }),
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.DailyCompanionConfig" })
export interface DailyCompanionConfig extends Schema.Schema.Type<typeof DailyCompanionConfig> {}

export const GoogleConnectionStatus = Schema.Struct({
  available: Schema.Boolean,
  phase: Schema.Literals(["unavailable", "disconnected", "connecting", "connected", "expired", "error"]),
  accountID: optional(Schema.String),
  email: optional(Schema.String),
  scopes: Schema.Array(Schema.String),
  writeScopes: Schema.Array(Schema.String),
  checkedAt: NonNegativeInt,
  error: optional(Schema.String),
}).annotate({ identifier: "Jarvis.GoogleConnectionStatus" })
export interface GoogleConnectionStatus extends Schema.Schema.Type<typeof GoogleConnectionStatus> {}

export const DailyBriefingSource = Schema.Struct({
  id: Schema.String,
  kind: DailyCompanionSourceKind,
  status: Schema.Literals(["ready", "unavailable", "error"]),
  title: Schema.String,
  summary: optional(Schema.String),
  timestamp: optional(NonNegativeInt),
  url: optional(Schema.String),
  error: optional(Schema.String),
}).annotate({ identifier: "Jarvis.DailyBriefingSource" })
export interface DailyBriefingSource extends Schema.Schema.Type<typeof DailyBriefingSource> {}

export const CompanionActionKind = Schema.Literals(["gmail_draft", "calendar_create", "calendar_update", "jarvis_reminder", "jarvis_goal"])
  .annotate({ identifier: "Jarvis.CompanionActionKind" })
export type CompanionActionKind = typeof CompanionActionKind.Type

export const CompanionActionProposal = Schema.Struct({
  id: Schema.String,
  briefingID: optional(Schema.String),
  kind: CompanionActionKind,
  title: Schema.String,
  preview: Schema.String,
  access: Schema.Literals(["read", "local_write", "external_write"]),
  input: Schema.Record(Schema.String, Schema.Json),
  requiredScopes: Schema.Array(Schema.String),
  idempotencyKey: Schema.String,
  externalRevision: optional(Schema.String),
  status: Schema.Literals(["prepared", "approved", "executing", "completed", "cancelled", "conflict", "error"]),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.CompanionActionProposal" })
export interface CompanionActionProposal extends Schema.Schema.Type<typeof CompanionActionProposal> {}

export const CompanionActionPrepare = Schema.Struct({
  briefingID: optional(Schema.String),
  kind: CompanionActionKind,
  title: Schema.String,
  preview: Schema.String,
  input: Schema.Record(Schema.String, Schema.Json),
  requiredScopes: optional(Schema.Array(Schema.String)),
  idempotencyKey: Schema.String,
  externalRevision: optional(Schema.String),
}).annotate({ identifier: "Jarvis.CompanionActionPrepare" })
export interface CompanionActionPrepare extends Schema.Schema.Type<typeof CompanionActionPrepare> {}

export const CompanionActionExecution = Schema.Struct({
  id: Schema.String,
  proposalID: Schema.String,
  status: Schema.Literals(["approved", "executing", "completed", "cancelled", "conflict", "error"]),
  result: optional(Schema.Record(Schema.String, Schema.Json)),
  error: optional(Schema.String),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.CompanionActionExecution" })
export interface CompanionActionExecution extends Schema.Schema.Type<typeof CompanionActionExecution> {}

export const CompanionActionApprove = Schema.Struct({
  externalRevision: optional(Schema.String),
}).annotate({ identifier: "Jarvis.CompanionActionApprove" })
export interface CompanionActionApprove extends Schema.Schema.Type<typeof CompanionActionApprove> {}

export const DailyBriefing = Schema.Struct({
  id: Schema.String,
  localDate: Schema.String,
  accountID: Schema.String,
  sessionID: optional(Schema.String),
  status: Schema.Literals(["collecting", "ready", "partial", "error"]),
  summary: Schema.String,
  schedule: Schema.Array(Schema.String),
  importantMessages: Schema.Array(Schema.String),
  goalsAndPromises: Schema.Array(Schema.String),
  conflicts: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
  sources: Schema.Array(DailyBriefingSource),
  proposedActions: Schema.Array(CompanionActionProposal),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "Jarvis.DailyBriefing" })
export interface DailyBriefing extends Schema.Schema.Type<typeof DailyBriefing> {}

export const DailyBriefingRun = Schema.Struct({
  id: Schema.String,
  briefingID: optional(Schema.String),
  trigger: Schema.Literals(["scheduled", "catch_up", "manual"]),
  status: Schema.Literals(["queued", "collecting", "completed", "partial", "error", "skipped"]),
  localDate: Schema.String,
  accountID: optional(Schema.String),
  sourceCounts: Schema.Record(Schema.String, NonNegativeInt),
  error: optional(Schema.String),
  startedAt: NonNegativeInt,
  completedAt: optional(NonNegativeInt),
}).annotate({ identifier: "Jarvis.DailyBriefingRun" })
export interface DailyBriefingRun extends Schema.Schema.Type<typeof DailyBriefingRun> {}

export const DailyBriefingRunRequest = Schema.Struct({
  trigger: optional(Schema.Literals(["scheduled", "catch_up", "manual"])),
  force: optional(Schema.Boolean),
}).annotate({ identifier: "Jarvis.DailyBriefingRunRequest" })
export interface DailyBriefingRunRequest extends Schema.Schema.Type<typeof DailyBriefingRunRequest> {}

export const DailyCompanionStatus = Schema.Struct({
  config: DailyCompanionConfig,
  google: GoogleConnectionStatus,
  lastRun: optional(DailyBriefingRun),
  nextRunAt: optional(NonNegativeInt),
  catchUpAvailable: Schema.Boolean,
  bridgeAvailable: Schema.Boolean,
  error: optional(Schema.String),
}).annotate({ identifier: "Jarvis.DailyCompanionStatus" })
export interface DailyCompanionStatus extends Schema.Schema.Type<typeof DailyCompanionStatus> {}

export const ControlStatus = Schema.Struct({
  runtime: RuntimeStatus,
  conversation: optional(ConversationState),
  currentTurn: optional(Turn),
  presence: Presence,
  media: MediaState,
  replayCount: NonNegativeInt,
  recentMemoryUses: NonNegativeInt,
  recommendations: Schema.Array(Schema.String),
}).annotate({ identifier: "Jarvis.ControlStatus" })
export interface ControlStatus extends Schema.Schema.Type<typeof ControlStatus> {}

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

export const TurnUpdated = Event.define({
  type: "jarvis.turn.updated",
  schema: { turn: Turn },
})

export const PresenceUpdated = Event.define({
  type: "jarvis.presence.updated",
  schema: { presence: Presence },
})

export const ReplayUpdated = Event.define({
  type: "jarvis.replay.updated",
  schema: { replay: ReplayRun },
})

export const DailyBriefingUpdated = Event.define({
  type: "jarvis.companion.briefing.updated",
  schema: { briefing: DailyBriefing },
})
