export type RuntimeConfig = {
  providerID: "lmstudio" | "llama-server"
  baseURL: string
  modelID: string
  aiTraineeModel?: {
    providerID: "lmstudio" | "llama-server"
    baseURL: string
    modelID: string
  }
  speech?: {
    transcription?: {
      baseURL: string
      modelID: string
      language?: string
    }
    synthesis?: {
      endpoint: string
      modelID: string
      voice: string
      speed?: number
    }
  }
  retention?: {
    logsDays: number
    replaysDays: number
    resultsDays: number
  }
  xapi?: {
    enabled: boolean
    endpoint: string
    actorAccount: string
  }
}

export function validateRuntimeConfig(value: unknown): RuntimeConfig | undefined {
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  if (input.providerID !== "lmstudio" && input.providerID !== "llama-server") return
  if (typeof input.baseURL !== "string" || typeof input.modelID !== "string" || !input.modelID.trim()) return
  if (!URL.canParse(input.baseURL)) return
  const url = new URL(input.baseURL)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") return
  const speech = validateSpeech(input.speech)
  if (input.speech !== undefined && !speech) return
  const retention = validateRetention(input.retention)
  if (input.retention !== undefined && !retention) return
  const xapi = validateXApi(input.xapi)
  if (input.xapi !== undefined && !xapi) return
  const aiTraineeModel = validateModelRoute(input.aiTraineeModel)
  if (input.aiTraineeModel !== undefined && !aiTraineeModel) return
  return {
    providerID: input.providerID,
    baseURL: url.toString().replace(/\/$/, ""),
    modelID: input.modelID.trim(),
    ...(aiTraineeModel ? { aiTraineeModel } : {}),
    ...(speech ? { speech } : {}),
    ...(retention ? { retention } : {}),
    ...(xapi ? { xapi } : {}),
  }
}

export function aiTraineeRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  if (!config.aiTraineeModel) return config
  return {
    ...config,
    providerID: config.aiTraineeModel.providerID,
    baseURL: config.aiTraineeModel.baseURL,
    modelID: config.aiTraineeModel.modelID,
  }
}

function validateModelRoute(value: unknown): RuntimeConfig["aiTraineeModel"] | undefined {
  if (value === undefined) return
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  if (input.providerID !== "lmstudio" && input.providerID !== "llama-server") return
  const baseURL = localURL(input.baseURL)
  if (!baseURL || typeof input.modelID !== "string" || !input.modelID.trim()) return
  return { providerID: input.providerID, baseURL, modelID: input.modelID.trim() }
}

function validateRetention(value: unknown): RuntimeConfig["retention"] | undefined {
  if (value === undefined) return
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  if (![input.logsDays, input.replaysDays, input.resultsDays].every((item) => typeof item === "number" && Number.isInteger(item) && item >= 1 && item <= 3_650)) return
  return { logsDays: input.logsDays as number, replaysDays: input.replaysDays as number, resultsDays: input.resultsDays as number }
}

function validateXApi(value: unknown): RuntimeConfig["xapi"] | undefined {
  if (value === undefined) return
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  if (typeof input.enabled !== "boolean" || typeof input.endpoint !== "string" || !URL.canParse(input.endpoint)) return
  if (typeof input.actorAccount !== "string" || !input.actorAccount.trim()) return
  const endpoint = new URL(input.endpoint)
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))) return
  return { enabled: input.enabled, endpoint: endpoint.toString().replace(/\/$/, ""), actorAccount: input.actorAccount.trim() }
}

function validateSpeech(value: unknown): RuntimeConfig["speech"] | undefined {
  if (value === undefined) return
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  const transcription = validateTranscription(input.transcription)
  if (input.transcription !== undefined && !transcription) return
  const synthesis = validateSynthesis(input.synthesis)
  if (input.synthesis !== undefined && !synthesis) return
  if (!transcription && !synthesis) return
  return { ...(transcription ? { transcription } : {}), ...(synthesis ? { synthesis } : {}) }
}

function validateTranscription(value: unknown): NonNullable<RuntimeConfig["speech"]>["transcription"] | undefined {
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  const baseURL = localURL(input.baseURL)
  if (!baseURL || typeof input.modelID !== "string" || !input.modelID.trim()) return
  if (input.language !== undefined && typeof input.language !== "string") return
  return {
    baseURL,
    modelID: input.modelID.trim(),
    ...(typeof input.language === "string" && input.language.trim() ? { language: input.language.trim() } : {}),
  }
}

function validateSynthesis(value: unknown): NonNullable<RuntimeConfig["speech"]>["synthesis"] | undefined {
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  const endpoint = localURL(input.endpoint)
  if (!endpoint || typeof input.modelID !== "string" || !input.modelID.trim()) return
  if (typeof input.voice !== "string" || !input.voice.trim()) return
  if (input.speed !== undefined && (typeof input.speed !== "number" || input.speed < 0.25 || input.speed > 4)) return
  return {
    endpoint,
    modelID: input.modelID.trim(),
    voice: input.voice.trim(),
    ...(typeof input.speed === "number" ? { speed: input.speed } : {}),
  }
}

function localURL(value: unknown) {
  if (typeof value !== "string" || !URL.canParse(value)) return
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") return
  return url.toString().replace(/\/$/, "")
}
