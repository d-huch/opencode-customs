import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AvatarPairingManager, loadAvatarBridgeCertificate } from "./avatar-bridge-lan"
import { AvatarPersistentStore } from "./avatar-bridge-state"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Avatar Bridge secure LAN pairing", () => {
  test("generates a persistent certificate and one-time device credential", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-lan-"))
    directories.push(directory)
    const certificate = await loadAvatarBridgeCertificate(directory)
    const repeated = await loadAvatarBridgeCertificate(directory)
    expect(certificate.fingerprint).toHaveLength(64)
    expect(repeated.fingerprint).toBe(certificate.fingerprint)

    const store = await AvatarPersistentStore.open(join(directory, "state.json"))
    const pairing = new AvatarPairingManager(store, certificate)
    const started = pairing.start(43_210)
    expect(started.pin).toMatch(/^\d{6}$/)
    expect(await pairing.pair({ pin: "000000", name: "Quest" })).toBeUndefined()
    const device = await pairing.pair({ pin: started.pin, name: "Quest 3" })
    expect(device?.token).toBeTruthy()
    expect(device?.certificateFingerprint).toBe(certificate.fingerprint)
    expect(pairing.deviceForToken(device?.token ?? "")?.name).toBe("Quest 3")
    expect(await pairing.pair({ pin: started.pin, name: "Replay" })).toBeUndefined()
  })

  test("revoked credentials no longer authenticate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-bridge-lan-"))
    directories.push(directory)
    const certificate = await loadAvatarBridgeCertificate(directory)
    const store = await AvatarPersistentStore.open(join(directory, "state.json"))
    const pairing = new AvatarPairingManager(store, certificate)
    const started = pairing.start(43_210)
    const device = await pairing.pair({ pin: started.pin, name: "Quest" })
    expect(pairing.deviceForToken(device?.token ?? "")?.id).toBe(device?.deviceID)
    await store.revokeDevice(device?.deviceID ?? "")
    expect(pairing.deviceForToken(device?.token ?? "")).toBeUndefined()
  })
})
