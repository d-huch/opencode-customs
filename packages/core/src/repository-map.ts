export * as RepositoryMap from "./repository-map"

import path from "path"
import { Context, Effect, Layer, Option, Ref, Schema, Scope, Semaphore, Stream } from "effect"
import { RepositoryMap } from "@opencode-ai/schema/repository-map"
import { makeLocationNode } from "./effect/app-node"
import { EventV2 } from "./event"
import { Watcher } from "./filesystem/watcher"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { Ripgrep } from "./ripgrep"
import { RepositorySemantic } from "./repository-semantic"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"

const MAX_FILES = 20_000
const MAX_IMPORTS = 20_000
const MAX_MANIFESTS = 200
const MAX_GRAPH_FILES = 4_000
const MAX_SYMBOLS = 1_000
const MAX_EDGES = 1_000
const MAX_MODULES = 20
const MAX_RELATIONSHIPS = 30
const MAX_LANDMARKS_PER_KIND = 6
const MAX_SEMANTIC_FILES = 48

const manifestNames = new Set([
  "package.json",
  "composer.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
])

const entrypointNames = new Set([
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "main.ts",
  "main.tsx",
  "main.js",
  "main.jsx",
  "app.ts",
  "app.tsx",
  "app.js",
  "app.jsx",
  "server.ts",
  "server.js",
  "bootstrap.ts",
  "bootstrap.js",
  "manage.py",
  "main.py",
  "main.go",
  "main.rs",
  "lib.rs",
  "Program.cs",
])

const languageByExtension: Readonly<Record<string, string>> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript JSX",
  ".js": "JavaScript",
  ".jsx": "JavaScript JSX",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".php": "PHP",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".cs": "C#",
  ".rb": "Ruby",
  ".swift": "Swift",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".sql": "SQL",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".md": "Markdown",
}

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".php",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".cs",
  ".rb",
  ".swift",
])

export const Language = RepositoryMap.Language
export type Language = RepositoryMap.Language

export const Module = RepositoryMap.Module
export type Module = RepositoryMap.Module

export const Relationship = RepositoryMap.Relationship
export type Relationship = RepositoryMap.Relationship

export const Landmark = RepositoryMap.Landmark
export type Landmark = RepositoryMap.Landmark

export const SymbolNode = RepositoryMap.SymbolNode
export type SymbolNode = RepositoryMap.SymbolNode

export const FileEdge = RepositoryMap.FileEdge
export type FileEdge = RepositoryMap.FileEdge

export const Semantic = RepositoryMap.Semantic
export type Semantic = RepositoryMap.Semantic

export const Info = RepositoryMap.Info
export type Info = RepositoryMap.Info

export type Input = {
  readonly files: ReadonlyArray<string>
  readonly truncated?: boolean
  readonly imports?: ReadonlyArray<{ readonly path: string; readonly text: string }>
  readonly manifests?: ReadonlyArray<{ readonly path: string; readonly content?: string }>
  readonly symbols?: ReadonlyArray<SymbolNode>
  readonly edges?: ReadonlyArray<FileEdge>
  readonly semantic?: Semantic
  readonly semanticFiles?: ReadonlyArray<string>
}

type Import = NonNullable<Input["imports"]>[number]
type Manifest = NonNullable<Input["manifests"]>[number]

type Indexed = {
  readonly files: ReadonlySet<string>
  readonly truncated: boolean
  readonly imports: ReadonlyMap<string, ReadonlyArray<Import>>
  readonly manifests: ReadonlyMap<string, Manifest>
  readonly symbols: ReadonlyMap<string, ReadonlyArray<SymbolNode>>
  readonly semanticEdges: ReadonlyArray<FileEdge>
  readonly semanticFiles: ReadonlySet<string>
  readonly info: Info
}

export interface Interface {
  readonly current: () => Effect.Effect<Info | undefined>
  readonly load: () => Effect.Effect<Info>
  readonly refresh: () => Effect.Effect<Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RepositoryMap") {}

const key = SystemContext.Key.make("core/repository-map")
const MapCodec = Schema.toCodecJson(Info)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const ripgrep = yield* Ripgrep.Service
    const scope = yield* Scope.Scope
    const state = yield* Ref.make<Indexed | undefined>(undefined)
    const indexLock = Semaphore.makeUnsafe(1)
    const semanticLock = Semaphore.makeUnsafe(1)

