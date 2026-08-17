import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { llamaServerContextLimits, probeLlamaServer } from "@/local-agent-runtime/llama-server"

export function llamaServerDiscoveredChatModels(
  probe: Awaited<ReturnType<typeof probeLlamaServer>> | undefined,
  configured: Record<string, typeof ConfigProviderV1.Model.Type> = {},
): Record<string, typeof ConfigProviderV1.Model.Type> {
  const configuredIDs = new Set(
    Object.entries(configured).flatMap(([modelID, model]) => [modelID, model.id].filter((id) => id !== undefined)),
  )
  return Object.fromEntries(
    (probe?.models ?? [])
      .filter((model) => model.status !== "failed" && !configuredIDs.has(model.id))
      .map((model) => [
        model.id,
        {
          id: model.id,
          name: model.name,
          attachment: model.modalities.input.includes("image"),
          tool_call: model.capabilities.tools,
        },
      ]),
  )
}

export {
  findLlamaServerModel,
  llamaServerContextLimits,
  LlamaServerProbe,
  probeLlamaServer,
} from "@/local-agent-runtime/llama-server"
