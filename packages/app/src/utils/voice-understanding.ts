import { applyVoiceDictionary, type VoiceDictionaryContext, type VoiceDictionaryEntry } from "./voice-dictionary"

export type VoicePersonalityMode = "normal" | "work" | "night" | "emergency"
export type VoiceIntent = "conversation" | "code" | "navigation" | "action" | "dangerous"
export type VoiceUnderstandingDecision = "submit" | "review" | "learned"
export type VoiceUnderstandingReason = "low_confidence" | "ambiguous_reference" | "dangerous_command"

type Alternative = {
  text: string
  confidence?: number
}

type VoiceTranscriptInput = {
  text: string
  confidence?: number
  averageLogProbability?: number
  noSpeechProbability?: number
  languageProbability?: number
  alternatives?: Alternative[]
  dictionary: VoiceDictionaryEntry[]
  dictionaryContext: VoiceDictionaryContext
  contextualCorrection: boolean
  confirmRiskyCommands: boolean
  recentContext: string
}

export type VoiceTranscriptAssessment = {
  original: string
  text: string
  intent: VoiceIntent
  decision: VoiceUnderstandingDecision
  reason?: VoiceUnderstandingReason
  learned?: { heard: string; replacement: string }
  appliedCorrections: string[]
}

// JavaScript's `\b` only understands ASCII word characters, so it silently
// misses Ukrainian words. Unicode-aware boundaries keep mixed speech routing
// deterministic without maintaining language-specific tokenizers here.
const questions = /^(хто|що|де|коли|чому|навіщо|як|який|яка|яке|які|скільки|куди|звідки|чи|who|what|where|when|why|how|which|whose|is|are|do|does|did|can|could|would|should)(?=$|[^\p{L}\p{N}])/iu
const code = /(?:^|[^\p{L}\p{N}])(code|код|файл|клас|метод|функц[\p{L}\p{N}]*|проєкт|проект|репозитор[\p{L}\p{N}]*|build|test|deploy|commit|git|terminal|unity|c#|python|javascript|typescript|php)(?=$|[^\p{L}\p{N}])/iu
const navigation = /(?:^|[^\p{L}\p{N}])(відкрий|покажи|перейди|знайди|open|show|navigate|find)(?=$|[^\p{L}\p{N}])/iu
const action = /(?:^|[^\p{L}\p{N}])(запусти|створи|зміни|додай|закрий|відкрий|надішли|виконай|run|create|change|add|close|open|send|execute)(?=$|[^\p{L}\p{N}])/iu
const danger = /(?:^|[^\p{L}\p{N}])(видал[\p{L}\p{N}]*|стер[\p{L}\p{N}]*|очист[\p{L}\p{N}]*|формат[\p{L}\p{N}]*|знищ[\p{L}\p{N}]*|перекаж[\p{L}\p{N}]*|надішли\s+грош[\p{L}\p{N}]*|delete|remove|wipe|format|erase|shutdown|transfer|send\s+money)(?=$|[^\p{L}\p{N}])/iu
const broadTarget = /(?:^|[^\p{L}\p{N}])(все|усі|всю|цілий|повністю|диск|база|репозитор[\p{L}\p{N}]*|акаунт|all|every|entire|disk|database|repository|account)(?=$|[^\p{L}\p{N}])/iu
const reference = /(?:^|[^\p{L}\p{N}])(його|її|їх|це|цю|цей|ця|там|туди|воно|it|this|that|there|him|her|them)(?=$|[^\p{L}\p{N}])/iu

export function assessVoiceTranscript(input: VoiceTranscriptInput): VoiceTranscriptAssessment {
  const original = input.text.trim()
  const learned = input.contextualCorrection ? explicitCorrection(original) : undefined
  if (learned) {
    return {
      original,
      text: original,
      intent: "conversation",
      decision: "learned",
      learned,
      appliedCorrections: [],
    }
  }

  const selected = selectCandidate(original, input.confidence, input.alternatives)
  const corrected = input.contextualCorrection
    ? applyVoiceDictionary(selected, input.dictionary, input.dictionaryContext)
    : { text: selected, applied: [] as string[] }
  const text = punctuate(corrected.text)
  const intent = classifyIntent(text)
  const base = {
    original,
    text,
    intent,
    appliedCorrections: corrected.applied,
  }
  if (isLowConfidence(input)) return { ...base, decision: "review" as const, reason: "low_confidence" }
  if (input.confirmRiskyCommands && intent === "dangerous") {
    return { ...base, decision: "review" as const, reason: "dangerous_command" }
  }
  if (isAmbiguousReference(text, input.recentContext)) {
    return { ...base, decision: "review" as const, reason: "ambiguous_reference" }
  }
  return { ...base, decision: "submit" as const }
}

export function voicePersonalityInstruction(input: {
  mode: VoicePersonalityMode
  intent: VoiceIntent
  language: string
}) {
  const mode = {
    normal: "Use a natural, warm, concise delivery. Usually answer in one or two short sentences unless the task needs detail.",
    work: "Use a direct professional delivery. Lead with the result, then only the details needed to act.",
    night: "Use a calm, quiet, especially brief delivery. Avoid unnecessary lists and follow-up questions.",
    emergency: "State the most important outcome or warning first. Be unambiguous and omit nonessential commentary.",
  }[input.mode]
  const completeness = input.intent === "code" ? "For code work, completeness and verification take priority over brevity." : ""
  return [
    "This request came from the voice interface.",
    `Reply in the same natural language and script as the user's spoken request (${input.language || "auto-detected"}); preserve mixed-language technical terms as spoken.`,
    "First determine the correct facts, decision, or action. Then express it with a stable assistant personality.",
    mode,
    completeness,
    "Use the recent conversation and active workspace to resolve references such as “it” or “there”. Ask one short clarification only when the reference is genuinely ambiguous.",
    "Do not repeat the obvious, invent emotions, claim unsupported certainty, or restrict ordinary conversation to software engineering.",
  ]
    .filter(Boolean)
    .join(" ")
}

function selectCandidate(text: string, confidence: number | undefined, alternatives: Alternative[] | undefined) {
  const candidate = alternatives
    ?.filter((item) => item.text.trim())
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]
  if (!candidate || candidate.confidence === undefined || candidate.confidence < (confidence ?? 0) + 0.15) return text
  return candidate.text.trim()
}