    const markSemantic = (status: Semantic["status"]) =>
      Ref.update(state, (current) => {
        if (!current) return current
        return {
          ...current,
          info: Info.make({
            ...current.info,
            semantic: Semantic.make({ ...current.info.semantic, status }),
          }),
        }
      })

    const failSemantic = (replace: boolean) =>
      Ref.update(state, (current) => {
        if (!current) return current
        const status = replace || current.info.semantic.servers.length === 0 ? "unavailable" : "ready"
        return {
          ...current,
          info: Info.make({ ...current.info, semantic: Semantic.make({ ...current.info.semantic, status }) }),
        }
      })

    const enrich = Effect.fn("RepositoryMap.enrich")(function* (files: ReadonlyArray<string>, replace: boolean) {
      const result = yield* RepositorySemantic.enrich({
        directory: location.directory,
        worktree: location.project.directory,
        projectID: location.project.id,
        files,
      })
      if (!result) {
        yield* indexLock.withPermit(markSemantic("unavailable"))
        return
      }

      yield* indexLock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          if (!current) return
          const targets = new Set(files.map(normalize))
          const syntax = Array.from(current.symbols.values())
            .flat()
            .filter((symbol) => symbol.source !== "lsp")
          const retainedSymbols = replace
            ? []
            : Array.from(current.symbols.values())
                .flat()
                .filter((symbol) => symbol.source === "lsp" && !targets.has(symbol.path))
          const retainedEdges = replace
            ? []
            : current.semanticEdges.filter((edge) => !targets.has(edge.from) && !targets.has(edge.to))
          const semanticFiles = replace ? new Set<string>() : new Set(current.semanticFiles)
          if (!replace) targets.forEach((file) => semanticFiles.delete(file))
          result.files.map(normalize).forEach((file) => semanticFiles.add(file))
          const servers = Array.from(
            new Set(replace ? result.servers : [...current.info.semantic.servers, ...result.servers]),
          ).toSorted()
          const next = indexed({
            files: Array.from(current.files),
            truncated: current.truncated,
            imports: Array.from(current.imports.values()).flat(),
            manifests: Array.from(current.manifests.values()),
            symbols: [...syntax, ...retainedSymbols, ...result.symbols],
            edges: [...retainedEdges, ...result.edges],
            semanticFiles: Array.from(semanticFiles),
            semantic: Semantic.make({
              status: servers.length ? "ready" : "unavailable",
              files: semanticFiles.size,
              servers,
            }),
          })
          yield* Ref.set(state, next)
          yield* Effect.logInfo("repository map semantic index updated", {
            directory: location.directory,
            files: next.info.semantic.files,
            servers: next.info.semantic.servers.join(", "),
            symbols: next.info.symbols.filter((symbol) => symbol.source === "lsp").length,
            edges: next.semanticEdges.length,
          })
        }),
      )
    })

    const scheduleSemantic = Effect.fn("RepositoryMap.scheduleSemantic")(function* (
      files: ReadonlyArray<string>,
      replace: boolean,
    ) {
      if (!RepositorySemantic.available()) return
      if (files.length === 0) {
        yield* markSemantic("unavailable")
        return
      }
      yield* markSemantic("indexing")
      yield* semanticLock
        .withPermit(enrich(files, replace))
        .pipe(
          Effect.catch((error) =>
            indexLock.withPermit(failSemantic(replace)).pipe(
              Effect.andThen(
                Effect.logWarning("repository map semantic index unavailable", {
                  directory: location.directory,
                  error,
                }),
              ),
            ),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
    })

    const build = Effect.fn("RepositoryMap.build")(function* () {
      const [found, imports] = yield* Effect.all(
        [
          ripgrep.find({ cwd: location.directory, pattern: "*", limit: MAX_FILES + 1 }),
          ripgrep
            .grep({
              cwd: location.directory,
              pattern: String.raw`(?:\b(?:import|export)\b.*\bfrom\s*|\b(?:import|require)\s*\(\s*)["'][^"']+["']|^\s*from\s+[.\w]+\s+import\s+|^\s*use\s+[\w:]+`,
              include: "*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,py,rs}",
              limit: MAX_IMPORTS,
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("repository map import scan skipped", {
                  directory: location.directory,
                  error,
                }).pipe(Effect.as([])),
              ),
            ),
        ],
        { concurrency: "unbounded" },
      )
      const truncated = found.length > MAX_FILES
      const files = found.slice(0, MAX_FILES).map((entry) => normalize(entry.path))
      const [manifests, parsed] = yield* Effect.all(
        [
          Effect.forEach(
            files.filter(isManifest).slice(0, MAX_MANIFESTS),
            (file) =>
              fs.readFileStringSafe(path.join(location.directory, file)).pipe(
                Effect.map((content) => ({ path: file, content })),
                Effect.catch(() => Effect.succeed({ path: file, content: undefined })),
              ),
            { concurrency: 16 },
          ),
          Effect.forEach(
            balanced(files.filter(isGraphSource).toSorted(comparePath), area, MAX_GRAPH_FILES),
            (file) =>
              fs.readFileStringSafe(path.join(location.directory, file)).pipe(
                Effect.flatMap((content) => parseSource(file, content)),
                Effect.catch(() => Effect.succeed({ imports: [], symbols: [] })),
              ),
            { concurrency: 16 },
          ),
        ],
        { concurrency: "unbounded" },
      )
      return indexed({
        files,
        truncated,
        imports: dedupeImports([
          ...imports.map((match) => ({ path: normalize(match.entry.path), text: match.text })),
          ...parsed.flatMap((item) => item.imports),
        ]),
        manifests,
        symbols: parsed.flatMap((item) => item.symbols),
        semantic: Semantic.make({
          status: RepositorySemantic.available() ? "indexing" : "unavailable",
          files: 0,
          servers: [],
        }),
      })
    })

    const rebuild = Effect.fn("RepositoryMap.rebuild")(function* () {
      const current = yield* build()
      yield* Ref.set(state, current)
      yield* scheduleSemantic(semanticCandidates(Array.from(current.files), current.info), true)
      yield* Effect.logInfo("repository map indexed", {
        directory: location.directory,
        files: current.info.files,
        modules: current.info.modules.length,
        symbols: current.info.symbols.length,
        edges: current.info.edges.length,
        status: current.info.status,
      })
      return current.info
    })

    const safe = (effect: Effect.Effect<Info, unknown>) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const info = unavailable()
            yield* Ref.set(state, {
              files: new Set<string>(),
              truncated: false,
              imports: new Map(),
              manifests: new Map(),
              symbols: new Map(),
              semanticEdges: [],
              semanticFiles: new Set<string>(),
              info,
            })
            yield* Effect.logWarning("repository map unavailable", { directory: location.directory, error })
            return info
          }),
        ),
      )

    const load = Effect.fn("RepositoryMap.load")(function* () {
      return yield* safe(
        indexLock.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(state)
            if (current) return current.info
            return yield* rebuild()
          }),
        ),
      )
    })

    const current = () => Ref.get(state).pipe(Effect.map((value) => value?.info))

    const refresh = Effect.fn("RepositoryMap.refresh")(function* () {
      return yield* safe(indexLock.withPermit(rebuild()))
    })

    const update = Effect.fn("RepositoryMap.update")(function* (event: {
      file: string
      event: "add" | "change" | "unlink"
    }) {
      const relative = path.relative(location.directory, path.resolve(event.file))
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return
      const file = normalize(relative)
      if (file === ".git" || file.startsWith(".git/")) return
      yield* indexLock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          if (!current) return
          const files = new Set(current.files)
          const imports = new Map(current.imports)
          const manifests = new Map(current.manifests)
          const symbols = new Map(current.symbols)
          const semanticFiles = new Set(current.semanticFiles)
          const semanticEdges = current.semanticEdges.filter((edge) => edge.from !== file && edge.to !== file)
          if (event.event === "unlink") {
            files.delete(file)
            imports.delete(file)
            manifests.delete(file)
            symbols.delete(file)
            semanticFiles.delete(file)
          }
          if (event.event !== "unlink") {
            if (!(yield* fs.isFile(path.join(location.directory, file)))) return
            if (!files.has(file) && files.size >= MAX_FILES) return
            files.add(file)
            const content = yield* fs
              .readFileStringSafe(path.join(location.directory, file))
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (isManifest(file)) manifests.set(file, { path: file, content })
            if (!isManifest(file)) manifests.delete(file)
            const parsed = yield* parseSource(file, content)
            imports.set(file, parsed.imports)
            symbols.set(file, parsed.symbols)
          }
          const next = indexed({
            files: Array.from(files),
            truncated: current.truncated,
            imports: Array.from(imports.values()).flat(),
            manifests: Array.from(manifests.values()),
            symbols: Array.from(symbols.values()).flat(),
            edges: semanticEdges,
            semanticFiles: Array.from(semanticFiles),
            semantic: Semantic.make({ ...current.info.semantic, files: semanticFiles.size }),
          })
          yield* Ref.set(state, next)
          yield* Effect.logDebug("repository map updated", {
            directory: location.directory,
            file,
            event: event.event,
            files: next.info.files,
          })
        }),
      )
      if (event.event !== "unlink" && isGraphSource(file)) yield* scheduleSemantic([file], false)
    })

    yield* events.subscribe(Watcher.Event.Updated).pipe(
      Stream.runForEach((event) => update(event.data)),
      Effect.catchCause((cause) => Effect.logWarning("repository map watcher stopped", { cause })),
      Effect.forkScoped,
    )

    yield* registry.register({
      key,
      load: current().pipe(
        Effect.map((info) =>
          !info || info.status === "unavailable"
            ? SystemContext.empty
            : SystemContext.make({
                key,
                codec: MapCodec,
                load: Effect.succeed(info),
                baseline: render,
                update: (_previous, current) =>
                  `The repository structure changed. Replace the previous repository map with this one:\n\n${render(current)}`,
              }),
        ),
      ),
    })

    yield* Effect.forkScoped(load().pipe(Effect.asVoid))

    return Service.of({ current, load, refresh })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, EventV2.node, Location.node, Ripgrep.node, SystemContextRegistry.node],
})

