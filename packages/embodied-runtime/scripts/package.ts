import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto"
import { chmod, cp, mkdir, readdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { replayAuditBundle } from "../src/replay"

const packageRoot = resolve(import.meta.dir, "..")
const repositoryRoot = resolve(packageRoot, "../..")
const release = resolve(packageRoot, "dist/release")
const macBinary = resolve(packageRoot, "dist/mac-arm64/embodied-agent-runtime")
const macReplay = resolve(packageRoot, "dist/mac-arm64/embodied-replay")
const windowsBinary = resolve(packageRoot, "dist/win-x64/embodied-agent-runtime.exe")
const windowsReplay = resolve(packageRoot, "dist/win-x64/embodied-replay.exe")
const questApk = resolve(packageRoot, "dist/quest/Embodied-Agent-Safety-Instructor.apk")
const unityPackage = resolve(repositoryRoot, "integrations/unity/com.embodiedagent.sdk")
const runtimePackage = await Bun.file(resolve(packageRoot, "package.json")).json()
const version = runtimePackage.version as string
const production = process.env.EMBODIED_RELEASE === "production"
const identity = process.env.EMBODIED_CODESIGN_IDENTITY ?? "-"
const notaryProfile = process.env.EMBODIED_NOTARY_PROFILE
const auditKeyPath = process.env.EMBODIED_AUDIT_SIGNING_KEY
const updateKeyPath = process.env.EMBODIED_UPDATE_SIGNING_KEY
const installerIdentity = process.env.EMBODIED_INSTALLER_IDENTITY
const windowsMsi = process.env.EMBODIED_WINDOWS_MSI
const windowsValidation = process.env.EMBODIED_WINDOWS_VALIDATION_REPORT
const questSoak = process.env.EMBODIED_QUEST_SOAK_REPORT
const dependencyScan = process.env.EMBODIED_DEPENDENCY_SCAN_REPORT
const paidDesignPartners = Number(process.env.EMBODIED_PAID_DESIGN_PARTNERS ?? 0)
const onboardingMinutes = Number(process.env.EMBODIED_CLEAN_ONBOARDING_MINUTES ?? Number.POSITIVE_INFINITY)

if (production && identity === "-") throw new Error("Production release requires EMBODIED_CODESIGN_IDENTITY")
if (production && !notaryProfile) throw new Error("Production release requires EMBODIED_NOTARY_PROFILE")
if (production && !auditKeyPath) throw new Error("Production release requires EMBODIED_AUDIT_SIGNING_KEY")
if (production && !updateKeyPath) throw new Error("Production release requires EMBODIED_UPDATE_SIGNING_KEY")
if (production && !installerIdentity) throw new Error("Production release requires EMBODIED_INSTALLER_IDENTITY")
if (production && !windowsMsi) throw new Error("Production release requires EMBODIED_WINDOWS_MSI")
if (production && !windowsValidation) throw new Error("Production release requires EMBODIED_WINDOWS_VALIDATION_REPORT")
if (production && !questSoak) throw new Error("Production release requires EMBODIED_QUEST_SOAK_REPORT")
if (production && !dependencyScan) throw new Error("Production release requires EMBODIED_DEPENDENCY_SCAN_REPORT")
if (production && paidDesignPartners < 2) throw new Error("Production Beta requires two paid design partners")
if (production && onboardingMinutes > 30) throw new Error("Production Beta requires clean onboarding in 30 minutes or less")
if (production && !Bun.which("osslsigncode")) throw new Error("Production release requires osslsigncode to verify Authenticode")
const hasQuestApk = await Bun.file(questApk).exists()
if (production && !hasQuestApk) throw new Error("Production release requires a fresh Quest development APK from check:embodied --unity --quest")
for (const evidence of [windowsMsi, windowsValidation, questSoak, dependencyScan].filter((value): value is string => Boolean(value)))
  if (!(await Bun.file(evidence).exists())) throw new Error(`Missing Beta evidence: ${evidence}`)

for (const file of [macBinary, macReplay, windowsBinary, windowsReplay])
  if (!(await Bun.file(file).exists())) throw new Error(`Missing build output: ${file}`)

await rm(release, { recursive: true, force: true })
await mkdir(resolve(release, "mac-arm64"), { recursive: true })
await mkdir(resolve(release, "win-x64"), { recursive: true })
await cp(macBinary, resolve(release, "mac-arm64/embodied-agent-runtime"))
await cp(macReplay, resolve(release, "mac-arm64/embodied-replay"))
await cp(windowsBinary, resolve(release, "win-x64/embodied-agent-runtime.exe"))
await cp(windowsReplay, resolve(release, "win-x64/embodied-replay.exe"))
if (hasQuestApk) {
  await mkdir(resolve(release, "quest"), { recursive: true })
  await cp(questApk, resolve(release, "quest/Embodied-Agent-Safety-Instructor.apk"))
}
await Bun.write(resolve(release, "mac-arm64/README.txt"), instructions("macOS ARM64"))
await Bun.write(resolve(release, "win-x64/README.txt"), instructions("Windows x64"))
await Bun.write(resolve(release, "mac-arm64/install.sh"), macInstaller())
await Bun.write(resolve(release, "mac-arm64/uninstall.sh"), macUninstaller())
await Bun.write(resolve(release, "win-x64/install.ps1"), windowsInstaller())
await Bun.write(resolve(release, "win-x64/uninstall.ps1"), windowsUninstaller())
await chmod(resolve(release, "mac-arm64/install.sh"), 0o755)
await chmod(resolve(release, "mac-arm64/uninstall.sh"), 0o755)
await chmod(resolve(release, "mac-arm64/embodied-replay"), 0o755)

for (const binary of ["embodied-agent-runtime", "embodied-replay"]) {
  const path = resolve(release, "mac-arm64", binary)
  const sign = Bun.spawnSync(["codesign", "--force", "--deep", "--options", "runtime", "--entitlements", resolve(packageRoot, "entitlements.plist"), ...(identity === "-" ? [] : ["--timestamp"]), "--sign", identity, path], {
    stdout: "inherit", stderr: "inherit",
  })
  if (sign.exitCode !== 0) throw new Error(`macOS signing failed for ${binary}`)
  const verified = Bun.spawnSync(["codesign", "--verify", "--strict", "--verbose=4", path], { stdout: "inherit", stderr: "inherit" })
  if (verified.exitCode !== 0) throw new Error(`macOS signature verification failed for ${binary}`)
}

const macInstallerPackage = resolve(release, "Embodied-Agent-Runtime-macOS-arm64.pkg")
await buildMacInstaller(macInstallerPackage)
const windowsInstallerPackage = resolve(release, "Embodied-Agent-Runtime-Windows-x64.msi")
if (windowsMsi) await cp(windowsMsi, windowsInstallerPackage)

for (const [directory, archive] of [
  ["mac-arm64", "embodied-agent-runtime-mac-arm64.zip"],
  ["win-x64", "embodied-agent-runtime-win-x64.zip"],
] as const) {
  const result = Bun.spawnSync(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", resolve(release, directory), resolve(release, archive)], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) throw new Error(`Failed to create ${archive}`)
}

const unityArchive = resolve(release, `com.embodiedagent.sdk-${version}.tgz`)
const unity = Bun.spawnSync(["tar", "-czf", unityArchive, "-C", resolve(unityPackage, ".."), "com.embodiedagent.sdk"], {
  stdout: "inherit",
  stderr: "inherit",
})
if (unity.exitCode !== 0) throw new Error("Failed to package the Unity SDK")

const airgap = resolve(release, "airgap")
const offlinePackages = resolve(airgap, "unity-packages")
await mkdir(offlinePackages, { recursive: true })
await cp(unityPackage, resolve(offlinePackages, "com.embodiedagent.sdk"), { recursive: true })
const unityManifest = await Bun.file(resolve(unityPackage, "package.json")).json()
const dependencyPaths = await Promise.all(Object.entries(unityManifest.dependencies as Record<string, string>).map(async ([name, dependencyVersion]) => {
  const source = await findUnityPackage(name, dependencyVersion)
  if (!source) throw new Error(`Unity dependency ${name}@${dependencyVersion} is not present in the local cache. Set EMBODIED_UNITY_PACKAGE_CACHE.`)
  await cp(source, resolve(offlinePackages, name), { recursive: true })
  return [name, `file:../unity-packages/${name}`] as const
}))
await mkdir(resolve(airgap, "Packages"), { recursive: true })
await Bun.write(resolve(airgap, "Packages/manifest.json"), JSON.stringify({
  dependencies: Object.fromEntries([["com.embodiedagent.sdk", "file:../unity-packages/com.embodiedagent.sdk"], ...dependencyPaths]),
}, null, 2))
await cp(resolve(release, "mac-arm64"), resolve(airgap, "runtime/mac-arm64"), { recursive: true })
await cp(resolve(release, "win-x64"), resolve(airgap, "runtime/win-x64"), { recursive: true })
await mkdir(resolve(airgap, "installers"), { recursive: true })
if (await Bun.file(macInstallerPackage).exists()) await cp(macInstallerPackage, resolve(airgap, "installers/Embodied-Agent-Runtime-macOS-arm64.pkg"))
if (await Bun.file(windowsInstallerPackage).exists()) await cp(windowsInstallerPackage, resolve(airgap, "installers/Embodied-Agent-Runtime-Windows-x64.msi"))
await cp(resolve(unityPackage, "Documentation~"), resolve(airgap, "Documentation"), { recursive: true })
await cp(resolve(packageRoot, "fixtures"), resolve(airgap, "replay-fixtures"), { recursive: true })
if (hasQuestApk) await cp(questApk, resolve(airgap, "Samples/Quest/Embodied-Agent-Safety-Instructor.apk"))
await Bun.write(resolve(airgap, "README.txt"), airgapInstructions())
await Bun.write(resolve(airgap, "compatibility.json"), JSON.stringify({
  product: "Embodied Agent SDK Beta",
  version,
  scenarioSchema: 1,
  bridge: { major: 2, minor: 9, compatibleMinor: 7 },
  unity: "6000.x",
  hosts: ["macOS arm64", "Windows x64"],
  clients: ["Unity Desktop", "Meta Quest 3"],
  providers: ["lmstudio", "llama-server"],
}, null, 2))
const offlineUpdateArtifacts = (await Promise.all([
  ["installers/Embodied-Agent-Runtime-macOS-arm64.pkg", resolve(airgap, "installers/Embodied-Agent-Runtime-macOS-arm64.pkg")] as const,
  ["installers/Embodied-Agent-Runtime-Windows-x64.msi", resolve(airgap, "installers/Embodied-Agent-Runtime-Windows-x64.msi")] as const,
  ["unity-packages/com.embodiedagent.sdk/package.json", resolve(airgap, "unity-packages/com.embodiedagent.sdk/package.json")] as const,
].map(async (entry) => await Bun.file(entry[1]).exists() ? entry : undefined))).filter(defined)
const offlineUpdatePayload = {
  format: "embodied-agent-offline-update-v1",
  version,
  minimumScenarioSchema: 1,
  bridge: { major: 2, minor: 9 },
  generatedAt: new Date().toISOString(),
  artifacts: await Promise.all(offlineUpdateArtifacts.map(async ([name, path]) => ({
    name,
    sha256: createHash("sha256").update(Buffer.from(await Bun.file(path).arrayBuffer())).digest("hex"),
    bytes: Bun.file(path).size,
  }))),
}
await Bun.write(resolve(airgap, "update-manifest.json"), JSON.stringify(await signedPayload(offlineUpdatePayload, updateKeyPath), null, 2))
if (updateKeyPath) await Bun.write(resolve(airgap, "update-public.pem"), publicKey(await Bun.file(updateKeyPath).text()))
const airgapArchive = resolve(release, `embodied-agent-airgap-${version}.zip`)
const archived = Bun.spawnSync(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", airgap, airgapArchive], {
  stdout: "inherit", stderr: "inherit",
})
if (archived.exitCode !== 0) throw new Error("Failed to create the air-gapped pilot bundle")

const publicSymbols = (await Promise.all((await readdir(resolve(unityPackage, "Runtime")))
  .filter((name) => name.endsWith(".cs"))
  .map(async (name) => ({
    file: name,
    symbols: (await Bun.file(resolve(unityPackage, "Runtime", name)).text())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^public (?:sealed |abstract |static )?(?:class|interface|enum|struct) [A-Za-z0-9_]+/.test(line)),
  }))))
  .filter((entry) => entry.symbols.length > 0)
