import { expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { createMemo, createRoot } from "solid-js"
import { createHomeSessionIndexCache, parseHomeSessionIndex } from "@/context/global-sync/home-session-index"

test("the Home index reactively hides a deleted session before its query cache changes", () => {
  createRoot((dispose) => {
    const cache = createHomeSessionIndexCache(new QueryClient(), "local-reactive")
    const initial = parseHomeSessionIndex([
      {
        id: "deleted",
        projectID: "project",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
        title: "deleted",
        location: { directory: "/project" },
      },
    ])
    const visible = createMemo(() => cache.sessions({ sessions: initial, eventSequence: 0 }, undefined))

    expect(visible()).toHaveLength(1)
    cache.apply({
      type: "session.deleted",
      properties: { sessionID: initial[0]!.id, info: initial[0]! },
    })
    expect(visible()).toEqual([])
    dispose()
  })
})
