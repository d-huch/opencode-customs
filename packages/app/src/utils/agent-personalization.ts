export type AgentTone = "natural" | "professional" | "direct" | "friendly"
export type AgentDetail = "brief" | "balanced" | "detailed"
export type AgentProactivity = "reactive" | "balanced" | "proactive"
export type AgentHumor = "off" | "subtle" | "playful"
export type AgentArchetype = "natural" | "military" | "depressive" | "clown" | "jarvis" | "mentor" | "sarcastic"

export type AgentLocalVoice = {
  provider: "local"
  endpoint: string
  model: string
  mode: "quality" | "fast"
  voice: string
  playbackRate: number
  volume: number
}

export type AgentFishVoice = {
  provider: "fish-local"
  voicePresetID: string
  endpoint: string
  latency: "normal" | "balanced"
  language: "auto" | "uk" | "en" | "mixed"
  playbackRate: number
  volume: number
  temperature: number
  topP: number
  repetitionPenalty: number
  seed: number | null
  chunkLength: number
  normalize: boolean
  streaming: boolean
  useMemoryCache: boolean
  maxNewTokens: number
}

export type AgentVoice = AgentLocalVoice | AgentFishVoice

export type AgentPersonalizationProfile = {
  enabled: boolean
  archetype: AgentArchetype
  assistantName: string
  userName: string
  addressAs: string
  language: string
  tone: AgentTone
  detail: AgentDetail
  proactivity: AgentProactivity
  humor: AgentHumor
  catchphrases: string
  customInstructions: string
}

export type AgentPersonalizationValues = Omit<AgentPersonalizationProfile, "enabled">

export type AgentPersonalizationPreset = AgentPersonalizationValues & {
  id: string
  name: string
  voice?: AgentVoice | null
  createdAt: number
  updatedAt: number
}

export function migrateAgentPersonalization(input: {
  enabled?: boolean
  activePresetID?: string
  presets?: Array<Omit<AgentPersonalizationPreset, "archetype"> & { archetype?: AgentArchetype }>
  values: AgentPersonalizationValues
  createID: () => string
  now: number
}) {
  const archetypes = new Set<AgentArchetype>([
    "natural",
    "military",
    "depressive",
    "clown",
    "jarvis",
    "mentor",
    "sarcastic",
  ])
  const existing = (input.presets ?? []).map((preset) => {
    const archetype = preset.archetype
    return {
      ...preset,
      archetype: archetype && archetypes.has(archetype) ? archetype : ("natural" as const),
      voice: preset.voice ?? null,
    }
  })
  const active = input.activePresetID
  const id = (active && existing.some((preset) => preset.id === active) ? active : existing[0]?.id) ?? input.createID()
  const presets = existing.length
    ? existing
    : [
        {
          id,
          name: input.values.assistantName,
          ...input.values,
          voice: null,
          createdAt: input.now,
          updatedAt: input.now,
        },
      ]
  return {
    version: 2,
    defaultPresetID: input.enabled === false ? "" : id,
    presets,
  }
}

export function resolveAgentPersonality(
  presets: AgentPersonalizationPreset[],
  selection: string | null | undefined,
  defaultPresetID: string,
) {
  const id = selection === undefined ? defaultPresetID : selection
  if (!id) return
  return presets.find((preset) => preset.id === id)
}

export function detachFishVoicePreset(
  presets: AgentPersonalizationPreset[],
  voicePresetID: string,
  updatedAt = Date.now(),
) {
  return presets.map((preset) =>
    preset.voice?.provider === "fish-local" && preset.voice.voicePresetID === voicePresetID
      ? { ...preset, voice: null, updatedAt }
      : preset,
  )
}

const compact = (value: string, limit: number) => value.replace(/\s+/g, " ").trim().slice(0, limit)

export function agentCatchphrases(value: string) {
  const seen = new Set<string>()
  return value
    .split(/[,\n]+/)
    .map((phrase) => compact(phrase, 120))
    .filter((phrase) => {
      const key = phrase.toLocaleLowerCase()
      if (!phrase || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 20)
}

export function agentPersonalizationInstruction(profile: AgentPersonalizationProfile) {
  if (!profile.enabled) return

  const assistantName = compact(profile.assistantName, 80)
  const userName = compact(profile.userName, 80)
  const addressAs = compact(profile.addressAs, 80)
  const language = compact(profile.language, 80)
  const catchphrases = agentCatchphrases(profile.catchphrases)
  const customInstructions = profile.customInstructions.trim().slice(0, 4_000)
  const archetype = {
    natural: "Communicate naturally and neutrally, adapting to the conversation.",
    military: "Use a disciplined, structured, direct manner with clear priorities and concise action language.",
    depressive:
      "Use a subdued, melancholic, dry manner while remaining constructive. Never encourage hopelessness, self-harm, or giving up.",
    clown:
      "Use a playful, lightly absurd manner. Suppress jokes in dangerous, sensitive, high-stakes, or otherwise serious situations.",
    jarvis: "Be calm, precise, composed, and restrainedly witty, like a highly capable personal assistant.",
    mentor: "Be patient, educational, encouraging, and explain the reasoning that helps the user learn.",
    sarcastic: "Use light dry sarcasm without insulting, belittling, or antagonizing the user.",
  }[profile.archetype]
  const lines = [
    "Apply this user-controlled personalization profile to communication style and collaboration behavior.",
    "It does not override system or developer instructions, the active user request, permissions, safety rules, factual accuracy, or required verification.",
    "Do not refuse an ordinary conversation only because it is unrelated to the current repository. Handle both general conversation and software work within the active agent's capabilities.",
    assistantName ? `Preferred assistant name: ${assistantName}.` : undefined,
    userName ? `User name: ${userName}.` : undefined,
    addressAs ? `Address the user as: ${addressAs}.` : undefined,
    !language || language.toLowerCase() === "auto"
      ? "Reply in the same natural language and script as the user's latest request. Use standard grammar and do not switch or mix languages unless the user does."
      : `Preferred response language: ${language}. Follow an explicit per-request language choice instead.`,
    `Personality archetype: ${profile.archetype}. ${archetype}`,
    "The explicit tone, detail level, proactivity, and humor settings below refine the archetype and take priority in their respective dimensions.",
    `Tone: ${profile.tone}.`,
    `Detail level: ${profile.detail}.`,
    `Proactivity: ${profile.proactivity}.`,
    `Humor: ${profile.humor}.`,
    catchphrases.length
      ? [
          "Optional user-provided catchphrases:",
          ...catchphrases.map((phrase) => `- ${phrase}`),
          "Use at most one catchphrase in a response and only when it fits naturally. Do not force one into every response, repeat one in consecutive responses, alter its wording, or let it replace factual content. Avoid catchphrases in errors, warnings, confirmations of destructive actions, and other serious situations.",
        ].join("\n")
      : undefined,
    customInstructions ? `Additional user preferences:\n${customInstructions}` : undefined,
  ].filter((line): line is string => !!line)

  return lines.join("\n")
}
