export type AvatarCameraPoint = { x: number; y: number; z: number }

export type AvatarCameraBounds = {
  min: AvatarCameraPoint
  max: AvatarCameraPoint
}

export function resizeAvatarRenderer(
  renderer: {
    domElement: { style: { display: string; width: string; height: string } }
    setPixelRatio(value: number): void
    setSize(width: number, height: number, updateStyle?: boolean): void
  },
  input: { width: number; height: number; pixelRatio: number },
) {
  if (input.width < 2 || input.height < 2) return false
  renderer.setPixelRatio(Math.min(2, Math.max(1, input.pixelRatio)))
  renderer.setSize(input.width, input.height, true)
  renderer.domElement.style.display = "block"
  renderer.domElement.style.width = "100%"
  renderer.domElement.style.height = "100%"
  return true
}

export function calculateAvatarCameraFrame(input: {
  viewport: { width: number; height: number }
  bounds: AvatarCameraBounds
  hips?: AvatarCameraPoint
  head?: AvatarCameraPoint
  leftFoot?: AvatarCameraPoint
  rightFoot?: AvatarCameraPoint
  verticalFovDegrees: number
  bottomInset: number
  padding: number
  margin: number
}) {
  if (input.viewport.width < 2 || input.viewport.height < 2) return
  if (
    [input.bounds.min.x, input.bounds.min.y, input.bounds.min.z, input.bounds.max.x, input.bounds.max.y, input.bounds.max.z].some(
      (value) => !Number.isFinite(value),
    )
  )
    return
  const safeWidth = input.viewport.width - input.padding * 2
  const safeHeight = input.viewport.height - input.bottomInset - input.padding * 2
  if (safeWidth <= 0 || safeHeight <= 0) return
  const fallback = {
    x: (input.bounds.min.x + input.bounds.max.x) / 2,
    y: (input.bounds.min.y + input.bounds.max.y) / 2,
    z: (input.bounds.min.z + input.bounds.max.z) / 2,
  }
  const anchors = [input.hips, input.head].filter((point): point is AvatarCameraPoint => !!point)
  const body = anchors.length
    ? {
        x: anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length,
        y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length,
        z: anchors.reduce((sum, point) => sum + point.z, 0) / anchors.length,
      }
    : fallback
  const feet = [input.leftFoot, input.rightFoot].filter((point): point is AvatarCameraPoint => !!point)
  const lower = Math.min(input.bounds.min.y, ...feet.map((point) => point.y))
  const centerY = (lower + input.bounds.max.y) / 2
  const halfWidth = Math.max(Math.abs(input.bounds.min.x - body.x), Math.abs(input.bounds.max.x - body.x), 0.05)
  const halfHeight = Math.max(Math.abs(lower - centerY), Math.abs(input.bounds.max.y - centerY))
  const verticalTangent = Math.tan((input.verticalFovDegrees * Math.PI) / 360)
  const horizontalTangent = verticalTangent * (input.viewport.width / input.viewport.height)
  const availableVerticalTangent = verticalTangent * (safeHeight / input.viewport.height)
  const availableHorizontalTangent = horizontalTangent * (safeWidth / input.viewport.width)
  const distance =
    Math.max(halfWidth / availableHorizontalTangent, halfHeight / availableVerticalTangent, 0.1) * input.margin
  const depth = Math.max(input.bounds.max.z - input.bounds.min.z, 0.1)
  const targetY = centerY - verticalTangent * distance * (input.bottomInset / input.viewport.height)

  return {
    aspect: input.viewport.width / input.viewport.height,
    target: { x: body.x, y: targetY, z: body.z },
    position: { x: body.x, y: targetY, z: body.z + distance + depth / 2 },
    near: Math.max(0.01, distance * 0.05),
    far: distance + depth + Math.max(input.bounds.max.y - lower, depth) * 4,
    distance,
  }
}
