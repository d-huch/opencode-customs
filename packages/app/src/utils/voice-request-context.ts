type VoiceRequestContext = {
  text: string
  instruction: string
  createdAt: number
}

const pending: VoiceRequestContext[] = []
const lifetime = 120_000

export function stageVoiceRequestContext(text: string, instruction: string, now = Date.now()) {
  const normalized = text.trim()
  if (!normalized || !instruction.trim()) return
  pending.splice(
    0,
    pending.length,
    ...pending.filter((item) => now - item.createdAt < lifetime && item.text !== normalized).slice(-19),
    { text: normalized, instruction: instruction.trim(), createdAt: now },
  )
}

export function takeVoiceRequestContext(text: string, now = Date.now()) {
  const normalized = text.trim()
  const index = pending.findLastIndex((item) => now - item.createdAt < lifetime && item.text === normalized)
  if (index === -1) {
    pending.splice(0, pending.length, ...pending.filter((item) => now - item.createdAt < lifetime))
    return
  }
  const [item] = pending.splice(index, 1)
  return item?.instruction
}

export function clearVoiceRequestContext() {
  pending.length = 0
}
