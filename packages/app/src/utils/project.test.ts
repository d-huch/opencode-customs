import { describe, expect, test } from "bun:test"
import { isChatWorkspaceDirectory, isDefaultProjectDirectory, isNonRepositoryDirectory } from "./project"

describe("project utilities", () => {
  test("recognizes the desktop onboarding project on macOS and Windows", () => {
    expect(isDefaultProjectDirectory("/Users/user/Documents/Default Project")).toBe(true)
    expect(isDefaultProjectDirectory("C:\\Users\\user\\Documents\\Default Project\\")).toBe(true)
    expect(isDefaultProjectDirectory("/Users/user/Documents/project")).toBe(false)
  })

  test("recognizes the dedicated chat workspace without treating other projects as chat", () => {
    expect(isChatWorkspaceDirectory("/Users/user/Documents/OpenCode Customs Chat")).toBe(true)
    expect(isChatWorkspaceDirectory("C:\\Users\\user\\Documents\\OpenCode Customs Chat\\")).toBe(true)
    expect(isChatWorkspaceDirectory("/Users/user/Documents/project")).toBe(false)
    expect(isNonRepositoryDirectory("/Users/user/Documents/OpenCode Customs Chat")).toBe(true)
    expect(isNonRepositoryDirectory("/Users/user/Documents/Default Project")).toBe(true)
  })
})
