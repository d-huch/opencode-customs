import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Location } from "@opencode-ai/core/location"
import { RepositoryContextRouter } from "@opencode-ai/core/repository-context-router"
import { RepositoryMap } from "@opencode-ai/core/repository-map"
import { RepositorySemantic } from "@opencode-ai/core/repository-semantic"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const repositoryFiles = ["src/index.ts", "src/routes/session.ts", "src/components/sidebar.tsx"]
const repositoryLayer = AppNodeBuilder.build(
  LayerNode.group([RepositoryMap.node, RepositoryContextRouter.node, SystemContextRegistry.node, EventV2.node]),
  [
    [
      Location.node,
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/repo") }))),
    ],
    [
      Ripgrep.node,
      Layer.succeed(
        Ripgrep.Service,
        Ripgrep.Service.of({
          find: () =>
            Effect.succeed(
              repositoryFiles.map((file) => FileSystem.Entry.make({ path: RelativePath.make(file), type: "file" })),
            ),
          glob: () => Effect.succeed([]),
          // Import discovery is enrichment. A pathological generated line must not
          // prevent the structural map and per-file parser from being available.
          grep: (input) =>
            input.pattern.includes("журна")
              ? Effect.succeed([
                  FileSystem.Match.make({
                    entry: FileSystem.Entry.make({
                      path: RelativePath.make("app/Http/Controllers/Api/UserController.php"),
                      type: "file",
                    }),
                    line: 160,
                    offset: 0,
                    text: "Журнали NavigationItem getNavigationItems journals",
                    submatches: [],
                  }),
                  FileSystem.Match.make({
                    entry: FileSystem.Entry.make({
                      path: RelativePath.make("resources/js/components/NavigationSidebar.vue"),
                      type: "file",
                    }),
                    line: 24,
                    offset: 0,
                    text: "Меню NavigationSidebar navigationItems",
                    submatches: [],
                  }),
                  FileSystem.Match.make({
                    entry: FileSystem.Entry.make({
                      path: RelativePath.make("app/Models/Soldier.php"),
                      type: "file",
                    }),
                    line: 30,
                    offset: 0,
                    text: "солдатами Soldier People Person",
                    submatches: [],
                  }),
                  FileSystem.Match.make({
                    entry: FileSystem.Entry.make({
                      path: RelativePath.make("resources/js/pages/journals/SoldierStatusJournal.vue"),
                      type: "file",
                    }),
                    line: 1,
                    offset: 0,
                    text: "статусом SoldierStatusJournal status state",
                    submatches: [],
                  }),
                ])
              : input.pattern.includes("Navigation") || input.pattern.includes("Soldier")
                ? Effect.succeed([
                    FileSystem.Match.make({
                      entry: FileSystem.Entry.make({
                        path: RelativePath.make("app/Http/Controllers/Api/UserController.php"),
                        type: "file",
                      }),
                      line: 160,
                      offset: 0,
                      text: "getNavigationItems journals",
                      submatches: [],
                    }),
                    FileSystem.Match.make({
                      entry: FileSystem.Entry.make({ path: RelativePath.make("routes/web.php"), type: "file" }),
                      line: 80,
                      offset: 0,
                      text: "SoldierStatusJournal journals.soldier-status-page",
                      submatches: [],
                    }),
                    FileSystem.Match.make({
                      entry: FileSystem.Entry.make({
                        path: RelativePath.make("app/Http/Controllers/Journals/SoldierStatusJournalController.php"),
                        type: "file",
                      }),
                      line: 12,
                      offset: 0,
                      text: "SoldierStatusJournalController",
                      submatches: [],
                    }),
                    FileSystem.Match.make({
                      entry: FileSystem.Entry.make({
                        path: RelativePath.make("app/Models/Soldier.php"),
                        type: "file",
                      }),
                      line: 30,
                      offset: 0,
                      text: "soldier status",
                      submatches: [],
                    }),
                    FileSystem.Match.make({
                      entry: FileSystem.Entry.make({
                        path: RelativePath.make("resources/js/pages/journals/SoldierStatusJournal.vue"),
                        type: "file",
                      }),
                      line: 1,
                      offset: 0,
                      text: "SoldierStatusJournal",
                      submatches: [],
                    }),
                    FileSystem.Match.make({
                      entry: FileSystem.Entry.make({
                        path: RelativePath.make("resources/js/components/NavigationSidebar.vue"),
                        type: "file",
                      }),
                      line: 24,
                      offset: 0,
                      text: "navigation journals",
                      submatches: [],
                    }),
                  ])
                : Effect.fail(new Ripgrep.Error({ message: "Ripgrep JSON record exceeded 65536 bytes" })),
        }),
      ),
    ],
  ],
)
const it = testEffect(repositoryLayer)