await Bun.write(resolve(release, "unity-api.json"), JSON.stringify({ version, namespace: "EmbodiedAgent.Unity", files: publicSymbols }, null, 2))

if (notaryProfile) {
  const notarized = Bun.spawnSync(["xcrun", "notarytool", "submit", macInstallerPackage, "--keychain-profile", notaryProfile, "--wait"], {
    stdout: "inherit", stderr: "inherit",
  })
  if (notarized.exitCode !== 0) throw new Error("macOS notarization failed")
  const stapled = Bun.spawnSync(["xcrun", "stapler", "staple", macInstallerPackage], { stdout: "inherit", stderr: "inherit" })
  if (stapled.exitCode !== 0) throw new Error("macOS installer stapling failed")
}
if (production) {
  for (const binary of ["embodied-agent-runtime.exe", "embodied-replay.exe"]) {
    const verified = Bun.spawnSync(["osslsigncode", "verify", resolve(release, "win-x64", binary)], { stdout: "inherit", stderr: "inherit" })
    if (verified.exitCode !== 0) throw new Error(`Authenticode verification failed for ${binary}`)
  }
  const verified = Bun.spawnSync(["osslsigncode", "verify", windowsInstallerPackage], { stdout: "inherit", stderr: "inherit" })
  if (verified.exitCode !== 0) throw new Error("Authenticode verification failed for Windows MSI")
}