export function analyze(input: Input) {
  const files = input.files.map(normalize).filter(Boolean).toSorted()
  const manifestInputs = new Map((input.manifests ?? []).map((item) => [normalize(item.path), item.content]))
  const manifestPaths = files.filter(isManifest)
  const topLevel = files.flatMap((file) => {
    const parts = file.split("/")
    return parts.length > 1 ? [parts[0]] : []
  })
  const topCounts = count(topLevel)
  const manifestRoots = new Set(
    manifestPaths.flatMap((file) => {
      const parts = file.split("/")
      return parts.length > 1 ? [parts[0]] : []
    }),
  )
  const structuralCounts = count(
    files.flatMap((file) => {
      const parts = file.split("/")
      if (parts.length < 3 || manifestRoots.has(parts[0])) return []
      return [parts.slice(0, 2).join("/")]
    }),
  )
  const modulePaths = Array.from(
    new Set([
      ...manifestPaths.map((file) => normalize(path.posix.dirname(file))),
      ...Array.from(topCounts).flatMap(([directory, files]) =>
        files >= 3 && !manifestRoots.has(directory) ? [directory] : [],
      ),
      ...Array.from(structuralCounts).flatMap(([directory, files]) => (files >= 2 ? [directory] : [])),
    ]),
  )
    .map((directory) => (directory === "." ? "." : directory.replace(/\/$/, "")))
    .toSorted((left, right) => depth(left) - depth(right) || left.localeCompare(right))
  if (modulePaths.length === 0) modulePaths.push(".")

  const owner = (file: string) =>
    modulePaths
      .filter((module) => module === "." || file === module || file.startsWith(`${module}/`))
      .toSorted((left, right) => depth(right) - depth(left) || right.length - left.length)[0] ?? "."
  const packageInfo = new Map(
    manifestPaths.map((file) => {
      const info = parseManifest(manifestInputs.get(file))
      return [file, { ...info, module: owner(file) }] as const
    }),
  )
  const packageNames = new Map(
    Array.from(packageInfo.values()).flatMap((info) => (info.name ? [[info.name, info.module] as const] : [])),
  )
  const moduleCounts = count(files.map(owner))
  const entrypoints = group(
    files.filter((file) => entrypointNames.has(path.posix.basename(file)) && !isNoisy(file)),
    owner,
  )
  const manifests = group(manifestPaths, owner)
  const modules = Array.from(moduleCounts)
    .map(([module, fileCount]) =>
      Module.make({
        path: module,
        name: Array.from(packageInfo.values()).find((info) => info.module === module)?.name,
        files: fileCount,
        manifests: (manifests.get(module) ?? []).toSorted().slice(0, 4),
        entrypoints: (entrypoints.get(module) ?? []).toSorted(comparePath).slice(0, 4),
      }),
    )
    .toSorted((left, right) => right.files - left.files || comparePath(left.path, right.path))
    .slice(0, MAX_MODULES)
  const visibleModules = new Set(modules.map((module) => module.path))
  const fileSet = new Set(files)
  const relationships = new Map<string, number>()
  const edges = new Map<string, number>()
  const addRelationship = (from: string, to: string) => {
    if (from === to || !visibleModules.has(from) || !visibleModules.has(to)) return
    const relation = `${from}\0${to}`
    relationships.set(relation, (relationships.get(relation) ?? 0) + 1)
  }

  for (const item of input.imports ?? []) {
    const file = normalize(item.path)
    const from = owner(file)
    const specifier = importSpecifier(item.text)
    if (!specifier) continue
    const target = resolveImport(file, specifier, owner, packageNames)
    if (target) addRelationship(from, target)
    const targetFile = resolveImportFile(file, specifier, fileSet)
    if (targetFile && targetFile !== file) {
      const edge = `${file}\0${targetFile}\0import`
      edges.set(edge, (edges.get(edge) ?? 0) + 1)
    }
  }
  for (const info of packageInfo.values()) {
    for (const dependency of info.dependencies) {
      const target = packageNames.get(dependency)
      if (target) addRelationship(info.module, target)
    }
  }
  for (const item of input.edges ?? []) {
    const from = normalize(item.from)
    const to = normalize(item.to)
    if (from === to || !fileSet.has(from) || !fileSet.has(to)) continue
    const edge = `${from}\0${to}\0${item.kind}`
    edges.set(edge, (edges.get(edge) ?? 0) + item.references)
  }

  return Info.make({
    status: input.truncated ? "truncated" : "complete",
    files: files.length,
    languages: Array.from(count(files.map(language)))
      .map(([name, fileCount]) => Language.make({ name, files: fileCount }))
      .toSorted((left, right) => right.files - left.files || left.name.localeCompare(right.name))
      .slice(0, 12),
    modules,
    relationships: Array.from(relationships)
      .map(([relation, references]) => {
        const [from, to] = relation.split("\0")
        return Relationship.make({ from, to, references })
      })
      .toSorted(
        (left, right) =>
          right.references - left.references || left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
      )
      .slice(0, MAX_RELATIONSHIPS),
    landmarks: landmarkFiles(files),
    symbols: Array.from(
      new Map(
        (input.symbols ?? [])
          .filter((symbol) => fileSet.has(normalize(symbol.path)))
          .map((symbol) => [
            `${normalize(symbol.path)}\0${symbol.name}\0${symbol.kind}`,
            SymbolNode.make({ ...symbol, path: normalize(symbol.path) }),
          ]),
      ).values(),
    )
      .toSorted(
        (left, right) =>
          (left.source === right.source ? 0 : left.source === "lsp" ? -1 : 1) ||
          comparePath(left.path, right.path) ||
          left.line - right.line ||
          left.name.localeCompare(right.name),
      )
      .slice(0, MAX_SYMBOLS),
    edges: Array.from(edges)
      .map(([edge, references]) => {
        const [from, to, kind] = edge.split("\0")
        return FileEdge.make({ from, to, kind: fileEdgeKind(kind), references })
      })
      .toSorted(
        (left, right) =>
          right.references - left.references || left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
      )
      .slice(0, MAX_EDGES),
    semantic:
      input.semantic ??
      Semantic.make({
        status: "unavailable",
        files: 0,
        servers: [],
      }),
  })
}

