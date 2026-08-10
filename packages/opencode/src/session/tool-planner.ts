export * as SessionToolPlanner from "./tool-planner"

import { snapshot } from "@/local-agent-runtime/resource-governor"
import type { ChangeRisk } from "@opencode-ai/core/change-risk"
import os from "os"

const CACHE_TTL = 60_000
const REQUEST_TTL = 30 * 60_000
const CACHE_LIMIT = 256

export type Access = "read" | "write" | "control"

export type Capability = {
  readonly access: Access
  readonly cache?: boolean
  readonly completesEvidence?: boolean
}

export type Metadata = {
  readonly node: number
  readonly access: Access
  readonly dependencies: readonly number[]
  readonly concurrency: number
  readonly cache: "hit" | "miss" | "deduplicated" | "disabled" | "invalidated"
  readonly skipped?: "evidence_sufficient"
  readonly risk?: ChangeRisk.Assessment
}

type Output = {
  readonly title: string
  readonly metadata: Record<string, unknown>
  readonly output: string
  readonly attachments?: readonly unknown[]
}

type CacheEntry = {
  readonly expires: number
  readonly generation: number
  readonly value: Output
}

type WorkspaceState = {
  generation: number
  node: number
  reads: number
  readonly readWaiters: Array<() => void>
  readonly activeReads: Map<Promise<unknown>, number>
  readonly cache: Map<string, CacheEntry>
  readonly inflight: Map<string, Promise<Output>>
  writeBarrier: Promise<void>
  lastWriteNode?: number
}

type RequestState = {
  evidenceSufficient: boolean
  touchedAt: number
}

const workspaces = new Map<string, WorkspaceState>()
const requests = new Map<string, RequestState>()

export function create(input: {
  readonly root: string
  readonly sessionID: string
  readonly requestID?: string
  readonly readLimit?: number
}) {
  const workspace = workspaceState(input.root)
  const request = requestState(`${input.sessionID}:${input.requestID ?? "current"}`)

  return {
    run: async <T extends Output>(call: {
      readonly tool: string
      readonly args: unknown
      readonly capability: Capability
      readonly risk?: ChangeRisk.Assessment
      readonly execute: () => Promise<T>
    }): Promise<{ readonly value: T; readonly metadata: Metadata }> => {
      request.touchedAt = Date.now()
      const node = ++workspace.node
      const concurrency = input.readLimit ?? readConcurrency()

      if (call.capability.access === "read" && request.evidenceSufficient) {
        return {
          value: {
            title: "Search skipped",
            metadata: {},
            output: "Skipped because the current request already has sufficient accepted evidence.",
          } as T,
          metadata: {
            node,
            access: "read",
            dependencies: workspace.lastWriteNode ? [workspace.lastWriteNode] : [],
            concurrency,
            cache: "disabled",
            skipped: "evidence_sufficient",
          },
        }
      }

      if (call.capability.access === "read") {
        const dependencies = workspace.lastWriteNode ? [workspace.lastWriteNode] : []
        const pending = runRead(workspace, concurrency, call, input.sessionID)
        workspace.activeReads.set(pending, node)
        pending.finally(() => workspace.activeReads.delete(pending)).catch(() => undefined)
        const result = await pending
        return {
          value: result.value as T,
          metadata: { node, access: "read", dependencies, concurrency, cache: result.cache },
        }
      }

      if (call.capability.access === "write") {
        const dependencies = Array.from(
          new Set([...(workspace.lastWriteNode ? [workspace.lastWriteNode] : []), ...workspace.activeReads.values()]),
        ).sort((a, b) => a - b)
        const previous = workspace.writeBarrier
        const reads = [...workspace.activeReads.keys()]
        const pending = Promise.allSettled([previous, ...reads])
          .then(call.execute)
          .then(
            (value) => {
              invalidate(workspace)
              return value
            },
            (error) => {
              invalidate(workspace)
              throw error
            },
          )
        workspace.writeBarrier = pending.then(
          () => undefined,
          () => undefined,
        )
        workspace.lastWriteNode = node
        return {
          value: await pending,
          metadata: { node, access: "write", dependencies, concurrency, cache: "invalidated", risk: call.risk },
        }
      }

      const dependencies = Array.from(
        new Set([...(workspace.lastWriteNode ? [workspace.lastWriteNode] : []), ...workspace.activeReads.values()]),
      ).sort((a, b) => a - b)
      await Promise.allSettled([workspace.writeBarrier, ...workspace.activeReads.keys()])
      const value = await call.execute()
      if (call.capability.completesEvidence && value.metadata.evidence === true && value.metadata.status === "complete")
        request.evidenceSufficient = true
      return {
        value,
        metadata: { node, access: "control", dependencies, concurrency, cache: "disabled" },
      }
    },
  }
}

