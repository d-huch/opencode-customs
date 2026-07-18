import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as LSPClient from "./client"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import * as LSPServer from "./server"
import { Config } from "@/config/config"
import { Process } from "@/util/process"
import { spawn as lspspawn } from "./launch"
import { Effect, Layer, Context, Option, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { containsPath, type InstanceContext } from "@/project/instance-context"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LspEvent } from "@opencode-ai/schema/lsp-event"
import { Project } from "@opencode-ai/schema/project"
import { RepositoryMap } from "@opencode-ai/schema/repository-map"
import { RepositorySemantic } from "@opencode-ai/core/repository-semantic"
import { InstanceRef } from "@/effect/instance-ref"

export const Event = LspEvent

const Position = Schema.Struct({
  line: NonNegativeInt,
  character: NonNegativeInt,
})

export const Range = Schema.Struct({
  start: Position,
  end: Position,
}).annotate({ identifier: "Range" })
export type Range = typeof Range.Type

export const Symbol = Schema.Struct({
  name: Schema.String,
  kind: NonNegativeInt,
  location: Schema.Struct({
    uri: Schema.String,
    range: Range,
  }),
}).annotate({ identifier: "Symbol" })
export type Symbol = typeof Symbol.Type

export const DocumentSymbol = Schema.Struct({
  name: Schema.String,
  detail: Schema.optional(Schema.String),
  kind: NonNegativeInt,
  range: Range,
  selectionRange: Range,
}).annotate({ identifier: "DocumentSymbol" })
export type DocumentSymbol = typeof DocumentSymbol.Type

export const Status = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["connected", "error"]),
}).annotate({ identifier: "LSPStatus" })
export type Status = typeof Status.Type

enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

const kinds = [
  SymbolKind.Class,
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Interface,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.Struct,
  SymbolKind.Enum,
]

const filterExperimentalServers = (servers: Record<string, LSPServer.Info>, flags: RuntimeFlags.Info) => {
  if (flags.experimentalLspTy) {
    if (servers["pyright"]) {
      delete servers["pyright"]
    }
  } else {
    if (servers["ty"]) {
      delete servers["ty"]
    }
  }
}

type LocInput = { file: string; line: number; character: number }

interface State {
  clients: LSPClient.Info[]
  servers: Record<string, LSPServer.Info>
  broken: Set<string>
  spawning: Map<string, Promise<LSPClient.Info | undefined>>
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status[]>
  readonly hasClients: (file: string, servers?: ReadonlySet<string>) => Effect.Effect<boolean>
  readonly touchFile: (
    input: string,
    diagnostics?: "document" | "full",
    servers?: ReadonlySet<string>,
  ) => Effect.Effect<void>
  readonly diagnostics: () => Effect.Effect<Record<string, LSPClient.Diagnostic[]>>
  readonly hover: (input: LocInput) => Effect.Effect<any>
  readonly definition: (input: LocInput, servers?: ReadonlySet<string>) => Effect.Effect<any[]>
  readonly references: (input: LocInput, servers?: ReadonlySet<string>) => Effect.Effect<any[]>
  readonly implementation: (input: LocInput) => Effect.Effect<any[]>
  readonly documentSymbol: (uri: string, servers?: ReadonlySet<string>) => Effect.Effect<(DocumentSymbol | Symbol)[]>
  readonly workspaceSymbol: (query: string) => Effect.Effect<Symbol[]>
  readonly prepareCallHierarchy: (input: LocInput) => Effect.Effect<any[]>
  readonly incomingCalls: (input: LocInput) => Effect.Effect<any[]>
  readonly outgoingCalls: (input: LocInput, servers?: ReadonlySet<string>) => Effect.Effect<any[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LSP") {}

async function requestClients<T>(clients: ReadonlyArray<LSPClient.Info>, fn: (client: LSPClient.Info) => Promise<T>) {
  const result = await Promise.all(
    clients
      .filter((client) => !client.closed)
      .map(async (client) => {
        try {
          return { success: true as const, value: await fn(client) }
        } catch {
          return { success: false as const }
        }
      }),
  )
  return result.flatMap((item) => (item.success ? [item.value] : []))
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("LSP.state")(function* () {
        const cfg = yield* config.get()
        const enabled = cfg.lsp ?? (flags.client === "desktop")

        const servers: Record<string, LSPServer.Info> = {}

        if (!enabled) {
          yield* Effect.logInfo("all LSPs are disabled")
        } else {
          for (const server of Object.values(LSPServer)) {
            servers[server.id] = server
          }

          filterExperimentalServers(servers, flags)

          if (enabled !== true) {
            for (const [name, item] of Object.entries(enabled)) {
              const existing = servers[name]
              if (item.disabled) {
                yield* Effect.logInfo(`LSP server ${name} is disabled`)
                delete servers[name]
                continue
              }
              servers[name] = {
                ...existing,
                id: name,
                root: existing?.root ?? (async (_file, ctx) => ctx.directory),
                extensions: item.extensions ?? existing?.extensions ?? [],
                spawn: async (root) => ({
                  process: lspspawn(item.command[0], item.command.slice(1), {
                    cwd: root,
                    env: { ...process.env, ...item.env },
                  }),
                  initialization: item.initialization,
                }),
              }
            }
          }

          yield* Effect.logInfo("enabled LSP servers", {
            serverIds: Object.values(servers)
              .map((server) => server.id)
              .join(", "),
          })
        }

        const s: State = {
          clients: [],
          servers,
          broken: new Set(),
          spawning: new Map(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await Promise.all(s.clients.map((client) => client.shutdown()))
          }),
        )

        return s
      }),
    )

