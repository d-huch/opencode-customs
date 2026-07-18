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
