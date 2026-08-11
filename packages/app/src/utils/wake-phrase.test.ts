import { describe, expect, test } from "bun:test"
import { configuredWakePhrases, extractWakeCommand, routeWakeTranscript } from "./wake-phrase"

describe("wake phrase", () => {
  test("parses bounded unique phrases without depending on a language", () => {
    expect(configuredWakePhrases(" Джарвіс, jarvis; ДЖАРВІС\nOpen Code ")).toEqual([
      "джарвіс",
      "jarvis",
      "open code",
    ])
  })

  test("extracts a command after a wake phrase near the start", () => {
    expect(extractWakeCommand("Гей, Джарвіс, покажи останні логи", "джарвіс, jarvis")).toEqual({
      matched: true,
      command: "покажи останні логи",
    })
    expect(extractWakeCommand("Jarvis! Open the project", "джарвіс, jarvis")).toEqual({
      matched: true,
      command: "Open the project",
    })
  })

  test("does not activate when the phrase is only discussed later", () => {
    expect(extractWakeCommand("Розкажи мені про Джарвіса", "джарвіс, jarvis")).toEqual({
      matched: false,
      command: "Розкажи мені про Джарвіса",
    })
    expect(extractWakeCommand("Джарвіс", "джарвіс, jarvis")).toEqual({ matched: true, command: "" })
  })

  test("keeps background speech out of the agent pipeline while armed", () => {
    expect(routeWakeTranscript("просто фонова розмова", "джарвіс, jarvis", false)).toEqual({
      action: "ignore",
      text: "",
    })
    expect(routeWakeTranscript("Джарвіс", "джарвіс, jarvis", false)).toEqual({ action: "activate", text: "" })
    expect(routeWakeTranscript("Джарвіс, покажи логи", "джарвіс, jarvis", false)).toEqual({
      action: "submit",
      text: "покажи логи",
      activated: true,
    })
    expect(routeWakeTranscript("наступне уточнення", "джарвіс, jarvis", true)).toEqual({
      action: "submit",
      text: "наступне уточнення",
      activated: false,
    })
  })
})
