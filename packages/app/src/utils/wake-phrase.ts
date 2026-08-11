export function configuredWakePhrases(value: string) {
  return [...new Set(value.split(/[\n,;]/).map(normalize).filter(Boolean))].slice(0, 8)
}

export function extractWakeCommand(text: string, configured: string) {
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)]
  if (!words.length) return { matched: false, command: text.trim() }

  for (const phrase of configuredWakePhrases(configured)) {
    const parts = phrase.split(" ")
    const limit = Math.min(3, words.length - parts.length + 1)
    for (let index = 0; index < limit; index += 1) {
      if (parts.some((part, offset) => normalize(words[index + offset]?.[0] ?? "") !== part)) continue
      const last = words[index + parts.length - 1]
      if (last?.index === undefined) continue
      return {
        matched: true,
        command: text
          .slice(last.index + last[0].length)
          .replace(/^[\s,.:;!?—–-]+/u, "")
          .trim(),
      }
    }
  }
  return { matched: false, command: text.trim() }
}

export function routeWakeTranscript(text: string, configured: string, active: boolean) {
  if (active) return { action: "submit" as const, text: text.trim(), activated: false }
  const wake = extractWakeCommand(text, configured)
  if (!wake.matched) return { action: "ignore" as const, text: "" }
  if (!wake.command) return { action: "activate" as const, text: "" }
  return { action: "submit" as const, text: wake.command, activated: true }
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
}
