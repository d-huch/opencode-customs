export * as RepositoryRetrievalFeedback from "./repository-retrieval-feedback"

import path from "path"
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { Hash } from "./util/hash"

const VERSION = 1
const MAX_ENTRIES = 100

export const Stage = Schema.Literals([
  "attachment",
  "exact",
  "lexical",
  "concept",
  "embedding",
  "lsp",
  "graph",
  "memory",
  "analogy",
])
export type Stage = typeof Stage.Type

export const Classification = Schema.Literals(["fact", "assumption", "analogy"])
export type Classification = typeof Classification.Type

export const Reason = Schema.Struct({
  stage: Stage,
  detail: Schema.String,
  weight: Schema.Number,
})
export type Reason = typeof Reason.Type

export const File = Schema.Struct({
  path: Schema.String,
  score: Schema.Number,
  confidence: Schema.Number,
  classification: Classification,
  reasons: Schema.Array(Reason),
  used: Schema.optional(Schema.Boolean),
  rejected: Schema.optional(Schema.Boolean),
})
export type File = typeof File.Type

const StoredEntry = Schema.Struct({
  id: Schema.String,
  query: Schema.String,
  files: Schema.Array(File),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  recallAt5: Schema.optional(Schema.Number),
  recallAt10: Schema.optional(Schema.Number),
})

const StoredFile = Schema.Struct({
  version: Schema.Literal(VERSION),
  entries: Schema.Array(StoredEntry),
})

export type Entry = typeof StoredEntry.Type

export type Hint = {
  readonly positive: ReadonlyArray<string>
  readonly negative: ReadonlyArray<string>
}

export type Feedback = {
  readonly path: string
  readonly relevance: "used" | "rejected" | "clear"
}

export type Snapshot = {
  readonly total: number
  readonly matched: number
  readonly recallAt5?: number
  readonly recallAt10?: number
  readonly entries: ReadonlyArray<Entry>
}

export interface Interface {
  readonly record: (input: { readonly query: string; readonly files: ReadonlyArray<File> }) => Effect.Effect<Entry>
  readonly feedback: (id: string, input: Feedback) => Effect.Effect<number>
  readonly recall: (query: string) => Effect.Effect<Hint>
  readonly inspect: (input?: { readonly search?: string; readonly limit?: number }) => Effect.Effect<Snapshot>
  readonly clear: () => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RepositoryRetrievalFeedback") {}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeFile = Schema.decodeUnknownOption(StoredFile)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const file = path.join(global.cache, "repository-retrieval", `${Hash.fast(location.directory)}.json`)
    const state = yield* Ref.make<ReadonlyArray<Entry> | undefined>(undefined)
    const lock = Semaphore.makeUnsafe(1)

    const load = Effect.fn("RepositoryRetrievalFeedback.load")(function* () {
      const cached = yield* Ref.get(state)
      if (cached) return cached
      const content = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const json = content ? Option.getOrUndefined(decodeJson(content)) : undefined
      const stored = json === undefined ? undefined : Option.getOrUndefined(decodeFile(json))
      const entries = stored?.entries ?? []
      yield* Ref.set(state, entries)
      return entries
    })

    const persist = Effect.fn("RepositoryRetrievalFeedback.persist")(function* (entries: ReadonlyArray<Entry>) {
      const next = entries
        .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
        .slice(0, MAX_ENTRIES)
      yield* Ref.set(state, next)
      yield* fs
        .writeWithDirs(file, JSON.stringify({ version: VERSION, entries: next }, null, 2))
        .pipe(Effect.catch(() => Effect.void))
      return next
    })

