import { createHash, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { networkInterfaces } from "node:os"
import { dirname, join } from "node:path"
import { generate } from "selfsigned"
import type { AvatarPairedDevice, AvatarPersistentStore } from "./avatar-bridge-state"

export type AvatarBridgeCertificate = {
  key: string
  cert: string
  fingerprint: string
}

export type AvatarPairing = {
  pin: string
  expiresAt: number
  addresses: string[]
  certificateFingerprint: string
}

export class AvatarPairingManager {
  private active?: AvatarPairing
  private failures = 0

  constructor(
    private readonly store: AvatarPersistentStore,
    private readonly certificate: AvatarBridgeCertificate,
  ) {}

  start(port: number) {
    const addresses = localAddresses().map((address) => `wss://${address}:${port}/avatar`)
    this.active = {
      pin: String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, "0"),
      expiresAt: Date.now() + 2 * 60_000,
      addresses,
      certificateFingerprint: this.certificate.fingerprint,
    }
    this.failures = 0
    return { ...this.active, addresses: [...this.active.addresses] }
  }

  status() {
    if (!this.active || this.active.expiresAt <= Date.now()) return
    return { ...this.active, addresses: [...this.active.addresses] }
  }

  cancel() {
    this.active = undefined
    this.failures = 0
  }

  async pair(input: { pin: string; name: string }) {
    const pairing = this.status()
    if (!pairing) return
    if (input.pin !== pairing.pin) {
      this.failures++
      if (this.failures >= 10) this.active = undefined
      return
    }
    this.active = undefined
    this.failures = 0
    const token = randomBytes(32).toString("base64url")
    const device: AvatarPairedDevice = {
      id: `device_${randomUUID()}`,
      name: input.name.trim().slice(0, 120) || "Unity device",
      tokenHash: tokenHash(token),
      certificateFingerprint: this.certificate.fingerprint,
      createdAt: Date.now(),
    }
    await this.store.upsertDevice(device)
    return {
      deviceID: device.id,
      token,
      certificateFingerprint: device.certificateFingerprint,
      addresses: pairing.addresses,
    }
  }

  deviceForToken(token: string) {
    const hash = Buffer.from(tokenHash(token))
    return this.store.devices().find((device) => {
      if (device.revokedAt) return false
      const expected = Buffer.from(device.tokenHash)
      return hash.byteLength === expected.byteLength && timingSafeEqual(hash, expected)
    })
  }
}

export async function loadAvatarBridgeCertificate(directory: string) {
  const keyPath = join(directory, "avatar-bridge.key.pem")
  const certPath = join(directory, "avatar-bridge.cert.pem")
  const existing = await Promise.all([readFile(keyPath, "utf8"), readFile(certPath, "utf8")]).catch(() => undefined)
  if (existing) {
    const fingerprint = certificateFingerprint(existing[1])
    if (fingerprint) return { key: existing[0], cert: existing[1], fingerprint }
  }
  const notAfterDate = new Date()
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 5)
  const generated = await generate([{ name: "commonName", value: "OpenCode Customs Avatar Bridge" }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    notAfterDate,
    extensions: [
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", digitalSignature: true, keyAgreement: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
          ...localAddresses().map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  })
  await mkdir(dirname(keyPath), { recursive: true })
  await Promise.all([
    writeFile(keyPath, generated.private, { encoding: "utf8", mode: 0o600 }),
    writeFile(certPath, generated.cert, { encoding: "utf8", mode: 0o600 }),
  ])
  return {
    key: generated.private,
    cert: generated.cert,
    fingerprint: new X509Certificate(generated.cert).fingerprint256.replaceAll(":", "").toLowerCase(),
  }
}

function certificateFingerprint(cert: string) {
  try {
    return new X509Certificate(cert).fingerprint256.replaceAll(":", "").toLowerCase()
  } catch {
    return
  }
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function localAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal && privateIPv4(item.address))
    .map((item) => item.address)
    .toSorted()
}

function privateIPv4(address: string) {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  if (octets[0] === 10 || octets[0] === 127) return true
  if (octets[0] === 192 && octets[1] === 168) return true
  return octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31
}
