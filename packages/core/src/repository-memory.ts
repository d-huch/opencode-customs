export * as RepositoryMemory from "./repository-memory"

import path from "path"
import { Context, Effect, Layer, Option, Ref, Schema, Scope, Semaphore } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { Hash } from "./util/hash"
import { Config } from "./config"
import { RepositoryEmbeddings } from "./repository-embeddings"

const VERSION = 1
const MAX_ENTRIES = 96
const MAX_FILES = 8
const MAX_NOTES = 4
const MAX_NOTE_CHARS = 1_200
const MAX_AGE = 1000 * 60 * 60 * 24 * 90
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24
const EXPIRED_RETENTION = 1000 * 60 * 60 * 24 * 30
const ARCHIVED_RETENTION = 1000 * 60 * 60 * 24 * 180
const CONSOLIDATION_STALE_AGE = 1000 * 60 * 60 * 24 * 90
const MAX_USAGE_HISTORY = 20
const globalStores = new Map<
  string,
  {
    entries: ReadonlyArray<Entry> | undefined
    lock: ReturnType<typeof Semaphore.makeUnsafe>
  }
>()

export const MemoryCategory = Schema.Literals(["identity", "preference", "constraint", "decision", "context"])
export type MemoryCategory = typeof MemoryCategory.Type
export const MemoryScope = Schema.Literals(["global", "cross-project", "project", "session", "pattern"])
export type MemoryScope = typeof MemoryScope.Type
export const MemoryStatus = Schema.Literals(["active", "conflict"])
export type MemoryStatus = typeof MemoryStatus.Type
export const MemoryLifecycle = Schema.Literals(["candidate", "verified", "durable", "rejected", "expired", "archived"])
export type MemoryLifecycle = typeof MemoryLifecycle.Type
export const MemoryClassification = Schema.Literals(["fact", "analogy"])
export type MemoryClassification = typeof MemoryClassification.Type
export const RecallReason = Schema.Literals(["lexical", "semantic"])
export type RecallReason = typeof RecallReason.Type

const Usage = Schema.Struct({
  at: Schema.Number,
  query: Schema.String,
  reason: RecallReason,
  project: Schema.String,
  classification: MemoryClassification,
})
export type Usage = typeof Usage.Type

const StoredEntry = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["route", "summary", "conversation"]),
  text: Schema.String,
  terms: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  updatedAt: Schema.Number,
  embeddingModel: Schema.optional(Schema.String),
  embedding: Schema.optional(Schema.Array(Schema.Number)),
  category: Schema.optional(MemoryCategory),
  topic: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.Literals(["classifier", "answer", "manual", "route", "compaction"])),
  evidence: Schema.optional(Schema.String),
  originProject: Schema.optional(Schema.String),
  scope: Schema.optional(MemoryScope),
  scopeID: Schema.optional(Schema.String),
  lifecycle: Schema.optional(MemoryLifecycle),
  createdAt: Schema.optional(Schema.Number),
  verifiedAt: Schema.optional(Schema.Number),
  ttl: Schema.optional(Schema.Number),
  classification: Schema.optional(MemoryClassification),
  status: Schema.optional(MemoryStatus),
  conflictsWith: Schema.optional(Schema.String),
  conflicts: Schema.optional(Schema.Array(Schema.String)),
  correction: Schema.optional(Schema.Boolean),
  pinned: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Number),
  lastUsedAt: Schema.optional(Schema.Number),
  useCount: Schema.optional(Schema.Number),
  confirmationCount: Schema.optional(Schema.Number),
  lastQuery: Schema.optional(Schema.String),
  matchReason: Schema.optional(RecallReason),
  usage: Schema.optional(Schema.Array(Usage)),
})

const StoredFile = Schema.Struct({
  version: Schema.Literal(VERSION),
  entries: Schema.Array(StoredEntry),
})

export type Entry = typeof StoredEntry.Type

export type InspectEntry = Omit<Entry, "embedding"> & {
  readonly dimensions: number
}

export type Snapshot = {
  readonly total: number
  readonly matched: number
  readonly entries: ReadonlyArray<InspectEntry>
}

export type Recall = {
  readonly files: ReadonlyArray<string>
  readonly notes: ReadonlyArray<string>
  readonly matches: number
  readonly memories?: ReadonlyArray<{
    readonly id: string
    readonly text: string
    readonly scope: MemoryScope
    readonly originProject?: string
    readonly classification: MemoryClassification
    readonly reason: RecallReason
  }>
  readonly uses: ReadonlyArray<{
    readonly id: string
    readonly reason: RecallReason
    readonly classification?: MemoryClassification
  }>
}

export type ConversationInput = {
  readonly text: string
  readonly category?: MemoryCategory
  readonly topic?: string
  readonly confidence?: number
  readonly source?: "classifier" | "answer" | "manual" | "route" | "compaction"
  readonly evidence?: string
  readonly originProject?: string
  readonly scope?: MemoryScope
  readonly scopeID?: string
  readonly lifecycle?: MemoryLifecycle
  readonly verifiedAt?: number
  readonly ttl?: number
  readonly classification?: MemoryClassification
  readonly correction?: boolean
  readonly expiresAt?: number
}

export type LifecycleUpdate = {
  readonly pinned?: boolean
  readonly expiresAt?: number
  readonly clearExpiration?: boolean
  readonly resolve?: boolean
  readonly lifecycle?: MemoryLifecycle
}

export type ConsolidationAction = {
  readonly type:
    | "merge_duplicate"
    | "resolve_conflict"
    | "decrease_confidence"
    | "increase_confidence"
    | "archive_unused"
    | "unresolved_conflict"
  readonly id: string
  readonly relatedIDs: ReadonlyArray<string>
  readonly reason: string
  readonly beforeConfidence?: number
  readonly afterConfidence?: number
  readonly winnerID?: string
}

export type ConsolidationPreview = {
  readonly fingerprint: string
  readonly generatedAt: number
  readonly total: number
  readonly protected: number
  readonly actionable: number
  readonly unresolved: number
  readonly actions: ReadonlyArray<ConsolidationAction>
}

export type ConsolidationResult = {
  readonly applied: boolean
  readonly stale: boolean
  readonly removed: number
  readonly updated: number
  readonly archived: number
  readonly preview: ConsolidationPreview
}