export function render(info: Info) {
  if (info.status === "unavailable") {
    return [
      '<repository_map status="unavailable">',
      "The repository index is temporarily unavailable. Do not infer that a file or feature is absent from this.",
      "</repository_map>",
    ].join("\n")
  }

  const lines = [
    `<repository_map status="${info.status}">`,
    `Indexed files: ${info.files}${info.status === "truncated" ? " (limit reached; the map is partial)" : ""}`,
    `Languages: ${info.languages.map((item) => `${item.name} ${item.files}`).join(", ") || "unknown"}`,
    "",
    "Project areas:",
    ...info.modules.map((module) => {
      const details = [
        module.name ? `package ${module.name}` : undefined,
        module.manifests.length ? `manifests ${module.manifests.join(", ")}` : undefined,
        module.entrypoints.length ? `entrypoints ${module.entrypoints.join(", ")}` : undefined,
      ].filter((item): item is string => item !== undefined)
      return `- ${module.path}: ${module.files} files${details.length ? `; ${details.join("; ")}` : ""}`
    }),
  ]
  if (info.relationships.length) {
    lines.push(
      "",
      "Observed local relationships:",
      ...info.relationships.map((item) => `- ${item.from} -> ${item.to} (${item.references})`),
    )
  }
  if (info.symbols.length || info.edges.length)
    lines.push("", `Navigation graph: ${info.symbols.length} symbols, ${info.edges.length} file relationships`)
  lines.push(
    `Semantic graph: ${info.semantic.status}; ${info.semantic.files} files${
      info.semantic.servers.length ? `; servers ${info.semantic.servers.join(", ")}` : ""
    }`,
  )
  if (info.landmarks.length) {
    lines.push(
      "",
      "Navigation landmarks:",
      ...Array.from(group(info.landmarks, (item) => item.kind)).map(
        ([kind, items]) => `- ${kind}: ${items.map((item) => item.path).join(", ")}`,
      ),
    )
  }
  lines.push(
    "</repository_map>",
    "Use this map to choose the first files to inspect and follow imports/configuration from there. Query-specific graph matches may be supplied separately. This is a compact navigation aid, not proof that omitted files or relationships do not exist.",
  )
  return lines.join("\n")
}

