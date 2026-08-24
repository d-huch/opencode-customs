import { describe, expect, test } from "bun:test"
import { calculateAvatarCameraFrame, resizeAvatarRenderer } from "./desktop-avatar-camera"

const frame = (viewport: { width: number; height: number }, minX = -0.7, maxX = 0.7) =>
  calculateAvatarCameraFrame({
    viewport,
    bounds: { min: { x: minX, y: 0, z: -0.2 }, max: { x: maxX, y: 1.7, z: 0.2 } },
    hips: { x: 0, y: 0.98, z: 0 },
    head: { x: 0, y: 1.47, z: 0 },
    leftFoot: { x: 0.05, y: 0.14, z: 0 },
    rightFoot: { x: -0.05, y: 0.14, z: 0 },
    verticalFovDegrees: 28,
    bottomInset: 72,
    padding: 20,
    margin: 1.1,
  })

describe("Desktop avatar camera", () => {
  test.each([1, 2])("keeps the canvas at CSS size with device pixel ratio %p", (pixelRatio) => {
    const canvas = { style: { display: "", width: "", height: "" }, width: 0, height: 0 }
    const renderer = {
      domElement: canvas,
      ratio: 1,
      setPixelRatio(value: number) {
        this.ratio = value
      },
      setSize(width: number, height: number) {
        canvas.width = width * this.ratio
        canvas.height = height * this.ratio
      },
    }
    expect(resizeAvatarRenderer(renderer, { width: 304, height: 700, pixelRatio })).toBe(true)
    expect(canvas.style).toEqual({ display: "block", width: "100%", height: "100%" })
    expect(canvas.width).toBe(304 * pixelRatio)
    expect(canvas.height).toBe(700 * pixelRatio)
  })

  test("does not resize for a transient zero-sized layout", () => {
    let calls = 0
    const renderer = {
      domElement: { style: { display: "", width: "", height: "" } },
      setPixelRatio() {
        calls++
      },
      setSize() {
        calls++
      },
    }
    expect(resizeAvatarRenderer(renderer, { width: 0, height: 700, pixelRatio: 2 })).toBe(false)
    expect(calls).toBe(0)
  })

  test("waits for a measurable viewport", () => {
    expect(frame({ width: 0, height: 800 })).toBeUndefined()
    expect(frame({ width: 320, height: 0 })).toBeUndefined()
  })

  test("uses the humanoid body as the horizontal center", () => {
    const result = frame({ width: 320, height: 700 }, -1.8, 0.7)
    expect(result?.target.x).toBe(0)
    expect(result?.position.x).toBe(0)
  })

  test("moves farther away in a narrow panel so the full pose stays visible", () => {
    const narrow = frame({ width: 304, height: 700 })
    const wide = frame({ width: 900, height: 700 })
    expect(narrow?.distance).toBeGreaterThan(wide?.distance ?? Infinity)
  })

  test("reserves the status area below the avatar", () => {
    const result = frame({ width: 304, height: 700 })
    expect(result?.target.y).toBeLessThan(0.85)
    expect(result?.near).toBeGreaterThan(0)
    expect(result?.far).toBeGreaterThan(result?.distance ?? Infinity)
  })

  test("falls back to geometric center without humanoid anchors", () => {
    const result = calculateAvatarCameraFrame({
      viewport: { width: 304, height: 700 },
      bounds: { min: { x: -0.4, y: 0, z: -0.1 }, max: { x: 0.8, y: 1.5, z: 0.1 } },
      verticalFovDegrees: 28,
      bottomInset: 72,
      padding: 20,
      margin: 1.1,
    })
    expect(result?.target.x).toBeCloseTo(0.2)
  })
})
