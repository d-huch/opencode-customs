import { Config } from "@/config/config"
import { snapshot } from "@/local-agent-runtime/resource-governor"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { ModelCapabilityRouter } from "@opencode-ai/core/model-capability-router"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import photonWasm from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" }
import { Context, Effect, Layer, Schema } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const MAX_BASE64_BYTES = 5 * 1024 * 1024
const MAX_WIDTH = 2000
const MAX_HEIGHT = 2000
const AUTO_RESIZE = true
const JPEG_QUALITIES = [80, 70, 55, 40]

export class ResizerUnavailableError extends Schema.TaggedErrorClass<ResizerUnavailableError>()(
  "ImageResizerUnavailableError",
  {},
) {
  override get message() {
    return "Image resizer is unavailable"
  }
}

export class InvalidDataUrlError extends Schema.TaggedErrorClass<InvalidDataUrlError>()("ImageInvalidDataUrlError", {
  url: Schema.String,
}) {
  override get message() {
    return "Image URL must be a base64 data URL or a local file URL"
  }
}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()("ImageDecodeError", {}) {
  override get message() {
    return "Image could not be decoded"
  }
}

export class SizeError extends Schema.TaggedErrorClass<SizeError>()("ImageSizeError", {
  bytes: Schema.Number,
  max: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  max_width: Schema.Number,
  max_height: Schema.Number,
}) {
  override get message() {
    return `Image ${this.width}x${this.height} with base64 size ${this.bytes} exceeds configured limits and could not be resized below ${this.max_width}x${this.max_height}/${this.max} bytes`
  }
}

export type Error = ResizerUnavailableError | InvalidDataUrlError | DecodeError | SizeError

export interface Interface {
  readonly normalize: (input: SessionV1.FilePart) => Effect.Effect<SessionV1.FilePart, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Image") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const global = yield* Global.Service
    const loadPhoton = yield* Effect.cached(
      Effect.sync(() => {
        // Patched photon-node reads this during module init so Bun compiled binaries use the embedded wasm path.
        ;(globalThis as typeof globalThis & { __OPENCODE_PHOTON_WASM_PATH?: string }).__OPENCODE_PHOTON_WASM_PATH =
          path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
      }).pipe(
        Effect.andThen(() => Effect.tryPromise(() => import("@silvia-odwyer/photon-node"))),
        Effect.tapError((error) => Effect.logWarning("failed to load photon", { error })),
        Effect.mapError(() => new ResizerUnavailableError()),
      ),
    )

    const normalize = Effect.fn("Image.normalize")(function* (input: SessionV1.FilePart) {
      const image = (yield* config.get()).attachment?.image
      const resources = snapshot()
      const factor = resources.status === "critical" ? 0.5 : resources.status === "pressured" ? 0.75 : 1
      const limits = {
        autoResize: image?.auto_resize ?? AUTO_RESIZE,
        maxWidth: Math.max(1, Math.round((image?.max_width ?? MAX_WIDTH) * factor)),
        maxHeight: Math.max(1, Math.round((image?.max_height ?? MAX_HEIGHT) * factor)),
        maxBase64Bytes: Math.max(1, Math.round((image?.max_base64_bytes ?? MAX_BASE64_BYTES) * factor)),
      }
      const source = yield* readSource(input)
      const photon = yield* loadPhoton
      const decoded = yield* Effect.try({
        try: () => photon.PhotonImage.new_from_byteslice(source.data),
        catch: () => new DecodeError(),
      }).pipe(Effect.tapError((error) => Effect.logWarning("failed to decode image", { error })))

      try {
        const originalWidth = decoded.get_width()
        const originalHeight = decoded.get_height()
        const originalBase64Bytes = base64Bytes(source.data.byteLength)
        const withinLimits =
          originalWidth <= limits.maxWidth &&
          originalHeight <= limits.maxHeight &&
          originalBase64Bytes <= limits.maxBase64Bytes
        if (!withinLimits && !limits.autoResize)
          return yield* new SizeError({
            bytes: originalBase64Bytes,
            max: limits.maxBase64Bytes,
            width: originalWidth,
            height: originalHeight,
            max_width: limits.maxWidth,
            max_height: limits.maxHeight,
          })

        const prepared = withinLimits
          ? { data: source.data, mime: input.mime, width: originalWidth, height: originalHeight }
          : yield* resize({
              photon,
              decoded,
              originalWidth,
              originalHeight,
              maxWidth: limits.maxWidth,
              maxHeight: limits.maxHeight,
              maxBase64Bytes: limits.maxBase64Bytes,
            })
        const directory = path.join(global.data, "vision", safeSegment(input.sessionID))
        const digest = new Bun.CryptoHasher("sha256").update(prepared.data).digest("hex").slice(0, 24)
        const artifactPath = path.join(directory, `${digest}.${extension(prepared.mime)}`)
        const artifact: ModelCapabilityRouter.VisionArtifact = {
          fileURL: pathToFileURL(artifactPath).href,
          filename: input.filename ?? `image.${extension(prepared.mime)}`,
          mime: prepared.mime,
          originalWidth,
          originalHeight,
          originalBytes: source.data.byteLength,
          preparedWidth: prepared.width,
          preparedHeight: prepared.height,
          preparedBytes: prepared.data.byteLength,
          compressed:
            prepared.width !== originalWidth ||
            prepared.height !== originalHeight ||
            prepared.data.byteLength !== source.data.byteLength ||
            prepared.mime !== input.mime,
          estimatedTokens: estimateTokens(prepared.width, prepared.height),
          reason: [
            "vision.file_reference",
            ...(withinLimits ? ["vision.within_limits"] : ["vision.compressed"]),
            ...(resources.status === "healthy" ? [] : [`vision.resources.${resources.status}`]),
          ],
        }
        yield* Effect.tryPromise(async () => {
          await fs.mkdir(directory, { recursive: true })
          await Bun.write(artifactPath, prepared.data)
          await Bun.write(`${artifactPath}.json`, JSON.stringify(artifact))
        }).pipe(Effect.orDie)
        yield* Effect.logInfo("prepared image file reference", {
          mime: artifact.mime,
          original: `${artifact.originalWidth}x${artifact.originalHeight}`,
          prepared: `${artifact.preparedWidth}x${artifact.preparedHeight}`,
          bytes: artifact.preparedBytes,
          compressed: artifact.compressed,
        })
        return { ...input, mime: artifact.mime, url: artifact.fileURL, filename: artifact.filename }
      } finally {
        decoded.free()
      }
    })

