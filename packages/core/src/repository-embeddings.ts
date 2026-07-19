export * as RepositoryEmbeddings from "./repository-embeddings"

import path from "path"
import { Context, Effect, Layer, Option, Ref, Schema, Scope, Semaphore, Stream } from "effect"
import { Config } from "./config"
import { EventV2 } from "./event"
import { makeLocationNode } from "./effect/app-node"
import { Watcher } from "./filesystem/watcher"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { Ripgrep } from "./ripgrep"
import { Hash } from "./util/hash"

const VERSION = 1
const DEFAULT_MAX_FILES = 256
const DEFAULT_MAX_CHUNKS = 1_024
const DEFAULT_TOP_K = 6
const MAX_FILE_BYTES = 192 * 1024
const MAX_CHUNK_CHARS = 1_600
const MAX_CHUNKS_PER_FILE = 12
const MAX_VECTOR_DIMENSIONS = 4_096

export type Model = {
  readonly id: string
  readonly name?: string
}

export type Provider = {
  readonly model: (preferred?: string) => Effect.Effect<Model | undefined, unknown>
  readonly embed: (input: {
    readonly model: Model
    readonly texts: ReadonlyArray<string>
  }) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, unknown>
}

const providers: Provider[] = []
const vectorCache = new Map<string, { readonly time: number; readonly vector: ReadonlyArray<number> }>()

export function register(provider: Provider) {
  providers.push(provider)
  return () => {
    const index = providers.lastIndexOf(provider)
    if (index !== -1) providers.splice(index, 1)
  }
}

export function available() {
  return providers.length > 0
}

export function model(preferred?: string) {
  const provider = providers.at(-1)
  return provider
    ? provider.model(preferred).pipe(Effect.catch(() => Effect.succeed(undefined)))
    : Effect.succeed(undefined)
}

export function embed(input: { readonly model: Model; readonly texts: ReadonlyArray<string> }) {
  const provider = providers.at(-1)
  if (!provider || input.texts.length === 0) return Effect.succeed(undefined)
  const keys = input.texts.map((text) => `${input.model.id}\0${Hash.fast(text)}`)
  const cached = keys.map((key) => {
    const item = vectorCache.get(key)
    return item && Date.now() - item.time < 30_000 ? item.vector : undefined
  })
  if (cached.every((vector) => vector !== undefined)) return Effect.succeed({ model: input.model.id, vectors: cached })
  return provider.embed(input).pipe(
    Effect.map((vectors) => {
      if (vectors.length !== input.texts.length) return undefined
      const normalized = vectors.map((vector) =>
        vector.slice(0, MAX_VECTOR_DIMENSIONS).map(Number).filter(Number.isFinite),
      )
      if (normalized.some((vector) => vector.length === 0 || vector.length !== normalized[0]?.length)) return undefined
      normalized.forEach((vector, index) => vectorCache.set(keys[index], { time: Date.now(), vector }))
      if (vectorCache.size > 64)
        Array.from(vectorCache.keys())
          .slice(0, vectorCache.size - 64)
          .forEach((key) => vectorCache.delete(key))
      return { model: input.model.id, vectors: normalized }
    }),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

const StoredEntry = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  fileHash: Schema.String,
  vector: Schema.Array(Schema.Number),
  updatedAt: Schema.Number,
})

const StoredFile = Schema.Struct({
  version: Schema.Literal(VERSION),
  model: Schema.String,
  entries: Schema.Array(StoredEntry),
})

export type Entry = typeof StoredEntry.Type

export type InspectEntry = Omit<Entry, "vector"> & {
  readonly dimensions: number
}

export type Snapshot = {
  readonly model?: string
  readonly total: number
  readonly matched: number
  readonly files: number
  readonly entries: ReadonlyArray<InspectEntry>
}

export type Match = {
  readonly path: string
  readonly start: number
  readonly end: number
  readonly score: number
}

export type Search = {
  readonly model?: string
  readonly matches: ReadonlyArray<Match>
  readonly indexedFiles: number
  readonly indexedChunks: number
}

