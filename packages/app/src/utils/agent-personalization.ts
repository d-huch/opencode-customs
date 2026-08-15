export type AgentTone = "natural" | "professional" | "direct" | "friendly"
export type AgentDetail = "brief" | "balanced" | "detailed"
export type AgentProactivity = "reactive" | "balanced" | "proactive"
export type AgentHumor = "off" | "subtle" | "playful"

export type AgentPersonalizationProfile = {
  enabled: boolean
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
  createdAt: number
  updatedAt: number
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