    return Service.of({
      record: Effect.fn("RepositoryRetrievalFeedback.record")(function* (input) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const now = Date.now()
            const query = input.query.replace(/\s+/g, " ").trim().slice(0, 500)
            const id = Hash.fast(`${query}\0${now}\0${input.files.map((item) => item.path).join("\0")}`)
            const entry: Entry = {
              id,
              query,
              files: input.files,
              createdAt: now,
              updatedAt: now,
            }
            yield* persist([entry, ...(yield* load())])
            return entry
          }),
        )
      }),
      feedback: Effect.fn("RepositoryRetrievalFeedback.feedback")(function* (id, input) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const current = yield* load()
            const target = current.find((entry) => entry.id === id)
            if (!target) return 0
            const files = target.files.map((file) => {
              if (file.path !== input.path) return file
              if (input.relevance === "clear") return { ...file, used: undefined, rejected: undefined }
              if (input.relevance === "used") return { ...file, used: true, rejected: false }
              return { ...file, used: false, rejected: true }
            })
            const relevant = files.filter((file) => file.used).map((file) => file.path)
            const recall = (limit: number) =>
              relevant.length
                ? relevant.filter((file) => files.slice(0, limit).some((selected) => selected.path === file)).length /
                  relevant.length
                : undefined
            yield* persist(
              current.map((entry) =>
                entry.id === id
                  ? {
                      ...entry,
                      files,
                      updatedAt: Date.now(),
                      recallAt5: recall(5),
                      recallAt10: recall(10),
                    }
                  : entry,
              ),
            )
            return 1
          }),
        )
      }),
      recall: Effect.fn("RepositoryRetrievalFeedback.recall")(function* (query) {
        const terms = tokenize(query)
        if (terms.length === 0) return { positive: [], negative: [] }
        const matches = (yield* lock.withPermit(load()))
          .map((entry) => ({
            entry,
            overlap: terms.filter((term) => tokenize(entry.query).includes(term)).length,
          }))
          .filter((item) => item.overlap > 0)
          .toSorted(
            (left, right) =>
              right.overlap - left.overlap ||
              right.entry.updatedAt - left.entry.updatedAt ||
              left.entry.id.localeCompare(right.entry.id),
          )
          .slice(0, 12)
        return {
          positive: Array.from(
            new Set(matches.flatMap((item) => item.entry.files.filter((file) => file.used).map((file) => file.path))),
          ),
          negative: Array.from(
            new Set(matches.flatMap((item) => item.entry.files.filter((file) => file.rejected).map((file) => file.path))),
          ),
        }
      }),
      inspect: Effect.fn("RepositoryRetrievalFeedback.inspect")(function* (input) {
        const entries = yield* lock.withPermit(load())
        const query = input?.search?.trim().toLocaleLowerCase() ?? ""
        const matched = entries.filter((entry) =>
          query
            ? `${entry.id} ${entry.query} ${entry.files.map((file) => file.path).join(" ")}`
                .toLocaleLowerCase()
                .includes(query)
            : true,
        )
        const values = matched
          .map((entry) => ({
            ...entry,
            files: entry.files.map((file) => ({
              ...file,
              reasons: file.reasons.toSorted(
                (left, right) => right.weight - left.weight || left.stage.localeCompare(right.stage),
              ),
            })),
          }))
          .slice(0, Math.max(1, Math.min(500, input?.limit ?? 200)))
        const withRecall5 = entries.flatMap((entry) =>
          entry.recallAt5 === undefined ? [] : [entry.recallAt5],
        )
        const withRecall10 = entries.flatMap((entry) =>
          entry.recallAt10 === undefined ? [] : [entry.recallAt10],
        )
        return {
          total: entries.length,
          matched: matched.length,
          recallAt5: average(withRecall5),
          recallAt10: average(withRecall10),
          entries: values,
        }
      }),
      clear: Effect.fn("RepositoryRetrievalFeedback.clear")(function* () {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const current = yield* load()
            if (current.length === 0) return 0
            yield* persist([])
            return current.length
          }),
        )
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Location.node],
})

function tokenize(value: string) {
  return Array.from(
    new Set(
      (value.match(/[\p{L}\p{N}_$./-]+/gu) ?? [])
        .flatMap((token) => token.split(/[./_-]+/))
        .map((token) => token.toLocaleLowerCase())
        .filter((token) => token.length > 1),
    ),
  )
}

function average(values: ReadonlyArray<number>) {
  if (values.length === 0) return undefined
  return values.reduce((total, value) => total + value, 0) / values.length
}