const auditFixture = await Bun.file(resolve(packageRoot, "fixtures/equipment-isolation-happy.json")).json()
await Bun.write(resolve(release, "pilot-gate-audit.json"), JSON.stringify(replayAuditBundle(
  auditFixture,
  auditKeyPath ? await Bun.file(auditKeyPath).text() : undefined,
), null, 2))
if (auditKeyPath) await Bun.write(resolve(release, "audit-public.pem"), publicKey(await Bun.file(auditKeyPath).text()))

const artifacts = [
  "embodied-agent-runtime-mac-arm64.zip",
  "embodied-agent-runtime-win-x64.zip",
  `com.embodiedagent.sdk-${version}.tgz`,
  `embodied-agent-airgap-${version}.zip`,
  ...(await Bun.file(macInstallerPackage).exists() ? ["Embodied-Agent-Runtime-macOS-arm64.pkg"] : []),
  ...(await Bun.file(windowsInstallerPackage).exists() ? ["Embodied-Agent-Runtime-Windows-x64.msi"] : []),
  ...(hasQuestApk ? ["quest/Embodied-Agent-Safety-Instructor.apk"] : []),
]
const updatePayload = {
  format: "embodied-agent-offline-update-v1",
  version,
  minimumScenarioSchema: 1,
  bridge: { major: 2, minor: 9 },
  generatedAt: new Date().toISOString(),
  artifacts: await Promise.all(artifacts.map(async (name) => ({
    name,
    sha256: createHash("sha256").update(Buffer.from(await Bun.file(resolve(release, name)).arrayBuffer())).digest("hex"),
    bytes: Bun.file(resolve(release, name)).size,
  }))),
}
await Bun.write(resolve(release, "update-manifest.json"), JSON.stringify(await signedPayload(updatePayload, updateKeyPath), null, 2))
if (updateKeyPath) await Bun.write(resolve(release, "update-public.pem"), publicKey(await Bun.file(updateKeyPath).text()))
artifacts.push("update-manifest.json")
const manifest = await Promise.all(artifacts.map(async (name) => ({
  name,
  sha256: createHash("sha256").update(Buffer.from(await Bun.file(resolve(release, name)).arrayBuffer())).digest("hex"),
  bytes: Bun.file(resolve(release, name)).size,
})))
const sbom = JSON.stringify({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: { component: { type: "application", name: "Embodied Agent Runtime", version } },
  components: [
    ...Object.entries(runtimePackage.dependencies ?? {}).map(([name, dependencyVersion]) => ({ type: "library", name, version: dependencyVersion, scope: "required" })),
    ...Object.entries(unityManifest.dependencies ?? {}).map(([name, dependencyVersion]) => ({ type: "library", name, version: dependencyVersion, scope: "required" })),
  ],
}, null, 2)
await Bun.write(resolve(release, "sbom.json"), sbom)
await Bun.write(resolve(release, "license-inventory.json"), JSON.stringify({
  format: "embodied-agent-license-inventory-v1",
  generatedAt: new Date().toISOString(),
  runtime: Object.entries(runtimePackage.dependencies ?? {}).map(([name, dependencyVersion]) => ({ name, version: dependencyVersion, license: "see-package-metadata" })),
  unity: Object.entries(unityManifest.dependencies ?? {}).map(([name, dependencyVersion]) => ({ name, version: dependencyVersion, license: "Unity Package Terms" })),
}, null, 2))
const evidence = Object.fromEntries(await Promise.all([
  ["windowsValidation", windowsValidation], ["questSoak", questSoak], ["dependencyScan", dependencyScan],
].filter((item): item is [string, string] => Boolean(item[1])).map(async ([name, path]) => [name, {
  sha256: createHash("sha256").update(Buffer.from(await Bun.file(path).arrayBuffer())).digest("hex"),
  bytes: Bun.file(path).size,
}] as const)))
await Bun.write(resolve(release, "manifest.json"), JSON.stringify({
  product: production ? "Embodied Agent SDK Beta" : "Embodied Agent SDK Beta development candidate",
  version,
  generatedAt: new Date().toISOString(),
  macSigning: identity === "-" ? "ad-hoc-development" : notaryProfile ? "developer-id-notarized" : "developer-id-not-notarized",
  windowsSigning: production ? "authenticode-verified" : "unsigned-development",
  sbom: { name: "sbom.json", sha256: createHash("sha256").update(sbom).digest("hex") },
  apiReference: { name: "unity-api.json", sha256: createHash("sha256").update(await Bun.file(resolve(release, "unity-api.json")).text()).digest("hex") },
  audit: { name: "pilot-gate-audit.json", sha256: createHash("sha256").update(await Bun.file(resolve(release, "pilot-gate-audit.json")).text()).digest("hex"), signed: Boolean(auditKeyPath) },
  releaseGate: { production, paidDesignPartners, onboardingMinutes: Number.isFinite(onboardingMinutes) ? onboardingMinutes : null, evidence },
  artifacts: manifest,
}, null, 2))

