import { describe, expect, test } from "bun:test"
import type { SessionV2Info } from "@opencode-ai/sdk/v2/client"
import { QueryClient } from "@tanstack/solid-query"
import {
  applyHomeSessionEvent,
  appendHomeSessionEvent,
  createHomeSessionIndexCache,
  HOME_V2_SESSION_PAGE_LIMIT,
  type HomeSessionEvents,
  type HomeSessionIndex,
  loadHomeSessionIndex,
  homeSessionIndexSessions,
  homeSessionIndexRefresh,
  parseHomeSessionIndex,
  retainHomeSessions,
} from "./home-session-index"

const session = (input: {
  id: string
  directory?: string
  parentID?: string
  archived?: number
  updated?: number
  mode?: "project" | "chat"
}) => ({
  id: input.id,
  parentID: input.parentID,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: input.updated ?? 1, archived: input.archived },
  title: input.id,
  location: { directory: input.directory ?? "/project" },
  mode: input.mode,
})

describe("Home V2 session index", () => {
  test("loads the Home index with one global V2 request", async () => {
    const calls: unknown[] = []
    const result = await loadHomeSessionIndex(async (input) => {
      calls.push(input)
      return { data: { data: [session({ id: "root" })], cursor: {} } }
    })

    expect(result.sessions).toHaveLength(1)
    expect(calls).toEqual([{ limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc" }])
  })

  test("loads subsequent pages until the session index is complete", async () => {
    const calls: unknown[] = []
    const controller = new AbortController()
    const result = await loadHomeSessionIndex(
      async (input, options) => {
        calls.push({ input, signal: options.signal })
        if (!("cursor" in input)) {
          return {
            data: {
              data: Array.from({ length: HOME_V2_SESSION_PAGE_LIMIT }, (_, index) =>
                session({ id: `page-1-${index}` }),
              ),
              cursor: { next: "next-page" },
            },
          }
        }
        return { data: { data: [session({ id: "page-2" })], cursor: {} } }
      },
      0,
      controller.signal,
    )

    expect(result.sessions).toHaveLength(HOME_V2_SESSION_PAGE_LIMIT + 1)
    expect(calls).toEqual([
      { input: { limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc" }, signal: controller.signal },
      {
        input: { limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc", cursor: "next-page" },
        signal: controller.signal,
      },
    ])
  })

  test("maps visible roots to Home session summaries", () => {
    const activeNull = {
      ...session({ id: "active-null", updated: 20 }),
      time: { created: 1, updated: 20, archived: null },
    } as unknown as SessionV2Info
    const result = parseHomeSessionIndex([
      session({ id: "root", updated: 30 }),
      activeNull,
      session({ id: "child", parentID: "root", updated: 40 }),
      session({ id: "archived", archived: 50, updated: 50 }),
    ])

    expect(result).toEqual([
      expect.objectContaining({
        id: "root",
        slug: "root",
        version: "",
        directory: "/project",
        projectID: "project",
        title: "root",
        time: { created: 1, updated: 30 },
      }),
      expect.objectContaining({
        id: "active-null",
        time: { created: 1, updated: 20, archived: null },
      }),
    ])
  })

  test("preserves explicit Chat mode independently of its server directory name", () => {
    expect(parseHomeSessionIndex([session({ id: "chat", directory: "/data/chat", mode: "chat" })])[0]).toMatchObject({
      id: "chat",
      directory: "/data/chat",
      mode: "chat",
    })
  })

  test("preserves the per-directory Home retention limit", () => {
    const now = 10 * 60 * 60 * 1000
    const sessions = Array.from({ length: 80 }, (_, index) => ({
      ...parseHomeSessionIndex([session({ id: `session-${index}`, updated: index + 1 })])[0],
      directory: index % 2 === 0 ? "/one" : "/two",
    }))

    const retained = retainHomeSessions(sessions, 10, now)
    expect(retained.filter((item) => item.directory === "/one")).toHaveLength(10)
    expect(retained.filter((item) => item.directory === "/two")).toHaveLength(10)
  })

  test("replays session events over the loaded index", () => {
    const initial = parseHomeSessionIndex([session({ id: "old" })])
    const created = { ...initial[0], id: "new", slug: "new", title: "new", time: { created: 2, updated: 2 } }

    const afterCreate = applyHomeSessionEvent(initial, {
      type: "session.created",
      properties: { sessionID: created.id, info: created },
    })
    expect(
      applyHomeSessionEvent(afterCreate, {
        type: "session.deleted",
        properties: { sessionID: initial[0]!.id, info: initial[0]! },
      }),
    ).toEqual([created])
  })

  test("does not resurrect a deleted session from a late update", () => {
    const initial = parseHomeSessionIndex([session({ id: "deleted" })])
    const deleted = new Set<string>()
    const afterDelete = applyHomeSessionEvent(
      initial,
      {
        type: "session.deleted",
        properties: { sessionID: initial[0]!.id, info: initial[0]! },
      },
      deleted,
    )
    const afterLateUpdate = applyHomeSessionEvent(
      afterDelete,
      {
        type: "session.updated",
        properties: { sessionID: initial[0]!.id, info: { ...initial[0]!, title: "late" } },
      },
      deleted,
    )

    expect(afterLateUpdate).toEqual([])
    expect(
      applyHomeSessionEvent(
        afterLateUpdate,
        {
          type: "session.created",
          properties: { sessionID: initial[0]!.id, info: { ...initial[0]!, title: "recreated" } },
        },
        deleted,
      ),
    ).toEqual([expect.objectContaining({ id: "deleted", title: "recreated" })])
  })

  test("applies only events newer than the index baseline", () => {
    const initial = parseHomeSessionIndex([session({ id: "old" })])
    const stale = { ...initial[0], title: "stale" }
    const current = { ...initial[0], title: "current" }
    const first = appendHomeSessionEvent(undefined, {
      type: "session.updated",
      properties: { sessionID: stale.id, info: stale },
    })
    const events = appendHomeSessionEvent(first, {
      type: "session.updated",
      properties: { sessionID: current.id, info: current },
    })

    expect(homeSessionIndexSessions({ sessions: initial, eventSequence: 1 }, events)[0]?.title).toBe("current")
  })

  test("applies a local deletion when the cached index is ahead of the event query", () => {
    const queryClient = new QueryClient()
    const cache = createHomeSessionIndexCache(queryClient, "local")
    const initial = parseHomeSessionIndex([session({ id: "deleted" })])
    queryClient.setQueryData(cache.indexKey, { sessions: initial, eventSequence: 12 })
    queryClient.setQueryData(cache.eventsKey, { sequence: 0, entries: [] })

    cache.apply({
      type: "session.deleted",
      properties: { sessionID: initial[0]!.id, info: initial[0]! },
    })

    expect(queryClient.getQueryData<HomeSessionIndex>(cache.indexKey)).toEqual({ sessions: [], eventSequence: 13 })
    expect(queryClient.getQueryData<HomeSessionEvents>(cache.eventsKey)).toEqual({ sequence: 13, entries: [] })
  })

  test("refetches after reconnect, disposal, and session moves", () => {
    expect(homeSessionIndexRefresh("server.connected", false)).toEqual({ connected: true, refetch: false })
    expect(homeSessionIndexRefresh("server.connected", true)).toEqual({ connected: true, refetch: true })
    expect(homeSessionIndexRefresh("global.disposed", true).refetch).toBe(true)
    expect(homeSessionIndexRefresh("session.next.moved", true).refetch).toBe(true)
  })
})
