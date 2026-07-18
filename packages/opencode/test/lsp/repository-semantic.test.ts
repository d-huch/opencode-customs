import { expect, test } from "bun:test"
import { Effect } from "effect"
import { pathToFileURL } from "url"
import { enrichRepository, searchRepository, type LSP } from "@/lsp/lsp"

test("converts LSP symbols, definitions, references, and calls into repository graph data", async () => {
  const directory = "/repo"
  const uri = (file: string) => pathToFileURL(`${directory}/${file}`).href
  const range = { start: { line: 6, character: 2 }, end: { line: 6, character: 13 } }
  const lsp: LSP.Interface = {
    init: () => Effect.void,
    status: () => Effect.succeed([{ id: "typescript", name: "typescript", root: "", status: "connected" }]),
    hasClients: () => Effect.succeed(true),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(null),
    definition: () => Effect.succeed([{ uri: uri("src/service.ts"), range }]),
    references: () => Effect.succeed([{ uri: uri("src/view.ts"), range }]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () =>
      Effect.succeed([
        {
          name: "savePenalty",
          kind: 12,
          range,
          selectionRange: range,
        },
      ]),
    workspaceSymbol: () =>
      Effect.succeed([
        {
          name: "savePenalty",
          kind: 12,
          location: { uri: uri("src/controller.ts"), range },
        },
      ]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([{ to: { uri: uri("src/model.ts") } }]),
  }

  const result = await Effect.runPromise(
    enrichRepository(lsp, {
      directory,
      worktree: directory,
      projectID: "project",
      files: ["src/controller.ts"],
    }),
  )

  expect(result.files).toEqual(["src/controller.ts"])
  expect(result.servers).toEqual(["typescript"])
  expect(result.symbols).toEqual([
    {
      name: "savePenalty",
      kind: "function",
      path: "src/controller.ts",
      line: 7,
      source: "lsp",
    },
  ])
  expect(result.edges).toEqual([
    { from: "src/controller.ts", to: "src/service.ts", kind: "reference", references: 1 },
    { from: "src/view.ts", to: "src/controller.ts", kind: "reference", references: 1 },
    { from: "src/controller.ts", to: "src/model.ts", kind: "call", references: 1 },
  ])

  const lookup = await Effect.runPromise(
    searchRepository(lsp, {
      directory,
      worktree: directory,
      projectID: "project",
      query: "savePenalty",
      files: ["src/controller.ts"],
    }),
  )

  expect(lookup).toEqual({
    query: "savePenalty",
    servers: ["typescript"],
    symbols: [
      {
        name: "savePenalty",
        kind: "function",
        path: "src/controller.ts",
        line: 7,
        source: "lsp",
      },
    ],
    edges: [
      { from: "src/view.ts", to: "src/controller.ts", kind: "reference", references: 1 },
      { from: "src/controller.ts", to: "src/model.ts", kind: "call", references: 1 },
    ],
  })
})