    const getClients = Effect.fnUntraced(function* (file: string, serverIDs?: ReadonlySet<string>) {
      const ctx = yield* InstanceState.context
      if (!containsPath(file, ctx)) return [] as LSPClient.Info[]
      const s = yield* InstanceState.get(state)
      const clients = yield* Effect.promise(async () => {
        const extension = path.parse(file).ext || file
        const result: LSPClient.Info[] = []
        let updated = 0
        s.clients = s.clients.filter((client) => !client.closed)

        async function schedule(server: LSPServer.Info, root: string, key: string) {
          const handle = await server
            .spawn(root, ctx, flags)
            .then((value) => {
              if (!value) s.broken.add(key)
              return value
            })
            .catch(() => {
              s.broken.add(key)
              return undefined
            })

          if (!handle) return undefined
          const client = await LSPClient.create({
            serverID: server.id,
            server: handle,
            root,
            directory: ctx.directory,
            instance: ctx,
          }).catch(async () => {
            s.broken.add(key)
            await Process.stop(handle.process)
            return undefined
          })

          if (!client) return undefined

          const existing = s.clients.find((x) => x.root === root && x.serverID === server.id && !x.closed)
          if (existing) {
            await Process.stop(handle.process)
            return existing
          }

          s.clients.push(client)
          return client
        }

        for (const server of Object.values(s.servers)) {
          if (serverIDs && !serverIDs.has(server.id)) continue
          if (server.extensions.length && !server.extensions.includes(extension)) continue

          const root = await server.root(file, ctx)
          if (!root) continue
          if (s.broken.has(root + server.id)) continue

          const match = s.clients.find((x) => x.root === root && x.serverID === server.id && !x.closed)
          if (match) {
            result.push(match)
            continue
          }

          const inflight = s.spawning.get(root + server.id)
          if (inflight) {
            const client = await inflight
            if (!client) continue
            result.push(client)
            continue
          }

          const task = schedule(server, root, root + server.id)
          s.spawning.set(root + server.id, task)

          void task.finally(() => {
            if (s.spawning.get(root + server.id) === task) {
              s.spawning.delete(root + server.id)
            }
          })

          const client = await task
          if (!client) continue

          result.push(client)
          updated++
        }

        return { result, updated }
      })
      yield* Effect.forEach(Array.from({ length: clients.updated }), () => events.publish(Event.Updated, {}), {
        discard: true,
      })
      return clients.result
    })

    const run = Effect.fnUntraced(function* <T>(
      file: string,
      fn: (client: LSPClient.Info) => Promise<T>,
      serverIDs?: ReadonlySet<string>,
    ) {
      const clients = yield* getClients(file, serverIDs)
      return yield* Effect.promise(() => requestClients(clients, fn))
    })

