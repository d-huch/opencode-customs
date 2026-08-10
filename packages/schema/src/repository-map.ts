export * as RepositoryMap from "./repository-map"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"

export const Language = Schema.Struct({
  name: Schema.String,
  files: NonNegativeInt,
}).annotate({ identifier: "RepositoryMap.Language" })
export interface Language extends Schema.Schema.Type<typeof Language> {}

export const Module = Schema.Struct({
  path: Schema.String,
  name: optional(Schema.String),
  files: NonNegativeInt,
  manifests: Schema.Array(Schema.String),
  entrypoints: Schema.Array(Schema.String),
}).annotate({ identifier: "RepositoryMap.Module" })
export interface Module extends Schema.Schema.Type<typeof Module> {}

export const Relationship = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  references: NonNegativeInt,
}).annotate({ identifier: "RepositoryMap.Relationship" })
export interface Relationship extends Schema.Schema.Type<typeof Relationship> {}

export const Landmark = Schema.Struct({
  kind: Schema.Literals(["routes", "controllers", "components", "config", "schema", "migrations"]),
  path: Schema.String,
}).annotate({ identifier: "RepositoryMap.Landmark" })
export interface Landmark extends Schema.Schema.Type<typeof Landmark> {}

export const SymbolNode = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["class", "function", "interface", "type", "enum", "variable", "export"]),
  path: Schema.String,
  line: NonNegativeInt,
  source: Schema.Literals(["syntax", "lsp"]),
}).annotate({ identifier: "RepositoryMap.SymbolNode" })
export interface SymbolNode extends Schema.Schema.Type<typeof SymbolNode> {}

export const FileEdge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  kind: Schema.Literals(["import", "reference", "call"]),
  references: NonNegativeInt,
}).annotate({ identifier: "RepositoryMap.FileEdge" })
export interface FileEdge extends Schema.Schema.Type<typeof FileEdge> {}

export const Semantic = Schema.Struct({
  status: Schema.Literals(["indexing", "ready", "unavailable"]),
  files: NonNegativeInt,
  servers: Schema.Array(Schema.String),
}).annotate({ identifier: "RepositoryMap.Semantic" })
export interface Semantic extends Schema.Schema.Type<typeof Semantic> {}

export const DiagnosticEntry = Schema.Struct({
  id: NonNegativeInt,
  time: NonNegativeInt,
  level: Schema.Literals(["info", "warning", "error"]),
  stage: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "RepositoryMap.DiagnosticEntry" })
export interface DiagnosticEntry extends Schema.Schema.Type<typeof DiagnosticEntry> {}

export const Diagnostics = Schema.Struct({
  enabled: Schema.Boolean,
  entries: Schema.Array(DiagnosticEntry),
}).annotate({ identifier: "RepositoryMap.Diagnostics" })
export interface Diagnostics extends Schema.Schema.Type<typeof Diagnostics> {}

export const DiagnosticsConfig = Schema.Struct({
  enabled: Schema.Boolean,
  clear: optional(Schema.Boolean),
}).annotate({ identifier: "RepositoryMap.DiagnosticsConfig" })
export interface DiagnosticsConfig extends Schema.Schema.Type<typeof DiagnosticsConfig> {}

export const KnowledgeScope = Schema.Literals(["memory", "rag", "retrieval"]).annotate({
  identifier: "RepositoryMap.KnowledgeScope",
})
export type KnowledgeScope = typeof KnowledgeScope.Type

