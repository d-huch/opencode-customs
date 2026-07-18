export * as RepositoryMemory from "./repository-memory"

import path from "path"
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { Hash } from "./util/hash"

const VERSION = 1
const MAX_ENTRIES = 96
const MAX_FILES = 8
const MAX_NOTES = 4
const MAX_NOTE_CHARS = 1_200
const MAX_AGE = 1000 * 60 * 60 * 24 * 90

const StoredEntry = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["route", "summary"]),
  text: Schema.String,
  terms: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  updatedAt: Schema.Number,
})

const StoredFile = Schema.Struct({
  version: Schema.Literal(VERSION),
  entries: Schema.Array(StoredEntry),
})

export type Entry = typeof StoredEntry.Type

export type Recall = {
  readonly files: ReadonlyArray<string>
  readonly notes: ReadonlyArray<string>
  readonly matches: number
}

export interface Interface {
  readonly recall: (query: string) => Effect.Effect<Recall>
  readonly rememberRoute: (input: {
    readonly query: string
    readonly files: ReadonlyArray<string>
    readonly terms?: ReadonlyArray<string>
  }) => Effect.Effect<void>
  readonly rememberSummary: (summary: string) => Effect.Effect<void>
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
    const state = yield* Ref.make<ReadonlyArray<Entry> | undefined>(undefined)
    const lock = Semaphore.makeUnsafe(1)
    const file = path.join(
      global.cache,
      "repository-memory",
      `${Hash.fast(location.project.directory)}.json`,
    )

    const load = Effect.fn("RepositoryMemory.load")(function* () {
      const current = yield* Ref.get(state)
      if (current) return current
      const content = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const json = content ? Option.getOrUndefined(decodeJson(content)) : undefined
      const stored = json === undefined ? undefined : Option.getOrUndefined(decodeFile(json))
      const entries = (stored?.entries ?? []).filter((entry) => Date.now() - entry.updatedAt <= MAX_AGE)
      yield* Ref.set(state, entries)
      return entries
    })

    const store = Effect.fn("RepositoryMemory.store")(function* (additions: ReadonlyArray<Entry>) {
      if (additions.length === 0) return
      yield* lock.withPermit(
        Effect.gen(function* () {
          const current = yield* load()
          const entries = new Map(current.map((entry) => [entry.id, entry]))
          additions.forEach((entry) => {
            const previous = entries.get(entry.id)
            if (previous && sameEntry(previous, entry)) return
            entries.set(entry.id, entry)
          })
          const next = Array.from(entries.values())
            .filter((entry) => Date.now() - entry.updatedAt <= MAX_AGE)
            .toSorted((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, MAX_ENTRIES)
          if (sameEntries(current, next)) return
          yield* Ref.set(state, next)
          yield* fs
            .writeWithDirs(file, JSON.stringify({ version: VERSION, entries: next }, null, 2))
            .pipe(Effect.catch(() => Effect.void))
        }),
      )
    })

    return Service.of({
      recall: Effect.fn("RepositoryMemory.recall")(function* (query) {
        return recall(yield* lock.withPermit(load()), query)
      }),
      rememberRoute: Effect.fn("RepositoryMemory.rememberRoute")(function* (input) {
        const entry = routeEntry(input)
        if (entry) yield* store([entry])
      }),
      rememberSummary: Effect.fn("RepositoryMemory.rememberSummary")(function* (summary) {
        yield* store(summaryEntries(summary))
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Location.node],
})

export function recall(entries: ReadonlyArray<Entry>, query: string, now = Date.now()): Recall {
  const terms = tokenize(query)
  if (terms.length === 0) return { files: [], notes: [], matches: 0 }
  const ranked = entries
    .filter((entry) => now - entry.updatedAt <= MAX_AGE)
    .map((entry) => {
      const overlap = terms.filter((term) => entry.terms.includes(term))
      const pathMatches = terms.filter((term) => entry.files.some((file) => searchable(file).includes(term)))
      const exact = searchable(entry.text) === searchable(query)
      return {
        entry,
        relevant:
          exact ||
          pathMatches.length > 0 ||
          overlap.length >= 2 ||
          overlap.some((term) => Array.from(term).length >= 6),
        score:
          overlap.length * 20 +
          pathMatches.length * 8 +
          (exact ? 100 : 0) +
          Math.max(0, 10 - Math.floor((now - entry.updatedAt) / (1000 * 60 * 60 * 24 * 7))),
      }
    })
    .filter((item) => item.relevant && item.score >= 20)
    .toSorted((left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt)
    .slice(0, 8)
  const files = Array.from(new Set(ranked.flatMap((item) => item.entry.files))).slice(0, MAX_FILES)
  const notes = ranked
    .filter((item) => item.entry.kind === "summary")
    .map((item) => item.entry.text)
    .filter((note, index, all) => all.indexOf(note) === index)
    .slice(0, MAX_NOTES)
    .reduce<string[]>((result, note) => {
      const used = result.join("\n").length
      if (used >= MAX_NOTE_CHARS) return result
      return [...result, note.slice(0, MAX_NOTE_CHARS - used)]
    }, [])
  return { files, notes, matches: ranked.length }
}

export function routeEntry(input: {
  readonly query: string
  readonly files: ReadonlyArray<string>
  readonly terms?: ReadonlyArray<string>
}): Entry | undefined {
  const text = input.query.replace(/\s+/g, " ").trim().slice(0, 500)
  if (!text || input.files.length === 0) return
  return {
    id: Hash.fast(`route\0${searchable(text)}`),
    kind: "route",
    text,
    terms: Array.from(new Set([...tokenize(text), ...(input.terms ?? []).flatMap(tokenize)])).slice(0, 48),
    files: Array.from(new Set(input.files)).slice(0, MAX_FILES),
    updatedAt: Date.now(),
  }
}

export function summaryEntries(summary: string, now = Date.now()): Entry[] {
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
              id: Hash.fast(`summary\0${searchable(text)}`),
              kind: "summary",
              text,
              terms,
              files: memoryPaths(text),
              updatedAt: now,
            },
          ],
        }
      },
      { enabled: false, entries: [] },
    )
    .entries.slice(0, 24)
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
    left.kind === right.kind &&
    left.text === right.text &&
    left.terms.join("\0") === right.terms.join("\0") &&
    left.files.join("\0") === right.files.join("\0")
  )
}

function sameEntries(left: ReadonlyArray<Entry>, right: ReadonlyArray<Entry>) {
  return left.length === right.length && left.every((entry, index) => sameEntry(entry, right[index]))
}
