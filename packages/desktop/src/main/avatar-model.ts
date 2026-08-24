import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

export function createAvatarModelStore(input: { userDataPath: string; bundledModelPath: string }) {
  const directory = join(input.userDataPath, "avatar")
  const modelPath = join(directory, "jarvis.vrm")
  const metadataPath = join(directory, "jarvis.json")

  return {
    async install(source: string) {
      const info = await stat(source)
      if (info.size > 100 * 1024 * 1024) throw new Error("VRM model exceeds the 100 MB limit")
      await mkdir(directory, { recursive: true })
      const temporary = `${modelPath}.tmp`
      await copyFile(source, temporary)
      await rename(temporary, modelPath)
      const updatedAt = Date.now()
      await writeFile(metadataPath, JSON.stringify({ name: basename(source), bytes: info.size, updatedAt }))
      return { name: basename(source), bytes: info.size, updatedAt }
    },
    async get() {
      const override = await readFile(modelPath).catch(() => undefined)
      if (!override) {
        const data = await readFile(input.bundledModelPath).catch(() => undefined)
        if (!data) return null
        return {
          data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          name: "Vita.vrm",
          bytes: data.byteLength,
          updatedAt: 0,
        }
      }
      const [metadata, info] = await Promise.all([
        readFile(metadataPath, "utf8")
          .then((value) => JSON.parse(value) as { name: string; bytes: number; updatedAt: number })
          .catch(() => undefined),
        stat(modelPath).catch(() => undefined),
      ])
      return {
        data: override.buffer.slice(override.byteOffset, override.byteOffset + override.byteLength),
        name: metadata?.name ?? "jarvis.vrm",
        bytes: metadata?.bytes ?? override.byteLength,
        updatedAt: metadata?.updatedAt ?? Math.max(1, Math.floor(info?.mtimeMs ?? Date.now())),
      }
    },
    async clear() {
      await Promise.all([rm(modelPath, { force: true }), rm(metadataPath, { force: true })])
    },
  }
}