    const runAll = Effect.fnUntraced(function* <T>(fn: (client: LSPClient.Info) => Promise<T>) {
      const s = yield* InstanceState.get(state)
      return yield* Effect.promise(() => requestClients(s.clients, fn))
    })

    const init = Effect.fn("LSP.init")(function* () {
      yield* InstanceState.get(state)
    })

    const status = Effect.fn("LSP.status")(function* () {
      const ctx = yield* InstanceState.context
      const s = yield* InstanceState.get(state)
      const result: Status[] = []
      for (const client of s.clients.filter((item) => !item.closed)) {
        result.push({
          id: client.serverID,
          name: s.servers[client.serverID].id,
          root: path.relative(ctx.directory, client.root),
          status: "connected",
        })
      }
      return result
    })

    const hasClients = Effect.fn("LSP.hasClients")(function* (file: string, serverIDs?: ReadonlySet<string>) {
      const ctx = yield* InstanceState.context
      const s = yield* InstanceState.get(state)
      return yield* Effect.promise(async () => {
        const extension = path.parse(file).ext || file
        for (const server of Object.values(s.servers)) {
          if (serverIDs && !serverIDs.has(server.id)) continue
          if (server.extensions.length && !server.extensions.includes(extension)) continue
          const root = await server.root(file, ctx)
          if (!root) continue
          if (s.broken.has(root + server.id)) continue
          return true
        }
        return false
      })
    })

    const touchFile = Effect.fn("LSP.touchFile")(function* (
      input: string,
      diagnostics?: "document" | "full",
      serverIDs?: ReadonlySet<string>,
    ) {
      yield* Effect.logInfo("touching file", { file: input })
      const clients = yield* getClients(input, serverIDs)
      yield* Effect.promise(() =>
        Promise.all(
          clients.map(async (client) => {
            const after = Date.now()
            const version = await client.notify.open({ path: input })
            if (!diagnostics) return
            return client.waitForDiagnostics({
              path: input,
              version,
              mode: diagnostics,
              after,
            })
          }),
        ).catch(() => {}),
      )
    })

    const diagnostics = Effect.fn("LSP.diagnostics")(function* () {
      const results: Record<string, LSPClient.Diagnostic[]> = {}
      const all = yield* runAll(async (client) => client.diagnostics)
      for (const result of all) {
        for (const [p, diags] of result.entries()) {
          const arr = results[p] || []
          arr.push(...diags)
          results[p] = arr
        }
      }
      return results
    })

    const hover = Effect.fn("LSP.hover")(function* (input: LocInput) {
      return yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/hover", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
    })

    const definition = Effect.fn("LSP.definition")(function* (input: LocInput, serverIDs?: ReadonlySet<string>) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/definition", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
        serverIDs,
      )
      return results.flat().filter(Boolean)
    })

    const references = Effect.fn("LSP.references")(function* (input: LocInput, serverIDs?: ReadonlySet<string>) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/references", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            context: { includeDeclaration: true },
          })
          .catch(() => []),
        serverIDs,
      )
      return results.flat().filter(Boolean)
    })

    const implementation = Effect.fn("LSP.implementation")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/implementation", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const documentSymbol = Effect.fn("LSP.documentSymbol")(function* (uri: string, serverIDs?: ReadonlySet<string>) {
      const file = fileURLToPath(uri)
      const results = yield* run(
        file,
        (client) =>
          client.connection
            .sendRequest<(DocumentSymbol | Symbol)[]>("textDocument/documentSymbol", { textDocument: { uri } })
            .catch(() => []),
        serverIDs,
      )
      return results.flat().filter(Boolean)
    })

    const workspaceSymbol = Effect.fn("LSP.workspaceSymbol")(function* (query: string) {
      const results = yield* runAll((client) =>
        client.connection
          .sendRequest<Symbol[]>("workspace/symbol", { query })
          .then((result) => result.filter((x) => kinds.includes(x.kind)).slice(0, 10))
          .catch(() => [] as Symbol[]),
      )
      return results.flat()
    })

    const prepareCallHierarchy = Effect.fn("LSP.prepareCallHierarchy")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/prepareCallHierarchy", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const callHierarchyRequest = Effect.fnUntraced(function* (
      input: LocInput,
      direction: "callHierarchy/incomingCalls" | "callHierarchy/outgoingCalls",
      serverIDs?: ReadonlySet<string>,
    ) {
      const results = yield* run(
        input.file,
        async (client) => {
          const items = await client.connection
            .sendRequest<unknown[] | null>("textDocument/prepareCallHierarchy", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => [] as unknown[])
          if (!items?.length) return []
          return client.connection.sendRequest(direction, { item: items[0] }).catch(() => [])
        },
        serverIDs,
      )
      return results.flat().filter(Boolean)
    })

    const incomingCalls = Effect.fn("LSP.incomingCalls")(function* (input: LocInput) {
      return yield* callHierarchyRequest(input, "callHierarchy/incomingCalls")
    })

    const outgoingCalls = Effect.fn("LSP.outgoingCalls")(function* (
      input: LocInput,
      serverIDs?: ReadonlySet<string>,
    ) {
      return yield* callHierarchyRequest(input, "callHierarchy/outgoingCalls", serverIDs)
    })

    const service = Service.of({
      init,
      status,
      hasClients,
      touchFile,
      diagnostics,
      hover,
      definition,
      references,
      implementation,
      documentSymbol,
      workspaceSymbol,
      prepareCallHierarchy,
      incomingCalls,
      outgoingCalls,
    })
    const unregister = RepositorySemantic.register({
      enrich: (input) => enrichRepository(service, input),
      search: (input) => searchRepository(service, input),
    })
    yield* Effect.addFinalizer(() => Effect.sync(unregister))
    return service
  }),
)

