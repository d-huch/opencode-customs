import { expect, test } from "bun:test"
import { SESSION_TABS_REMOVED_EVENT, readSessionTabsRemovedDetail } from "@/components/titlebar-session-events"
import type { ServerConnection } from "@/context/server"
import { deleteHomeSession } from "./home-session-delete"

const remote = "remote" as ServerConnection.Key

test("deleting a Home session removes its descendants and open tabs", async () => {
  let detail: ReturnType<typeof readSessionTabsRemovedDetail>
  const removed: string[][] = []
  const evicted: string[] = []
  window.addEventListener(
    SESSION_TABS_REMOVED_EVENT,
    (event) => {
      detail = readSessionTabsRemovedDetail(event)
    },
    { once: true },
  )

  const deleted = await deleteHomeSession({
    server: remote,
    session: { id: "ses_root", directory: "/workspace" },
    sessions: [
      { id: "ses_root", directory: "/workspace" },
      { id: "ses_child", directory: "/workspace", parentID: "ses_root" },
      { id: "ses_grandchild", directory: "/workspace", parentID: "ses_child" },
      { id: "ses_other", directory: "/workspace" },
    ],
    request: async () => true,
    remove: (sessionIDs) => removed.push(sessionIDs),
    evict: (sessionID) => evicted.push(sessionID),
  })

  expect(deleted).toBe(true)
  expect(removed).toEqual([["ses_root", "ses_child", "ses_grandchild"]])
  expect(evicted).toEqual(["ses_root", "ses_child", "ses_grandchild"])
  expect(detail).toEqual({
    server: remote,
    directory: "/workspace",
    sessionIDs: ["ses_root", "ses_child", "ses_grandchild"],
  })
})

test("reports deletion failures without removing the session", async () => {
  const failure = new Error("offline")
  let error: unknown
  let removed = false

  const deleted = await deleteHomeSession({
    server: remote,
    session: { id: "ses_1", directory: "/workspace" },
    sessions: [],
    request: async () => Promise.reject(failure),
    remove: () => {
      removed = true
    },
    evict: () => {},
    onError: (value) => {
      error = value
    },
  })

  expect(deleted).toBe(false)
  expect(error).toBe(failure)
  expect(removed).toBe(false)
})

test("removes a stale Home session when the server reports it was already deleted", async () => {
  const missing = new Error("Session not found")
  const removed: string[][] = []
  let reported = false

  const deleted = await deleteHomeSession({
    server: remote,
    session: { id: "ses_stale", directory: "/workspace" },
    sessions: [],
    request: async () => Promise.reject(missing),
    remove: (sessionIDs) => removed.push(sessionIDs),
    evict: () => {},
    isAlreadyDeleted: (error) => error === missing,
    onError: () => {
      reported = true
    },
  })

  expect(deleted).toBe(true)
  expect(removed).toEqual([["ses_stale"]])
  expect(reported).toBe(false)
})