function indexed(input: Input): Indexed {
  const files = input.files.map(normalize).filter(Boolean)
  const imports = group(input.imports ?? [], (item) => normalize(item.path))
  const symbols = group(input.symbols ?? [], (item) => normalize(item.path))
  return {
    files: new Set(files),
    truncated: input.truncated === true,
    imports,
    manifests: new Map((input.manifests ?? []).map((item) => [normalize(item.path), item])),
    symbols,
    semanticEdges: input.edges ?? [],
    semanticFiles: new Set(input.semanticFiles?.map(normalize) ?? []),
    info: analyze({ ...input, files }),
  }
}

function dedupeImports(imports: ReadonlyArray<Import>) {
  return Array.from(
    new Map(
      imports.map((item) => [
        `${normalize(item.path)}\0${importSpecifier(item.text) ?? item.text.trim()}`,
        item,
      ]),
    ).values(),
  )
}

function parseSource(file: string, content?: string) {
  if (!content || !isGraphSource(file)) return Effect.succeed({ imports: [] as Import[], symbols: [] as SymbolNode[] })
  return Effect.try({
    try: () => {
      const scan = scanSource(file, content)
      const exports = new Set(scan?.exports ?? [])
      return {
        imports: dedupeImports([
          ...(scan?.imports ?? []).map((item) => ({ path: file, text: `import "${item.path}"` })),
          ...syntaxImports(file, content),
        ]),
        symbols: syntaxSymbols(file, content, exports),
      }
    },
    catch: () => ({ imports: syntaxImports(file, content), symbols: syntaxSymbols(file, content, new Set()) }),
  }).pipe(Effect.catch((fallback) => Effect.succeed(fallback)))
}

