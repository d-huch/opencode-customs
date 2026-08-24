import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createAvatarModelStore } from "./avatar-model"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("desktop avatar model store", () => {
  test("ships the reviewed Vita binary", async () => {
    const data = Buffer.from(
      await Bun.file(
        join(dirname(fileURLToPath(import.meta.url)), "../../resources/avatar/Vita.vrm"),
      ).arrayBuffer(),
    )
    expect(new Bun.CryptoHasher("sha256").update(data).digest("hex")).toBe(
      "f2bf78f28a24e2f75f5ca0b6c3b646654c394e4b03592dfaa0d0633ef0972b4d",
    )
    expect(data.subarray(0, 4).toString()).toBe("glTF")
    const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString()) as {
      extensions: {
        VRM: {
          meta: { title: string; licenseName: string }
          humanoid: { humanBones: Array<{ bone: string }> }
          blendShapeMaster: { blendShapeGroups: Array<{ name: string }> }
        }
      }
    }
    expect(json.extensions.VRM.meta).toMatchObject({ title: "Vita", licenseName: "CC0" })
    expect(json.extensions.VRM.humanoid.humanBones.map((bone) => bone.bone)).toEqual(
      expect.arrayContaining(["hips", "spine", "head", "leftHand", "rightHand"]),
    )
    expect(json.extensions.VRM.blendShapeMaster.blendShapeGroups.map((group) => group.name)).toEqual(
      expect.arrayContaining(["Blink", "Joy", "Sorrow", "A", "I", "U", "E", "O"]),
    )
  })

  test("uses Vita by default and restores it after clearing an override", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-avatar-"))
    directories.push(directory)
    const bundled = join(directory, "Vita.vrm")
    const custom = join(directory, "custom.vrm")
    await Promise.all([writeFile(bundled, "vita"), writeFile(custom, "custom")])
    const store = createAvatarModelStore({ userDataPath: join(directory, "user"), bundledModelPath: bundled })

    const fallback = await store.get()
    expect(fallback?.name).toBe("Vita.vrm")
    expect(fallback?.updatedAt).toBe(0)
    expect(new TextDecoder().decode(fallback?.data)).toBe("vita")

    await store.install(custom)
    const override = await store.get()
    expect(override?.name).toBe("custom.vrm")
    expect(override?.updatedAt).toBeGreaterThan(0)
    expect(new TextDecoder().decode(override?.data)).toBe("custom")

    await store.clear()
    const restored = await store.get()
    expect(restored?.name).toBe("Vita.vrm")
    expect(new TextDecoder().decode(restored?.data)).toBe("vita")
  })

  test("returns null only when neither override nor bundled model exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-avatar-"))
    directories.push(directory)
    const store = createAvatarModelStore({
      userDataPath: join(directory, "user"),
      bundledModelPath: join(directory, "missing.vrm"),
    })
    expect(await store.get()).toBeNull()
  })
})
