import { describe, expect, test } from "bun:test"
import {
  assessVoiceTranscript,
  voicePersonalityInstruction,
} from "./voice-understanding"
import { normalizeVoiceDictionary } from "./voice-dictionary"

const input = (text: string) => ({
  text,
  dictionary: [],
  dictionaryContext: { language: "uk", project: "/project", sessionID: "session-1" },
  contextualCorrection: true,
  confirmRiskyCommands: true,
  recentContext: "",
})

describe("voice understanding", () => {
  test("adds question punctuation without rewriting mixed language", () => {
    expect(assessVoiceTranscript(input("як запустити build у terminal")).text).toBe("як запустити build у terminal?")
  })

  test("applies personal dictionary corrections", () => {
    const result = assessVoiceTranscript({
      ...input("запусти дисплей"),
      dictionary: normalizeVoiceDictionary("дисплей => deploy"),
    })
    expect(result.text).toBe("запусти deploy.")
    expect(result.appliedCorrections).toEqual(["дисплей → deploy"])
  })

  test("learns an explicit correction without submitting it as a request", () => {
    const result = assessVoiceTranscript(input("Я сказав deploy, а не display"))
    expect(result.decision).toBe("learned")
    expect(result.learned).toEqual({ heard: "display", replacement: "deploy" })
  })

  test("holds low-confidence speech for review", () => {
    const result = assessVoiceTranscript({ ...input("запусти build"), confidence: 0.1 })
    expect(result.decision).toBe("review")
    expect(result.reason).toBe("low_confidence")
  })

  test("holds destructive commands for explicit review", () => {
    const result = assessVoiceTranscript(input("видали весь репозиторій"))
    expect(result.intent).toBe("dangerous")
    expect(result.reason).toBe("dangerous_command")
  })

  test("uses recent context to admit short referential actions", () => {
    const ambiguous = assessVoiceTranscript(input("закрий його"))
    const contextual = assessVoiceTranscript({ ...input("закрий його"), recentContext: "Ми щойно відкрили термінал." })
    expect(ambiguous.reason).toBe("ambiguous_reference")
    expect(contextual.decision).toBe("submit")
  })

  test("personality instruction preserves language and code completeness", () => {
    const instruction = voicePersonalityInstruction({ mode: "work", intent: "code", language: "uk" })
    expect(instruction).toContain("same natural language")
    expect(instruction).toContain("completeness and verification")
    expect(instruction).toContain("direct professional")
  })
})