export interface Interface {
  readonly search: (query: string) => Effect.Effect<Search>
  readonly inspect: (input?: { readonly search?: string; readonly limit?: number }) => Effect.Effect<Snapshot>
  readonly remove: (id: string) => Effect.Effect<number>
  readonly clear: () => Effect.Effect<number>
  readonly index: (files: ReadonlyArray<string>) => Effect.Effect<void>
  readonly refresh: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RepositoryEmbeddings") {}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeFile = Schema.decodeUnknownOption(StoredFile)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const ripgrep = yield* Ripgrep.Service
    const scope = yield* Scope.Scope
    const settings = Config.latest(yield* config.entries(), "rag")
    const maxFiles = clamp(settings?.max_files ?? DEFAULT_MAX_FILES, 16, 2_000)
    const maxChunks = clamp(settings?.max_chunks ?? DEFAULT_MAX_CHUNKS, 32, 8_000)
    const topK = clamp(settings?.top_k ?? DEFAULT_TOP_K, 1, 12)
    const file = path.join(global.cache, "repository-embeddings", `${Hash.fast(location.directory)}.json`)
    const state = yield* Ref.make<{ readonly model: string; readonly entries: ReadonlyArray<Entry> } | undefined>(
      undefined,
    )
    const queue = yield* Ref.make<{ readonly files: ReadonlySet<string>; readonly running: boolean }>({
      files: new Set(),
      running: false,
    })
    const started = yield* Ref.make(false)
    const lock = Semaphore.makeUnsafe(1)

    const resolveModel = () =>
      settings?.embeddings === false
        ? Effect.succeed(undefined)
        : model(settings?.model).pipe(Effect.catch(() => Effect.succeed(undefined)))

    const readStored = Effect.fn("RepositoryEmbeddings.readStored")(function* () {
      const content = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const json = content ? Option.getOrUndefined(decodeJson(content)) : undefined
      return json === undefined ? undefined : Option.getOrUndefined(decodeFile(json))
    })

    const load = Effect.fn("RepositoryEmbeddings.load")(function* (current: Model) {
      const cached = yield* Ref.get(state)
      if (cached?.model === current.id) return cached
      const stored = yield* readStored()
      const next = {
        model: current.id,
        entries: stored?.model === current.id ? stored.entries.slice(0, maxChunks) : [],
      }
      yield* Ref.set(state, next)
      return next
    })

    const inspectState = Effect.fn("RepositoryEmbeddings.inspectState")(function* () {
      const cached = yield* Ref.get(state)
      if (cached) return cached
      const stored = yield* readStored()
      if (!stored) return undefined
      const next = { model: stored.model, entries: stored.entries.slice(0, maxChunks) }
      yield* Ref.set(state, next)
      return next
    })

    const persist = (current: { readonly model: string; readonly entries: ReadonlyArray<Entry> }) =>
      fs
        .writeWithDirs(file, JSON.stringify({ version: VERSION, model: current.model, entries: current.entries }))
        .pipe(Effect.catch(() => Effect.void))

    const indexFile = Effect.fn("RepositoryEmbeddings.indexFile")(function* (
      current: Model,
      target: string,
      existing: ReadonlyArray<Entry>,
    ) {
      const relative = normalize(target)
      if (!indexable(relative)) return []
      const absolute = path.join(location.directory, relative)
      const info = yield* fs.stat(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!info || info.type !== "File" || Number(info.size) > MAX_FILE_BYTES) return []
      const content = yield* fs.readFileStringSafe(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!content || content.includes("\0")) return []
      const fileHash = Hash.fast(content)
      const retained = existing.filter((entry) => entry.path === relative)
      if (retained.length && retained.every((entry) => entry.fileHash === fileHash)) return retained
      const pieces = chunks(relative, content).slice(0, MAX_CHUNKS_PER_FILE)
      const result = yield* embed({ model: current, texts: pieces.map((piece) => piece.text) }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!result) return undefined
      return pieces.map((piece, index) => ({
        id: Hash.fast(`${relative}\0${piece.start}\0${piece.end}\0${fileHash}`),
        path: relative,
        start: piece.start,
        end: piece.end,
        fileHash,
        vector: result.vectors[index],
        updatedAt: Date.now(),
      })) satisfies Entry[]
    })

    const drain = Effect.fn("RepositoryEmbeddings.drain")(function* () {
      while (true) {
        const pending = yield* Ref.modify(queue, (current) => {
          if (current.files.size === 0) return [undefined, { files: new Set<string>(), running: false }]
          return [Array.from(current.files), { files: new Set<string>(), running: true }]
        })
        if (!pending) return
        const currentModel = yield* resolveModel()
        if (!currentModel) {
          yield* Ref.update(queue, (current) => ({ files: new Set([...pending, ...current.files]), running: false }))
          return
        }
        const snapshot = yield* lock.withPermit(load(currentModel))
        const indexed = yield* Effect.forEach(
          pending.slice(0, maxFiles),
          (target) => indexFile(currentModel, target, snapshot.entries),
          { concurrency: 1 },
        )
        yield* lock.withPermit(
          Effect.gen(function* () {
            const current = yield* load(currentModel)
            const changed = indexed.reduce<ReadonlyArray<Entry>>((entries, next, index) => {
              if (next === undefined) return entries
              const target = normalize(pending[index])
              return [...entries.filter((entry) => entry.path !== target), ...next]
            }, current.entries)
            const entries = trim(changed, maxFiles, maxChunks)
            const next = { model: currentModel.id, entries }
            yield* Ref.set(state, next)
            yield* persist(next)
          }),
        )
      }
    })