console.log(`Embodied Agent ${production ? "Beta" : "Beta development candidate"} artifacts: ${release}`)

function instructions(platform: string) {
  return `Embodied Agent Runtime ${version} — ${platform}\n\nRun the included installer, start the Runtime, then use Embodied Agent > Setup Wizard in Unity. The wizard opens an authenticated Control Center without copying a token. Unity discovers the Runtime on http://127.0.0.1:57112.\nThe installer keeps one previous Runtime and Replay CLI for rollback. Use the included uninstaller to remove the application without deleting training results.\nProduction pilots must use vendor-signed artifacts; development packages may use ad-hoc or unsigned signing.\n`
}

function macInstaller() {
  return `#!/bin/sh\nset -eu\nTARGET="$HOME/Applications/Embodied Agent Runtime"\nmkdir -p "$TARGET"\nfor NAME in embodied-agent-runtime embodied-replay; do if [ -f "$TARGET/$NAME" ]; then mv "$TARGET/$NAME" "$TARGET/$NAME.previous"; fi; cp "$(dirname "$0")/$NAME" "$TARGET/$NAME"; chmod 755 "$TARGET/$NAME"; done\nprintf 'Installed Embodied Agent Runtime ${version} at %s\\n' "$TARGET"\n`
}

function macUninstaller() {
  return `#!/bin/sh\nset -eu\nTARGET="$HOME/Applications/Embodied Agent Runtime"\nif [ "\${1:-}" = "--rollback" ]; then for NAME in embodied-agent-runtime embodied-replay; do if [ -f "$TARGET/$NAME.previous" ]; then mv "$TARGET/$NAME.previous" "$TARGET/$NAME"; fi; done; exit 0; fi\nrm -f "$TARGET/embodied-agent-runtime" "$TARGET/embodied-agent-runtime.previous" "$TARGET/embodied-replay" "$TARGET/embodied-replay.previous"\nrmdir "$TARGET" 2>/dev/null || true\nprintf 'Removed Embodied Agent Runtime. Local training data was preserved.\\n'\n`
}

