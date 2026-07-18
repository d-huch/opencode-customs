import { describe, expect, test } from "bun:test"
import { RepositoryContextRouter } from "@opencode-ai/core/repository-context-router"

describe("repository context retrieval", () => {
  test("scales the retrieval budget from the model context window", () => {
    expect(RepositoryContextRouter.contextBudget(4_096)).toBe(512)
    expect(RepositoryContextRouter.contextBudget(32_768)).toBe(1_600)
    expect(RepositoryContextRouter.contextBudget()).toBe(1_200)
  })

  test("retrieves a bounded source window around the selected symbol", () => {
    const content = Array.from({ length: 40 }, (_, index) =>
      index === 19 ? "export function buildNavigationJournal() {" : `// line ${index + 1}`,
    ).join("\n")
    const snippets = RepositoryContextRouter.retrieveSnippets({
      query: "buildNavigationJournal",
      files: ["src/navigation.ts"],
      symbols: [
        {
          name: "buildNavigationJournal",
          kind: "function",
          path: "src/navigation.ts",
          line: 20,
          source: "lsp",
        },
      ],
      hits: [],
      contents: new Map([["src/navigation.ts", content]]),
    })

    expect(snippets).toHaveLength(1)
    expect(snippets[0]).toMatchObject({ path: "src/navigation.ts", start: 16, end: 27 })
    expect(snippets[0].text).toContain("buildNavigationJournal")
    expect(snippets[0].text.length).toBeLessThanOrEqual(1_200)
  })
})
