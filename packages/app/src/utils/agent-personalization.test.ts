import { describe, expect, test } from "bun:test"
import {
  agentCatchphrases,
  agentPersonalizationInstruction,
  detachFishVoicePreset,
  migrateAgentPersonalization,
  resolveAgentPersonality,
  type AgentPersonalizationProfile,
  type AgentPersonalizationValues,
} from "./agent-personalization"

const profile: AgentPersonalizationProfile = {
  enabled: true,
  archetype: "natural",
  assistantName: "OpenCode Customs",
  userName: "Денис",
  addressAs: "Денис",
  language: "auto",
  tone: "natural",
  detail: "balanced",
  proactivity: "balanced",
  humor: "subtle",
  catchphrases: "До роботи, Буде зроблено",
  customInstructions: "Lead with the result.",
}
const profileValues: AgentPersonalizationValues = {
  archetype: "natural",
  assistantName: profile.assistantName,
  userName: profile.userName,
  addressAs: profile.addressAs,
  language: profile.language,
  tone: profile.tone,
  detail: profile.detail,
  proactivity: profile.proactivity,
  humor: profile.humor,
  catchphrases: profile.catchphrases,
  customInstructions: profile.customInstructions,
}

describe("agentPersonalizationInstruction", () => {
  test("returns nothing when personalization is disabled", () => {
    expect(agentPersonalizationInstruction({ ...profile, enabled: false })).toBeUndefined()
  })

  test("builds a guarded profile with automatic language matching", () => {
    const instruction = agentPersonalizationInstruction(profile)

    expect(instruction).toContain("User name: Денис.")
    expect(instruction).toContain("Address the user as: Денис.")
    expect(instruction).toContain("same natural language and script")
    expect(instruction).toContain("Tone: natural.")
    expect(instruction).toContain("Optional user-provided catchphrases:")
    expect(instruction).toContain("- До роботи")
    expect(instruction).toContain("Use at most one catchphrase in a response")
    expect(instruction).toContain("Lead with the result.")
    expect(instruction).toContain("does not override system or developer instructions")
  })

  test("normalizes profile labels and limits custom instructions", () => {
    const instruction = agentPersonalizationInstruction({
      ...profile,
      assistantName: "  OpenCode\n  Customs  ",
      language: "Українська",
      catchphrases: "",
      customInstructions: "x".repeat(5_000),
    })

    expect(instruction).toContain("Preferred assistant name: OpenCode Customs.")
    expect(instruction).toContain("Preferred response language: Українська.")
    expect(instruction?.length).toBeLessThan(5_000)
  })

  test("normalizes, deduplicates, and limits catchphrases", () => {
    expect(agentCatchphrases(" До роботи, буде зроблено\nДО РОБОТИ, , Усе під контролем ")).toEqual([
      "До роботи",
      "буде зроблено",
      "Усе під контролем",
    ])
    expect(agentCatchphrases(Array.from({ length: 25 }, (_, index) => `phrase ${index}`).join(","))).toHaveLength(20)
  })

  test.each([
    ["natural", "naturally and neutrally"],
    ["military", "disciplined, structured, direct"],
    ["depressive", "Never encourage hopelessness, self-harm, or giving up"],
    ["clown", "Suppress jokes in dangerous, sensitive, high-stakes"],
    ["jarvis", "calm, precise, composed"],
    ["mentor", "patient, educational, encouraging"],
    ["sarcastic", "without insulting, belittling, or antagonizing"],
  ] as const)("renders the %s archetype guardrails", (archetype, expected) => {
    const instruction = agentPersonalizationInstruction({ ...profile, archetype })

    expect(instruction).toContain(`Personality archetype: ${archetype}.`)
    expect(instruction).toContain(expected)
    expect(instruction).toContain("take priority in their respective dimensions")
  })
})

