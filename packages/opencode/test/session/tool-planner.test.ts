import { afterEach, describe, expect, test } from "bun:test"
import { SessionToolPlanner } from "../../src/session/tool-planner"
import { ChangeRisk } from "@opencode-ai/core/change-risk"

const read = { access: "read", cache: true } as const
const write = { access: "write" } as const
const evidence = { access: "control", completesEvidence: true } as const

afterEach(() => SessionToolPlanner.reset())

describe("session tool planner", () => {
  test("runs independent reads in parallel", async () => {
    const planner = SessionToolPlanner.create({
      root: "/workspace/parallel",
      sessionID: "session",
      requestID: "request",
      readLimit: 2,
    })
    const started: string[] = []
    const finish: Array<() => void> = []
    const first = planner.run({
      tool: "read",
      args: { file: "a" },
      capability: read,
      execute: () =>
        new Promise<ReturnType<typeof output>>((resolve) => {
          started.push("a")
          finish.push(() => resolve(output("a")))
        }),
    })
    const second = planner.run({
      tool: "read",
      args: { file: "b" },
      capability: read,
      execute: () =>
        new Promise<ReturnType<typeof output>>((resolve) => {
          started.push("b")
          finish.push(() => resolve(output("b")))
        }),
    })

    await tick()
    expect(started).toEqual(["a", "b"])
    finish.forEach((done) => done())
    await Promise.all([first, second])
  })

  test("serializes writes behind active reads and blocks later reads behind the write", async () => {
    const planner = SessionToolPlanner.create({
      root: "/workspace/graph",
      sessionID: "session",
      requestID: "request",
      readLimit: 2,
    })
    const order: string[] = []
    let finishRead = () => {}
    let finishWrite = () => {}
    const first = planner.run({
      tool: "read",
      args: { file: "a" },
      capability: read,
      execute: () =>
        new Promise<ReturnType<typeof output>>((resolve) => {
          order.push("read:start")
          finishRead = () => {
            order.push("read:end")
            resolve(output("read"))
          }
        }),
    })
    await tick()
    const mutation = planner.run({
      tool: "write",
      args: { file: "a" },
      capability: write,
      execute: () =>
        new Promise<ReturnType<typeof output>>((resolve) => {
          order.push("write:start")
          finishWrite = () => {
            order.push("write:end")
            resolve(output("write"))
          }
        }),
    })
    const later = planner.run({
      tool: "read",
      args: { file: "b" },
      capability: read,
      execute: async () => {
        order.push("later")
        return output("later")
      },
    })

    await tick()
    expect(order).toEqual(["read:start"])
    finishRead()
    await tick()
    expect(order).toEqual(["read:start", "read:end", "write:start"])
    finishWrite()
    const completed = await Promise.all([first, mutation, later])
    expect(order).toEqual(["read:start", "read:end", "write:start", "write:end", "later"])
    expect(completed[1].metadata.dependencies).toEqual([completed[0].metadata.node])
    expect(completed[2].metadata.dependencies).toEqual([completed[1].metadata.node])
  })

  test("deduplicates in-flight reads, caches results, and invalidates after writes", async () => {
    const planner = SessionToolPlanner.create({
      root: "/workspace/cache",
      sessionID: "session",
      requestID: "request",
      readLimit: 3,
    })
    let executions = 0
    const call = () =>
      planner.run({
        tool: "grep",
        args: { pattern: "value" },
        capability: read,
        execute: async () => {
          executions += 1
          await tick()
          return output("result")
        },
      })

    const parallel = await Promise.all([call(), call()])
    expect(executions).toBe(1)
    expect(parallel.map((item) => item.metadata.cache).sort()).toEqual(["deduplicated", "miss"])
    expect((await call()).metadata.cache).toBe("hit")
    expect(executions).toBe(1)

    await planner.run({
      tool: "write",
      args: { file: "changed" },
      capability: write,
      execute: async () => output("changed"),
    })
    expect((await call()).metadata.cache).toBe("miss")
    expect(executions).toBe(2)
  })

  test("invalidates cached reads after a failed write attempt", async () => {
    const planner = SessionToolPlanner.create({
      root: "/workspace/failed-write",
      sessionID: "session",
      requestID: "request",
      readLimit: 2,
    })
    let executions = 0
    const call = () =>
      planner.run({
        tool: "read",
        args: { file: "partial" },
        capability: read,
        execute: async () => {
          executions += 1
          return output("value")
        },
      })

    expect((await call()).metadata.cache).toBe("miss")
    expect((await call()).metadata.cache).toBe("hit")
    await expect(
      planner.run({
        tool: "write",
        args: { file: "partial" },
        capability: write,
        execute: async () => {
          throw new Error("partial write")
        },
      }),
    ).rejects.toThrow("partial write")
    expect((await call()).metadata.cache).toBe("miss")
    expect(executions).toBe(2)
  })

  test("accepted evidence stops later search tools without executing them", async () => {
    const planner = SessionToolPlanner.create({
      root: "/workspace/evidence",
      sessionID: "session",
      requestID: "request",
      readLimit: 2,
    })
    await planner.run({
      tool: "evidence",
      args: { status: "complete" },
      capability: evidence,
      execute: async () => ({
        title: "Evidence",
        metadata: { evidence: true, status: "complete" },
        output: "complete",
      }),
    })
    const continued = SessionToolPlanner.create({
      root: "/workspace/evidence",
      sessionID: "session",
      requestID: "request",
      readLimit: 2,
    })
    let executed = false
    const result = await continued.run({
      tool: "grep",
      args: { pattern: "again" },
      capability: read,
      execute: async () => {
        executed = true
        return output("unexpected")
      },
    })

    expect(executed).toBeFalse()
    expect(result.metadata.skipped).toBe("evidence_sufficient")
  })

  test("attaches the preflight risk decision to the write graph node", async () => {
    const planner = SessionToolPlanner.create({
      root: "/workspace/risk",
      sessionID: "session",
      requestID: "request",
    })
    const risk = ChangeRisk.classify({
      tool: "write",
      args: { filePath: "/workspace/risk/src/permissions/access.ts" },
      root: "/workspace/risk",
      declared: true,
    })
    const result = await planner.run({
      tool: "write",
      args: { filePath: "/workspace/risk/src/permissions/access.ts" },
      capability: write,
      risk,
      execute: async () => output("changed"),
    })

    expect(result.metadata.risk).toEqual(risk)
    expect(result.metadata.risk?.policy.confirmation).toBe(true)
  })
})

function output(value: string) {
  return { title: value, metadata: {}, output: value }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
