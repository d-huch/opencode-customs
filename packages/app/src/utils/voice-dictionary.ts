export type VoiceDictionaryScope = "global" | "project" | "session"

export type VoiceDictionaryEntry = {
  id: string
  correct: string
  variants: string[]
  language: string
  scope: VoiceDictionaryScope
  scopeID?: string
  confidence: number
  confirmed: boolean
  createdAt: number
  updatedAt: number
}

export type VoiceDictionaryContext = {
  language: string
  project?: string
  sessionID?: string
}

export type VoiceDictionaryCandidate = {
  correct: string
  variants: string[]
  language: string
  scope: VoiceDictionaryScope
  scopeID?: string
  confidence: number
  confirmed?: boolean
  id?: string
  now?: number
}

export function normalizeVoiceDictionary(value: unknown): VoiceDictionaryEntry[] {
  if (typeof value === "string") return migrateLegacyDictionary(value)
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const entry = item as Partial<VoiceDictionaryEntry>
    const correct = clean(entry.correct)
    const variants = Array.isArray(entry.variants)
      ? [...new Set(entry.variants.map(clean).filter(Boolean))]
      : []
    const scope = isScope(entry.scope) ? entry.scope : "global"
    const scopeID = clean(entry.scopeID)
    if (!correct || !variants.length || (scope !== "global" && !scopeID)) return []
    const createdAt = finite(entry.createdAt, Date.now())
    return [
      {
        id: clean(entry.id) || createID(),
        correct,
        variants,
        language: normalizeLanguage(entry.language),
        scope,
        scopeID: scope === "global" ? undefined : scopeID,
        confidence: clamp(entry.confidence),
        confirmed: entry.confirmed === true,
        createdAt,
        updatedAt: finite(entry.updatedAt, createdAt),
      },
    ]
  })
}

export function upsertVoiceDictionaryEntry(entries: unknown, candidate: VoiceDictionaryCandidate) {
  const normalized = normalizeVoiceDictionary(entries)
  const correct = clean(candidate.correct)
  const variants = [...new Set(candidate.variants.map(clean).filter(Boolean))]
  const scopeID = clean(candidate.scopeID)
  if (!correct || !variants.length || (candidate.scope !== "global" && !scopeID)) return normalized
  const language = normalizeLanguage(candidate.language)
  const match = normalized.find(
    (entry) =>
      entry.correct.toLocaleLowerCase() === correct.toLocaleLowerCase() &&
      entry.language === language &&
      entry.scope === candidate.scope &&
      entry.scopeID === (candidate.scope === "global" ? undefined : scopeID),
  )
  const now = candidate.now ?? Date.now()
  if (!match) {
    return [
      ...normalized,
      {
        id: candidate.id ?? createID(),
        correct,
        variants,
        language,
        scope: candidate.scope,
        scopeID: candidate.scope === "global" ? undefined : scopeID,
        confidence: clamp(candidate.confidence),
        confirmed: candidate.confirmed === true,
        createdAt: now,
        updatedAt: now,
      },
    ].slice(-500)
  }
  return normalized.map((entry) =>
    entry.id === match.id
      ? {
          ...entry,
          variants: [...new Set([...entry.variants, ...variants])],
          confidence: Math.max(entry.confidence, clamp(candidate.confidence)),
          confirmed: entry.confirmed || candidate.confirmed === true,
          updatedAt: now,
        }
      : entry,
  )
}

export function updateVoiceDictionaryEntry(
  entries: unknown,
  id: string,
  update: Partial<Omit<VoiceDictionaryEntry, "id" | "createdAt">>,
) {
  return normalizeVoiceDictionary(entries).flatMap((entry) => {
    if (entry.id !== id) return [entry]
    return normalizeVoiceDictionary([
      {
        ...entry,
        ...update,
        id: entry.id,
        createdAt: entry.createdAt,
        updatedAt: Date.now(),
      },
    ])
  })
}

export function removeVoiceDictionaryEntry(entries: unknown, id: string) {
  return normalizeVoiceDictionary(entries).filter((entry) => entry.id !== id)
}