function scanSource(file: string, content: string) {
  const extension = path.posix.extname(file).toLowerCase()
  if (extension === ".ts") return new Bun.Transpiler({ loader: "ts" }).scan(content)
  if (extension === ".tsx") return new Bun.Transpiler({ loader: "tsx" }).scan(content)
  if (extension === ".jsx") return new Bun.Transpiler({ loader: "jsx" }).scan(content)
  if ([".js", ".mjs", ".cjs"].includes(extension)) return new Bun.Transpiler({ loader: "js" }).scan(content)
  return undefined
}

function syntaxImports(file: string, content: string): Import[] {
  return content.split("\n").flatMap((text) => (importSpecifier(text) ? [{ path: file, text }] : []))
}

function syntaxSymbols(file: string, content: string, exports: ReadonlySet<string>): SymbolNode[] {
  const declarations = content.split("\n").flatMap((text, index) => {
    const match = text.match(
      /^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(class|function|interface|type|enum|const|let|var|def|fn|struct|trait)\s+([A-Za-z_$][\w$]*)/,
    )
    if (!match) return []
    return [
      SymbolNode.make({
        name: match[2],
        kind: symbolKind(match[1]),
        path: file,
        line: index + 1,
        source: "syntax",
      }),
    ]
  })
  const names = new Set(declarations.map((symbol) => symbol.name))
  return [
    ...declarations,
    ...Array.from(exports).flatMap((name) =>
      names.has(name) ? [] : [SymbolNode.make({ name, kind: "export", path: file, line: 0, source: "syntax" })],
    ),
  ]
}

