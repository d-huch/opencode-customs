import { describe, expect, test } from "bun:test"
import { validateRuntimeConfig } from "../src/config"

describe("runtime local model configuration", () => {
  test("accepts LM Studio and normalizes the endpoint", () => {
    expect(validateRuntimeConfig({ providerID: "lmstudio", baseURL: "http://127.0.0.1:1234/v1/", modelID: " qwen " })).toEqual({
      providerID: "lmstudio",
      baseURL: "http://127.0.0.1:1234/v1",
      modelID: "qwen",
    })
  })

  test("accepts local llama-server", () => {
    expect(validateRuntimeConfig({ providerID: "llama-server", baseURL: "http://localhost:8080/v1", modelID: "instructor" })?.providerID).toBe("llama-server")
    expect(validateRuntimeConfig({ providerID: "llama-server", baseURL: "http://[::1]:8080/v1", modelID: "instructor" })?.baseURL).toBe("http://[::1]:8080/v1")
  })

  test("accepts local speech endpoints", () => {
    expect(validateRuntimeConfig({
      providerID: "lmstudio",
      baseURL: "http://localhost:1234/v1",
      modelID: "instructor",
      speech: {
        transcription: { baseURL: "http://127.0.0.1:8000/v1", modelID: "whisper", language: "uk" },
        synthesis: { endpoint: "http://localhost:8080/v1/audio/speech", modelID: "fish", voice: "instructor", speed: 1.1 },
      },
    })?.speech).toEqual({
      transcription: { baseURL: "http://127.0.0.1:8000/v1", modelID: "whisper", language: "uk" },
      synthesis: { endpoint: "http://localhost:8080/v1/audio/speech", modelID: "fish", voice: "instructor", speed: 1.1 },
    })
  })

  test("rejects remote speech endpoints and invalid playback speed", () => {
    const base = { providerID: "lmstudio", baseURL: "http://localhost:1234/v1", modelID: "instructor" }
    expect(validateRuntimeConfig({ ...base, speech: { transcription: { baseURL: "https://stt.example.com/v1", modelID: "whisper" } } })).toBeUndefined()
    expect(validateRuntimeConfig({ ...base, speech: { synthesis: { endpoint: "http://localhost:8080/v1/audio/speech", modelID: "fish", voice: "instructor", speed: 8 } } })).toBeUndefined()
  })

  test("rejects cloud, private network and unknown providers", () => {
    expect(validateRuntimeConfig({ providerID: "openai", baseURL: "https://api.openai.com/v1", modelID: "gpt" })).toBeUndefined()
    expect(validateRuntimeConfig({ providerID: "lmstudio", baseURL: "http://192.168.1.10:1234/v1", modelID: "qwen" })).toBeUndefined()
    expect(validateRuntimeConfig({ providerID: "lmstudio", baseURL: "broken", modelID: "qwen" })).toBeUndefined()
  })

  test("accepts bounded retention and a secure optional xAPI endpoint", () => {
    const value = validateRuntimeConfig({
      providerID: "lmstudio",
      baseURL: "http://localhost:1234/v1",
      modelID: "instructor",
      retention: { logsDays: 14, replaysDays: 30, resultsDays: 365 },
      xapi: { enabled: true, endpoint: "https://lrs.example/xapi/", actorAccount: "deployment-7" },
    })
    expect(value?.retention).toEqual({ logsDays: 14, replaysDays: 30, resultsDays: 365 })
    expect(value?.xapi).toEqual({ enabled: true, endpoint: "https://lrs.example/xapi", actorAccount: "deployment-7" })
  })

  test("rejects insecure remote xAPI and unbounded retention", () => {
    const base = { providerID: "lmstudio", baseURL: "http://localhost:1234/v1", modelID: "instructor" }
    expect(validateRuntimeConfig({ ...base, xapi: { enabled: true, endpoint: "http://lrs.example/xapi", actorAccount: "deployment" } })).toBeUndefined()
    expect(validateRuntimeConfig({ ...base, retention: { logsDays: 0, replaysDays: 30, resultsDays: 365 } })).toBeUndefined()
  })
})