function windowsInstaller() {
  return `$ErrorActionPreference = "Stop"\n$Target = Join-Path $env:LOCALAPPDATA "Embodied Agent Runtime"\nNew-Item -ItemType Directory -Force -Path $Target | Out-Null\nforeach ($Name in @("embodied-agent-runtime.exe", "embodied-replay.exe")) { $Binary = Join-Path $Target $Name; if (Test-Path $Binary) { Move-Item -Force $Binary "$Binary.previous" }; Copy-Item -Force (Join-Path $PSScriptRoot $Name) $Binary }\nWrite-Host "Installed Embodied Agent Runtime ${version} at $Target"\n`
}

function windowsUninstaller() {
  return `param([switch]$Rollback)\n$ErrorActionPreference = "Stop"\n$Target = Join-Path $env:LOCALAPPDATA "Embodied Agent Runtime"\nforeach ($Name in @("embodied-agent-runtime.exe", "embodied-replay.exe")) { $Binary = Join-Path $Target $Name; if ($Rollback -and (Test-Path "$Binary.previous")) { Move-Item -Force "$Binary.previous" $Binary } elseif (-not $Rollback) { Remove-Item -Force -ErrorAction SilentlyContinue $Binary, "$Binary.previous" } }\nif ($Rollback) { Write-Host "Rolled back Embodied Agent Runtime." } else { Write-Host "Removed Embodied Agent Runtime. Local training data was preserved." }\n`
}

