export type JarvisSynthesizedAudio = { contentType: string; audio: ArrayBuffer }

type Job = { index: number; text: string; audio: Promise<JarvisSynthesizedAudio> }

export class JarvisMediaCoordinator {
  private current?: JarvisMediaTurn

  start(input: {
    turnID: string
    owner: string
    synthesize: (text: string, signal: AbortSignal) => Promise<JarvisSynthesizedAudio>
    play: (text: string, audio: JarvisSynthesizedAudio) => void | Promise<void>
    state?: (value: { state: "buffering" | "synthesizing" | "playing" | "idle" | "cancelling" | "error"; queued: number; active: number }) => void
  }) {
    if (this.current && this.current.turnID !== input.turnID) this.current.cancel("surface_handoff")
    const turn = new JarvisMediaTurn(input)
    this.current = turn
    return turn
  }

  cancel(turnID?: string, reason = "barge_in") {
    if (!this.current || (turnID && this.current.turnID !== turnID)) return false
    this.current.cancel(reason)
    this.current = undefined
    return true
  }

  snapshot() {
    return this.current?.snapshot() ?? { state: "idle" as const, queued: 0, active: 0 }
  }
}

export class JarvisMediaTurn {
  private readonly controller = new AbortController()
  private buffer = ""
  private pending: string[] = []
  private jobs = new Map<number, Job>()
  private nextJob = 0
  private nextPlayback = 0
  private pump?: Promise<void>
  private finished = false
  private failed?: Error

  constructor(
    private readonly input: {
      turnID: string
      owner: string
      synthesize: (text: string, signal: AbortSignal) => Promise<JarvisSynthesizedAudio>
      play: (text: string, audio: JarvisSynthesizedAudio) => void | Promise<void>
      state?: (value: { state: "buffering" | "synthesizing" | "playing" | "idle" | "cancelling" | "error"; queued: number; active: number }) => void
    },
  ) {}

  get turnID() {
    return this.input.turnID
  }

  append(delta: string) {
    if (this.finished || this.controller.signal.aborted || !delta) return
    this.buffer += delta
    const complete = this.buffer.match(/^[\s\S]*?[.!?…](?:["'»”)]*)?(?=\s|$)/u)
    while (complete?.[0]) {
      const sentence = complete[0].trim()
      this.buffer = this.buffer.slice(complete[0].length).trimStart()
      if (sentence) this.pending.push(sentence)
      const next = this.buffer.match(/^[\s\S]*?[.!?…](?:["'»”)]*)?(?=\s|$)/u)
      if (!next?.[0]) break
      complete[0] = next[0]
    }
    this.launch()
  }

  async finish() {
    if (this.finished) return this.pump
    this.finished = true
    if (this.buffer.trim()) this.pending.push(this.buffer.trim())
    this.buffer = ""
    this.launch()
    await this.pump
    if (this.failed) throw this.failed
    if (!this.controller.signal.aborted) this.input.state?.({ state: "idle", queued: 0, active: 0 })
  }

  cancel(_reason: string) {
    if (this.controller.signal.aborted) return
    this.input.state?.({ state: "cancelling", queued: this.pending.length, active: this.jobs.size })
    this.controller.abort()
    this.pending = []
    this.jobs.clear()
    this.buffer = ""
    this.input.state?.({ state: "idle", queued: 0, active: 0 })
  }

  snapshot() {
    return {
      state: this.controller.signal.aborted ? ("idle" as const) : this.jobs.size > 0 ? ("synthesizing" as const) : ("buffering" as const),
      queued: this.pending.length,
      active: this.jobs.size,
    }
  }

  private launch() {
    if (this.controller.signal.aborted || this.failed) return
    while (this.jobs.size < 2 && this.pending.length > 0) {
      const text = this.pending.shift()!
      const index = this.nextJob++
      this.jobs.set(index, { index, text, audio: this.input.synthesize(text, this.controller.signal) })
    }
    this.input.state?.({
      state: this.jobs.size > 0 ? "synthesizing" : "buffering",
      queued: this.pending.length,
      active: this.jobs.size,
    })
    if (!this.pump) this.pump = this.drain().finally(() => (this.pump = undefined))
  }

  private async drain() {
    while (!this.controller.signal.aborted) {
      const job = this.jobs.get(this.nextPlayback)
      if (!job) {
        if (this.finished && this.pending.length === 0 && this.jobs.size === 0) return
        return
      }
      try {
        const audio = await job.audio
        if (this.controller.signal.aborted) return
        this.input.state?.({ state: "playing", queued: this.pending.length, active: this.jobs.size })
        await this.input.play(job.text, audio)
        this.jobs.delete(job.index)
        this.nextPlayback++
        this.launch()
      } catch (error) {
        if (this.controller.signal.aborted) return
        this.failed = error instanceof Error ? error : new Error(String(error))
        this.input.state?.({ state: "error", queued: this.pending.length, active: this.jobs.size })
        this.controller.abort()
        return
      }
    }
  }
}