export interface Interface {
  readonly recall: (query: string, input?: { readonly sessionID?: string }) => Effect.Effect<Recall>
  readonly inspect: (input?: { readonly search?: string; readonly limit?: number }) => Effect.Effect<Snapshot>
  readonly remove: (id: string) => Effect.Effect<number>
  readonly clear: () => Effect.Effect<number>
  readonly update: (id: string, input: LifecycleUpdate) => Effect.Effect<number>
  readonly maintain: () => Effect.Effect<number>
  readonly previewConsolidation: () => Effect.Effect<ConsolidationPreview>
  readonly applyConsolidation: (input: {
    readonly fingerprint: string
    readonly generatedAt: number
  }) => Effect.Effect<ConsolidationResult>
  readonly rememberRoute: (input: {
    readonly query: string
    readonly files: ReadonlyArray<string>
    readonly terms?: ReadonlyArray<string>
  }) => Effect.Effect<void>
  readonly rememberSummary: (summary: string) => Effect.Effect<void>
  readonly rememberConversation: (input: string | ConversationInput) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RepositoryMemory") {}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeFile = Schema.decodeUnknownOption(StoredFile)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const config = yield* Config.Service
    const scope = yield* Scope.Scope
    const semantic = Config.latest(yield* config.entries(), "rag")?.memory !== false
    const state = yield* Ref.make<ReadonlyArray<Entry> | undefined>(undefined)
    const lock = Semaphore.makeUnsafe(1)
    const currentProject = location.project.directory
    const file = path.join(global.cache, "repository-memory", `${Hash.fast(location.project.directory)}.json`)
    const globalFile = path.join(global.cache, "repository-memory", "global.json")
    const catalogueFile = path.join(global.cache, "repository-memory", "projects.json")
    const shared =
      globalStores.get(globalFile) ??
      (() => {
        const value = { entries: undefined, lock: Semaphore.makeUnsafe(1) }
        globalStores.set(globalFile, value)
        return value
      })()
    const catalogue =
      globalStores.get(catalogueFile) ??
      (() => {
        const value = { entries: undefined, lock: Semaphore.makeUnsafe(1) }
        globalStores.set(catalogueFile, value)
        return value
      })()

