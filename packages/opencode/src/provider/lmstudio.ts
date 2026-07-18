import { lmStudioContextLimits, probeLmStudio } from "@/local-agent-runtime/lmstudio"

type Request = (input: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>

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
