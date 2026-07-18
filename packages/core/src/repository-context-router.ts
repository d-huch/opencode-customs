export * as RepositoryContextRouter from "./repository-context-router"

import path from "path"
import { Cause, Context, Effect, Layer } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { Location } from "./location"
import { RepositoryMap } from "./repository-map"
import { RepositorySemantic } from "./repository-semantic"

const MAX_FILES = 10
const MAX_SYMBOLS = 12
const MAX_MODULES = 5
const SEMANTIC_LOOKUP_TIMEOUT = "2 seconds"

const stopwords = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "with",
  "where",
  "defined",
  "used",
  "method",
  "function",
  "class",
  "find",
  "references",
  "usage",
  "which",
  "what",
  "як",
  "це",
  "та",
  "і",
  "в",
  "на",
  "для",
  "з",
  "до",
  "що",
])

export type Input = {
  readonly query: string
  readonly files?: ReadonlyArray<string>
}

export type Selection = {
  readonly text: string
  readonly files: ReadonlyArray<string>
  readonly symbols: ReadonlyArray<RepositoryMap.SymbolNode>
  readonly modules: ReadonlyArray<RepositoryMap.Module>
}

export interface Interface {
  readonly route: (input: Input) => Effect.Effect<Selection | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RepositoryContextRouter") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const map = yield* RepositoryMap.Service
    const location = yield* Location.Service
    const lookups = new Map<string, { readonly time: number; readonly result: RepositorySemantic.SearchResult | undefined }>()
    return Service.of({
      route: Effect.fn("RepositoryContextRouter.route")(function* (input) {
        const info = yield* map.load()
        const initial = select(info, input)
        const query = semanticQuery(input.query, info)
        if (!query || !RepositorySemantic.available()) return initial
        const cached = lookups.get(query)
        const lookup =
          cached && Date.now() - cached.time < 15_000
            ? cached.result
            : yield* RepositorySemantic.search({
                directory: location.directory,
                worktree: location.project.directory,
                projectID: location.project.id,
                query,
                files: initial?.files ?? [],
              }).pipe(
                Effect.timeout(SEMANTIC_LOOKUP_TIMEOUT),
                Effect.catchCause((cause) =>
                  Effect.logWarning("repository context semantic lookup unavailable", {
                    directory: location.directory,
                    query,
                    cause: Cause.pretty(cause),
                  }).pipe(Effect.as(undefined)),
                ),
                Effect.tap((result) =>
                  Effect.sync(() => {
                    lookups.set(query, { time: Date.now(), result })
                  }),
                ),
              )
        if (!lookup) return initial
        yield* Effect.logInfo("repository context semantic lookup completed", {
          directory: location.directory,
          query,
          servers: lookup.servers.join(", "),
          symbols: lookup.symbols.length,
          edges: lookup.edges.length,
        })
        return select(info, input, [lookup])
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [RepositoryMap.node, Location.node] })

export function select(
  info: RepositoryMap.Info,
  input: Input,
  lookups: ReadonlyArray<RepositorySemantic.SearchResult> = [],
): Selection | undefined {
  if (info.status === "unavailable" || info.files === 0) return undefined
  const tokens = tokenize(input.query)
  const allSymbols = Array.from(
    new Map(
      [...info.symbols, ...lookups.flatMap((lookup) => lookup.symbols)].map((symbol) => [
        `${symbol.path}\0${symbol.name}\0${symbol.kind}`,
        symbol,
      ]),
    ).values(),
  )
  const allEdges = Array.from(
    new Map(
      [...info.edges, ...lookups.flatMap((lookup) => lookup.edges)].map((edge) => [
        `${edge.from}\0${edge.to}\0${edge.kind}`,
        edge,
      ]),
    ).values(),
  )
  const scores = new Map<string, number>()
  const add = (file: string, score: number) => scores.set(file, (scores.get(file) ?? 0) + score)
  const candidates = new Set([
    ...allSymbols.map((symbol) => symbol.path),
    ...info.landmarks.map((landmark) => landmark.path),
    ...allEdges.flatMap((edge) => [edge.from, edge.to]),
    ...info.modules.flatMap((module) => module.entrypoints),
  ])
  input.files?.map(normalizeAttachment).forEach((file) => {
    const match = Array.from(candidates).find((candidate) => file === candidate || file.endsWith(`/${candidate}`))
    if (match) add(match, 100)
  })

  allSymbols.forEach((symbol) => {
    const name = searchable(symbol.name)
    const path = searchable(symbol.path)
    const confidence = symbol.source === "lsp" ? 4 : 0
    tokens.forEach((token) => {
      if (name === token) add(symbol.path, 24 + confidence)
      if (name.includes(token)) add(symbol.path, 12 + confidence)
      if (path.includes(token)) add(symbol.path, 4)
    })
  })
  info.landmarks.forEach((landmark) => {
    const value = searchable(`${landmark.kind} ${landmark.path}`)
    tokens.forEach((token) => {
      if (value.includes(token)) add(landmark.path, 6)
    })
  })
  info.modules.forEach((module) => {
    const value = searchable(`${module.name ?? ""} ${module.path}`)
    const score = tokens.reduce((total, token) => total + (value.includes(token) ? 3 : 0), 0)
    if (!score) return
    module.entrypoints.forEach((file) => add(file, score + 2))
  })

  const seeds = Array.from(scores)
    .filter(([, score]) => score > 0)
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_FILES)
  const seedFiles = new Set(seeds.map(([file]) => file))
  allEdges.forEach((edge) => {
    const confidence = edge.kind === "call" ? 3 : edge.kind === "reference" ? 2 : 1
    if (seedFiles.has(edge.from)) add(edge.to, Math.min(7, edge.references + confidence))
    if (seedFiles.has(edge.to)) add(edge.from, Math.min(5, edge.references + confidence - 1))
  })

  if (scores.size === 0) {
    info.landmarks.slice(0, MAX_FILES).forEach((landmark) => add(landmark.path, 1))
    info.modules
      .flatMap((module) => module.entrypoints)
      .slice(0, MAX_FILES)
      .forEach((file) => add(file, 1))
  }

  const files = Array.from(scores)
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([file]) => file)
    .slice(0, MAX_FILES)
  const selected = new Set(files)
  const symbols = allSymbols
    .filter((symbol) => selected.has(symbol.path) || tokens.some((token) => searchable(symbol.name).includes(token)))
    .slice(0, MAX_SYMBOLS)
  const modules = info.modules
    .filter((module) => files.some((file) => module.path === "." || file.startsWith(`${module.path}/`)))
    .slice(0, MAX_MODULES)
  if (files.length === 0 && symbols.length === 0 && modules.length === 0) return undefined
  return { files, symbols, modules, text: render({ files, symbols, modules }, lookups) }
}

function render(
  selection: Omit<Selection, "text">,
  lookups: ReadonlyArray<RepositorySemantic.SearchResult>,
) {
  const semanticEdges = lookups.flatMap((lookup) => lookup.edges).slice(0, 12)
  return [
    '<repository_context source="query-router">',
    "Likely relevant files for the current request:",
    ...selection.files.map((file) => `- ${file}`),
    ...(selection.symbols.length
      ? [
          "",
          "Matching symbols:",
          ...selection.symbols.map(
            (symbol) => `- ${symbol.name} — ${symbol.path}:${symbol.line}${symbol.source === "lsp" ? " (LSP)" : ""}`,
          ),
        ]
      : []),
    ...(selection.modules.length
      ? ["", `Project areas: ${selection.modules.map((module) => module.path).join(", ")}`]
      : []),
    ...(lookups.length
      ? [
          "",
          "On-demand LSP lookup already performed by the context router:",
          ...lookups.map((lookup) =>
            lookup.symbols.length
              ? `- ${lookup.query}: ${lookup.symbols.length} definition candidate(s), ${lookup.edges.length} semantic relationship(s); servers ${lookup.servers.join(", ") || "none"}`
              : `- ${lookup.query}: no matching workspace symbol; servers ${lookup.servers.join(", ") || "none"}`,
          ),
          ...(semanticEdges.length
            ? [
                "Semantic reference/call relationships:",
                ...semanticEdges.map(
                  (edge) => `- ${edge.kind}: ${edge.from} -> ${edge.to} (${edge.references} location(s))`,
                ),
              ]
            : []),
        ]
      : []),
    "</repository_context>",
    "These are ranking hints from the local repository graph. Inspect the listed files before searching broadly.",
    ...(lookups.length
      ? [
          "The router already ran LSP workspaceSymbol and references for the exact identifier. Do not repeat the same LSP or grep search. Read the listed definition and related files directly. If the LSP lookup has no match, at most one literal repository-wide search is enough; do not try equivalent grep/find/shell variants.",
        ]
      : [
          "For an exact identifier question, prefer the listed LSP symbol and use LSP references/definitions. If no matching symbol is listed, call LSP workspaceSymbol once using a listed source file. If that also has no match, run at most one literal repository-wide search for the exact identifier; do not repeat equivalent grep/find/shell searches. A missing graph or LSP match alone is not proof that the identifier does not exist.",
        ]),
  ].join("\n")
}

function semanticQuery(value: string, info: RepositoryMap.Info) {
  const quoted = Array.from(value.matchAll(/[`'"]([A-Za-z_$][A-Za-z0-9_$]*)[`'"]/g)).map((match) => match[1])
  const known = new Set(info.symbols.map((symbol) => symbol.name.toLocaleLowerCase()))
  return Array.from(new Set([...quoted, ...(value.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])]))
    .filter((token) => token.length > 2 && !stopwords.has(token.toLocaleLowerCase()))
    .map((token) => ({
      token,
      score:
        (known.has(token.toLocaleLowerCase()) ? 100 : 0) +
        (/[a-z0-9][A-Z]/.test(token) ? 50 : 0) +
        (/[_$]/.test(token) ? 40 : 0) +
        (/^[A-Z][a-z]/.test(token) ? 30 : 0) +
        (quoted.includes(token) ? 50 : 0) +
        Math.min(token.length, 20),
    }))
    .filter((item) => item.score >= 40)
    .toSorted((left, right) => right.score - left.score || left.token.localeCompare(right.token))[0]?.token
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      (value.match(/[\p{L}\p{N}_$./-]+/gu) ?? [])
        .flatMap((token) => token.split(/[./_-]+/))
        .map(searchable)
        .filter((token) => token.length > 1 && !stopwords.has(token)),
    ),
  )
}

function searchable(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase()
    .replaceAll("\\", "/")
}

function normalizeAttachment(value: string) {
  const uri = value.startsWith("file://") ? decodeURIComponent(value.slice("file://".length)) : value
  return path.normalize(uri).replaceAll("\\", "/").replace(/^\.\//, "")
}