export const MemoryEntry = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["route", "summary", "conversation"]),
  text: Schema.String,
  terms: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  updatedAt: NonNegativeInt,
  embeddingModel: optional(Schema.String),
  dimensions: NonNegativeInt,
  category: optional(Schema.Literals(["identity", "preference", "constraint", "decision", "context"])),
  topic: optional(Schema.String),
  confidence: optional(Schema.Number),
  source: optional(Schema.Literals(["classifier", "answer", "manual", "route", "compaction"])),
  evidence: optional(Schema.String),
  originProject: optional(Schema.String),
  scope: optional(Schema.Literals(["global", "cross-project", "project", "session", "pattern"])),
  scopeID: optional(Schema.String),
  lifecycle: optional(Schema.Literals(["candidate", "verified", "durable", "rejected", "expired", "archived"])),
  createdAt: optional(NonNegativeInt),
  verifiedAt: optional(NonNegativeInt),
  ttl: optional(NonNegativeInt),
  classification: optional(Schema.Literals(["fact", "analogy"])),
  status: optional(Schema.Literals(["active", "conflict"])),
  conflictsWith: optional(Schema.String),
  conflicts: optional(Schema.Array(Schema.String)),
  pinned: optional(Schema.Boolean),
  expiresAt: optional(NonNegativeInt),
  lastUsedAt: optional(NonNegativeInt),
  useCount: optional(NonNegativeInt),
  confirmationCount: optional(NonNegativeInt),
  lastQuery: optional(Schema.String),
  matchReason: optional(Schema.Literals(["lexical", "semantic"])),
  usage: optional(
    Schema.Array(
      Schema.Struct({
        at: NonNegativeInt,
        query: Schema.String,
        reason: Schema.Literals(["lexical", "semantic"]),
        project: Schema.String,
        classification: Schema.Literals(["fact", "analogy"]),
      }),
    ),
  ),
}).annotate({ identifier: "RepositoryMap.MemoryEntry" })
export interface MemoryEntry extends Schema.Schema.Type<typeof MemoryEntry> {}

export const MemoryLifecycleUpdate = Schema.Struct({
  pinned: optional(Schema.Boolean),
  expiresAt: optional(NonNegativeInt),
  clearExpiration: optional(Schema.Boolean),
  resolve: optional(Schema.Boolean),
  lifecycle: optional(Schema.Literals(["candidate", "verified", "durable", "rejected", "expired", "archived"])),
}).annotate({ identifier: "RepositoryMap.MemoryLifecycleUpdate" })
export interface MemoryLifecycleUpdate extends Schema.Schema.Type<typeof MemoryLifecycleUpdate> {}

export const MemoryConsolidationAction = Schema.Struct({
  type: Schema.Literals([
    "merge_duplicate",
    "resolve_conflict",
    "decrease_confidence",
    "increase_confidence",
    "archive_unused",
    "unresolved_conflict",
  ]),
  id: Schema.String,
  relatedIDs: Schema.Array(Schema.String),
  reason: Schema.String,
  beforeConfidence: optional(Schema.Number),
  afterConfidence: optional(Schema.Number),
  winnerID: optional(Schema.String),
}).annotate({ identifier: "RepositoryMap.MemoryConsolidationAction" })
export interface MemoryConsolidationAction extends Schema.Schema.Type<typeof MemoryConsolidationAction> {}

export const MemoryConsolidationPreview = Schema.Struct({
  fingerprint: Schema.String,
  generatedAt: NonNegativeInt,
  total: NonNegativeInt,
  protected: NonNegativeInt,
  actionable: NonNegativeInt,
  unresolved: NonNegativeInt,
  actions: Schema.Array(MemoryConsolidationAction),
}).annotate({ identifier: "RepositoryMap.MemoryConsolidationPreview" })
export interface MemoryConsolidationPreview extends Schema.Schema.Type<typeof MemoryConsolidationPreview> {}

export const MemoryConsolidationApply = Schema.Struct({
  fingerprint: Schema.String,
  generatedAt: NonNegativeInt,
}).annotate({ identifier: "RepositoryMap.MemoryConsolidationApply" })
export interface MemoryConsolidationApply extends Schema.Schema.Type<typeof MemoryConsolidationApply> {}

export const MemoryConsolidationResult = Schema.Struct({
  applied: Schema.Boolean,
  stale: Schema.Boolean,
  removed: NonNegativeInt,
  updated: NonNegativeInt,
  archived: NonNegativeInt,
  preview: MemoryConsolidationPreview,
}).annotate({ identifier: "RepositoryMap.MemoryConsolidationResult" })
export interface MemoryConsolidationResult extends Schema.Schema.Type<typeof MemoryConsolidationResult> {}

