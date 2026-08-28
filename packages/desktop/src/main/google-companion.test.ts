import { describe, expect, test } from "bun:test"
import { parseGoogleDesktopClient, sanitizeGoogleError } from "./google-companion-config"

describe("Google Companion credentials", () => {
  test("accepts only Google Desktop OAuth configuration", () => {
    expect(parseGoogleDesktopClient(JSON.stringify({ installed: { client_id: "client", client_secret: "secret" } }))).toEqual({
      clientID: "client",
      clientSecret: "secret",
      authURI: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenURI: "https://oauth2.googleapis.com/token",
    })
    expect(() => parseGoogleDesktopClient(JSON.stringify({ web: { client_id: "client" } }))).toThrow()
  })

  test("redacts bearer credentials from surfaced errors", () => {
    expect(sanitizeGoogleError("failed with Bearer very-secret-token")).toBe("failed with Bearer [redacted]")
  })
})