describe("RepositoryMap", () => {
  it.effect("registers a compact repository outline as location-scoped model context", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const map = yield* RepositoryMap.Service
      const info = yield* map.load()
      const initialized = yield* SystemContext.initialize(yield* registry.load())
      const initialFiles = repositoryFiles.length

      expect(info.status).toBe("complete")
      expect(info.files).toBe(initialFiles)
      expect(initialized.baseline).toContain('<repository_outline status="complete">')
      expect(initialized.baseline).toContain("src/routes/session.ts")
      expect(initialized.baseline).toContain("not proof that omitted files or relationships do not exist")

      repositoryFiles.push("src/schema/session.ts")
      expect((yield* map.load()).files).toBe(initialFiles)
      expect((yield* map.refresh()).files).toBe(initialFiles + 1)
    }),
  )

  it.effect("applies file watcher changes without rebuilding the repository", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const map = yield* RepositoryMap.Service
      const initial = yield* map.load()

      yield* Effect.yieldNow
      yield* events.publish(Watcher.Event.Updated, { file: "/repo/src/index.ts", event: "unlink" })
      yield* Effect.yieldNow

      expect((yield* map.load()).files).toBe(initial.files - 1)
    }),
  )

  test("builds project areas, local relationships, languages, and landmarks", () => {
    const map = RepositoryMap.analyze({
      files: [
        "package.json",
        "packages/app/package.json",
        "packages/app/src/index.tsx",
        "packages/app/src/routes/session.tsx",
        "packages/app/src/components/sidebar.tsx",
        "packages/core/package.json",
        "packages/core/src/index.ts",
        "packages/core/src/config/settings.ts",
        "packages/core/src/schema/session.ts",
      ],
      manifests: [
        {
          path: "package.json",
          content: JSON.stringify({ name: "workspace", workspaces: ["packages/*"] }),
        },
        {
          path: "packages/app/package.json",
          content: JSON.stringify({ name: "@example/app", dependencies: { "@example/core": "workspace:*" } }),
        },
        {
          path: "packages/core/package.json",
          content: JSON.stringify({ name: "@example/core" }),
        },
      ],
      imports: [
        {
          path: "packages/app/src/index.tsx",
          text: 'import { Settings } from "@example/core/config/settings"',
        },
      ],
    })

    expect(map.status).toBe("complete")
    expect(map.files).toBe(9)
    expect(map.languages).toContainEqual({ name: "TypeScript JSX", files: 3 })
    expect(map.modules).toContainEqual(
      expect.objectContaining({ path: "packages/app", name: "@example/app", files: 4 }),
    )
    expect(map.relationships).toEqual([{ from: "packages/app", to: "packages/core", references: 2 }])
    expect(map.landmarks).toEqual(
      expect.arrayContaining([
        { kind: "routes", path: "packages/app/src/routes/session.tsx" },
        { kind: "components", path: "packages/app/src/components/sidebar.tsx" },
        { kind: "config", path: "packages/core/src/config/settings.ts" },
        { kind: "schema", path: "packages/core/src/schema/session.ts" },
      ]),
    )
  })

  test("resolves relative imports between structural areas", () => {
    const map = RepositoryMap.analyze({
      files: [
        "app/controllers/PenaltyController.ts",
        "app/models/Penalty.ts",
        "app/models/User.ts",
        "routes/api.ts",
        "routes/web.ts",
        "resources/components/PenaltyList.vue",
        "resources/components/PenaltyDetail.vue",
      ],
      imports: [
        {
          path: "app/controllers/PenaltyController.ts",
          text: 'import { Penalty } from "../models/Penalty"',
        },
      ],
    })

    expect(map.relationships).toContainEqual({ from: "app", to: "app/models", references: 1 })
    expect(map.landmarks).toContainEqual({ kind: "controllers", path: "app/controllers/PenaltyController.ts" })
    expect(map.landmarks).toContainEqual({ kind: "routes", path: "routes/api.ts" })
  })

  test("builds a file graph and routes query-specific context", () => {
    const map = RepositoryMap.analyze({
      files: ["src/index.ts", "src/config/settings.ts", "src/session/runner.ts"],
      imports: [{ path: "src/session/runner.ts", text: 'import { Settings } from "../config/settings"' }],
      symbols: [
        { name: "Settings", kind: "interface", path: "src/config/settings.ts", line: 8, source: "syntax" },
        { name: "runSession", kind: "function", path: "src/session/runner.ts", line: 12, source: "syntax" },
      ],
    })

    expect(map.edges).toEqual([
      { from: "src/session/runner.ts", to: "src/config/settings.ts", kind: "import", references: 1 },
    ])
    const routed = RepositoryContextRouter.select(map, { query: "change Settings session behavior" })
    expect(routed?.files).toContain("src/config/settings.ts")
    expect(routed?.symbols).toContainEqual(expect.objectContaining({ name: "Settings" }))
    expect(routed?.text).toContain('<repository_context source="query-router">')
    expect(routed?.text).toContain("call LSP workspaceSymbol once")
    expect(routed?.text).toContain("do not repeat equivalent grep/find/shell searches")
  })

  it.effect("learns project vocabulary and routes an abstract request through a topology slice", () =>
    Effect.gen(function* () {
      const router = yield* RepositoryContextRouter.Service
      yield* router.configureDiagnostics({ enabled: true, clear: true })
      const result = yield* router.route({
        query: "Додай новий журнал у меню з усіма солдатами та їх статусом",
      })

      expect(result?.concepts.map((concept) => concept.name)).toEqual(["журнал", "меню", "солдатами", "статусом"])
      expect(result?.concepts.find((concept) => concept.name === "журнал")?.terms).toContain("getNavigationItems")
      expect(result?.concepts.find((concept) => concept.name === "меню")?.terms).toContain("navigationItems")
      expect(result?.concepts.find((concept) => concept.name === "солдатами")?.terms).toContain("People")
      expect(result?.slice.map((item) => item.area)).toEqual(
        expect.arrayContaining([
          "app/Http/Controllers/Api",
          "routes",
          "app/Http/Controllers/Journals",
          "app/Models",
          "resources/js/pages/journals",
        ]),
      )
      expect(result?.files).toEqual(
        expect.arrayContaining([
          "app/Http/Controllers/Api/UserController.php",
          "routes/web.php",
          "app/Http/Controllers/Journals/SoldierStatusJournalController.php",
          "app/Models/Soldier.php",
          "resources/js/pages/journals/SoldierStatusJournal.vue",
        ]),
      )
      expect(result?.text).toContain("Concept expansion already applied")
      expect(result?.text).toContain("Analogous feature candidates")
      expect(result?.text).toContain("Observed implementation path")
      expect(result?.text).toContain("project's own topology")
      expect(result?.text).toContain("Do not repeat broad grep/glob discovery")
      expect((yield* router.diagnostics()).entries.map((entry) => entry.stage)).toEqual([
        "prompt",
        "map",
        "concept",
        "concept",
        "concept",
        "context",
      ])
    }),
  )

  it.effect("keeps short navigation lookups on the lightweight route", () =>
    Effect.gen(function* () {
      const router = yield* RepositoryContextRouter.Service
      yield* router.configureDiagnostics({ enabled: true, clear: true })
      const result = yield* router.route({ query: "знайди навігаційне меню" })

      expect(result?.concepts).toEqual([])
      expect((yield* router.diagnostics()).entries.map((entry) => entry.stage)).toEqual([
        "prompt",
        "map",
        "context",
      ])
    }),
  )

  test("derives implementation areas from a non-web repository topology", () => {
    const map = RepositoryMap.analyze({
      files: ["cmd/agent/main.go", "internal/tasks/handler.go", "internal/store/sqlite.go", "pkg/protocol/message.go"],
      edges: [
        { from: "cmd/agent/main.go", to: "internal/tasks/handler.go", kind: "call", references: 1 },
        { from: "internal/tasks/handler.go", to: "internal/store/sqlite.go", kind: "call", references: 2 },
        { from: "internal/tasks/handler.go", to: "pkg/protocol/message.go", kind: "import", references: 1 },
      ],
    })
    const result = RepositoryContextRouter.select(map, { query: "додай обробку черги задач" }, [], {
      concepts: [{ name: "черги", aliases: ["черги"], terms: ["TaskQueue", "enqueue"] }],
      hits: [
        {
          path: "internal/tasks/handler.go",
          line: 12,
          concepts: ["черги"],
          terms: ["TaskQueue"],
          source: "literal",
          strength: 20,
        },
      ],
    })

    expect(result?.slice.map((item) => item.area)).toEqual(
      expect.arrayContaining(["cmd/agent", "internal/tasks", "internal/store", "pkg/protocol"]),
    )
    expect(result?.text).not.toContain("controller:")
    expect(result?.text).not.toContain("page:")
  })

  test("derives a feature path from Unity assets and C# code without framework roles", () => {
    const map = RepositoryMap.analyze({
      files: [
        "Assets/Scenes/Barracks.unity",
        "Assets/Prefabs/SoldierRoster.prefab",
        "Assets/Scripts/UI/SoldierRosterPanel.cs",
        "Assets/Scripts/Runtime/SoldierRegistry.cs",
        "Assets/Scripts/Data/SoldierState.cs",
      ],
      edges: [
        {
          from: "Assets/Scripts/UI/SoldierRosterPanel.cs",
          to: "Assets/Scripts/Runtime/SoldierRegistry.cs",
          kind: "call",
          references: 2,
        },
        {
          from: "Assets/Scripts/Runtime/SoldierRegistry.cs",
          to: "Assets/Scripts/Data/SoldierState.cs",
          kind: "reference",
          references: 3,
        },
      ],
    })
    const result = RepositoryContextRouter.select(map, { query: "додай екран зі списком бійців та їх станом" }, [], {
      concepts: [
        { name: "списком", aliases: ["списком"], terms: ["SoldierRoster"] },
        { name: "станом", aliases: ["станом"], terms: ["SoldierState"] },
      ],
      hits: [
        {
          path: "Assets/Scenes/Barracks.unity",
          line: 40,
          concepts: ["списком"],
          terms: ["SoldierRosterPanel"],
          source: "literal",
          strength: 20,
        },
        {
          path: "Assets/Prefabs/SoldierRoster.prefab",
          line: 18,
          concepts: ["списком", "станом"],
          terms: ["SoldierRosterPanel", "SoldierState"],
          source: "vocabulary",
          strength: 10,
        },
        {
          path: "Assets/Scripts/UI/SoldierRosterPanel.cs",
          line: 9,
          concepts: ["списком"],
          terms: ["SoldierRoster"],
          source: "vocabulary",
          strength: 10,
        },
      ],
    })

    expect(result?.files).toEqual(
      expect.arrayContaining([
        "Assets/Scenes/Barracks.unity",
        "Assets/Prefabs/SoldierRoster.prefab",
        "Assets/Scripts/UI/SoldierRosterPanel.cs",
        "Assets/Scripts/Runtime/SoldierRegistry.cs",
        "Assets/Scripts/Data/SoldierState.cs",
      ]),
    )
    expect(result?.slice.map((item) => item.area)).toEqual(
      expect.arrayContaining([
        "Assets/Scenes",
        "Assets/Prefabs",
        "Assets/Scripts/UI",
        "Assets/Scripts/Runtime",
        "Assets/Scripts/Data",
      ]),
    )
    expect(result?.text).not.toContain("controller:")
    expect(result?.text).not.toContain("route:")
    expect(result?.text).not.toContain("page:")
  })

  test("prefers LSP symbols and routes through semantic references and calls", () => {
    const map = RepositoryMap.analyze({
      files: ["src/controller.ts", "src/service.ts", "src/model.ts"],
      symbols: [
        { name: "savePenalty", kind: "function", path: "src/controller.ts", line: 4, source: "syntax" },
        { name: "savePenalty", kind: "function", path: "src/controller.ts", line: 8, source: "lsp" },
      ],
      edges: [
        { from: "src/controller.ts", to: "src/service.ts", kind: "reference", references: 3 },
        { from: "src/service.ts", to: "src/model.ts", kind: "call", references: 2 },
      ],
      semantic: { status: "ready", files: 3, servers: ["typescript"] },
    })

    expect(map.semantic).toEqual({ status: "ready", files: 3, servers: ["typescript"] })
    expect(map.symbols.filter((symbol) => symbol.name === "savePenalty")).toEqual([
      { name: "savePenalty", kind: "function", path: "src/controller.ts", line: 8, source: "lsp" },
    ])
    expect(map.edges).toEqual([
      { from: "src/controller.ts", to: "src/service.ts", kind: "reference", references: 3 },
      { from: "src/service.ts", to: "src/model.ts", kind: "call", references: 2 },
    ])
    expect(RepositoryContextRouter.select(map, { query: "savePenalty" })?.files).toContain("src/service.ts")
    expect(RepositoryMap.render(map)).toContain("Semantic graph: ready; 3 files; servers typescript")
  })

  it.effect("runs an on-demand semantic lookup before returning routed context", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        RepositorySemantic.register({
          enrich: () => Effect.succeed({ files: [], servers: [], symbols: [], edges: [] }),
          search: (input) =>
            Effect.succeed({
              query: input.query,
              servers: ["typescript"],
              symbols: [
                {
                  name: "ensureSoldierScopeAccess",
                  kind: "function",
                  path: "src/routes/session.ts",
                  line: 13,
                  source: "lsp",
                },
              ],
              edges: [
                {
                  from: "src/components/sidebar.tsx",
                  to: "src/routes/session.ts",
                  kind: "reference",
                  references: 2,
                },
              ],
            }),
        }),
      ),
      () =>
        Effect.gen(function* () {
          const router = yield* RepositoryContextRouter.Service
          yield* router.configureDiagnostics({ enabled: true, clear: true })
          const result = yield* router.route({
            query: "Де визначений ensureSoldierScopeAccess і де він використовується?",
          })

          expect(result?.files).toEqual(expect.arrayContaining(["src/routes/session.ts", "src/components/sidebar.tsx"]))
          expect(result?.text).toContain("On-demand LSP lookup already performed")
          expect(result?.text).toContain(
            "reference: src/components/sidebar.tsx -> src/routes/session.ts (2 location(s))",
          )
          expect(result?.text).toContain("Do not repeat the same LSP or grep search")
          expect((yield* router.diagnostics()).entries.map((entry) => entry.stage)).toEqual([
            "prompt",
            "map",
            "lsp",
            "lsp",
            "context",
          ])
        }),
      (unregister) => Effect.sync(unregister),
    ),
  )

  it.live("falls back to the static map when semantic lookup does not respond", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        RepositorySemantic.register({
          enrich: () => Effect.succeed({ files: [], servers: [], symbols: [], edges: [] }),
          search: () => Effect.promise(() => new Promise<never>(() => {})),
        }),
      ),
      () =>
        Effect.gen(function* () {
          const router = yield* RepositoryContextRouter.Service
          const started = Date.now()
          const result = yield* router.route({ query: "Де визначений ensureSoldierScopeAccess?" })

          expect(Date.now() - started).toBeLessThan(2_500)
          expect(result?.files.length).toBeGreaterThan(0)
          expect(result?.text).not.toContain("On-demand LSP lookup already performed")
        }),
      (unregister) => Effect.sync(unregister),
    ),
  )

  it.effect("falls back to the static map when semantic lookup defects", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        RepositorySemantic.register({
          enrich: () => Effect.succeed({ files: [], servers: [], symbols: [], edges: [] }),
          search: () => Effect.die(new Error("Connection is closed")),
        }),
      ),
      () =>
        Effect.gen(function* () {
          const router = yield* RepositoryContextRouter.Service
          const result = yield* router.route({ query: "Де визначений ensureSoldierScopeAccess?" })

          expect(result?.files.length).toBeGreaterThan(0)
          expect(result?.text).not.toContain("On-demand LSP lookup already performed")
        }),
      (unregister) => Effect.sync(unregister),
    ),
  )

  test("renders truncation and omission caveats for the model", () => {
    const text = RepositoryMap.render(
      RepositoryMap.analyze({
        files: ["src/index.ts", "src/router.ts", "src/config.ts"],
        truncated: true,
      }),
    )

    expect(text).toContain('<repository_map status="truncated">')
    expect(text).toContain("limit reached; the map is partial")
    expect(text).toContain("not proof that omitted files or relationships do not exist")
  })
})