const MAX_RELATION_SYMBOLS = 12
const fileURL = Option.liftThrowable(fileURLToPath)
const semanticClassKinds = new Set([5, 23])
const semanticCallableKinds = new Set([6, 9, 12])

type SemanticSymbol = {
  readonly symbol: RepositoryMap.SymbolNode
  readonly kind: number
  readonly position: { readonly line: number; readonly character: number }
}

export function enrichRepository(lsp: Interface, input: RepositorySemantic.Input) {
  const context: InstanceContext = {
    directory: input.directory,
    worktree: input.worktree,
    project: {
      id: Project.ID.make(input.projectID),
      worktree: input.worktree,
      time: { created: 0, updated: 0 },
      sandboxes: [],
    },
  }

  return Effect.gen(function* () {
    const unavailable = new Set<string>()
    const documents = yield* Effect.forEach(
      input.files,
      (file) => {
        const absolute = path.join(input.directory, file)
        const servers = semanticServers(absolute)
        if (Array.from(servers).some((server) => unavailable.has(server))) return Effect.succeed(undefined)
        return Effect.gen(function* () {
          if (!(yield* lsp.hasClients(absolute, servers))) return undefined
          yield* lsp.touchFile(absolute, undefined, servers)
          const symbols = semanticSymbols(
            yield* lsp.documentSymbol(pathToFileURL(absolute).href, servers),
            file,
            input.directory,
          )
          return { file, symbols }
        }).pipe(
          Effect.timeout("20 seconds"),
          Effect.catch(() =>
            Effect.sync(() => {
              servers.forEach((server) => unavailable.add(server))
              return undefined
            }),
          ),
        )
      },
      { concurrency: 1 },
    )
    const servers = (yield* lsp.status()).map((item) => item.name).toSorted()
    const active = documents.filter((item): item is NonNullable<typeof item> => item !== undefined)
    if (servers.length === 0) return { files: [], servers, symbols: [], edges: [] }

    const edges = yield* Effect.forEach(
      active
        .flatMap((item) => item.symbols)
        .filter((item) => semanticKind(item.kind) !== "variable")
        .slice(0, MAX_RELATION_SYMBOLS),
      (item) =>
        Effect.gen(function* () {
          const absolute = path.join(input.directory, item.symbol.path)
          const location = { file: absolute, ...item.position }
          const servers = semanticServers(absolute)
          const [definitions, references, calls] = yield* Effect.all(
            [
              lsp.definition(location, servers),
              lsp.references(location, servers),
              isCallable(item.kind) ? lsp.outgoingCalls(location, servers) : Effect.succeed([]),
            ],
            { concurrency: "unbounded" },
          )
          return [
            ...definitionEdges(item.symbol.path, definitions, input.directory),
            ...referenceEdges(item.symbol.path, references, input.directory),
            ...callEdges(item.symbol.path, calls, input.directory),
          ]
        }).pipe(
          Effect.timeout("15 seconds"),
          Effect.catch(() => Effect.succeed([])),
        ),
      { concurrency: 1 },
    )

    return {
      files: active.map((item) => item.file),
      servers: Array.from(new Set(servers)),
      symbols: Array.from(
        new Map(
          active
            .flatMap((item) => item.symbols)
            .map((item) => [
              `${item.symbol.path}\0${item.symbol.name}\0${item.symbol.kind}`,
              item.symbol,
            ]),
        ).values(),
      ),
      edges: dedupeEdges(edges.flat()),
    }
  }).pipe(Effect.provideService(InstanceRef, context))
}

