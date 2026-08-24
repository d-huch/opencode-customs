import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { inspectNemotronModelDirectory } from "./nemotron-voice"

describe("Nemotron VoiceChat model validation", () => {
  test("accepts the expected architecture with three complete shards", async () => {
    const directory = join(process.env.TMPDIR ?? "/tmp", `nemotron-complete-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "config.json"), JSON.stringify({ model_type: "nemotron_voicechat" }))
    await writeFile(join(directory, "model.safetensors.index.json"), JSON.stringify({
      weight_map: { a: "model-00001-of-00003.safetensors", b: "model-00002-of-00003.safetensors", c: "model-00003-of-00003.safetensors" },
    }))
    await Promise.all([1, 2, 3].map((part) => writeFile(join(directory, `model-0000${part}-of-00003.safetensors`), "weight")))
    expect(await inspectNemotronModelDirectory(directory)).toEqual({ valid: true, incomplete: false, reason: undefined })
  })

  test("rejects an active LM Studio partial download", async () => {
    const directory = join(process.env.TMPDIR ?? "/tmp", `nemotron-partial-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "config.json"), JSON.stringify({ model_type: "nemotron_voicechat" }))
    await writeFile(join(directory, "downloading_model-00003-of-00003.safetensors.part"), "partial")
    expect(await inspectNemotronModelDirectory(directory)).toEqual({ valid: false, incomplete: true, reason: "partial" })
  })

  test("rejects another architecture", async () => {
    const directory = join(process.env.TMPDIR ?? "/tmp", `nemotron-wrong-${crypto.randomUUID()}`)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "config.json"), JSON.stringify({ model_type: "llama" }))
    expect(await inspectNemotronModelDirectory(directory)).toEqual({ valid: false, incomplete: false, reason: "architecture" })
  })
})