function airgapInstructions() {
  return `Embodied Agent SDK ${version} air-gapped pilot bundle\n\n1. Copy this directory to the isolated workstation.\n2. Run the installer under runtime/<platform>.\n3. Copy Packages/manifest.json into a new Unity 6 project's Packages directory, or add unity-packages/com.embodiedagent.sdk/package.json from disk.\n4. Open Embodied Agent > Setup Wizard.\n\nEvery Unity dependency used by the SDK is included as a local package folder. No package registry, Bun, OpenCode repository, or cloud model is required.\n`
}

async function findUnityPackage(name: string, version: string) {
  const roots = [
    process.env.EMBODIED_UNITY_PACKAGE_CACHE,
    resolve(repositoryRoot, "vr-avatar/vr-avatar/Library/PackageCache"),
    join(homedir(), "Library/Unity/cache/packages/packages.unity.com"),
  ].filter((value): value is string => Boolean(value))
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.filter((value) => value.isDirectory() && value.name.startsWith(name + "@"))) {
      const directory = resolve(root, entry.name)
      const manifest = await Bun.file(resolve(directory, "package.json")).json().catch(() => undefined)
      if (manifest?.name === name && manifest?.version === version) return directory
    }
  }
}

function defined<T>(value: T | undefined): value is T {
  return value !== undefined
}

