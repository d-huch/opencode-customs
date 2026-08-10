import type { ModelKey } from "./models"

type Probe = {
  models: ReadonlyArray<{
    id: string
    type: string
    loaded: boolean
    instances: ReadonlyArray<string>
  }>
}

type Catalog = Record<
  string,
  {
    id: string
    api: { id: string }
  }
>

export function loadedModelDefault(
  probe: Probe | undefined,
  catalog: Catalog | undefined,
  valid: (model: ModelKey) => boolean,
): ModelKey | undefined {
  if (!catalog) return
  const loaded = probe?.models.filter((model) => model.loaded && model.type === "llm") ?? []
  return Object.values(catalog)
    .map((item) => ({ item, model: { providerID: "lmstudio", modelID: item.id } satisfies ModelKey }))
    .find(({ item, model }) => {
      if (!valid(model)) return false
      return loaded.some(
        (candidate) =>
          candidate.id === item.id ||
          candidate.id === item.api.id ||
          candidate.instances.includes(item.id) ||
          candidate.instances.includes(item.api.id),
      )
    })
    ?.model
}