export function searchRepository(lsp: Interface, input: RepositorySemantic.SearchInput) {
  const context: InstanceContext = {
    directory: input.directory,
    worktree: input.worktree,
    project: {
      id: Project.ID.make(input.projectID),
      worktree: input.worktree,
      time: { created: 0, updated: 0 },
      sandboxes: [],
    },
  }

  return Effect.gen(function* () {
    yield* Effect.forEach(
      Array.from(
        input.files.reduce((result, file) => {
          const absolute = path.join(input.directory, file)
          const key = Array.from(semanticServers(absolute)).join("\0")
          if (key && !result.has(key)) result.set(key, absolute)
          return result
        }, new Map<string, string>()).values(),
      ).slice(0, 2),
      (file) =>
        Effect.gen(function* () {
          const servers = semanticServers(file)
          if (!(yield* lsp.hasClients(file, servers))) return
          yield* lsp.touchFile(file, undefined, servers)
        }).pipe(Effect.timeout("8 seconds"), Effect.catch(() => Effect.void)),
      { concurrency: 1, discard: true },
    )

    const query = input.query.toLocaleLowerCase()
    const symbols = semanticSymbols(yield* lsp.workspaceSymbol(input.query), "", input.directory)
      .filter((item) => {
        const name = item.symbol.name.toLocaleLowerCase()
        return item.symbol.path && (name === query || name.includes(query) || query.includes(name))
      })
      .toSorted((left, right) => {
        const leftExact = left.symbol.name.toLocaleLowerCase() === query ? 0 : 1
        const rightExact = right.symbol.name.toLocaleLowerCase() === query ? 0 : 1
        return leftExact - rightExact || left.symbol.path.localeCompare(right.symbol.path)
      })
      .slice(0, 6)
    const edges = yield* Effect.forEach(
      symbols.slice(0, 2),
      (item) =>
        Effect.gen(function* () {
          const absolute = path.join(input.directory, item.symbol.path)
          const location = { file: absolute, ...item.position }
          const servers = semanticServers(absolute)
          const [references, calls] = yield* Effect.all(
            [
              lsp.references(location, servers),
              isCallable(item.kind) ? lsp.outgoingCalls(location, servers) : Effect.succeed([]),
            ],
            { concurrency: "unbounded" },
          )
          return [
            ...referenceEdges(item.symbol.path, references, input.directory),
            ...callEdges(item.symbol.path, calls, input.directory),
          ]
        }).pipe(Effect.timeout("8 seconds"), Effect.catch(() => Effect.succeed([]))),
      { concurrency: 1 },
    )
    return {
      query: input.query,
      servers: Array.from(new Set((yield* lsp.status()).map((item) => item.name))).toSorted(),
      symbols: Array.from(
        new Map(
          symbols.map((item) => [
            `${item.symbol.path}\0${item.symbol.name}\0${item.symbol.kind}`,
            item.symbol,
          ]),
        ).values(),
      ),
      edges: dedupeEdges(edges.flat()),
    }
  }).pipe(Effect.provideService(InstanceRef, context))
}