async function buildMacInstaller(output: string) {
  if (!Bun.which("pkgbuild")) {
    if (production) throw new Error("Production release requires pkgbuild")
    return
  }
  const root = resolve(packageRoot, "dist/mac-pkg-root")
  const scripts = resolve(packageRoot, "dist/mac-pkg-scripts")
  await rm(root, { recursive: true, force: true })
  await rm(scripts, { recursive: true, force: true })
  await mkdir(resolve(root, "usr/local/lib/embodied-agent"), { recursive: true })
  await mkdir(resolve(root, "usr/local/bin"), { recursive: true })
  await mkdir(resolve(root, "Library/LaunchAgents"), { recursive: true })
  await mkdir(scripts, { recursive: true })
  await cp(resolve(release, "mac-arm64/embodied-agent-runtime"), resolve(root, "usr/local/lib/embodied-agent/embodied-agent-runtime"))
  await cp(resolve(release, "mac-arm64/embodied-replay"), resolve(root, "usr/local/bin/embodied-replay"))
  await Bun.write(resolve(root, "usr/local/bin/embodied-agent-uninstall"), packagedMacUninstaller())
  await chmod(resolve(root, "usr/local/bin/embodied-agent-uninstall"), 0o755)
  await Bun.write(resolve(root, "Library/LaunchAgents/dev.embodied-agent.runtime.plist"), launchAgent())
  await Bun.write(resolve(scripts, "preinstall"), "#!/bin/sh\nset -eu\nTARGET=/usr/local/lib/embodied-agent/embodied-agent-runtime\nif [ -f \"$TARGET\" ]; then cp \"$TARGET\" \"$TARGET.previous\"; fi\nREPLAY=/usr/local/bin/embodied-replay\nif [ -f \"$REPLAY\" ]; then cp \"$REPLAY\" \"$REPLAY.previous\"; fi\n")
  await Bun.write(resolve(scripts, "postinstall"), "#!/bin/sh\nset -eu\nCONSOLE_USER=$(stat -f '%Su' /dev/console)\nif [ \"$CONSOLE_USER\" != root ]; then launchctl bootout gui/$(id -u \"$CONSOLE_USER\") /Library/LaunchAgents/dev.embodied-agent.runtime.plist 2>/dev/null || true; launchctl bootstrap gui/$(id -u \"$CONSOLE_USER\") /Library/LaunchAgents/dev.embodied-agent.runtime.plist; fi\n")
  await chmod(resolve(scripts, "preinstall"), 0o755)
  await chmod(resolve(scripts, "postinstall"), 0o755)
  const args = ["pkgbuild", "--root", root, "--scripts", scripts, "--identifier", "dev.embodied-agent.runtime", "--version", version, ...(installerIdentity ? ["--sign", installerIdentity] : []), output]
  const built = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" })
  if (built.exitCode !== 0) throw new Error("macOS installer build failed")
}

function packagedMacUninstaller() {
  return `#!/bin/sh
set -eu
RUNTIME=/usr/local/lib/embodied-agent/embodied-agent-runtime
REPLAY=/usr/local/bin/embodied-replay
if [ "\${1:-}" = "--rollback" ]; then
  test -f "$RUNTIME.previous" && mv "$RUNTIME.previous" "$RUNTIME"
  test -f "$REPLAY.previous" && mv "$REPLAY.previous" "$REPLAY"
  exit 0
fi
CONSOLE_USER=$(stat -f '%Su' /dev/console)
if [ "$CONSOLE_USER" != root ]; then launchctl bootout gui/$(id -u "$CONSOLE_USER") /Library/LaunchAgents/dev.embodied-agent.runtime.plist 2>/dev/null || true; fi
rm -f "$RUNTIME" "$RUNTIME.previous" "$REPLAY" "$REPLAY.previous" /usr/local/bin/embodied-agent-uninstall /Library/LaunchAgents/dev.embodied-agent.runtime.plist
rmdir /usr/local/lib/embodied-agent 2>/dev/null || true
echo "Removed Embodied Agent Runtime. Local training data was preserved."
`
}

function launchAgent() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>dev.embodied-agent.runtime</string><key>ProgramArguments</key><array><string>/usr/local/lib/embodied-agent/embodied-agent-runtime</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>5</integer><key>ProcessType</key><string>Interactive</string></dict></plist>\n`
}

function publicKey(privateKey: string) {
  return createPublicKey(createPrivateKey(privateKey)).export({ type: "spki", format: "pem" }).toString()
}

async function signedPayload(payload: Record<string, unknown>, keyPath?: string) {
  if (!keyPath) return { ...payload, signature: null }
  const privateKey = createPrivateKey(await Bun.file(keyPath).text())
  const serialized = JSON.stringify(payload)
  const algorithm = privateKey.asymmetricKeyType === "ed25519" || privateKey.asymmetricKeyType === "ed448" ? null : "sha256"
  const key = createPublicKey(privateKey).export({ type: "spki", format: "der" })
  return {
    ...payload,
    signature: {
      algorithm: algorithm ?? privateKey.asymmetricKeyType ?? "ed25519",
      publicKeyFingerprint: createHash("sha256").update(key).digest("hex"),
      value: sign(algorithm, Buffer.from(serialized), privateKey).toString("base64"),
    },
  }
}
