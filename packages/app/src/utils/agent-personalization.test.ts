import { describe, expect, test } from "bun:test"
import {
  agentCatchphrases,
  agentPersonalizationInstruction,
  type AgentPersonalizationProfile,
} from "./agent-personalization"

const profile: AgentPersonalizationProfile = {
  enabled: true,
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
})
