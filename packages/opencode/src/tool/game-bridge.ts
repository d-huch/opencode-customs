import { Effect } from "effect"

export function gameBridgeRequest(path: string, init: RequestInit, signal: AbortSignal) {
  return Effect.gen(function* () {
    const endpoint = bridgeEndpoint()
    if (!endpoint) throw new Error("No local Unity/VR Avatar Bridge v2 is available")
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(new URL(path, endpoint.url), {
          ...init,
          headers: {
            authorization: `Bearer ${endpoint.token}`,
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...init.headers,
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(70_000)]),
        }),
      catch: (error) =>
        new Error(`Avatar Bridge request failed: ${error instanceof Error ? error.message : String(error)}`),
    })
    const result = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => new Error("Avatar Bridge returned an invalid response"),
    })
    if (response.ok || path === "/action") return result
    const message = isRecord(result)
      ? typeof result.message === "string"
        ? result.message
        : typeof result.error === "string"
          ? result.error
          : undefined
      : undefined
    throw new Error(message ?? `Avatar Bridge returned HTTP ${response.status}`)
  })
}

function bridgeEndpoint() {
  const value = process.env.OPENCODE_AVATAR_BRIDGE_URL
  const token = process.env.OPENCODE_AVATAR_BRIDGE_TOKEN
  if (!value || !token) return
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return
  return { url, token }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