function semanticSymbols(input: ReadonlyArray<unknown>, fallback: string, directory: string): SemanticSymbol[] {
  return input.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.kind !== "number") return []
    const location = isRecord(item.location) ? item.location : undefined
    const uri = location && typeof location.uri === "string" ? location.uri : undefined
    const target = uri ? relativeFile(uri, directory) : undefined
    const range = readRange(location?.range) ?? readRange(item.selectionRange) ?? readRange(item.range)
    if (!range) return semanticSymbols(Array.isArray(item.children) ? item.children : [], fallback, directory)
    const file = target && !target.startsWith("../") ? target : fallback
    const symbol = RepositoryMap.SymbolNode.make({
      name: item.name,
      kind: semanticKind(item.kind),
      path: file,
      line: range.line + 1,
      source: "lsp",
    })
    return [
      { symbol, kind: item.kind, position: range },
      ...semanticSymbols(Array.isArray(item.children) ? item.children : [], fallback, directory),
    ]
  })
}

function definitionEdges(from: string, input: unknown, directory: string) {
  return relationFiles(input, directory).flatMap((to) =>
    to === from ? [] : [RepositoryMap.FileEdge.make({ from, to, kind: "reference", references: 1 })],
  )
}

function referenceEdges(to: string, input: unknown, directory: string) {
  return relationFiles(input, directory).flatMap((from) =>
    from === to ? [] : [RepositoryMap.FileEdge.make({ from, to, kind: "reference", references: 1 })],
  )
}

function callEdges(from: string, input: unknown, directory: string) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.to) || typeof item.to.uri !== "string") return []
    const to = relativeFile(item.to.uri, directory)
    return !to || to === from ? [] : [RepositoryMap.FileEdge.make({ from, to, kind: "call", references: 1 })]
  })
}

function relationFiles(input: unknown, directory: string) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    if (!isRecord(item)) return []
    const uri = typeof item.uri === "string" ? item.uri : typeof item.targetUri === "string" ? item.targetUri : undefined
    const file = uri ? relativeFile(uri, directory) : undefined
    return file ? [file] : []
  })
}

function relativeFile(uri: string, directory: string) {
  const file = Option.getOrUndefined(fileURL(uri))
  if (!file) return undefined
  const relative = path.relative(directory, file).replaceAll("\\", "/")
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) return undefined
  return relative
}

function readRange(input: unknown) {
  if (!isRecord(input) || !isRecord(input.start)) return undefined
  if (typeof input.start.line !== "number" || typeof input.start.character !== "number") return undefined
  return { line: input.start.line, character: input.start.character }
}

function semanticKind(kind: number): RepositoryMap.SymbolNode["kind"] {
  if (semanticClassKinds.has(kind)) return "class"
  if (semanticCallableKinds.has(kind)) return "function"
  if (kind === 11) return "interface"
  if (kind === 10) return "enum"
  if (kind === 26) return "type"
  return "variable"
}

function isCallable(kind: number) {
  return semanticCallableKinds.has(kind)
}

function semanticServers(file: string) {
  const extension = path.extname(file).toLowerCase()
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].includes(extension))
    return new Set(["typescript"])
  if (extension === ".vue") return new Set(["vue"])
  if (extension === ".php") return new Set(["php intelephense"])
  if (extension === ".py") return new Set(["pyright", "ty"])
  if (extension === ".go") return new Set(["gopls"])
  if (extension === ".rs") return new Set(["rust"])
  if (extension === ".java") return new Set(["jdtls"])
  if (extension === ".kt" || extension === ".kts") return new Set(["kotlin-ls"])
  if (extension === ".cs") return new Set(["csharp"])
  if (extension === ".rb") return new Set(["ruby-lsp"])
  if (extension === ".swift") return new Set(["sourcekit-lsp"])
  if (extension === ".svelte") return new Set(["svelte"])
  return new Set<string>()
}

function dedupeEdges(input: ReadonlyArray<RepositoryMap.FileEdge>) {
  return Array.from(
    input.reduce((result, edge) => {
      const key = `${edge.from}\0${edge.to}\0${edge.kind}`
      const current = result.get(key)
      result.set(key, RepositoryMap.FileEdge.make({ ...edge, references: edge.references + (current?.references ?? 0) }))
      return result
    }, new Map<string, RepositoryMap.FileEdge>()),
  ).map(([, edge]) => edge)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
}

export * as Diagnostic from "./diagnostic"

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, RuntimeFlags.node, FSUtil.node, EventV2Bridge.node],
})

export * as LSP from "./lsp"
