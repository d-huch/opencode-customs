import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { SessionLog } from "../../src/local-agent-runtime/session-log"

const root = path.join(import.meta.dir, ".tmp-session-log")

afterEach(async () => {
  delete process.env.OPENCODE_SESSION_LOG_DIR
  await fs.rm(root, { recursive: true, force: true })
})

describe("session log", () => {
  test("writes one structured JSONL file per session", async () => {
    process.env.OPENCODE_SESSION_LOG_DIR = root

    await Promise.all([
      SessionLog.write({ sessionID: "ses_one", type: "prompt.received", data: { text: "Привіт" } }),
      SessionLog.write({ sessionID: "ses_one", type: "model.request", data: { modelID: "coding" } }),
      SessionLog.write({ sessionID: "ses_two", type: "prompt.received", data: { text: "Hello" } }),
    ])

    const first = (await Bun.file(path.join(root, "ses_one.jsonl")).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(first.map((entry) => entry.type)).toEqual(["prompt.received", "model.request"])
    expect(first[0].data.text).toBe("Привіт")
    expect(await Bun.file(path.join(root, "ses_two.jsonl")).exists()).toBe(true)
  })

  test("clears every session log", async () => {
    process.env.OPENCODE_SESSION_LOG_DIR = root
    await SessionLog.write({ sessionID: "ses_one", type: "prompt.received" })
    await SessionLog.write({ sessionID: "ses_two", type: "prompt.received" })

    await SessionLog.clear()

    expect(await fs.readdir(root)).toEqual([])
  })

  test("reports the safe local path and whether the log exists", async () => {
    process.env.OPENCODE_SESSION_LOG_DIR = root

    expect(await SessionLog.location("ses_one")).toEqual({
      path: path.join(root, "ses_one.jsonl"),
      exists: false,
    })

    await SessionLog.write({ sessionID: "ses_one", type: "prompt.received" })

    expect(await SessionLog.location("ses_one")).toEqual({
      path: path.join(root, "ses_one.jsonl"),
      exists: true,
    })
  })

  test("does not invent unsafe filenames and bounds large strings", async () => {
    process.env.OPENCODE_SESSION_LOG_DIR = root
    await SessionLog.write({ sessionID: "../unsafe", type: "tool.result", data: { output: "x".repeat(40_000) } })

    const files = await fs.readdir(root)
    expect(files).toEqual([".._unsafe.jsonl"])
    const entry = JSON.parse(await Bun.file(path.join(root, files[0]!)).text())
    expect(entry.data.output.length).toBeLessThan(40_000)
    expect(entry.data.output).toContain("session log truncated")
  })
})