function symbolKind(value: string): SymbolNode["kind"] {
  if (value === "class" || value === "struct" || value === "trait") return "class"
  if (value === "function" || value === "def" || value === "fn") return "function"
  if (value === "interface") return "interface"
  if (value === "type") return "type"
  if (value === "enum") return "enum"
  return "variable"
}

function fileEdgeKind(value?: string): FileEdge["kind"] {
  if (value === "reference" || value === "call") return value
  return "import"
}

function unavailable() {
  return Info.make({
    status: "unavailable",
    files: 0,
    languages: [],
    modules: [],
    relationships: [],
    landmarks: [],
    symbols: [],
    edges: [],
    semantic: Semantic.make({ status: "unavailable", files: 0, servers: [] }),
  })
}

function normalize(file: string) {
  return file
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
}

function isManifest(file: string) {
  return manifestNames.has(path.posix.basename(file))
}

function isGraphSource(file: string) {
  return sourceExtensions.has(path.posix.extname(file).toLowerCase())
}

function semanticCandidates(files: ReadonlyArray<string>, info: Info) {
  const priority = new Set(
    [...info.landmarks.map((item) => item.path), ...info.modules.flatMap((item) => item.entrypoints)].filter(
      isGraphSource,
    ),
  )
  return [
    ...priority,
    ...balanced(
      files.filter((file) => isGraphSource(file) && !priority.has(file)).toSorted(comparePath),
      area,
      MAX_SEMANTIC_FILES,
    ),
  ].slice(0, MAX_SEMANTIC_FILES)
}

function depth(file: string) {
  return file === "." ? 0 : file.split("/").length
}

function comparePath(left: string, right: string) {
  return depth(left) - depth(right) || left.localeCompare(right)
}

function count(values: ReadonlyArray<string>) {
  const result = new Map<string, number>()
  values.forEach((value) => result.set(value, (result.get(value) ?? 0) + 1))
  return result
}

