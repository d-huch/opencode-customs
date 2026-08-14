import { describe, expect, test } from "bun:test"
import {
  applyVoiceDictionary,
  normalizeVoiceDictionary,
  updateVoiceDictionaryEntry,
  upsertVoiceDictionaryEntry,
  voiceDictionaryCandidateFromCorrection,
} from "./voice-dictionary"

const context = { language: "uk-UA", project: "/project-a", sessionID: "session-a" }

describe("voice dictionary", () => {
  test("migrates legacy replacements as confirmed global entries", () => {
    const entries = normalizeVoiceDictionary("display => deploy")
    expect(entries).toMatchObject([
      { correct: "deploy", variants: ["display"], language: "auto", scope: "global", confidence: 1, confirmed: true },
    ])
  })

  test("does not apply an unconfirmed candidate", () => {
    const entries = upsertVoiceDictionaryEntry([], {
      id: "candidate",
      now: 1,
      correct: "deploy",
      variants: ["display"],
      language: "en",
      scope: "global",
      confidence: 0.95,
    })
    expect(applyVoiceDictionary("run display", entries, { ...context, language: "en" }).text).toBe("run display")
    const confirmed = updateVoiceDictionaryEntry(entries, "candidate", { confirmed: true })
    expect(applyVoiceDictionary("run display", confirmed, { ...context, language: "en" }).text).toBe("run deploy")
  })

  test("supports multiple pronunciation variants and language", () => {
    const entries = upsertVoiceDictionaryEntry([], {
      correct: "OpenCode Customs",
      variants: ["опен код", "оупен код"],
      language: "uk",
      scope: "global",
      confidence: 0.9,
      confirmed: true,
    })
    expect(applyVoiceDictionary("відкрий оупен код", entries, context).text).toBe("відкрий OpenCode Customs")
    expect(applyVoiceDictionary("open code", entries, { ...context, language: "en" }).text).toBe("open code")
  })

  test("keeps project and session entries inside their scope", () => {
    const project = upsertVoiceDictionaryEntry([], {
      correct: "Alpha",
      variants: ["alfa"],
      language: "auto",
      scope: "project",
      scopeID: "/project-a",
      confidence: 0.7,
      confirmed: true,
    })
    const entries = upsertVoiceDictionaryEntry(project, {
      correct: "Beta",
      variants: ["beta"],
      language: "auto",
      scope: "session",
      scopeID: "session-a",
      confidence: 0.8,
      confirmed: true,
    })
    expect(applyVoiceDictionary("alfa beta", entries, context).text).toBe("Alpha Beta")
    expect(applyVoiceDictionary("alfa beta", entries, { ...context, project: "/project-b", sessionID: "session-b" }).text).toBe(
      "alfa beta",
    )
  })

  test("prefers the most specific confirmed meaning for a conflicting pronunciation", () => {
    const global = upsertVoiceDictionaryEntry([], {
      correct: "global",
      variants: ["term"],
      language: "auto",
      scope: "global",
      confidence: 1,
      confirmed: true,
    })
    const entries = upsertVoiceDictionaryEntry(global, {
      correct: "session",
      variants: ["term"],
      language: "auto",
      scope: "session",
      scopeID: "session-a",
      confidence: 0.6,
      confirmed: true,
    })
    expect(applyVoiceDictionary("term", entries, context).text).toBe("session")
  })

  test("extracts only the changed phrase from a corrected transcript", () => {
    expect(
      voiceDictionaryCandidateFromCorrection("відкрий дісплей режим", "відкрий deploy режим", {
        language: "uk",
        scope: "session",
        scopeID: "session-a",
        confidence: 1,
        confirmed: true,
      }),
    ).toMatchObject({ correct: "deploy", variants: ["дісплей"], confirmed: true })
  })
})
