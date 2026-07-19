import { describe, expect, test } from "bun:test"
import { RepositoryMemory } from "@opencode-ai/core/repository-memory"

describe("repository memory", () => {
  test("keeps durable summary sections and drops transient work state", () => {
    const entries = RepositoryMemory.summaryEntries(
      `## Objective
- Add a compact navigation journal.

## Important Details
- Navigation is defined in src/navigation.ts.

## Work State
### Completed
- Verified the route in src/routes.ts.

### Active
- Guessing which component to edit.

### Blocked
- Waiting for a response.

## Next Move
1. Read another file.

## Relevant Files
- src/navigation.ts: current menu implementation.`,
      1_000,
    )

    expect(entries.map((entry) => entry.text)).toEqual([
      "Add a compact navigation journal.",
      "Navigation is defined in src/navigation.ts.",
      "Verified the route in src/routes.ts.",
      "src/navigation.ts: current menu implementation.",
    ])
    expect(entries.flatMap((entry) => entry.files)).toEqual(
      expect.arrayContaining(["src/navigation.ts", "src/routes.ts"]),
    )
  })

  test("recalls only query-relevant notes and file routes", () => {
    const summary = RepositoryMemory.summaryEntries(
      `## Objective
- Add a navigation journal in src/navigation.ts.

## Important Details
- Authentication lives in src/auth.ts.

## Work State
### Completed
- Navigation journal route verified.

### Active
- (none)

### Blocked
- (none)

## Next Move
1. (none)

## Relevant Files
- src/navigation.ts: journal menu.`,
      1_000,
    )
    const route = RepositoryMemory.routeEntry({
      query: "find navigation journal",
      files: ["src/navigation.ts", "src/routes.ts"],
    })
    const result = RepositoryMemory.recall(route ? [...summary, route] : summary, "navigation journal", 1_000)

    expect(result.files).toEqual(expect.arrayContaining(["src/navigation.ts", "src/routes.ts"]))
    expect(result.notes.join("\n")).toContain("navigation journal")
    expect(result.notes.join("\n")).not.toContain("Authentication")
  })

  test("adds semantic memory matches without displacing lexical results", () => {
    const entries = RepositoryMemory.summaryEntries(
      `## Objective
- Configure the deployment roster in Assets/Scripts/RosterController.cs.

## Important Details
- Authentication lives in src/auth.ts.`,
      1_000,
    ).map((entry, index) => ({
      ...entry,
      embeddingModel: "local:test",
      embedding: index === 0 ? [1, 0] : [0, 1],
    }))
    const lexical = RepositoryMemory.recall(entries, "authentication", 1_000)
    const result = RepositoryMemory.recallSemantic(entries, lexical, "local:test", [1, 0])

    expect(result.files).toEqual(expect.arrayContaining(["src/auth.ts", "Assets/Scripts/RosterController.cs"]))
    expect(result.notes.join("\n")).toContain("deployment roster")
    expect(result.notes.join("\n")).toContain("Authentication")
  })

  test("inspects searchable metadata without exposing vectors", () => {
    const entries = RepositoryMemory.summaryEntries(
      `## Objective
- Configure the deployment roster in Assets/Scripts/RosterController.cs.`,
      1_000,
    ).map((entry) => ({ ...entry, embeddingModel: "local:test", embedding: [1, 0] }))
    const result = RepositoryMemory.inspectEntries(entries, "roster")

    expect(result.total).toBe(1)
    expect(result.matched).toBe(1)
    expect(result.entries[0].dimensions).toBe(2)
    expect(result.entries[0]).not.toHaveProperty("embedding")
  })
})
