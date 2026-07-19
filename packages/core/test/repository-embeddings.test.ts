import { describe, expect, test } from "bun:test"
import { RepositoryEmbeddings } from "@opencode-ai/core/repository-embeddings"

describe("repository embeddings", () => {
  test("creates bounded stack-neutral source chunks with line anchors", () => {
    const content = Array.from({ length: 120 }, (_, index) => `line ${index + 1} ${"value ".repeat(8)}`).join("\n")
    const chunks = RepositoryEmbeddings.chunks("Assets/Scripts/Player.cs", content)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThanOrEqual(12)
    expect(chunks[0].start).toBe(1)
    expect(chunks[0].text).toContain("File: Assets/Scripts/Player.cs")
    expect(chunks.every((chunk) => chunk.text.length <= 1_700)).toBe(true)
  })

  test("ranks one best chunk per file by cosine similarity", () => {
    const entries = [
      entry("src/navigation.ts", 1, [1, 0]),
      entry("src/navigation.ts", 40, [0.9, 0.1]),
      entry("src/database.ts", 1, [0, 1]),
      entry("Assets/MenuController.cs", 12, [0.8, 0.2]),
    ]
    const matches = RepositoryEmbeddings.rank(entries, [1, 0], 2)

    expect(matches.map((match) => match.path)).toEqual(["src/navigation.ts", "Assets/MenuController.cs"])
    expect(matches[0].start).toBe(1)
  })

  test("rejects vectors with incompatible dimensions", () => {
    expect(RepositoryEmbeddings.cosine([1, 0], [1])).toBe(-1)
    expect(RepositoryEmbeddings.cosine([], [])).toBe(-1)
  })

  test("inspects matching chunks without exposing vectors", () => {
    const result = RepositoryEmbeddings.inspectEntries(
      "local:test",
      [entry("src/navigation.ts", 1, [1, 0]), entry("src/database.ts", 1, [0, 1])],
      "navigation",
    )

    expect(result.total).toBe(2)
    expect(result.matched).toBe(1)
    expect(result.files).toBe(2)
    expect(result.entries[0].dimensions).toBe(2)
    expect(result.entries[0]).not.toHaveProperty("vector")
  })
})

function entry(file: string, start: number, vector: ReadonlyArray<number>): RepositoryEmbeddings.Entry {
  return {
    id: `${file}:${start}`,
    path: file,
    start,
    end: start + 5,
    fileHash: "hash",
    vector,
    updatedAt: 1,
  }
}
