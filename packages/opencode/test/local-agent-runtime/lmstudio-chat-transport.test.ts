import { describe, expect, test } from "bun:test"
import { LmStudioChatTransport } from "@/local-agent-runtime/lmstudio-chat-transport"
import fs from "fs/promises"
import os from "os"
import path from "path"

const identity = {
  baseURL: "http://127.0.0.1:1234/v1",
  modelID: "qwen-27b",
  instanceID: "qwen/qwen3.8-27b",
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-lmstudio-transport-"))
  const file = path.join(directory, "cache.json")
  return {
    file,
    store: LmStudioChatTransport.createStore(file),
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  }
}

describe("lmstudio chat transport", () => {
  test("normalizes equivalent server endpoints into one compatibility identity", () => {
    expect(
      LmStudioChatTransport.identity({
        baseURL: "http://127.0.0.1:1234/v1/",
        modelID: "qwen-27b",
        instanceID: "qwen/qwen3.8-27b",
      }),
    ).toEqual({
      baseURL: "http://127.0.0.1:1234",
      modelID: "qwen-27b",
      instanceID: "qwen/qwen3.8-27b",
    })
  })

  test("classifies only deterministic Responses payload failures", () => {
    expect(
      LmStudioChatTransport.fallbackReason(new Error("Jinja Exception: System message must be at the beginning.")),
    ).toBe("system_message_position")
    expect(
      LmStudioChatTransport.fallbackReason({
        data: { responseBody: '{"error":{"code":"invalid_union","param":"input"}}' },
      }),
    ).toBe("invalid_responses_input")
    expect(LmStudioChatTransport.fallbackReason(new Error("HTTP 500 Internal server error"))).toBeUndefined()
  })

  test("persists a fallback and restores it in a separate store", async () => {
    const current = await fixture()
    try {
      await current.store.rememberFallback(identity, "invalid_responses_input", 1_000)
      expect(await LmStudioChatTransport.createStore(current.file).resolve(identity, 2_000)).toEqual({
        transport: "chat_completions",
        reason: "invalid_responses_input",
        expiresAt: 86_401_000,
      })
    } finally {
      await current.cleanup()
    }
  })

  test("expires cached fallbacks without affecting another model", async () => {
    const current = await fixture()
    const other = { ...identity, modelID: "qwen-14b" }
    try {
      await current.store.rememberFallback(identity, "system_message_position", 1_000)
      await current.store.rememberFallback(other, "unsupported_item_reference", 2_000)

      expect(await current.store.resolve(identity, 86_401_000)).toEqual({ transport: "responses" })
      expect(await current.store.resolve(other, 86_401_000)).toMatchObject({
        transport: "chat_completions",
        reason: "unsupported_item_reference",
      })
    } finally {
      await current.cleanup()
    }
  })

  test("isolates cached fallbacks by endpoint, model, and active instance", async () => {
    const current = await fixture()
    try {
      await current.store.rememberFallback(identity, "invalid_responses_input", 1_000)

      expect(await current.store.resolve({ ...identity, baseURL: "http://127.0.0.1:1234/v1/" }, 2_000)).toMatchObject({
        transport: "chat_completions",
      })
      expect(await current.store.resolve({ ...identity, baseURL: "http://127.0.0.1:8080/v1" }, 2_000)).toEqual({
        transport: "responses",
      })
      expect(await current.store.resolve({ ...identity, modelID: "qwen-14b" }, 2_000)).toEqual({
        transport: "responses",
      })
      expect(await current.store.resolve({ ...identity, instanceID: "qwen/qwen3.8-27b-copy" }, 2_000)).toEqual({
        transport: "responses",
      })
    } finally {
      await current.cleanup()
    }
  })

  test("treats missing and corrupted cache files as Responses", async () => {
    const missing = await fixture()
    const corrupted = await fixture()
    try {
      expect(await missing.store.resolve(identity)).toEqual({ transport: "responses" })
      await fs.writeFile(corrupted.file, "not json", "utf8")
      expect(await corrupted.store.resolve(identity)).toEqual({ transport: "responses" })
    } finally {
      await Promise.all([missing.cleanup(), corrupted.cleanup()])
    }
  })
})