    const schedule = Effect.fn("RepositoryEmbeddings.schedule")(function* (files: ReadonlyArray<string>) {
      if (settings?.embeddings === false || files.length === 0 || !available()) return
      const start = yield* Ref.modify(queue, (current) => [
        !current.running,
        {
          files: new Set([...current.files, ...files.map(normalize).filter(indexable)].slice(0, maxFiles)),
          running: true,
        },
      ])
      if (!start) return
      yield* drain().pipe(Effect.forkIn(scope, { startImmediately: true }))
    })

    const discover = Effect.fn("RepositoryEmbeddings.discover")(function* () {
      const first = yield* Ref.modify(started, (current) => [!current, true])
      if (!first) return
      const found = yield* ripgrep
        .find({ cwd: location.directory, pattern: "*", limit: maxFiles * 8 })
        .pipe(Effect.catch(() => Effect.succeed([])))
      yield* schedule(balanced(found.map((entry) => String(entry.path)).filter(indexable), maxFiles))
    })

    const remove = Effect.fn("RepositoryEmbeddings.remove")(function* (target: string) {
      const current = yield* Ref.get(state)
      if (!current) return
      const entries = current.entries.filter((entry) => entry.path !== normalize(target))
      if (entries.length === current.entries.length) return
      const next = { ...current, entries }
      yield* Ref.set(state, next)
      yield* persist(next)
    })

    const search = Effect.fn("RepositoryEmbeddings.search")(function* (query: string) {
      yield* discover().pipe(Effect.forkIn(scope))
      const currentModel = yield* resolveModel()
      if (!currentModel) return { matches: [], indexedFiles: 0, indexedChunks: 0 }
      const current = yield* lock.withPermit(load(currentModel))
      const indexedFiles = new Set(current.entries.map((entry) => entry.path)).size
      if (!query.trim() || current.entries.length === 0)
        return { model: currentModel.id, matches: [], indexedFiles, indexedChunks: current.entries.length }
      const result = yield* embed({ model: currentModel, texts: [query.trim().slice(0, 2_000)] }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const matches = result ? rank(current.entries, result.vectors[0], topK) : []
      return { model: currentModel.id, matches, indexedFiles, indexedChunks: current.entries.length }
    })

    yield* events.subscribe(Watcher.Event.Updated).pipe(
      Stream.runForEach((event) => {
        const relative = path.relative(location.directory, path.resolve(event.data.file))
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return Effect.void
        if (event.data.event === "unlink") return remove(relative)
        return schedule([relative])
      }),
      Effect.catchCause((cause) => Effect.logWarning("repository embedding watcher stopped", { cause })),
      Effect.forkScoped,
    )

    yield* discover().pipe(Effect.delay("1 second"), Effect.forkIn(scope))

    return Service.of({
      inspect: Effect.fn("RepositoryEmbeddings.inspect")(function* (input) {
        const current = yield* lock.withPermit(inspectState())
        return inspectEntries(current?.model, current?.entries ?? [], input?.search, input?.limit)
      }),
      remove: Effect.fn("RepositoryEmbeddings.removeEntry")(function* (id) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const current = yield* inspectState()
            if (!current) return 0
            const entries = current.entries.filter((entry) => entry.id !== id)
            if (entries.length === current.entries.length) return 0
            const next = { ...current, entries }
            yield* Ref.set(state, next)
            yield* persist(next)
            return current.entries.length - entries.length
          }),
        )
      }),
      clear: Effect.fn("RepositoryEmbeddings.clear")(function* () {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const current = yield* inspectState()
            if (!current || current.entries.length === 0) return 0
            const next = { ...current, entries: [] }
            yield* Ref.set(state, next)
            yield* persist(next)
            return current.entries.length
          }),
        )
      }),
      search,
      index: schedule,
      refresh: Effect.fn("RepositoryEmbeddings.refresh")(function* () {
        yield* Ref.set(started, false)
        yield* discover()
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, EventV2.node, FSUtil.node, Global.node, Location.node, Ripgrep.node],
})

