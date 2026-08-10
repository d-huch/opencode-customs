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
    const result = RepositoryMemory.recallSemantic(entries, lexical, "local:test", [1, 0], undefined, 1_000)

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

  test("keeps user-provided conversation memory available across sessions", () => {
    const name = RepositoryMemory.conversationEntry(
      {
        text: "Користувача звати Денис.",
        category: "identity",
        topic: "user.identity.name",
        confidence: 0.98,
        source: "classifier",
        evidence: "msg_name",
      },
      1_000,
    )
    const preference = RepositoryMemory.conversationEntry("Користувач любить зелений колір.", 2_000)
    const entries = [name, preference].filter((entry): entry is RepositoryMemory.Entry => entry !== undefined)
    const result = RepositoryMemory.recall(entries, "Як мене звати?", 3_000)

    expect(result.notes).toEqual(["Користувача звати Денис."])
    expect(RepositoryMemory.inspectEntries(entries).entries[1]).toMatchObject({
      category: "identity",
      topic: "user.identity.name",
      confidence: 0.98,
      source: "classifier",
      evidence: "msg_name",
    })
    expect(RepositoryMemory.inspectEntries(entries).entries.every((entry) => entry.kind === "conversation")).toBe(true)
  })

  test("uses a semantic topic to replace a corrected fact", () => {
    const original = RepositoryMemory.conversationEntry({
      text: "Користувача звати Денис.",
      category: "identity",
      topic: "user.identity.name",
    })
    const corrected = RepositoryMemory.conversationEntry({
      text: "Користувача звати Віталій.",
      category: "identity",
      topic: "user.identity.name",
    })

    expect(original?.id).toBe(corrected?.id)
    expect(original?.text).not.toBe(corrected?.text)
  })

  test("does not inject unrelated recent conversation memory", () => {
    const name = RepositoryMemory.conversationEntry("Користувача звати Денис.", 1_000)
    const project = RepositoryMemory.conversationEntry("Користувач працює над Unity-проєктом.", 2_000)
    const entries = [name, project].filter((entry): entry is RepositoryMemory.Entry => entry !== undefined)

    expect(RepositoryMemory.recall(entries, "Як мене звати?", 3_000).notes).toEqual(["Користувача звати Денис."])
  })

  test("retrieves a taught answer in another session by the original question", () => {
    const memory = RepositoryMemory.conversationEntry(
      "Q: Скільки Віталік проїхав на велосипеді минулої неділі? A: Нескільки",
      1_000,
    )
    if (!memory) throw new Error("Expected conversation memory")

    const result = RepositoryMemory.recall([memory], "Скільки Віталік проїхав на велосипеді минулої неділі?", 2_000)

    expect(result.notes).toEqual(["Q: Скільки Віталік проїхав на велосипеді минулої неділі? A: Нескільки"])
  })

  test("separates global, project, and session memory scopes", () => {
    const global = RepositoryMemory.conversationEntry({
      text: "Користувача звати Денис.",
      topic: "user.identity.name",
      scope: "global",
    })
    const project = RepositoryMemory.conversationEntry({
      text: "У цьому проєкті тести запускаються вибірково.",
      topic: "testing.policy",
      scope: "project",
    })
    const session = RepositoryMemory.conversationEntry(
      {
        text: "У цій сесії порівнюємо два варіанти.",
        topic: "session.goal",
        scope: "session",
        scopeID: "ses_a",
      },
      1_000,
    )
    const entries = [global, project, session].filter((entry): entry is RepositoryMemory.Entry => entry !== undefined)

    expect(global?.id).not.toBe(
      RepositoryMemory.conversationEntry({
        text: "Користувача звати Денис.",
        topic: "user.identity.name",
        scope: "project",
      })?.id,
    )
    expect(RepositoryMemory.recall(entries, "Що ми порівнюємо?", 2_000).notes).toEqual([])
    expect(RepositoryMemory.recall(entries, "Що ми порівнюємо?", 2_000, { sessionID: "ses_a" }).notes).toEqual([
      "У цій сесії порівнюємо два варіанти.",
    ])
  })

  test("keeps pinned memory and records conflicting automatic corrections", () => {
    const original = RepositoryMemory.conversationEntry({
      text: "Користувача звати Денис.",
      topic: "user.identity.name",
      scope: "global",
      confidence: 0.98,
    })
    const correction = RepositoryMemory.conversationEntry({
      text: "Користувача звати Віталій.",
      topic: "user.identity.name",
      scope: "global",
      confidence: 0.99,
      correction: true,
      source: "classifier",
    })
    if (!original || !correction) throw new Error("Expected conversation memories")

    const conflict = RepositoryMemory.mergeEntry({ ...original, pinned: true }, correction)

    expect(conflict.status).toBe("conflict")
    expect(conflict.conflictsWith).toBe(original.id)
    expect(conflict.id).not.toBe(original.id)
    expect(RepositoryMemory.recall([{ ...original, pinned: true }, conflict], "Як мене звати?").notes).toEqual([
      "Користувача звати Денис.",
    ])
  })

  test("accepts an explicit high-confidence correction when memory is not pinned", () => {
    const original = RepositoryMemory.conversationEntry({
      text: "Користувача звати Денис.",
      topic: "user.identity.name",
      confidence: 0.98,
    })
    const correction = RepositoryMemory.conversationEntry({
      text: "Користувача звати Віталій.",
      topic: "user.identity.name",
      confidence: 0.98,
      correction: true,
    })
    if (!original || !correction) throw new Error("Expected conversation memories")

    expect(RepositoryMemory.mergeEntry(original, correction).text).toBe("Користувача звати Віталій.")
  })

  test("retains expired lifecycle records for debugging and preserves pinned durable memory", () => {
    const expired = RepositoryMemory.conversationEntry({ text: "Тимчасовий запис.", expiresAt: 1_500 }, 1_000)
    const pinned = RepositoryMemory.conversationEntry({ text: "Закріплений запис." }, 1_000)
    const entries = [expired, pinned && { ...pinned, pinned: true }].filter(
      (entry): entry is RepositoryMemory.Entry => entry !== undefined,
    )

    expect(RepositoryMemory.compactEntries(entries, 2_000)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Закріплений запис.", pinned: true }),
        expect.objectContaining({ text: "Тимчасовий запис.", lifecycle: "expired" }),
      ]),
    )
  })

  test("keeps durable memory beyond the ordinary age limit and preserves source provenance", () => {
    const durable = RepositoryMemory.conversationEntry(
      {
        text: "Universal verified workflow rule.",
        scope: "cross-project",
        lifecycle: "durable",
      },
      1_000,
    )
    const route = RepositoryMemory.routeEntry({
      query: "find the workflow rule",
      files: ["src/workflow.ts"],
      originProject: "/workspace/source",
    })
    const summary = RepositoryMemory.summaryEntries(
      "## Important Details\n- Workflow lives in src/workflow.ts.",
      1_000,
      "/workspace/source",
    )[0]
    if (!durable || !route || !summary) throw new Error("Expected managed memories")

    expect(RepositoryMemory.compactEntries([durable], 1_000 + 1000 * 60 * 60 * 24 * 365)).toHaveLength(1)
    expect(durable).toMatchObject({ source: "manual", confidence: 1 })
    expect(route).toMatchObject({ source: "route", confidence: 1 })
    expect(summary).toMatchObject({ source: "compaction", confidence: 0.9 })
  })

  test("uses another project's memory only as an analogy and never imports its file paths", () => {
    const current = RepositoryMemory.conversationEntry({
      text: "Current repository uses repository-native verification.",
      scope: "project",
      originProject: "/workspace/current",
      topic: "verification.policy",
    })
    const other = RepositoryMemory.conversationEntry({
      text: "Another repository verifies changes with focused integration checks.",
      scope: "project",
      originProject: "/workspace/other",
      topic: "verification.pattern",
    })
    if (!current || !other) throw new Error("Expected project memories")
    const recalled = RepositoryMemory.recall(
      [
        { ...current, files: ["tests/current.test.ts"] },
        { ...other, files: ["tests/other.test.ts"] },
      ],
      "How should repository verification checks work?",
      Date.now(),
      { project: "/workspace/current" },
    )

    expect(recalled.files).toContain("tests/current.test.ts")
    expect(recalled.files).not.toContain("tests/other.test.ts")
    expect(recalled.notes).toContain(
      "[analogy from /workspace/other] Another repository verifies changes with focused integration checks.",
    )
    expect(recalled.memories?.find((entry) => entry.id === other.id)?.classification).toBe("analogy")
    expect(recalled.memories?.find((entry) => entry.id === current.id)?.classification).toBe("fact")
  })

  test("recalls only verified or durable memory and keeps patterns explicitly analogous", () => {
    const candidate = RepositoryMemory.conversationEntry({
      text: "Candidate working rule for targeted checks.",
      scope: "cross-project",
      lifecycle: "candidate",
    })
    const verified = RepositoryMemory.conversationEntry({
      text: "Verified working rule uses targeted checks.",
      scope: "cross-project",
      lifecycle: "verified",
    })
    const rejected = RepositoryMemory.conversationEntry({
      text: "Rejected working rule uses every check.",
      scope: "cross-project",
      lifecycle: "rejected",
    })
    const pattern = RepositoryMemory.conversationEntry({
      text: "Reusable pattern applies a bounded verification loop.",
      scope: "pattern",
      originProject: "/workspace/source",
      lifecycle: "durable",
    })
    const entries = [candidate, verified, rejected, pattern].filter(
      (entry): entry is RepositoryMemory.Entry => entry !== undefined,
    )
    const recalled = RepositoryMemory.recall(entries, "Which targeted checks or verification pattern should apply?")

    expect(recalled.notes).toContain("Verified working rule uses targeted checks.")
    expect(recalled.notes).toContain(
      "[analogy from /workspace/source] Reusable pattern applies a bounded verification loop.",
    )
    expect(recalled.notes).not.toContain("Candidate working rule for targeted checks.")
    expect(recalled.notes).not.toContain("Rejected working rule uses every check.")
  })

  test("reports why a memory matched without exposing the embedding", () => {
    const entry = RepositoryMemory.conversationEntry("Користувача звати Денис.")
    if (!entry) throw new Error("Expected conversation memory")

    expect(RepositoryMemory.recall([entry], "Як мене звати?").uses).toEqual([{ id: entry.id, reason: "lexical" }])
  })

  test("refuses obvious credentials even when admission classification fails", () => {
    expect(RepositoryMemory.conversationEntry("Мій токен: eyJabcdefgh.abcdefgh123.abcdefgh456")).toBeUndefined()
    expect(
      RepositoryMemory.conversationEntry(
        "-----BEGIN PRIVATE KEY----- abcdefghijklmnopqrstuvwxyz -----END PRIVATE KEY-----",
      ),
    ).toBeUndefined()
  })

  test("previews consolidation without mutating memory and never changes pinned entries", () => {
    const pinned = RepositoryMemory.conversationEntry({
      text: "Use focused verification for every change.",
      scope: "cross-project",
      lifecycle: "durable",
    })
    if (!pinned) throw new Error("Expected memory")
    const entries = [
      { ...pinned, pinned: true, id: "pinned" },
      { ...pinned, pinned: false, id: "duplicate", lifecycle: "verified" as const },
    ]

    const preview = RepositoryMemory.previewConsolidation(entries, 10_000)

    expect(entries).toHaveLength(2)
    expect(preview).toMatchObject({ protected: 1, actionable: 1, unresolved: 0 })
    expect(preview.actions[0]).toMatchObject({
      type: "merge_duplicate",
      id: "pinned",
      relatedIDs: ["duplicate"],
    })
    const result = RepositoryMemory.consolidateEntries(entries, preview)
    expect(result.entries).toEqual([expect.objectContaining({ id: "pinned", pinned: true })])
    expect(result.entries[0]).toEqual(entries[0])
  })

  test("keeps ambiguous conflicts for review instead of guessing", () => {
    const original = RepositoryMemory.conversationEntry({
      text: "The selected option is blue.",
      topic: "selected.option",
      confidence: 0.8,
    })
    const correction = RepositoryMemory.conversationEntry({
      text: "The selected option is green.",
      topic: "selected.option",
      confidence: 0.8,
      source: "classifier",
      correction: true,
    })
    if (!original || !correction) throw new Error("Expected memories")
    const conflict = {
      ...correction,
      id: "conflict",
      lifecycle: "verified" as const,
      status: "conflict" as const,
      conflictsWith: original.id,
      conflicts: [original.id],
    }
    const preview = RepositoryMemory.previewConsolidation([original, conflict], 10_000)

    expect(preview).toMatchObject({ actionable: 0, unresolved: 1 })
    expect(preview.actions[0]).toMatchObject({ type: "unresolved_conflict", id: conflict.id })
    expect(RepositoryMemory.consolidateEntries([original, conflict], preview).entries).toHaveLength(2)
  })

  test("archives unused records, lowers stale fact confidence, and strengthens repeated reusable rules", () => {
    const age = 1000 * 60 * 60 * 24 * 120
    const unused = RepositoryMemory.conversationEntry({ text: "Unused working context.", confidence: 0.6 }, 1_000)
    const stale = RepositoryMemory.conversationEntry({ text: "Old confirmed fact.", confidence: 0.9 }, 1_000)
    const rule = RepositoryMemory.conversationEntry(
      {
        text: "Run focused checks after a bounded change.",
        scope: "cross-project",
        confidence: 0.7,
        lifecycle: "verified",
      },
      age,
    )
    if (!unused || !stale || !rule) throw new Error("Expected memories")
    const entries = [
      { ...unused, id: "unused", classification: "analogy" as const },
      { ...stale, id: "stale", useCount: 1 },
      { ...rule, id: "rule", confirmationCount: 3 },
    ]
    const preview = RepositoryMemory.previewConsolidation(entries, age + 1_000)
    const result = RepositoryMemory.consolidateEntries(entries, preview)

    expect(preview.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "archive_unused", id: "unused" }),
        expect.objectContaining({ type: "decrease_confidence", id: "stale", afterConfidence: 0.8 }),
        expect.objectContaining({ type: "increase_confidence", id: "rule" }),
      ]),
    )
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unused", lifecycle: "archived" }),
        expect.objectContaining({ id: "stale", confidence: 0.8 }),
        expect.objectContaining({ id: "rule", confidence: expect.closeTo(0.8, 5) }),
      ]),
    )
  })

  test("changes the consolidation fingerprint when memory changes after preview", () => {
    const entry = RepositoryMemory.conversationEntry("Stable memory.")
    if (!entry) throw new Error("Expected memory")
    const preview = RepositoryMemory.previewConsolidation([entry], 10_000)
    const changed = [{ ...entry, text: "Changed memory.", updatedAt: 11_000 }]

    expect(RepositoryMemory.previewConsolidation(changed, preview.generatedAt).fingerprint).not.toBe(
      preview.fingerprint,
    )
  })
})