function group<A>(values: ReadonlyArray<A>, key: (value: A) => string) {
  const result = new Map<string, A[]>()
  values.forEach((value) => result.set(key(value), [...(result.get(key(value)) ?? []), value]))
  return result
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function parseManifest(content?: string) {
  const value = content ? Option.getOrUndefined(decodeJson(content)) : undefined
  if (!isRecord(value)) return { dependencies: [] as string[] }
  const dependencies = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
    (field) => {
      const list = value[field]
      return isRecord(list) ? Object.keys(list) : []
    },
  )
  return { name: typeof value.name === "string" ? value.name : undefined, dependencies }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function language(file: string) {
  if (file.endsWith(".blade.php")) return "Blade"
  return languageByExtension[path.posix.extname(file).toLowerCase()] ?? "Other"
}

function importSpecifier(line: string) {
  const javascript = line.match(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"']+)["']/)
  if (javascript) return javascript[1]
  const python = line.match(/^\s*from\s+([.\w]+)\s+import\s+/)
  if (python) return python[1]
  const rust = line.match(/^\s*use\s+([\w:]+)/)
  return rust?.[1]
}

function resolveImport(
  file: string,
  specifier: string,
  owner: (file: string) => string,
  packages: ReadonlyMap<string, string>,
) {
  if (specifier.startsWith(".")) {
    const python = specifier.match(/^(\.+)(.*)$/)
    const relative =
      python && !specifier.includes("/")
        ? `${"../".repeat(Math.max(0, python[1].length - 1))}${python[2].replaceAll(".", "/")}`
        : specifier
    return owner(normalize(path.posix.join(path.posix.dirname(file), relative)))
  }
  return Array.from(packages)
    .toSorted(([left], [right]) => right.length - left.length)
    .find(([name]) => specifier === name || specifier.startsWith(`${name}/`))?.[1]
}

function resolveImportFile(file: string, specifier: string, files: ReadonlySet<string>) {
  if (!specifier.startsWith(".")) return undefined
  const python = specifier.match(/^(\.+)(.*)$/)
  const relative =
    python && !specifier.includes("/")
      ? `${"../".repeat(Math.max(0, python[1].length - 1))}${python[2].replaceAll(".", "/")}`
      : specifier
  const base = normalize(path.posix.join(path.posix.dirname(file), relative))
  return [
    base,
    ...Array.from(sourceExtensions).flatMap((extension) => [`${base}${extension}`, `${base}/index${extension}`]),
  ].find((candidate) => files.has(candidate))
}

function landmarkFiles(files: ReadonlyArray<string>) {
  const landmarks = files.flatMap((file): Landmark[] => {
    const lower = file.toLowerCase()
    const basename = path.posix.basename(lower)
    const extension = path.posix.extname(lower)
    const source = sourceExtensions.has(extension)
    if (isNoisy(lower)) return []
    const kind = (() => {
      if (source && (/(^|\/)(routes?|router|routing)(\/|\.)/.test(lower) || /^(api|web)\.php$/.test(basename)))
        return "routes"
      if (source && (/(^|\/)controllers?\//.test(lower) || /controller\.[^.]+$/.test(lower))) return "controllers"
      if (source && (/(^|\/)components?\//.test(lower) || /\.component\.[^.]+$/.test(lower))) return "components"
      if (/(^|\/)(config|configs)\//.test(lower) || /(^|\.)(config|settings)\.[^.]+$/.test(basename)) return "config"
      if (source && (/(^|\/)(schema|schemas)\//.test(lower) || /(^|\.)schema\.[^.]+$/.test(basename))) return "schema"
      if ((source || extension === ".sql") && /(^|\/)(migration|migrations)\//.test(lower)) return "migrations"
      return undefined
    })()
    return kind ? [Landmark.make({ kind, path: file })] : []
  })
  return Array.from(group(landmarks, (item) => item.kind)).flatMap(([, items]) =>
    balanced(
      items.toSorted((left, right) => comparePath(left.path, right.path)),
      (item) => area(item.path),
      MAX_LANDMARKS_PER_KIND,
    ),
  )
}

function isNoisy(file: string) {
  return (
    /(^|\/)(test|tests|e2e|fixtures?|assets?)\//.test(file.toLowerCase()) ||
    /\.(test|spec|stories)\.[^.]+$/.test(path.posix.basename(file).toLowerCase())
  )
}

function area(file: string) {
  const parts = file.split("/")
  return parts[0] === "packages" && parts.length > 1 ? parts.slice(0, 2).join("/") : parts[0]
}

function balanced<A>(values: ReadonlyArray<A>, key: (value: A) => string, limit: number) {
  const groups = Array.from(group(values, key).values())
  return Array.from({ length: limit })
    .flatMap((_, index) => groups.flatMap((items) => items[index] ?? []))
    .slice(0, limit)
}