export function chunks(file: string, content: string) {
  const lines = content.split(/\r?\n/)
  const result: Array<{ readonly start: number; readonly end: number; readonly text: string }> = []
  for (let start = 0; start < lines.length && result.length < MAX_CHUNKS_PER_FILE; ) {
    const selected: string[] = []
    let end = start
    while (end < lines.length && selected.join("\n").length < MAX_CHUNK_CHARS) {
      selected.push(lines[end])
      end += 1
      if (selected.join("\n").length >= MAX_CHUNK_CHARS) break
    }
    const body = selected.join("\n").slice(0, MAX_CHUNK_CHARS).trim()
    if (body) result.push({ start: start + 1, end, text: `File: ${file}\nLines: ${start + 1}-${end}\n${body}` })
    if (end >= lines.length) break
    start = Math.max(start + 1, end - 2)
  }
  return result
}

export function rank(entries: ReadonlyArray<Entry>, query: ReadonlyArray<number>, limit = DEFAULT_TOP_K) {
  const ranked = entries
    .map((entry) => ({ entry, score: cosine(entry.vector, query) }))
    .filter((item) => Number.isFinite(item.score) && item.score >= 0.2)
    .toSorted((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path))
  const seen = new Set<string>()
  return ranked.flatMap((item): Match[] => {
    if (seen.has(item.entry.path) || seen.size >= limit) return []
    seen.add(item.entry.path)
    return [{ path: item.entry.path, start: item.entry.start, end: item.entry.end, score: item.score }]
  })
}

export function inspectEntries(model: string | undefined, entries: ReadonlyArray<Entry>, search = "", limit = 200) {
  const query = search.trim().toLocaleLowerCase()
  const matched = entries
    .filter((entry) =>
      query ? `${entry.id} ${entry.path} ${entry.fileHash}`.toLocaleLowerCase().includes(query) : true,
    )
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.path.localeCompare(right.path))
  return {
    model,
    total: entries.length,
    matched: matched.length,
    files: new Set(entries.map((entry) => entry.path)).size,
    entries: matched.slice(0, Math.max(1, Math.min(500, limit))).map((entry) => ({
      id: entry.id,
      path: entry.path,
      start: entry.start,
      end: entry.end,
      fileHash: entry.fileHash,
      updatedAt: entry.updatedAt,
      dimensions: entry.vector.length,
    })),
  } satisfies Snapshot
}

export function cosine(left: ReadonlyArray<number>, right: ReadonlyArray<number>) {
  if (left.length === 0 || left.length !== right.length) return -1
  const totals = left.reduce(
    (result, value, index) => ({
      dot: result.dot + value * right[index],
      left: result.left + value * value,
      right: result.right + right[index] * right[index],
    }),
    { dot: 0, left: 0, right: 0 },
  )
  if (!totals.left || !totals.right) return -1
  return totals.dot / Math.sqrt(totals.left * totals.right)
}

function trim(entries: ReadonlyArray<Entry>, maxFiles: number, maxChunks: number) {
  const files = new Set<string>()
  return entries
    .toSorted((left, right) => right.updatedAt - left.updatedAt)
    .filter((entry) => {
      if (!files.has(entry.path) && files.size >= maxFiles) return false
      files.add(entry.path)
      return true
    })
    .slice(0, maxChunks)
}

function balanced(files: ReadonlyArray<string>, limit: number) {
  const groups = Map.groupBy(Array.from(new Set(files)).toSorted(), (file) => {
    const parts = file.split("/")
    return parts.length > 1 ? parts[0] : "."
  })
  const values = Array.from(groups.values())
  return Array.from({ length: Math.max(0, ...values.map((group) => group.length)) })
    .flatMap((_, index) => values.flatMap((group) => (group[index] ? [group[index]] : [])))
    .slice(0, limit)
}

function indexable(file: string) {
  const value = normalize(file)
  if (!value || value === ".git" || value.startsWith(".git/")) return false
  if (/(^|\/)(?:node_modules|vendor|dist|build|coverage|\.cache|cache|generated)(?:\/|$)/u.test(value)) return false
  if (/(?:^|\/)(?:bun|package|pnpm|yarn|composer|cargo)\.lock(?:b)?$/iu.test(value)) return false
  if (
    /\.(?:png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|bz2|xz|7z|tar|dmg|app|exe|dll|so|dylib|woff2?|ttf|otf|mp[34]|mov|wav)$/iu.test(
      value,
    )
  )
    return false
  return true
}

function normalize(file: string) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "")
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)))
}