    const read = Effect.fn("RepositoryMemory.read")(function* (
      target: string,
      scope: MemoryScope,
      originProject?: string,
    ) {
      const content = yield* fs.readFileStringSafe(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const json = content ? Option.getOrUndefined(decodeJson(content)) : undefined
      const stored = json === undefined ? undefined : Option.getOrUndefined(decodeFile(json))
      return (stored?.entries ?? []).map((entry) => normalizeEntry(entry, scope, originProject))
    })

    const persist = Effect.fn("RepositoryMemory.persist")(function* (entries: ReadonlyArray<Entry>) {
      const project = entries.filter(
        (entry) =>
          (entry.scope === "project" || entry.scope === "session") &&
          (entry.originProject ?? currentProject) === currentProject,
      )
      const globals = entries.filter(
        (entry) => entry.scope === "global" || entry.scope === "cross-project" || entry.scope === "pattern",
      )
      const projects = entries.filter((entry) => entry.scope === "project")
      yield* Ref.set(state, project)
      shared.entries = globals
      catalogue.entries = projects
      yield* Effect.all(
        [
          fs.writeWithDirs(file, JSON.stringify({ version: VERSION, entries: project }, null, 2)),
          fs.writeWithDirs(globalFile, JSON.stringify({ version: VERSION, entries: globals }, null, 2)),
          fs.writeWithDirs(catalogueFile, JSON.stringify({ version: VERSION, entries: projects }, null, 2)),
        ],
        { concurrency: 3 },
      ).pipe(Effect.catch(() => Effect.void))
    })

    const load = Effect.fn("RepositoryMemory.load")(function* () {
      const project = yield* Ref.get(state)
      const local = project ?? (yield* read(file, "project", currentProject))
      if (!project) yield* Ref.set(state, local)
      const globals = shared.entries ?? (yield* read(globalFile, "global"))
      if (!shared.entries) shared.entries = globals
      const projects = catalogue.entries ?? (yield* read(catalogueFile, "project"))
      const migratedProjects = Array.from(
        new Map(
          [...projects, ...local.filter((entry) => entry.scope === "project")].map(
            (entry) => [entry.id, entry] as const,
          ),
        ).values(),
      )
      if (!sameEntries(projects, migratedProjects))
        yield* fs
          .writeWithDirs(catalogueFile, JSON.stringify({ version: VERSION, entries: migratedProjects }, null, 2))
          .pipe(Effect.catch(() => Effect.void))
      catalogue.entries = migratedProjects
      return Array.from(
        new Map([...migratedProjects, ...local, ...globals].map((entry) => [entry.id, entry] as const)).values(),
      )
    })

    const store = Effect.fn("RepositoryMemory.store")(function* (additions: ReadonlyArray<Entry>) {
      if (additions.length === 0) return
      const snapshot = yield* lock.withPermit(shared.lock.withPermit(catalogue.lock.withPermit(load())))
      const currentModel = semantic
        ? yield* RepositoryEmbeddings.model().pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      const pending = additions.filter((entry) => {
        const previous = snapshot.find((item) => item.id === entry.id)
        return (
          !previous ||
          !sameContent(previous, entry) ||
          (currentModel !== undefined && (!previous.embedding?.length || previous.embeddingModel !== currentModel.id))
        )
      })
      const embedded = currentModel
        ? yield* RepositoryEmbeddings.embed({
            model: currentModel,
            texts: pending.map((entry) => entry.text),
          }).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      const prepared = pending.map((entry, index) => ({
        ...entry,
        ...(embedded ? { embeddingModel: embedded.model, embedding: embedded.vectors[index] } : {}),
      }))
      yield* lock.withPermit(
        shared.lock.withPermit(
          catalogue.lock.withPermit(
            Effect.gen(function* () {
              const current = yield* load()
              const entries = new Map(current.map((entry) => [entry.id, entry]))
              prepared.forEach((entry) => {
                const previous = entries.get(entry.id)
                if (previous && sameEntry(previous, entry)) return
                const merged = mergeEntry(previous, entry)
                entries.set(merged.id, merged)
              })
              const next = compactEntries(Array.from(entries.values()))
              if (sameEntries(current, next)) return
              yield* persist(next)
            }),
          ),
        ),
      )
    })

    const maintain = Effect.fn("RepositoryMemory.maintain")(function* () {
      return yield* lock.withPermit(
        shared.lock.withPermit(
          catalogue.lock.withPermit(
            Effect.gen(function* () {
              const current = yield* load()
              const next = compactEntries(current)
              if (sameEntries(current, next)) return 0
              yield* persist(next)
              return current.length - next.length
            }),
          ),
        ),
      )
    })

    const recordUses = Effect.fn("RepositoryMemory.recordUses")(function* (query: string, uses: Recall["uses"]) {
      if (uses.length === 0) return
      yield* lock.withPermit(
        shared.lock.withPermit(
          catalogue.lock.withPermit(
            Effect.gen(function* () {
              const current = yield* load()
              const recalled = new Map(uses.map((item) => [item.id, item]))
              const now = Date.now()
              const normalized = query.replace(/\s+/g, " ").trim().slice(0, 240)
              const next = current.map((entry) => {
                const use = recalled.get(entry.id)
                if (!use) return entry
                const useCount = (entry.useCount ?? 0) + 1
                const lifecycle =
                  entry.lifecycle === "candidate"
                    ? "verified"
                    : entry.lifecycle === "verified" && useCount >= 3 && (entry.confidence ?? 0) >= 0.8
                      ? "durable"
                      : entry.lifecycle
                return {
                  ...entry,
                  lifecycle,
                  ...(entry.lifecycle === "candidate" ? { verifiedAt: now } : {}),
                  lastUsedAt: now,
                  useCount,
                  lastQuery: normalized,
                  matchReason: use.reason,
                  usage: [
                    ...(entry.usage ?? []),
                    {
                      at: now,
                      query: normalized,
                      reason: use.reason,
                      project: currentProject,
                      classification: use.classification ?? recallClassification(entry, currentProject),
                    },
                  ].slice(-MAX_USAGE_HISTORY),
                }
              })
              if (sameEntries(current, next)) return
              yield* persist(next)
            }),
          ),
        ),
      )
    })

    return Service.of({
      inspect: Effect.fn("RepositoryMemory.inspect")(function* (input) {
        yield* maintain()
        return inspectEntries(
          yield* lock.withPermit(shared.lock.withPermit(catalogue.lock.withPermit(load()))),
          input?.search,
          input?.limit,
        )
      }),
      remove: Effect.fn("RepositoryMemory.remove")(function* (id) {
        return yield* lock.withPermit(
          shared.lock.withPermit(
            catalogue.lock.withPermit(
              Effect.gen(function* () {
                const current = yield* load()
                const entries = current.filter((entry) => entry.id !== id)
                if (entries.length === current.length) return 0
                yield* persist(entries)
                return current.length - entries.length
              }),
            ),
          ),
        )
      }),
      clear: Effect.fn("RepositoryMemory.clear")(function* () {
        return yield* lock.withPermit(
          shared.lock.withPermit(
            catalogue.lock.withPermit(
              Effect.gen(function* () {
                const current = yield* load()
                if (current.length === 0) return 0
                yield* persist([])
                return current.length
              }),
            ),
          ),
        )
      }),
      update: Effect.fn("RepositoryMemory.update")(function* (id, input) {
        return yield* lock.withPermit(
          shared.lock.withPermit(
            catalogue.lock.withPermit(
              Effect.gen(function* () {
                const current = yield* load()
                const target = current.find((entry) => entry.id === id)
                if (!target) return 0
                const now = Date.now()
                const resolved =
                  input.resolve === true && target.status === "conflict" && target.conflictsWith
                    ? current
                        .filter((entry) => entry.id !== target.id && entry.id !== target.conflictsWith)
                        .concat({
                          ...target,
                          id: target.conflictsWith,
                          status: "active" as const,
                          conflictsWith: undefined,
                          conflicts: [],
                          correction: true,
                          lifecycle: "verified" as const,
                          verifiedAt: now,
                          updatedAt: now,
                        })
                    : current.map((entry) =>
                        entry.id === id
                          ? {
                              ...entry,
                              ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
                              ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
                              ...(input.clearExpiration === true ? { expiresAt: undefined } : {}),
                              ...(input.pinned === true ? { expiresAt: undefined } : {}),
                              ...(input.lifecycle !== undefined
                                ? {
                                    lifecycle: input.lifecycle,
                                    ...(input.lifecycle === "verified" || input.lifecycle === "durable"
                                      ? { verifiedAt: target.verifiedAt ?? now }
                                      : {}),
                                  }
                                : {}),
                            }
                          : entry,
                      )
                yield* persist(compactEntries(resolved))
                return 1
              }),
            ),
          ),
        )
      }),
      previewConsolidation: Effect.fn("RepositoryMemory.previewConsolidation")(function* () {
        const entries = yield* lock.withPermit(shared.lock.withPermit(catalogue.lock.withPermit(load())))
        return previewConsolidation(entries)
      }),
      applyConsolidation: Effect.fn("RepositoryMemory.applyConsolidation")(function* (input) {
        return yield* lock.withPermit(
          shared.lock.withPermit(
            catalogue.lock.withPermit(
              Effect.gen(function* () {
                const current = yield* load()
                const preview = previewConsolidation(current, input.generatedAt)
                if (preview.fingerprint !== input.fingerprint)
                  return {
                    applied: false,
                    stale: true,
                    removed: 0,
                    updated: 0,
                    archived: 0,
                    preview: previewConsolidation(current),
                  }
                const result = consolidateEntries(current, preview)
                if (!sameEntries(current, result.entries)) yield* persist(result.entries)
                return { ...result.mutation, preview }
              }),
            ),
          ),
        )
      }),
      maintain,
      recall: Effect.fn("RepositoryMemory.recall")(function* (query, input) {
        yield* maintain()
        const entries = yield* lock.withPermit(shared.lock.withPermit(catalogue.lock.withPermit(load())))
        const lexical = recall(entries, query, Date.now(), { ...input, project: currentProject })
        if (!semantic) {
          yield* recordUses(query, lexical.uses).pipe(Effect.forkIn(scope))
          return lexical
        }
        const currentModel = yield* RepositoryEmbeddings.model().pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (
          !currentModel ||
          !entries.some((entry) => entry.embeddingModel === currentModel.id && entry.embedding?.length)
        ) {
          yield* recordUses(query, lexical.uses).pipe(Effect.forkIn(scope))
          return lexical
        }
        const embedded = yield* RepositoryEmbeddings.embed({ model: currentModel, texts: [query] }).pipe(
          Effect.timeout("2 seconds"),
          Effect.catchCause(() => Effect.succeed(undefined)),
        )
        if (!embedded) {
          yield* recordUses(query, lexical.uses).pipe(Effect.forkIn(scope))
          return lexical
        }
        const result = recallSemantic(entries, lexical, embedded.model, embedded.vectors[0], {
          ...input,
          project: currentProject,
        })
        yield* recordUses(query, result.uses).pipe(Effect.forkIn(scope))
        return result
      }),
      rememberRoute: Effect.fn("RepositoryMemory.rememberRoute")(function* (input) {
        const entry = routeEntry({ ...input, originProject: currentProject })
        if (entry) yield* store([entry])
      }),
      rememberSummary: Effect.fn("RepositoryMemory.rememberSummary")(function* (summary) {
        yield* store(summaryEntries(summary, Date.now(), currentProject))
      }),
      rememberConversation: Effect.fn("RepositoryMemory.rememberConversation")(function* (input) {
        const entry = conversationEntry(
          typeof input === "string"
            ? { text: input, originProject: currentProject }
            : { ...input, originProject: currentProject },
        )
        if (entry) yield* store([entry])
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node, Global.node, Location.node],
})

export function recall(
  entries: ReadonlyArray<Entry>,
  query: string,
  now = Date.now(),
  input?: { readonly sessionID?: string; readonly project?: string },
): Recall {
  const terms = tokenize(query)
  if (terms.length === 0) return { files: [], notes: [], matches: 0, uses: [] }
  const relevant = entries
    .filter((entry) => recallable(entry, now, input?.sessionID))
    .map((entry) => {
      const overlap = terms.filter((term) => entry.terms.includes(term))
      const pathMatches = terms.filter((term) => entry.files.some((file) => searchable(file).includes(term)))
      const exact = searchable(entry.text) === searchable(query)
      const classification = recallClassification(entry, input?.project)
      return {
        entry,
        classification,
        relevant:
          exact ||
          pathMatches.length > 0 ||
          overlap.length >= 2 ||
          overlap.some((term) => Array.from(term).length >= 5),
        score:
          overlap.length * 20 +
          pathMatches.length * 8 +
          (exact ? 100 : 0) +
          (classification === "analogy" ? -12 : 0) +
          Math.max(0, 10 - Math.floor((now - entry.updatedAt) / (1000 * 60 * 60 * 24 * 7))),
      }
    })
    .filter((item) => item.relevant && item.score >= 20)
    .toSorted((left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt)
    .slice(0, 8)
  const ranked = Array.from(new Map(relevant.map((item) => [item.entry.id, item] as const)).values())
    .toSorted((left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt)
    .slice(0, 8)
  const files = Array.from(
    new Set(ranked.filter((item) => item.classification === "fact").flatMap((item) => item.entry.files)),
  ).slice(0, MAX_FILES)
  const notes = ranked
    .filter((item) => item.entry.kind === "summary" || item.entry.kind === "conversation")
    .map((item) => recallText(item.entry, item.classification))
    .filter((note, index, all) => all.indexOf(note) === index)
    .slice(0, MAX_NOTES)
    .reduce<string[]>((result, note) => {
      const used = result.join("\n").length
      if (used >= MAX_NOTE_CHARS) return result
      return [...result, note.slice(0, MAX_NOTE_CHARS - used)]
    }, [])
  return {
    files,
    notes,
    matches: ranked.length,
    memories: ranked.map((item) => ({
      id: item.entry.id,
      text: item.entry.text,
      scope: item.entry.scope ?? "project",
      originProject: item.entry.originProject,
      classification: item.classification,
      reason: "lexical" as const,
    })),
    uses: ranked.map((item) => ({
      id: item.entry.id,
      reason: "lexical" as const,
      ...(item.classification === "analogy" ? { classification: item.classification } : {}),
    })),
  }
}

export function inspectEntries(entries: ReadonlyArray<Entry>, search = "", limit = 200): Snapshot {
  const query = searchable(search.trim())
  const matched = entries
    .filter((entry) =>
      query
        ? searchable(
            [
              entry.id,
              entry.kind,
              entry.text,
              entry.terms.join(" "),
              entry.files.join(" "),
              entry.embeddingModel ?? "",
              entry.category ?? "",
              entry.topic ?? "",
              entry.source ?? "",
              entry.evidence ?? "",
              entry.originProject ?? "",
              entry.scope ?? "",
              entry.scopeID ?? "",
              entry.lifecycle ?? "",
              entry.classification ?? "",
              entry.status ?? "",
              entry.conflictsWith ?? "",
              (entry.conflicts ?? []).join(" "),
              entry.pinned ? "pinned" : "",
              entry.lastQuery ?? "",
              entry.matchReason ?? "",
            ].join(" "),
          ).includes(query)
        : true,
    )
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
  return {
    total: entries.length,
    matched: matched.length,
    entries: matched.slice(0, Math.max(1, Math.min(500, limit))).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      terms: entry.terms,
      files: entry.files,
      updatedAt: entry.updatedAt,
      embeddingModel: entry.embeddingModel,
      dimensions: entry.embedding?.length ?? 0,
      category: entry.category,
      topic: entry.topic,
      confidence: entry.confidence,
      source: entry.source,
      evidence: entry.evidence,
      originProject: entry.originProject,
      scope: entry.scope,
      scopeID: entry.scopeID,
      lifecycle: entry.lifecycle,
      createdAt: entry.createdAt,
      verifiedAt: entry.verifiedAt,
      ttl: entry.ttl,
      classification: entry.classification,
      status: entry.status,
      conflictsWith: entry.conflictsWith,
      conflicts: entry.conflicts,
      pinned: entry.pinned,
      expiresAt: entry.expiresAt,
      lastUsedAt: entry.lastUsedAt,
      useCount: entry.useCount,
      confirmationCount: entry.confirmationCount,
      lastQuery: entry.lastQuery,
      matchReason: entry.matchReason,
      usage: entry.usage,
    })),
  }
}

export function routeEntry(input: {
  readonly query: string
  readonly files: ReadonlyArray<string>
  readonly terms?: ReadonlyArray<string>
  readonly originProject?: string
}): Entry | undefined {
  const text = input.query.replace(/\s+/g, " ").trim().slice(0, 500)
  if (!text || input.files.length === 0) return
  return {
    id: Hash.fast(`route\0${input.originProject ?? ""}\0${searchable(text)}`),
    kind: "route",
    text,
    terms: Array.from(new Set([...tokenize(text), ...(input.terms ?? []).flatMap(tokenize)])).slice(0, 48),
    files: Array.from(new Set(input.files)).slice(0, MAX_FILES),
    updatedAt: Date.now(),
    createdAt: Date.now(),
    verifiedAt: Date.now(),
    confidence: 1,
    source: "route",
    originProject: input.originProject,
    scope: "project",
    lifecycle: "verified",
    classification: "fact",
    status: "active",
    confirmationCount: 1,
  }
}

export function conversationEntry(value: string | ConversationInput, now = Date.now()): Entry | undefined {
  const input = typeof value === "string" ? { text: value } : value
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 500)
  const terms = tokenize(text)
  if (!text || terms.length === 0 || sensitive(text)) return
  const topic = input.topic?.replace(/\s+/g, " ").trim().slice(0, 120)
  const scope = input.scope ?? "project"
  const scopeID = input.scopeID?.replace(/\s+/g, " ").trim().slice(0, 120)
  if (scope === "session" && !scopeID) return
  const source = input.source ?? "manual"
  const confidence = Math.max(0, Math.min(1, input.confidence ?? (source === "classifier" ? 0 : 1)))
  const lifecycle =
    input.lifecycle ??
    (source === "manual" || source === "answer" ? "verified" : confidence >= 0.9 ? "verified" : "candidate")
  const expiresAt =
    input.expiresAt ??
    (input.ttl !== undefined ? now + Math.max(0, input.ttl) : scope === "session" ? now + SESSION_MAX_AGE : undefined)
  return {
    id: Hash.fast(
      `conversation\0${scope}\0${scope === "session" ? `${scopeID}\0` : ""}${
        scope === "project" || scope === "pattern" ? `${input.originProject ?? ""}\0` : ""
      }${topic ? `topic\0${searchable(topic)}` : searchable(text)}`,
    ),
    kind: "conversation",
    text,
    terms,
    files: [],
    updatedAt: now,
    createdAt: now,
    ...(lifecycle === "verified" || lifecycle === "durable" ? { verifiedAt: input.verifiedAt ?? now } : {}),
    ...(input.ttl !== undefined ? { ttl: Math.max(0, input.ttl) } : {}),
    originProject: input.originProject,
    ...(input.category ? { category: input.category } : {}),
    ...(topic ? { topic } : {}),
    confidence,
    source,
    ...(input.evidence ? { evidence: input.evidence } : {}),
    scope,
    ...(scopeID ? { scopeID } : {}),
    lifecycle,
    classification: input.classification ?? (scope === "pattern" ? "analogy" : "fact"),
    status: "active",
    conflicts: [],
    confirmationCount: 1,
    ...(input.correction !== undefined ? { correction: input.correction } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }
}

export function summaryEntries(summary: string, now = Date.now(), originProject?: string): Entry[] {
  const sections = new Set(["## Objective", "## Important Details", "### Completed", "## Relevant Files"])
  const lines = summary.split(/\r?\n/)
  return lines
    .reduce<{ readonly enabled: boolean; readonly entries: Entry[] }>(
      (result, line) => {
        const value = line.trim()
        if (/^#{2,3}\s/.test(value)) return { enabled: sections.has(value), entries: result.entries }
        if (!result.enabled || !/^[-*]\s+/.test(value)) return result
        const text = value
          .replace(/^[-*]\s+/, "")
          .trim()
          .slice(0, 500)
        if (!text || /^\(?none/i.test(text)) return result
        const terms = tokenize(text)
        if (terms.length === 0) return result
        return {
          enabled: true,
          entries: [
            ...result.entries,
            {
              id: Hash.fast(`summary\0${originProject ?? ""}\0${searchable(text)}`),
              kind: "summary",
              text,
              terms,
              files: memoryPaths(text),
              updatedAt: now,
              createdAt: now,
              verifiedAt: now,
              confidence: 0.9,
              source: "compaction",
              originProject,
              scope: "project",
              lifecycle: "verified",
              classification: "fact",
              status: "active",
              conflicts: [],
              confirmationCount: 1,
            },
          ],
        }
      },
      { enabled: false, entries: [] },
    )
    .entries.slice(0, 24)
}

export function recallSemantic(
  entries: ReadonlyArray<Entry>,
  lexical: Recall,
  model: string,
  query: ReadonlyArray<number>,
  input?: { readonly sessionID?: string; readonly project?: string },
  now = Date.now(),
): Recall {
  const ranked = entries
    .filter((entry) => recallable(entry, now, input?.sessionID))
    .flatMap((entry) =>
      entry.embeddingModel === model && entry.embedding?.length
        ? [
            {
              entry,
              score: RepositoryEmbeddings.cosine(entry.embedding, query),
              classification: recallClassification(entry, input?.project),
            },
          ]
        : [],
    )
    .filter((item) => item.score >= 0.25)
    .toSorted(
      (left, right) =>
        right.score -
          Number(right.classification === "analogy") * 0.1 -
          (left.score - Number(left.classification === "analogy") * 0.1) ||
        right.entry.updatedAt - left.entry.updatedAt,
    )
    .slice(0, 8)
  const files = Array.from(
    new Set([
      ...lexical.files,
      ...ranked.filter((item) => item.classification === "fact").flatMap((item) => item.entry.files),
    ]),
  ).slice(0, MAX_FILES)
  const notes = Array.from(
    new Set([
      ...lexical.notes,
      ...ranked
        .filter((item) => item.entry.kind === "summary" || item.entry.kind === "conversation")
        .map((item) => recallText(item.entry, item.classification)),
    ]),
  )
    .slice(0, MAX_NOTES)
    .reduce<string[]>((result, note) => {
      const used = result.join("\n").length
      if (used >= MAX_NOTE_CHARS) return result
      return [...result, note.slice(0, MAX_NOTE_CHARS - used)]
    }, [])
  return {
    files,
    notes,
    matches: Math.max(lexical.matches, ranked.length),
    memories: Array.from(
      new Map([
        ...(lexical.memories ?? []).map((item) => [item.id, item] as const),
        ...ranked.map(
          (item) =>
            [
              item.entry.id,
              {
                id: item.entry.id,
                text: item.entry.text,
                scope: item.entry.scope ?? "project",
                originProject: item.entry.originProject,
                classification: item.classification,
                reason: "semantic" as const,
              },
            ] as const,
        ),
      ]).values(),
    ),
    uses: Array.from(
      new Map([
        ...lexical.uses.map((item) => [item.id, item] as const),
        ...ranked.map(
          (item) =>
            [
              item.entry.id,
              {
                id: item.entry.id,
                reason: "semantic" as const,
                ...(item.classification === "analogy" ? { classification: item.classification } : {}),
              },
            ] as const,
        ),
      ]).values(),
    ),
  }
}

export function mergeEntry(previous: Entry | undefined, entry: Entry) {
  if (!previous) return entry
  if (previous.kind !== "conversation" || entry.kind !== "conversation" || previous.text === entry.text)
    return {
      ...entry,
      createdAt: previous.createdAt ?? entry.createdAt,
      pinned: previous.pinned,
      expiresAt: previous.pinned ? undefined : (entry.expiresAt ?? previous.expiresAt),
      lastUsedAt: previous.lastUsedAt,
      useCount: previous.useCount,
      confirmationCount:
        previous.text === entry.text ? Math.max(1, previous.confirmationCount ?? 1) + 1 : previous.confirmationCount,
      lastQuery: previous.lastQuery,
      matchReason: previous.matchReason,
      usage: previous.usage,
    }
  const confidence = entry.confidence ?? 0
  if (!previous.pinned && (entry.source === "manual" || (entry.correction === true && confidence >= 0.8))) return entry
  return {
    ...entry,
    id: Hash.fast(`conflict\0${previous.id}\0${searchable(entry.text)}`),
    lifecycle: "candidate" as const,
    status: "conflict" as const,
    conflictsWith: previous.id,
    conflicts: Array.from(new Set([...(previous.conflicts ?? []), previous.id])),
  }
}

export function compactEntries(entries: ReadonlyArray<Entry>, now = Date.now()) {
  const unique = new Map<string, Entry>()
  entries
    .map((entry) =>
      entry.expiresAt !== undefined && entry.expiresAt <= now && entry.lifecycle !== "rejected"
        ? { ...entry, lifecycle: "expired" as const, updatedAt: now }
        : entry,
    )
    .filter((entry) => retained(entry, now))
    .forEach((entry) => {
      const previous = unique.get(entry.id)
      if (
        !previous ||
        (entry.pinned && !previous.pinned) ||
        (entry.pinned === previous.pinned && entry.updatedAt > previous.updatedAt)
      )
        unique.set(entry.id, entry)
    })
  const sorted = Array.from(unique.values()).toSorted(
    (left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || right.updatedAt - left.updatedAt,
  )
  const pinned = sorted.filter((entry) => entry.pinned)
  const bounded = Array.from(
    Map.groupBy(
      sorted.filter((entry) => !entry.pinned),
      (entry) =>
        entry.scope === "project" || entry.scope === "session"
          ? `${entry.scope}:${entry.originProject ?? ""}`
          : (entry.scope ?? "project"),
    ).values(),
  ).flatMap((group) => group.slice(0, MAX_ENTRIES))
  return [...pinned, ...bounded].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  )
}

export function previewConsolidation(entries: ReadonlyArray<Entry>, now = Date.now()): ConsolidationPreview {
  const mutable = entries.filter((entry) => !entry.pinned)
  const duplicateActions = Array.from(Map.groupBy(entries, consolidationDuplicateKey).values()).flatMap((group) => {
    if (group.length < 2) return []
    const canonical = group.toSorted(consolidationRank)[0]
    const duplicates = group.filter((entry) => entry.id !== canonical.id && !entry.pinned)
    if (duplicates.length === 0) return []
    const beforeConfidence = canonical.confidence
    return [
      {
        type: "merge_duplicate" as const,
        id: canonical.id,
        relatedIDs: duplicates.map((entry) => entry.id).toSorted(),
        reason: "Equivalent records share the same normalized content and memory boundary.",
        beforeConfidence,
        afterConfidence: Math.min(1, (beforeConfidence ?? 0.5) + Math.min(0.2, duplicates.length * 0.05)),
      },
    ]
  })
  const duplicateIDs = new Set(duplicateActions.flatMap((action) => action.relatedIDs))
  const conflictActions = mutable
    .filter((entry) => entry.status === "conflict" && !duplicateIDs.has(entry.id))
    .map((entry): ConsolidationAction => {
      const base = entries.find((item) => item.id === entry.conflictsWith)
      if (!base)
        return {
          type: "resolve_conflict",
          id: entry.id,
          relatedIDs: [],
          winnerID: entry.id,
          reason: "The conflict target no longer exists, so the surviving record becomes active.",
        }
      const difference = consolidationScore(entry) - consolidationScore(base)
      if (Math.abs(difference) < 0.05)
        return {
          type: "unresolved_conflict",
          id: entry.id,
          relatedIDs: [base.id],
          reason: "The available provenance is not strong enough to choose a winner safely.",
        }
      return {
        type: "resolve_conflict",
        id: entry.id,
        relatedIDs: [base.id],
        winnerID: difference > 0 ? entry.id : base.id,
        reason: "The winner has stronger verified provenance, confidence, recency, and confirmation evidence.",
      }
    })
  const occupied = new Set([
    ...duplicateActions.flatMap((action) => [action.id, ...action.relatedIDs]),
    ...conflictActions.flatMap((action) => [action.id, ...action.relatedIDs]),
  ])
  const confidenceActions = mutable
    .filter(
      (entry) =>
        !occupied.has(entry.id) &&
        entry.status !== "conflict" &&
        entry.lifecycle !== "rejected" &&
        entry.lifecycle !== "expired" &&
        entry.lifecycle !== "archived",
    )
    .flatMap((entry): ReadonlyArray<ConsolidationAction> => {
      const confirmations = entry.confirmationCount ?? 1
      if (
        confirmations >= 2 &&
        (entry.lifecycle === "verified" || entry.lifecycle === "durable") &&
        (entry.scope === "cross-project" || entry.scope === "pattern")
      ) {
        const beforeConfidence = entry.confidence ?? 0.5
        const afterConfidence = Math.min(1, beforeConfidence + Math.min(0.2, (confirmations - 1) * 0.05))
        if (afterConfidence > beforeConfidence)
          return [
            {
              type: "increase_confidence",
              id: entry.id,
              relatedIDs: [],
              reason: "The reusable record was independently confirmed more than once.",
              beforeConfidence,
              afterConfidence,
            },
          ]
      }
      const lastEvidenceAt = Math.max(entry.verifiedAt ?? 0, entry.lastUsedAt ?? 0, entry.updatedAt)
      if (
        entry.classification === "fact" &&
        entry.lifecycle !== "durable" &&
        now - lastEvidenceAt >= CONSOLIDATION_STALE_AGE
      ) {
        const beforeConfidence = entry.confidence ?? 0.5
        const afterConfidence = Math.max(0.2, beforeConfidence - 0.1)
        if (afterConfidence < beforeConfidence)
          return [
            {
              type: "decrease_confidence",
              id: entry.id,
              relatedIDs: [],
              reason: "The fact has not been verified or recalled within the staleness window.",
              beforeConfidence,
              afterConfidence,
            },
          ]
      }
      if (
        entry.lifecycle !== "durable" &&
        (entry.useCount ?? 0) === 0 &&
        now - Math.max(entry.createdAt ?? entry.updatedAt, entry.updatedAt) >= CONSOLIDATION_STALE_AGE
      )
        return [
          {
            type: "archive_unused",
            id: entry.id,
            relatedIDs: [],
            reason: "The record is old, unpinned, non-durable, and has never been recalled.",
          },
        ]
      return []
    })
  const actions = [...duplicateActions, ...conflictActions, ...confidenceActions].toSorted(
    (left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id),
  )
  const state = entries
    .map((entry) => ({
      id: entry.id,
      text: entry.text,
      updatedAt: entry.updatedAt,
      confidence: entry.confidence,
      lifecycle: entry.lifecycle,
      status: entry.status,
      pinned: entry.pinned,
      confirmationCount: entry.confirmationCount,
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id))
  return {
    fingerprint: Hash.fast(JSON.stringify({ state, actions })),
    generatedAt: now,
    total: entries.length,
    protected: entries.filter((entry) => entry.pinned).length,
    actionable: actions.filter((action) => action.type !== "unresolved_conflict").length,
    unresolved: actions.filter((action) => action.type === "unresolved_conflict").length,
    actions,
  }
}

export function consolidateEntries(entries: ReadonlyArray<Entry>, preview: ConsolidationPreview) {
  const removed = new Set(
    preview.actions.filter((action) => action.type === "merge_duplicate").flatMap((action) => action.relatedIDs),
  )
  const byID = new Map(entries.filter((entry) => !removed.has(entry.id)).map((entry) => [entry.id, entry]))
  preview.actions.forEach((action) => {
    if (action.type === "unresolved_conflict") return
    const target = byID.get(action.id)
    if (!target || target.pinned) return
    if (action.type === "merge_duplicate") {
      byID.set(action.id, {
        ...target,
        confidence: action.afterConfidence,
        confirmationCount: (target.confirmationCount ?? 1) + action.relatedIDs.length,
        updatedAt: preview.generatedAt,
      })
      return
    }
    if (action.type === "resolve_conflict") {
      ;[action.id, ...action.relatedIDs].forEach((id) => {
        const entry = byID.get(id)
        if (!entry || entry.pinned) return
        byID.set(
          id,
          id === action.winnerID
            ? {
                ...entry,
                status: "active",
                conflictsWith: undefined,
                conflicts: [],
                lifecycle: entry.lifecycle === "candidate" ? "verified" : entry.lifecycle,
                verifiedAt: entry.verifiedAt ?? preview.generatedAt,
                updatedAt: preview.generatedAt,
              }
            : { ...entry, lifecycle: "rejected", updatedAt: preview.generatedAt },
        )
      })
      return
    }
    if (action.type === "archive_unused") {
      byID.set(action.id, { ...target, lifecycle: "archived", updatedAt: preview.generatedAt })
      return
    }
    byID.set(action.id, { ...target, confidence: action.afterConfidence, updatedAt: preview.generatedAt })
  })
  return {
    entries: compactEntries(Array.from(byID.values()), preview.generatedAt),
    mutation: {
      applied: true,
      stale: false,
      removed: removed.size,
      updated: preview.actions.filter(
        (action) =>
          action.type === "resolve_conflict" ||
          action.type === "decrease_confidence" ||
          action.type === "increase_confidence",
      ).length,
      archived: preview.actions.filter((action) => action.type === "archive_unused").length,
    },
  }
}

function consolidationDuplicateKey(entry: Entry) {
  return [
    entry.kind,
    entry.scope ?? "project",
    entry.scopeID ?? "",
    entry.originProject ?? "",
    entry.category ?? "",
    entry.classification ?? "fact",
    entry.status ?? "active",
    searchable(entry.text).replace(/\s+/g, " ").trim(),
  ].join("\0")
}

function consolidationRank(left: Entry, right: Entry) {
  return (
    Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
    consolidationScore(right) - consolidationScore(left) ||
    left.id.localeCompare(right.id)
  )
}

function consolidationScore(entry: Entry) {
  return (
    (entry.confidence ?? 0.5) +
    Number(entry.lifecycle === "durable") * 0.3 +
    Number(entry.lifecycle === "verified") * 0.15 +
    Math.min(0.2, (entry.confirmationCount ?? 1) * 0.05) +
    Math.min(0.1, (entry.useCount ?? 0) * 0.01)
  )
}

function alive(entry: Entry, now = Date.now()) {
  if (entry.lifecycle === "rejected" || entry.lifecycle === "expired" || entry.lifecycle === "archived") return false
  if (entry.expiresAt !== undefined && entry.expiresAt <= now) return false
  if (entry.pinned || entry.lifecycle === "durable") return true
  const age = now - entry.updatedAt
  if (entry.status === "conflict") return age <= 1000 * 60 * 60 * 24 * 30
  return age <= (entry.scope === "session" ? SESSION_MAX_AGE : MAX_AGE)
}

function recallable(entry: Entry, now: number, sessionID: string | undefined) {
  if (!alive(entry, now) || (entry.status ?? "active") !== "active") return false
  if ((entry.lifecycle ?? "verified") !== "verified" && entry.lifecycle !== "durable") return false
  if (entry.scope !== "session") return true
  return sessionID !== undefined && entry.scopeID === sessionID
}

function retained(entry: Entry, now: number) {
  if (entry.pinned) return true
  if (entry.lifecycle === "archived") return now - entry.updatedAt <= ARCHIVED_RETENTION
  if (entry.lifecycle === "rejected" || entry.lifecycle === "expired") return now - entry.updatedAt <= EXPIRED_RETENTION
  return true
}

function recallClassification(entry: Entry, project: string | undefined): MemoryClassification {
  if (entry.scope === "pattern" || entry.classification === "analogy") return "analogy"
  if (entry.scope === "project" && project !== undefined && entry.originProject !== project) return "analogy"
  return "fact"
}

function recallText(entry: Entry, classification: MemoryClassification) {
  if (classification === "fact") return entry.text
  return `[analogy from ${entry.originProject ?? "another project"}] ${entry.text}`
}

function normalizeEntry(entry: Entry, scope: MemoryScope, originProject?: string): Entry {
  const normalizedScope = entry.scope ?? scope
  const lifecycle =
    entry.lifecycle ??
    (entry.status === "conflict" ? "candidate" : entry.pinned || (entry.useCount ?? 0) >= 3 ? "durable" : "verified")
  return {
    ...entry,
    scope: normalizedScope,
    status: entry.status ?? "active",
    lifecycle,
    createdAt: entry.createdAt ?? entry.updatedAt,
    verifiedAt: entry.verifiedAt ?? (lifecycle === "verified" || lifecycle === "durable" ? entry.updatedAt : undefined),
    originProject:
      entry.originProject ??
      (normalizedScope === "project" || normalizedScope === "session" || normalizedScope === "pattern"
        ? originProject
        : undefined),
    classification: entry.classification ?? (normalizedScope === "pattern" ? "analogy" : "fact"),
    conflicts: entry.conflicts ?? (entry.conflictsWith ? [entry.conflictsWith] : []),
    usage: entry.usage ?? [],
    confirmationCount: entry.confirmationCount ?? 1,
  }
}

function sensitive(value: string) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return true
  if (/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/.test(value)) return true
  if (/\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(value)) return true
  return (value.match(/\b[A-Za-z0-9_+/=-]{40,}\b/g) ?? []).some((token) => /[A-Za-z]/.test(token) && /\d/.test(token))
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      (value.match(/[\p{L}\p{N}_$./-]+/gu) ?? [])
        .flatMap((token) => token.split(/[./_-]+/))
        .map(searchable)
        .filter((token) => token.length >= 3),
    ),
  ).slice(0, 64)
}

function searchable(value: string) {
  return value
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .toLocaleLowerCase()
    .replaceAll("\\", "/")
}

function memoryPaths(value: string) {
  return Array.from(
    new Set(
      value.match(
        /(?:(?:[A-Za-z]:[\\/]|\/|(?:\.{1,2}[\\/])?)(?:[\p{L}\p{N}_.@*+-]+[\\/])+[\p{L}\p{N}_.@*+-]+|[\p{L}\p{N}_@+-]+\.[\p{L}\p{N}_.@*+-]+)/gu,
      ) ?? [],
    ),
  )
    .map((file) => file.replaceAll("\\", "/").replace(/[.,;:!?]+$/u, ""))
    .filter(Boolean)
    .slice(0, MAX_FILES)
}

function sameEntry(left: Entry, right: Entry) {
  return (
    sameContent(left, right) &&
    left.embeddingModel === right.embeddingModel &&
    (left.embedding ?? []).join("\0") === (right.embedding ?? []).join("\0")
  )
}

function sameContent(left: Entry, right: Entry) {
  return (
    left.kind === right.kind &&
    left.text === right.text &&
    left.terms.join("\0") === right.terms.join("\0") &&
    left.files.join("\0") === right.files.join("\0") &&
    left.category === right.category &&
    left.topic === right.topic &&
    left.confidence === right.confidence &&
    left.source === right.source &&
    left.evidence === right.evidence &&
    left.originProject === right.originProject &&
    left.scope === right.scope &&
    left.scopeID === right.scopeID &&
    left.lifecycle === right.lifecycle &&
    left.createdAt === right.createdAt &&
    left.verifiedAt === right.verifiedAt &&
    left.ttl === right.ttl &&
    left.classification === right.classification &&
    left.status === right.status &&
    left.conflictsWith === right.conflictsWith &&
    (left.conflicts ?? []).join("\0") === (right.conflicts ?? []).join("\0") &&
    left.correction === right.correction &&
    left.pinned === right.pinned &&
    left.expiresAt === right.expiresAt &&
    left.lastUsedAt === right.lastUsedAt &&
    left.useCount === right.useCount &&
    left.confirmationCount === right.confirmationCount &&
    left.lastQuery === right.lastQuery &&
    left.matchReason === right.matchReason &&
    JSON.stringify(left.usage ?? []) === JSON.stringify(right.usage ?? [])
  )
}

function sameEntries(left: ReadonlyArray<Entry>, right: ReadonlyArray<Entry>) {
  if (left.length !== right.length) return false
  const entries = new Map(right.map((entry) => [entry.id, entry]))
  return left.every((entry) => {
    const match = entries.get(entry.id)
    return match !== undefined && sameEntry(entry, match)
  })
}