export function reset() {
  workspaces.clear()
  requests.clear()
}

async function runRead<T extends Output>(
  workspace: WorkspaceState,
  concurrency: number,
  call: {
    readonly tool: string
    readonly args: unknown
    readonly capability: Capability
    readonly execute: () => Promise<T>
  },
  namespace: string,
) {
  await workspace.writeBarrier
  const release = await acquireRead(workspace, concurrency)
  try {
    if (!call.capability.cache) return { value: await call.execute(), cache: "disabled" as const }
    const key = `${namespace}:${workspace.generation}:${call.tool}:${stable(call.args)}`
    const cached = workspace.cache.get(key)
    if (cached && cached.expires > Date.now() && cached.generation === workspace.generation)
      return { value: clone(cached.value) as T, cache: "hit" as const }

    const inflight = workspace.inflight.get(key)
    if (inflight) return { value: clone(await inflight) as T, cache: "deduplicated" as const }

    const pending = call.execute()
    workspace.inflight.set(key, pending)
    const value = await pending.finally(() => workspace.inflight.delete(key))
    if (!value.attachments?.length) {
      workspace.cache.set(key, {
        expires: Date.now() + CACHE_TTL,
        generation: workspace.generation,
        value: clone(value),
      })
      trimCache(workspace)
    }
    return { value, cache: "miss" as const }
  } finally {
    release()
  }
}

function workspaceState(root: string) {
  const current = workspaces.get(root)
  if (current) return current
  const created: WorkspaceState = {
    generation: 0,
    node: 0,
    reads: 0,
    readWaiters: [],
    activeReads: new Map(),
    cache: new Map(),
    inflight: new Map(),
    writeBarrier: Promise.resolve(),
  }
  workspaces.set(root, created)
  return created
}

function requestState(key: string) {
  const now = Date.now()
  for (const [id, state] of requests) {
    if (state.touchedAt + REQUEST_TTL < now) requests.delete(id)
  }
  const current = requests.get(key)
  if (current) return current
  const created = { evidenceSufficient: false, touchedAt: now }
  requests.set(key, created)
  return created
}

function readConcurrency() {
  const current = snapshot()
  const pressure = current.status === "healthy" ? 4 : current.status === "pressured" ? 2 : 1
  return Math.max(1, Math.min(pressure, Math.floor(cpuConcurrency() / 2)))
}

function cpuConcurrency() {
  return os.availableParallelism()
}

function acquireRead(workspace: WorkspaceState, limit: number) {
  if (workspace.reads < limit) {
    workspace.reads += 1
    return Promise.resolve(() => releaseRead(workspace))
  }
  return new Promise<() => void>((resolve) => {
    workspace.readWaiters.push(() => {
      workspace.reads += 1
      resolve(() => releaseRead(workspace))
    })
  })
}

function releaseRead(workspace: WorkspaceState) {
  workspace.reads -= 1
  workspace.readWaiters.shift()?.()
}

function invalidate(workspace: WorkspaceState) {
  workspace.generation += 1
  workspace.cache.clear()
  workspace.inflight.clear()
}

function trimCache(workspace: WorkspaceState) {
  while (workspace.cache.size > CACHE_LIMIT) {
    const key = workspace.cache.keys().next().value
    if (typeof key !== "string") return
    workspace.cache.delete(key)
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
  return `{${Object.entries(value)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
