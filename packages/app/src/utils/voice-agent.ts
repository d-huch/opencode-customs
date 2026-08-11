export function voiceLanguage(documentLanguage: string, navigatorLanguage: string) {
  const value = documentLanguage.trim() || navigatorLanguage.trim()
  if (!value) return "en-US"
  if (!/^[a-z]{2}$/i.test(value)) return value
  const locale = new Intl.Locale(value).maximize()
  return locale.region ? `${locale.language}-${locale.region}` : value
}

export function speechText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[>*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function streamingSpeechChunks(value: string, final: boolean) {
  const chunks = [...value.matchAll(/.*?[.!?…]+(?:["'»”\])]*)?(?:\s+|$)/gs)].map((match) => match[0].trim())
  const consumed = chunks.reduce((length, chunk) => {
    const index = value.indexOf(chunk, length)
    return index === -1 ? length : index + chunk.length
  }, 0)
  const remainder = value.slice(consumed).trim()
  if (!final && remainder.length >= 80) {
    const preferred = [...remainder.matchAll(/[,;:]\s+/g)]
      .map((match) => (match.index ?? 0) + match[0].length)
      .findLast((index) => index >= 40 && index <= 140)
    const bounded = remainder.slice(0, 140).lastIndexOf(" ")
    const boundary = preferred ?? (bounded >= 80 ? bounded : undefined)
    if (boundary) {
      return {
        chunks: [...chunks, remainder.slice(0, boundary).trim()],
        remainder: remainder.slice(boundary).trim(),
      }
    }
  }
  if (!final || !remainder) return { chunks, remainder }
  return { chunks: [...chunks, remainder], remainder: "" }
}

export function isLikelySpeechEcho(transcript: string, spoken: string) {
  const words = (value: string) =>
    value
      .toLocaleLowerCase()
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1)
  const heard = words(transcript)
  const output = words(spoken)
  if (!heard.length || !output.length) return false
  const overlap = heard.filter((word) => output.some((candidate) => sameSpeechWord(word, candidate))).length / heard.length
  return overlap >= 0.6 || hasSpeechWordRun(heard, output, 4)
}

function hasSpeechWordRun(left: string[], right: string[], minimum: number) {
  if (left.length < minimum || right.length < minimum) return false
  return left.slice(0, left.length - minimum + 1).some((_, leftStart) =>
    right.slice(0, right.length - minimum + 1).some((_, rightStart) =>
      left
        .slice(leftStart, leftStart + minimum)
        .every((word, index) => sameSpeechWord(word, right[rightStart + index])),
    ),
  )
}

function sameSpeechWord(left: string, right: string) {
  if (left === right) return true
  if (Math.min(left.length, right.length) < 4) return false
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const distance = [...left].reduce((row, character, leftIndex) => {
    const next = [leftIndex + 1]
    for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
      next.push(
        Math.min(
          next[rightIndex] + 1,
          row[rightIndex + 1] + 1,
          row[rightIndex] + (character === right[rightIndex] ? 0 : 1),
        ),
      )
    }
    return next
  }, previous)
  return distance[right.length] <= Math.max(1, Math.floor(Math.max(left.length, right.length) * 0.2))
}

export function isDeliberateSpeechInterruption(value: string) {
  const text = value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ")
  if (["стоп", "зупинись", "досить", "stop", "jarvis", "джарвіс"].includes(text)) return true
  return text.length >= 6 && text.split(" ").filter(Boolean).length >= 2
}

export function sameSpeechCandidate(left: string, right: string) {
  const words = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
  const expected = words(left)
  const actual = new Set(words(right))
  if (!expected.length || !actual.size) return false
  return expected.filter((word) => actual.has(word)).length / expected.length >= 0.6
}

export function bargeInLevelThreshold(noiseFloor: number) {
  return Math.max(0.014, Math.max(0, noiseFloor) * 2.8)
}