export function voiceDictionaryCandidateFromCorrection(
  heard: string,
  correct: string,
  metadata: Omit<VoiceDictionaryCandidate, "correct" | "variants">,
) {
  const source = heard.trim().split(/\s+/).filter(Boolean)
  const target = correct.trim().split(/\s+/).filter(Boolean)
  const prefix = source.findIndex((word, index) => comparable(word) !== comparable(target[index] ?? ""))
  if (prefix === -1 && source.length === target.length) return
  const start = prefix === -1 ? Math.min(source.length, target.length) : prefix
  const sharedSuffix = Math.min(source.length - start, target.length - start)
  const suffix = Array.from({ length: sharedSuffix }, (_, index) => index).find(
    (index) =>
      comparable(source[source.length - index - 1] ?? "") !== comparable(target[target.length - index - 1] ?? ""),
  )
  const end = suffix ?? sharedSuffix
  const variant = source.slice(start, source.length - end).join(" ")
  const intended = target.slice(start, target.length - end).join(" ")
  if (!variant || !intended || comparable(variant) === comparable(intended)) return
  return {
    ...metadata,
    correct: intended,
    variants: [variant],
  }
}

export function applyVoiceDictionary(text: string, entries: unknown, context: VoiceDictionaryContext) {
  const candidates = normalizeVoiceDictionary(entries)
    .filter((entry) => entry.confirmed && matchesContext(entry, context))
    .flatMap((entry) => entry.variants.map((variant) => ({ entry, variant })))
    .sort((a, b) => {
      const scope = scopeRank(b.entry.scope) - scopeRank(a.entry.scope)
      if (scope) return scope
      const length = b.variant.length - a.variant.length
      if (length) return length
      return b.entry.confidence - a.entry.confidence
    })
  const claimed = new Set<string>()
  return candidates.reduce(
    (result, candidate) => {
      const key = candidate.variant.toLocaleLowerCase()
      if (claimed.has(key)) return result
      claimed.add(key)
      const expression = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(candidate.variant)}(?=$|[^\\p{L}\\p{N}])`,
        "giu",
      )
      if (!expression.test(result.text)) return result
      return {
        text: result.text.replace(expression, (_, prefix: string) => `${prefix}${candidate.entry.correct}`),
        applied: [...result.applied, `${candidate.variant} → ${candidate.entry.correct}`],
      }
    },
    { text, applied: [] as string[] },
  )
}

export function voiceDictionaryScopeID(scope: VoiceDictionaryScope, context: VoiceDictionaryContext) {
  if (scope === "project") return context.project
  if (scope === "session") return context.sessionID
}

function migrateLegacyDictionary(value: string) {
  return value.split("\n").flatMap((line, index) => {
    const match = /^(.+?)\s*(?:=>|->|=)\s*(.+)$/.exec(line.trim())
    if (!match?.[1] || !match[2]) return []
    return [
      {
        id: `legacy-${index}-${hash(line)}`,
        correct: match[2].trim(),
        variants: [match[1].trim()],
        language: "auto",
        scope: "global" as const,
        confidence: 1,
        confirmed: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ]
  })
}

function matchesContext(entry: VoiceDictionaryEntry, context: VoiceDictionaryContext) {
  if (entry.language !== "auto" && normalizeLanguage(context.language) !== entry.language) return false
  if (entry.scope === "project") return entry.scopeID === context.project
  if (entry.scope === "session") return entry.scopeID === context.sessionID
  return true
}

function normalizeLanguage(value: unknown) {
  const language = typeof value === "string" ? value.trim().toLocaleLowerCase().split(/[-_]/)[0] : ""
  return language || "auto"
}

function scopeRank(scope: VoiceDictionaryScope) {
  if (scope === "session") return 3
  if (scope === "project") return 2
  return 1
}

function isScope(value: unknown): value is VoiceDictionaryScope {
  return value === "global" || value === "project" || value === "session"
}

function clamp(value: unknown) {
  return Math.min(1, Math.max(0, typeof value === "number" && Number.isFinite(value) ? value : 0.5))
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function comparable(value: string) {
  return value.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

function createID() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function hash(value: string) {
  return [...value].reduce((result, character) => ((result << 5) - result + character.charCodeAt(0)) | 0, 0).toString(36)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