function explicitCorrection(text: string) {
  const match = /^(?:я\s+сказав(?:ла)?|i\s+said)\s+[«"']?(.+?)[»"']?\s*,?\s+(?:а\s+не|not)\s+[«"']?(.+?)[»"']?[.!?]?$/iu.exec(text)
  if (!match?.[1] || !match[2]) return
  return { heard: cleanPhrase(match[2]), replacement: cleanPhrase(match[1]) }
}

function cleanPhrase(value: string) {
  return value.trim().replace(/^[«"']+|[»"'.,!?]+$/g, "")
}

function punctuate(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ")
  if (!normalized || /[.!?…]$/.test(normalized)) return normalized
  return `${normalized}${questions.test(normalized) ? "?" : "."}`
}

function classifyIntent(text: string): VoiceIntent {
  if (danger.test(text) && (broadTarget.test(text) || action.test(text))) return "dangerous"
  if (code.test(text)) return "code"
  if (navigation.test(text)) return "navigation"
  if (action.test(text)) return "action"
  return "conversation"
}

function isLowConfidence(input: VoiceTranscriptInput) {
  return (
    (input.confidence !== undefined && input.confidence < 0.2) ||
    (input.averageLogProbability !== undefined && input.averageLogProbability < -1.35) ||
    (input.noSpeechProbability !== undefined && input.noSpeechProbability > 0.65) ||
    (input.languageProbability !== undefined && input.languageProbability < 0.15)
  )
}

function isAmbiguousReference(text: string, recentContext: string) {
  if (!action.test(text) || !reference.test(text)) return false
  if (text.split(/\s+/).length > 8) return false
  return recentContext.trim().length < 12
}