export const RagEntry = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  start: NonNegativeInt,
  end: NonNegativeInt,
  fileHash: Schema.String,
  updatedAt: NonNegativeInt,
  dimensions: NonNegativeInt,
}).annotate({ identifier: "RepositoryMap.RagEntry" })
export interface RagEntry extends Schema.Schema.Type<typeof RagEntry> {}

export const RetrievalStage = Schema.Literals([
  "attachment",
  "exact",
  "lexical",
  "concept",
  "embedding",
  "lsp",
  "graph",
  "memory",
  "analogy",
]).annotate({ identifier: "RepositoryMap.RetrievalStage" })
export type RetrievalStage = typeof RetrievalStage.Type

export const RetrievalReason = Schema.Struct({
  stage: RetrievalStage,
  detail: Schema.String,
  weight: Schema.Number,
}).annotate({ identifier: "RepositoryMap.RetrievalReason" })
export interface RetrievalReason extends Schema.Schema.Type<typeof RetrievalReason> {}

export const RetrievalFile = Schema.Struct({
  path: Schema.String,
  score: Schema.Number,
  confidence: Schema.Number,
  classification: Schema.Literals(["fact", "assumption", "analogy"]),
  reasons: Schema.Array(RetrievalReason),
  used: optional(Schema.Boolean),
  rejected: optional(Schema.Boolean),
}).annotate({ identifier: "RepositoryMap.RetrievalFile" })
export interface RetrievalFile extends Schema.Schema.Type<typeof RetrievalFile> {}

export const RetrievalEntry = Schema.Struct({
  id: Schema.String,
  query: Schema.String,
  files: Schema.Array(RetrievalFile),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  recallAt5: optional(Schema.Number),
  recallAt10: optional(Schema.Number),
}).annotate({ identifier: "RepositoryMap.RetrievalEntry" })
export interface RetrievalEntry extends Schema.Schema.Type<typeof RetrievalEntry> {}

export const RetrievalFeedback = Schema.Struct({
  path: Schema.String,
  relevance: Schema.Literals(["used", "rejected", "clear"]),
}).annotate({ identifier: "RepositoryMap.RetrievalFeedback" })
export interface RetrievalFeedback extends Schema.Schema.Type<typeof RetrievalFeedback> {}

export const Knowledge = Schema.Struct({
  memory: Schema.Struct({
    total: NonNegativeInt,
    matched: NonNegativeInt,
    entries: Schema.Array(MemoryEntry),
  }),
  rag: Schema.Struct({
    model: optional(Schema.String),
    total: NonNegativeInt,
    matched: NonNegativeInt,
    files: NonNegativeInt,
    entries: Schema.Array(RagEntry),
  }),
  retrieval: Schema.Struct({
    total: NonNegativeInt,
    matched: NonNegativeInt,
    recallAt5: optional(Schema.Number),
    recallAt10: optional(Schema.Number),
    entries: Schema.Array(RetrievalEntry),
  }),
}).annotate({ identifier: "RepositoryMap.Knowledge" })
export interface Knowledge extends Schema.Schema.Type<typeof Knowledge> {}

export const KnowledgeMutation = Schema.Struct({
  removed: NonNegativeInt,
}).annotate({ identifier: "RepositoryMap.KnowledgeMutation" })
export interface KnowledgeMutation extends Schema.Schema.Type<typeof KnowledgeMutation> {}

export const Info = Schema.Struct({
  status: Schema.Literals(["complete", "truncated", "unavailable"]),
  files: NonNegativeInt,
  languages: Schema.Array(Language),
  modules: Schema.Array(Module),
  relationships: Schema.Array(Relationship),
  landmarks: Schema.Array(Landmark),
  symbols: Schema.Array(SymbolNode),
  edges: Schema.Array(FileEdge),
  semantic: Semantic,
}).annotate({ identifier: "RepositoryMap.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
