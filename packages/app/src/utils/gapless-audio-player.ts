type GaplessAudioPlayerOptions = {
  context?: AudioContext
  onStart?: () => void
  onBuffer?: (bufferedMs: number) => void
  onUnderrun?: (count: number) => void
  onReferenceNode?: (node: AudioNode | undefined) => void
}

export function adaptivePrebufferFrames(sampleRate: number, underruns: number) {
  return Math.round(sampleRate * Math.min(0.32, 0.12 + underruns * 0.04))
}

export function resamplePlaybackPCM(input: Int16Array, sourceRate: number, targetRate: number) {
  if (sourceRate <= 0 || targetRate <= 0) throw new Error("Audio sample rates must be positive.")
  const length = Math.max(1, Math.round((input.length * targetRate) / sourceRate))
  const output = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = (index * (input.length - 1)) / Math.max(1, length - 1)
    const left = Math.floor(position)
    const right = Math.min(input.length - 1, left + 1)
    const sample = input[left]! + (input[right]! - input[left]!) * (position - left)
    output[index] = sample / 32768
  }
  return output
}

const processorSource = `
class OpenCodePCMStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []
    this.offset = 0
    this.bufferedFrames = 0
    this.finished = false
    this.active = false
    this.started = false
    this.drained = false
    this.drainPending = false
    this.underruns = 0
    this.tick = 0
    this.port.onmessage = (event) => {
      if (event.data.type === "chunk") {
        this.queue.push(event.data.samples)
        this.bufferedFrames += event.data.samples.length
        this.reportBuffer()
        return
      }
      if (event.data.type === "finish") {
        this.finished = true
        return
      }
      if (event.data.type !== "reset") return
      this.queue = []
      this.offset = 0
      this.bufferedFrames = 0
      this.finished = true
      this.active = false
      this.reportBuffer()
    }
  }

  reportBuffer() {
    this.port.postMessage({ type: "buffer", frames: this.bufferedFrames })
  }

  process(_inputs, outputs) {
    const output = outputs[0][0]
    if (!output) return true
    output.fill(0)
    if (this.drainPending && !this.drained) {
      this.drained = true
      this.port.postMessage({ type: "drained" })
      return true
    }
    const prebuffer = Math.round(sampleRate * Math.min(0.32, 0.12 + this.underruns * 0.04))
    if (!this.active && (this.bufferedFrames >= prebuffer || (this.finished && this.bufferedFrames > 0))) {
      this.active = true
    }
    if (!this.active) {
      if (this.finished && this.bufferedFrames === 0 && !this.drained) {
        this.drained = true
        this.port.postMessage({ type: "drained" })
      }
      return true
    }

    let written = 0
    while (written < output.length && this.queue.length > 0) {
      const chunk = this.queue[0]
      const available = chunk.length - this.offset
      const count = Math.min(output.length - written, available)
      output.set(chunk.subarray(this.offset, this.offset + count), written)
      written += count
      this.offset += count
      this.bufferedFrames -= count
      if (this.offset !== chunk.length) continue
      this.queue.shift()
      this.offset = 0
    }

    if (written > 0 && !this.started) {
      this.started = true
      this.port.postMessage({ type: "started" })
    }
    if (written < output.length && !this.finished) {
      this.active = false
      this.underruns += 1
      this.port.postMessage({ type: "underrun", count: this.underruns })
    }
    if (this.finished && this.bufferedFrames === 0) {
      this.active = false
      this.drainPending = true
    }
    this.tick += 1
    if (this.tick % 64 === 0) this.reportBuffer()
    return true
  }
}
registerProcessor("opencode-pcm-stream", OpenCodePCMStreamProcessor)
`

export function createGaplessAudioPlayer(options: GaplessAudioPlayerOptions = {}) {
  const context = options.context ?? new AudioContext({ latencyHint: "interactive" })
  const ownsContext = !options.context
  let node: AudioWorkletNode | undefined
  let cancelled = false
  let finishing = false
  let readyError: unknown
  let resolveDrain: (() => void) | undefined
  let pending = Promise.resolve()
  const drained = new Promise<void>((resolve) => {
    resolveDrain = resolve
  })
  const ready = (async () => {
    const url = URL.createObjectURL(new Blob([processorSource], { type: "text/javascript" }))
    await context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
    if (cancelled) return
    node = new AudioWorkletNode(context, "opencode-pcm-stream", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    node.port.onmessage = (event: MessageEvent<{ type: string; frames?: number; count?: number }>) => {
      if (event.data.type === "started") options.onStart?.()
      if (event.data.type === "buffer") options.onBuffer?.(Math.round(((event.data.frames ?? 0) / context.sampleRate) * 1000))
      if (event.data.type === "underrun") options.onUnderrun?.(event.data.count ?? 0)
      if (event.data.type !== "drained") return
      resolveDrain?.()
    }
    node.connect(context.destination)
    options.onReferenceNode?.(node)
    await context.resume()
  })().catch((error: unknown) => {
    readyError = error
  })

  const requireReady = async () => {
    await ready
    if (readyError) throw readyError
  }

  const close = async () => {
    options.onReferenceNode?.(undefined)
    if (!ownsContext || context.state === "closed") return
    await context.close()
  }

  return {
    enqueue(audio: Int16Array, sampleRate: number) {
      pending = pending.then(async () => {
        await requireReady()
        if (cancelled || !node) return
        const samples = resamplePlaybackPCM(audio, sampleRate, context.sampleRate)
        node.port.postMessage({ type: "chunk", samples }, [samples.buffer])
      })
      return pending
    },
    async finish() {
      if (finishing) return drained
      finishing = true
      await pending
      await requireReady()
      if (cancelled || !node) return
      node.port.postMessage({ type: "finish" })
      await drained
      node.disconnect()
      await close()
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      node?.port.postMessage({ type: "reset" })
      node?.disconnect()
      resolveDrain?.()
      void close()
    },
  }
}
