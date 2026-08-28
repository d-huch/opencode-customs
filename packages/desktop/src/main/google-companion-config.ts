export type GoogleDesktopClient = {
  clientID: string
  clientSecret: string
  authURI: string
  tokenURI: string
}

export function parseGoogleDesktopClient(value: string): GoogleDesktopClient {
  const parsed = JSON.parse(value) as { installed?: Record<string, unknown> }
  const installed = parsed.installed
  if (!installed || typeof installed.client_id !== "string" || typeof installed.client_secret !== "string") throw new Error("This is not a Google Desktop OAuth client JSON file.")
  return {
    clientID: installed.client_id,
    clientSecret: installed.client_secret,
    authURI: typeof installed.auth_uri === "string" ? installed.auth_uri : "https://accounts.google.com/o/oauth2/v2/auth",
    tokenURI: typeof installed.token_uri === "string" ? installed.token_uri : "https://oauth2.googleapis.com/token",
  }
}

export function sanitizeGoogleError(value: string) {
  const text = value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/[\u0000-\u001f]+/g, " ").trim()
  return text.length <= 1_000 ? text : `${text.slice(0, 999)}…`
}
