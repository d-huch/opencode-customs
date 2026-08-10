import { describe, expect, test } from "bun:test"
import { isDefaultProjectDirectory } from "./project"

describe("project utilities", () => {
  test("recognizes the desktop onboarding project on macOS and Windows", () => {
    expect(isDefaultProjectDirectory("/Users/user/Documents/Default Project")).toBe(true)
    expect(isDefaultProjectDirectory("C:\\Users\\user\\Documents\\Default Project\\")).toBe(true)
    expect(isDefaultProjectDirectory("/Users/user/Documents/project")).toBe(false)
  })
})