describe("migrateAgentPersonalization", () => {
  test("creates one silent starter preset and keeps a disabled legacy profile without a default", () => {
    const result = migrateAgentPersonalization({
      enabled: false,
      values: profileValues,
      createID: () => "starter",
      now: 123,
    })

    expect(result.version).toBe(2)
    expect(result.defaultPresetID).toBe("")
    expect(result.presets).toHaveLength(1)
    expect(result.presets[0]).toMatchObject({ id: "starter", name: "OpenCode Customs", voice: null })
  })

  test("keeps existing presets, migrates missing voices to silent, and preserves the active default", () => {
    const preset = {
      id: "work",
      name: "Work",
      ...profileValues,
      createdAt: 1,
      updatedAt: 2,
    }
    const result = migrateAgentPersonalization({
      enabled: true,
      activePresetID: "work",
      presets: [preset],
      values: profileValues,
      createID: () => "unused",
      now: 123,
    })

    expect(result.defaultPresetID).toBe("work")
    expect(result.presets[0]?.voice).toBeNull()
  })

  test("adds the natural archetype to v1 presets without changing their selection", () => {
    const result = migrateAgentPersonalization({
      enabled: true,
      activePresetID: "legacy",
      presets: [
        {
          id: "legacy",
          name: "Legacy",
          assistantName: profileValues.assistantName,
          userName: profileValues.userName,
          addressAs: profileValues.addressAs,
          language: profileValues.language,
          tone: profileValues.tone,
          detail: profileValues.detail,
          proactivity: profileValues.proactivity,
          humor: profileValues.humor,
          catchphrases: profileValues.catchphrases,
          customInstructions: profileValues.customInstructions,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      values: profileValues,
      createID: () => "unused",
      now: 123,
    })

    expect(result.version).toBe(2)
    expect(result.defaultPresetID).toBe("legacy")
    expect(result.presets[0]?.archetype).toBe("natural")
  })

  test("preserves a complete voice snapshot during migration", () => {
    const voice = {
      provider: "fish-local" as const,
      voicePresetID: "fish-1",
      endpoint: "http://127.0.0.1:8080",
      latency: "balanced" as const,
      language: "uk" as const,
      playbackRate: 1.1,
      volume: 0.8,
      temperature: 0.7,
      topP: 0.9,
      repetitionPenalty: 1.2,
      seed: 42,
      chunkLength: 200,
      normalize: true,
      streaming: true,
      useMemoryCache: false,
      maxNewTokens: 1_024,
    }
    const result = migrateAgentPersonalization({
      enabled: true,
      activePresetID: "voiced",
      presets: [
        {
          id: "voiced",
          name: "Voiced",
          ...profileValues,
          voice,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      values: profileValues,
      createID: () => "unused",
      now: 123,
    })

    expect(result.presets[0]?.voice).toEqual(voice)
  })
})

describe("resolveAgentPersonality", () => {
  const presets = [
    {
      id: "default",
      name: "Default",
      ...profileValues,
      voice: null,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "chat",
      name: "Chat",
      ...profileValues,
      voice: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  test("uses the default only when the chat has no explicit selection", () => {
    expect(resolveAgentPersonality(presets, undefined, "default")?.id).toBe("default")
    expect(resolveAgentPersonality(presets, "chat", "default")?.id).toBe("chat")
    expect(resolveAgentPersonality(presets, null, "default")).toBeUndefined()
  })

  test("does not fall back when a selected preset was deleted", () => {
    expect(resolveAgentPersonality(presets, "missing", "default")).toBeUndefined()
  })
})

test("deleting a Fish voice makes every linked personality silent", () => {
  const presets = [
    {
      id: "fish-personality",
      name: "Fish",
      ...profileValues,
      voice: {
        provider: "fish-local" as const,
        voicePresetID: "fish-1",
        endpoint: "http://127.0.0.1:8080",
        latency: "balanced" as const,
        language: "auto" as const,
        playbackRate: 1,
        volume: 1,
        temperature: 0.8,
        topP: 0.8,
        repetitionPenalty: 1.1,
        seed: null,
        chunkLength: 300,
        normalize: true,
        streaming: false,
        useMemoryCache: true,
        maxNewTokens: 1_024,
      },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "silent-personality",
      name: "Silent",
      ...profileValues,
      voice: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  const result = detachFishVoicePreset(presets, "fish-1", 99)

  expect(result[0]).toMatchObject({ voice: null, updatedAt: 99 })
  expect(result[1]).toBe(presets[1])
})
