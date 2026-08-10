import { lmStudioContextLimits, probeLmStudio } from "@/local-agent-runtime/lmstudio"
import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"

type Request = (input: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>

export const LMSTUDIO_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const

export function lmStudioReasoningVariants(enabled: boolean) {
  if (!enabled) return
  return Object.fromEntries(
    LMSTUDIO_REASONING_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]),
  )
}

export function lmStudioDiscoveredChatModels(
  probe: Awaited<ReturnType<typeof probeLmStudio>> | undefined,
  configured: Record<string, typeof ConfigProviderV1.Model.Type> = {},
): Record<string, typeof ConfigProviderV1.Model.Type> {
  const configuredIDs = new Set(
    Object.entries(configured).flatMap(([modelID, model]) => [modelID, model.id].filter((id) => id !== undefined)),
  )
  return Object.fromEntries(
    (probe?.models ?? [])
      .filter((model) => model.type === "llm" && !configuredIDs.has(model.id))
      .map((model) => [
        model.id,
        {
          id: model.id,
          name: model.name,
          attachment: model.capabilities.vision,
          reasoning: model.capabilities.reasoning,
          tool_call: model.capabilities.tools,
        },
      ]),
  )
}

export async function discoverLmStudioContextLimits(input: {
  baseURL: unknown
  apiKey: unknown
  request?: Request
}) {
  return lmStudioContextLimits(
    await probeLmStudio({
      ...input,
      refresh: true,
    }),
  )
}

export { findLmStudioModel, lmStudioContextLimits, LmStudioProbe, probeLmStudio } from "@/local-agent-runtime/lmstudio"
