import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { LlamaServerProbe } from "./llama-server"
import type { LmStudioProbe } from "./lmstudio"

export function syncLmStudioCatalog(catalog: Catalog.Interface, probe: LmStudioProbe) {
  return catalog.transform((draft) => {
      const providerID = ProviderV2.ID.make("lmstudio")
      draft.provider.update(providerID, (provider) => {
        provider.name = "LM Studio"
        provider.api = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: probe.baseURL,
          settings: {},
        }
      })
      for (const item of probe.models) {
        if (item.type === "embedding") continue
        const modelID = ModelV2.ID.make(item.id)
        draft.model.update(providerID, modelID, (model) => {
          const context = item.context.active ?? item.context.supported ?? model.limit.context
          model.name = item.name
          model.api = {
            type: "aisdk",
            id: modelID,
            package: "@ai-sdk/openai-compatible",
            settings: {},
          }
          model.capabilities = {
            tools: item.capabilities.tools,
            input: ["text", ...(item.capabilities.vision ? ["image"] : [])],
            output: ["text", ...(item.capabilities.reasoning ? ["reasoning"] : [])],
          }
          model.status = "active"
          model.enabled = true
          model.runtime = {
            ...(item.instances[0] ? { instanceID: item.instances[0] } : {}),
            ...(item.sizeBytes ? { sizeBytes: item.sizeBytes } : {}),
          }
          if (context > 0) {
            model.limit.context = context
            model.limit.output = Math.max(model.limit.output, Math.min(32_768, Math.floor(context / 4)))
          }
        })
      }
  })
}

export function syncLlamaServerCatalog(catalog: Catalog.Interface, probe: LlamaServerProbe) {
  return catalog.transform((draft) => {
      const providerID = ProviderV2.ID.make("llama-server")
      draft.provider.update(providerID, (provider) => {
        provider.name = "llama-server"
        provider.api = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: probe.baseURL,
          settings: {},
        }
      })
      for (const item of probe.models) {
        const modelID = ModelV2.ID.make(item.id)
        draft.model.update(providerID, modelID, (model) => {
          const context = item.context.active ?? item.context.supported ?? model.limit.context
          model.name = item.name
          model.api = {
            type: "aisdk",
            id: modelID,
            package: "@ai-sdk/openai-compatible",
            settings: {},
          }
          model.capabilities = {
            tools: item.capabilities.tools,
            input: [...item.modalities.input],
            output: [...item.modalities.output],
          }
          model.status = "active"
          model.enabled = true
          model.runtime = {
            ...(item.sizeBytes ? { sizeBytes: item.sizeBytes } : {}),
          }
          if (context > 0) {
            model.limit.context = context
            model.limit.output = Math.max(model.limit.output, Math.min(32_768, Math.floor(context / 4)))
          }
        })
      }
  })
}
