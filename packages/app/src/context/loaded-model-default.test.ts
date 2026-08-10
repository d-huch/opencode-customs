import { describe, expect, test } from "bun:test"
import { loadedModelDefault } from "./loaded-model-default"

describe("loadedModelDefault", () => {
  test("returns the loaded LM Studio default", () => {
    expect(
      loadedModelDefault(
        {
          models: [{ id: "google/gemma", type: "llm", loaded: true, instances: ["gemma-instance"] }],
        },
        {
          gemma: { id: "gemma", api: { id: "google/gemma" } },
        },
        (model) => model.providerID === "lmstudio" && model.modelID === "gemma",
      ),
    ).toEqual({ providerID: "lmstudio", modelID: "gemma" })
  })

  test("ignores an unavailable loaded model", () => {
    expect(
      loadedModelDefault(
        {
          models: [{ id: "google/gemma", type: "llm", loaded: true, instances: [] }],
        },
        {
          gemma: { id: "gemma", api: { id: "google/gemma" } },
        },
        () => false,
      ),
    ).toBeUndefined()
  })

  test("ignores downloaded models that are not loaded into memory", () => {
    expect(
      loadedModelDefault(
        {
          models: [{ id: "google/gemma", type: "llm", loaded: false, instances: [] }],
        },
        {
          gemma: { id: "gemma", api: { id: "google/gemma" } },
        },
        () => true,
      ),
    ).toBeUndefined()
  })

  test("ignores loaded embedding models", () => {
    expect(
      loadedModelDefault(
        {
          models: [{ id: "nomic-embed", type: "embedding", loaded: true, instances: ["embed-instance"] }],
        },
        {
          embed: { id: "embed", api: { id: "nomic-embed" } },
        },
        () => true,
      ),
    ).toBeUndefined()
  })
})
