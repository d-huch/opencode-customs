import { describe, expect, test } from "bun:test"
import { JarvisMediaCoordinator } from "./jarvis-media-coordinator"

describe("JarvisMediaCoordinator", () => {
  test("synthesizes completed sentences early and plays them in order", async () => {
    const synthesized: string[] = []
    const played: string[] = []
    const media = new JarvisMediaCoordinator().start({
      turnID: "turn-1",
      owner: "unity-editor",
      synthesize: async (text) => {
        synthesized.push(text)
        return { contentType: "audio/wav", audio: new ArrayBuffer(1) }
      },
      play: (text) => played.push(text),
    })
    media.append("Перше речення. Друге")
    await Promise.resolve()
    expect(synthesized).toEqual(["Перше речення."])
    media.append(" речення!")
    await media.finish()
    expect(played).toEqual(["Перше речення.", "Друге речення!"])
  })

  test("cancellation prevents queued playback", async () => {
    const played: string[] = []
    const media = new JarvisMediaCoordinator().start({
      turnID: "turn-2",
      owner: "quest",
      synthesize: async (_text, signal) => {
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
          setTimeout(resolve, 20)
        })
        return { contentType: "audio/wav", audio: new ArrayBuffer(1) }
      },
      play: (text) => played.push(text),
    })
    media.append("Не програвати.")
    media.cancel("barge_in")
    await media.finish()
    expect(played).toEqual([])
  })

  test("bounds synthesis concurrency to two jobs", async () => {
    let active = 0
    let maximum = 0
    const media = new JarvisMediaCoordinator().start({
      turnID: "turn-3",
      owner: "pcvr",
      synthesize: async () => {
        active++
        maximum = Math.max(maximum, active)
        await Bun.sleep(5)
        active--
        return { contentType: "audio/wav", audio: new ArrayBuffer(1) }
      },
      play: () => undefined,
    })
    media.append("One. Two. Three. Four.")
    await media.finish()
    expect(maximum).toBe(2)
  })

  test("stops the voice queue on a synthesis error without playing a fallback", async () => {
    const states: string[] = []
    const played: string[] = []
    const media = new JarvisMediaCoordinator().start({
      turnID: "turn-4",
      owner: "desktop",
      synthesize: async () => {
        throw new Error("Fish unavailable")
      },
      play: (text) => played.push(text),
      state: (value) => states.push(value.state),
    })
    media.append("No fallback.")
    await expect(media.finish()).rejects.toThrow("Fish unavailable")
    await media.finish().catch(() => undefined)
    expect(played).toEqual([])
    expect(states).toContain("error")
  })
})
