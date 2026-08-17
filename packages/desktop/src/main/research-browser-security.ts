export function safeResearchProtocol(value: string) {
  if (!URL.canParse(value)) return false
  const protocol = new URL(value).protocol
  return protocol === "http:" || protocol === "https:"
}

export function blockedResearchHostname(value: string) {
  const host = value.toLocaleLowerCase().replace(/^\[|\]$/g, "")
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
}

export function privateResearchAddress(value: string): boolean {
  const normalized = value.toLocaleLowerCase()
  if (normalized.startsWith("::ffff:")) return privateResearchAddress(normalized.slice("::ffff:".length))
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  )
    return true
  const parts = normalized.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  )
}
