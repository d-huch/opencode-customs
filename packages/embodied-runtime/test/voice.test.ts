import { afterEach, describe, expect, test } from "bun:test"
import type { Server } from "bun"
import { createPCMRecognition, synthesizeSpeech } from "../src/voice"

const servers: Server<unknown>[] = []
afterEach(() => servers.splice(0).forEach((server) => server.stop(true)))

describe("local voice adapters", () => {
  test("posts a bounded WAV to an OpenAI-compatible transcription endpoint", async () => {
    let request: { path: string; model?: string; language?: string; wav?: Uint8Array }
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(input) {
        const form = await input.formData()
        const file = form.get("file")
        request = {
          path: new URL(input.url).pathname,
          model: String(form.get("model")),
          language: String(form.get("language")),
          wav: file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : undefined,
        }
        return Response.json({ text: "Перевірка завершена" })
      },
    })
    servers.push(server)
    const events: Array<{ type: string; text?: string }> = []
    const recognition = createPCMRecognition(
      { baseURL: `http://127.0.0.1:${server.port}/v1`, modelID: "whisper-local", language: "uk" },
      { locale: "uk-UA", sampleRate: 16_000, onEvent: (event) => events.push(event) },
    )
    expect(recognition.write(Buffer.from([0, 0, 1, 0]))).toBeTrue()
    recognition.finish()
    expect(await recognition.result).toBe("Перевірка завершена")
    expect(request!.path).toBe("/v1/audio/transcriptions")
    expect(request!.model).toBe("whisper-local")
    expect(request!.language).toBe("uk")
    expect(new TextDecoder().decode(request!.wav?.slice(0, 4))).toBe("RIFF")
    expect(events.at(-1)).toEqual({ type: "final", text: "Перевірка завершена" })
  })

  test("returns local synthesized audio without a cloud fallback", async () => {
    let request: Record<string, unknown> | undefined
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(input) {
        request = await input.json() as Record<string, unknown>
        return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "audio/wav" } })
      },
    })
    servers.push(server)
    const result = await synthesizeSpeech(
      { endpoint: `http://127.0.0.1:${server.port}/v1/audio/speech`, modelID: "fish-local", voice: "instructor" },
      "Safety check complete.",
      new AbortController().signal,
    )
    expect(request).toMatchObject({
      model: "fish-local",
      voice: "instructor",
      input: "Safety check complete.",
      response_format: "wav",
    })
    expect(result.contentType).toBe("audio/wav")
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([82, 73, 70, 70]))
  })
})
