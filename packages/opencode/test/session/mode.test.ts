import { describe, expect, test } from "bun:test"
import { SessionMode } from "../../src/session/mode"

describe("SessionMode", () => {
  test("prefers an explicit mode and persists chat in metadata", () => {
    expect(SessionMode.resolve({ mode: "chat", directory: "/repo" })).toBe("chat")
    expect(SessionMode.metadata({ source: "test" }, "chat", "/repo")).toEqual({ source: "test", mode: "chat" })
    expect(SessionMode.metadata({ mode: "chat" }, "project", "/repo")).toEqual({})
  })

  test("reopens metadata and legacy projectless chats without misclassifying projects", () => {
    expect(SessionMode.resolve({ metadata: { mode: "chat" }, directory: "/repo" })).toBe("chat")
    expect(SessionMode.resolve({ directory: "/tmp/Default Project" })).toBe("chat")
    expect(SessionMode.resolve({ directory: "/tmp/OpenCode Customs Chat" })).toBe("chat")
    expect(SessionMode.resolve({ directory: "/tmp/application" })).toBe("project")
  })
})