    return Service.of({ normalize })
  }),
)

export async function describe(parts: readonly SessionV1.FilePart[]) {
  const artifacts = (
    await Promise.all(parts.filter((part) => part.mime.startsWith("image/")).map((part) => readArtifact(part.url)))
  ).filter((artifact): artifact is ModelCapabilityRouter.VisionArtifact => artifact !== undefined)
  return {
    status: "prepared" as const,
    checkedAt: Date.now(),
    imageCount: artifacts.length,
    originalBytes: artifacts.reduce((total, artifact) => total + artifact.originalBytes, 0),
    preparedBytes: artifacts.reduce((total, artifact) => total + artifact.preparedBytes, 0),
    estimatedTokens: artifacts.reduce((total, artifact) => total + artifact.estimatedTokens, 0),
    failover: false,
    reason: [...new Set(artifacts.flatMap((artifact) => artifact.reason))],
    artifacts,
  } satisfies ModelCapabilityRouter.Vision
}

export async function toDataURL(part: Pick<SessionV1.FilePart, "url" | "mime">) {
  if (part.url.startsWith("data:")) return part.url
  if (!part.url.startsWith("file:")) throw new InvalidDataUrlError({ url: part.url })
  return `data:${part.mime};base64,${Buffer.from(await Bun.file(fileURLToPath(part.url)).arrayBuffer()).toString("base64")}`
}

async function readArtifact(url: string) {
  if (!url.startsWith("file:")) return
  return Schema.decodeUnknownPromise(ModelCapabilityRouter.VisionArtifact)(
    await Bun.file(`${fileURLToPath(url)}.json`)
      .json()
      .catch(() => undefined),
  ).catch(() => undefined)
}

function readSource(input: SessionV1.FilePart) {
  if (input.url.startsWith("data:") && input.url.includes(";base64,")) {
    return Effect.succeed({
      data: Buffer.from(input.url.slice(input.url.indexOf(";base64,") + ";base64,".length), "base64"),
    })
  }
  if (input.url.startsWith("file:"))
    return Effect.tryPromise(() => Bun.file(fileURLToPath(input.url)).arrayBuffer()).pipe(
      Effect.map((data) => ({ data: Buffer.from(data) })),
      Effect.mapError(() => new DecodeError()),
    )
  return Effect.fail(new InvalidDataUrlError({ url: input.url }))
}

function resize(input: {
  photon: typeof import("@silvia-odwyer/photon-node")
  decoded: InstanceType<typeof import("@silvia-odwyer/photon-node").PhotonImage>
  originalWidth: number
  originalHeight: number
  maxWidth: number
  maxHeight: number
  maxBase64Bytes: number
}) {
  const scale = Math.min(1, input.maxWidth / input.originalWidth, input.maxHeight / input.originalHeight)
  return Effect.gen(function* () {
    for (const size of sizes(input.originalWidth, input.originalHeight, scale)) {
      const resized = input.photon.resize(input.decoded, size.width, size.height, input.photon.SamplingFilter.Lanczos3)
      const candidates = [
        { data: Buffer.from(resized.get_bytes()), mime: "image/png" },
        ...JPEG_QUALITIES.map((quality) => ({
          data: Buffer.from(resized.get_bytes_jpeg(quality)),
          mime: "image/jpeg",
        })),
      ]
      resized.free()
      const candidate = candidates.find((item) => base64Bytes(item.data.byteLength) <= input.maxBase64Bytes)
      if (candidate) return { ...candidate, width: size.width, height: size.height }
    }
    return yield* new SizeError({
      bytes: base64Bytes(input.decoded.get_bytes().byteLength),
      max: input.maxBase64Bytes,
      width: input.originalWidth,
      height: input.originalHeight,
      max_width: input.maxWidth,
      max_height: input.maxHeight,
    })
  })
}

function sizes(originalWidth: number, originalHeight: number, scale: number) {
  return Array.from({ length: 32 }).reduce<Array<{ width: number; height: number }>>((result) => {
    const previous = result.at(-1) ?? {
      width: Math.max(1, Math.round(originalWidth * scale)),
      height: Math.max(1, Math.round(originalHeight * scale)),
    }
    const next =
      result.length === 0
        ? previous
        : {
            width: previous.width === 1 ? 1 : Math.max(1, Math.floor(previous.width * 0.75)),
            height: previous.height === 1 ? 1 : Math.max(1, Math.floor(previous.height * 0.75)),
          }
    return result.some((item) => item.width === next.width && item.height === next.height) ? result : [...result, next]
  }, [])
}

function base64Bytes(bytes: number) {
  return Math.ceil(bytes / 3) * 4
}

function estimateTokens(width: number, height: number) {
  return Math.max(85, Math.ceil(width / 512) * Math.ceil(height / 512) * 170)
}

function extension(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/webp") return "webp"
  if (mime === "image/gif") return "gif"
  return "png"
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export const node = LayerNode.make({ service: Service, layer, deps: [Config.node, Global.node] })

export * as Image from "./image"
