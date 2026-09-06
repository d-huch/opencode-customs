import { generateKeyPairSync } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const checkUnity = process.argv.includes("--unity")
const checkQuest = process.argv.includes("--quest")
const checkBeta = process.argv.includes("--beta")
const checkAITrainee = process.argv.includes("--ai-trainee")
const checkValidateTraining = process.argv.includes("--validate-training")
const buildRuntime = process.argv.includes("--build")
if (checkQuest && !checkUnity) {
  console.error("[Embodied Agent] --quest requires --unity")
  process.exit(1)
}
const commands = [
  { name: "Runtime typecheck", cwd: "packages/embodied-runtime", command: ["bun", "typecheck"] },
  { name: "Replay reliability gate", cwd: "packages/embodied-runtime", command: ["bun", "test"] },
  { name: "Bridge typecheck", cwd: "packages/desktop", command: ["bun", "typecheck"] },
  {
    name: "Bridge protocol and reconnect",
    cwd: "packages/desktop",
    command: ["bun", "test", "src/main/avatar-bridge-protocol.test.ts", "src/main/avatar-bridge.test.ts"],
  },
]

for (const item of commands) {
  console.log(`\n[Embodied Agent] ${item.name}`)
  const result = Bun.spawnSync(item.command, { cwd: resolve(root, item.cwd), stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

const packageRoot = resolve(root, "integrations/unity/com.embodiedagent.sdk")
const required = [
  "package.json",
  "LICENSE.md",
  "EULA-BETA.md",
  "Runtime/EmbodiedAgentClient.cs",
  "Runtime/AvatarProtocol.cs",
  "Runtime/EmbodiedScenario.cs",
  "Runtime/TrainingResults.cs",
  "Runtime/EmbodiedDemonstration.cs",
  "Editor/EmbodiedAgentSetupWizard.cs",
  "Editor/EmbodiedScenarioStudio.cs",
  "Editor/DemonstrationReviewWizard.cs",
  "Editor/AITraineeTestWindow.cs",
  "Editor/ScenarioValidationWindow.cs",
  "Runtime/ScenarioTestEnvironment.cs",
  "Tests/Editor/EmbodiedScenarioTests.cs",
  "Tests/Runtime/EmbodiedScenarioRunnerTests.cs",
  "Documentation~/quickstart.md",
  "Documentation~/capability-cookbook.md",
  "Documentation~/error-catalog.md",
  "Documentation~/compatibility.md",
  "Documentation~/migration.md",
  "Documentation~/security-and-data.md",
  "Documentation~/api-reference.md",
  "Documentation~/api-baseline-0.2.json",
  "Documentation~/api-baseline-0.3.json",
  "Documentation~/threat-model.md",
  "Documentation~/retention.md",
  "Documentation~/instructor-console.md",
  "Documentation~/teach-by-demo.md",
  "Documentation~/ai-trainee.md",
  "Documentation~/validate-training.md",
  "Samples~/SafetyInstructor/Editor/SafetyInstructorSceneBuilder.cs",
  "Samples~/SafetyInstructor/Editor/DemonstrationReviewAutoOpen.cs",
  "Samples~/SafetyInstructor/Editor/PilotQuestBuild.cs",
  "Samples~/SafetyInstructor/Runtime/SafetyCapabilities.cs",
  "Samples~/SafetyInstructor/Runtime/SafetyInstructorHUD.cs",
  "Samples~/SafetyInstructor/Runtime/SafetyTrainingInteraction.cs",
  "Samples~/SafetyInstructor/Scenarios/equipment-isolation.jsonl",
]
const missing = required.filter((file) => !existsSync(resolve(packageRoot, file)))
if (missing.length > 0) {
  console.error(`[Embodied Agent] Unity package is incomplete:\n${missing.join("\n")}`)
  process.exit(1)
}
const manifest = await Bun.file(resolve(packageRoot, "package.json")).json()
  if (manifest.name !== "com.embodiedagent.sdk" || manifest.version !== "0.4.0-beta.2") {
  console.error("[Embodied Agent] Unity package identity is invalid")
  process.exit(1)
}
const runtimeSource = await Bun.file(resolve(packageRoot, "Runtime/EmbodiedAgentClient.cs")).text()
if (!runtimeSource.includes("namespace EmbodiedAgent.Unity") || runtimeSource.includes("namespace OpenCode.Customs")) {
  console.error("[Embodied Agent] Public Unity runtime is not product-isolated")
  process.exit(1)
}
const protocolSource = await Bun.file(resolve(packageRoot, "Runtime/AvatarProtocol.cs")).text()
if (!protocolSource.includes("public const int Minor = 12")) {
  console.error("[Embodied Agent] Public Unity protocol is not v2.12")
  process.exit(1)
}
const scenarioSource = await Bun.file(resolve(packageRoot, "Runtime/EmbodiedScenario.cs")).text()
if (!scenarioSource.includes("public const int CurrentSchemaVersion = 1")) {
  console.error("[Embodied Agent] EmbodiedScenario manifest schema v1 is not frozen")
  process.exit(1)
}
const baseline = await Bun.file(resolve(packageRoot, "Documentation~/api-baseline-0.2.json")).json() as {
  symbols: { file: string; declaration: string }[]
}
const missingSymbols = baseline.symbols.filter((symbol) =>
  !readFileSync(resolve(packageRoot, "Runtime", symbol.file), "utf8").includes(symbol.declaration),
)
if (missingSymbols.length > 0) {
  console.error(`[Embodied Agent] Public 0.2 API compatibility failed:\n${missingSymbols.map((symbol) => `${symbol.file}: ${symbol.declaration}`).join("\n")}`)
  process.exit(1)
}
const betaBaseline = await Bun.file(resolve(packageRoot, "Documentation~/api-baseline-0.3.json")).json() as typeof baseline
const missingBetaSymbols = betaBaseline.symbols.filter((symbol) =>
  !readFileSync(resolve(packageRoot, "Runtime", symbol.file), "utf8").includes(symbol.declaration),
)
if (missingBetaSymbols.length > 0) {
  console.error(`[Embodied Agent] Public 0.3 API compatibility failed:\n${missingBetaSymbols.map((symbol) => `${symbol.file}: ${symbol.declaration}`).join("\n")}`)
  process.exit(1)
}
const editorLeak = readdirSync(resolve(packageRoot, "Runtime"))
  .filter((file) => file.endsWith(".cs"))
  .find((file) => readFileSync(resolve(packageRoot, "Runtime", file), "utf8").includes("using UnityEditor"))
if (editorLeak) {
  console.error(`[Embodied Agent] Runtime file depends on UnityEditor: ${editorLeak}`)
  process.exit(1)
}
console.log("\n[Embodied Agent] Public SDK manifest, schema v1, v2.12 contract, 0.2/0.3 API compatibility, Validate Training, Teach-by-Demo, AI Trainee, supervised training, docs, sample, and Beta license are present")

const checkOutput = process.env.EMBODIED_CHECK_OUTPUT ?? mkdtempSync(join(tmpdir(), "embodied-agent-gate-"))
mkdirSync(checkOutput, { recursive: true })
const auditKey = join(checkOutput, "audit-private.pem")
const keyPair = generateKeyPairSync("ed25519")
writeFileSync(auditKey, keyPair.privateKey.export({ type: "pkcs8", format: "pem" }))
const replayGate = Bun.spawnSync([
  "bun", "run", "src/replay-cli.ts", "fixtures/equipment-isolation-happy.json",
  "--json", join(checkOutput, "replay.json"),
  "--junit", join(checkOutput, "replay.junit.xml"),
  "--audit", join(checkOutput, "replay.audit.json"),
  "--sign-key", auditKey,
], { cwd: resolve(root, "packages/embodied-runtime"), stdout: "inherit", stderr: "inherit" })
if (replayGate.exitCode !== 0) process.exit(replayGate.exitCode)
const replayAudit = await Bun.file(join(checkOutput, "replay.audit.json")).json()
if (!replayAudit.signature?.value || replayAudit.events?.length === 0) {
  console.error("[Embodied Agent] Replay gate did not produce a signed audit bundle")
  process.exit(1)
}
console.log(`[Embodied Agent] JSON, JUnit and signed audit outputs: ${checkOutput}`)
const supervisedGate = Bun.spawnSync([
  "bun", "run", "src/replay-cli.ts", "fixtures/instructor-supervised.json",
  "--json", join(checkOutput, "instructor.json"),
  "--junit", join(checkOutput, "instructor.junit.xml"),
  "--audit", join(checkOutput, "instructor.audit.json"),
  "--sign-key", auditKey,
], { cwd: resolve(root, "packages/embodied-runtime"), stdout: "inherit", stderr: "inherit" })
if (supervisedGate.exitCode !== 0) process.exit(supervisedGate.exitCode)
const supervisedAudit = await Bun.file(join(checkOutput, "instructor.audit.json")).json()
if (!supervisedAudit.signature?.value || supervisedAudit.events?.length === 0) {
  console.error("[Embodied Agent] Supervised instructor gate did not produce a signed audit bundle")
  process.exit(1)
}

if (checkAITrainee) {
  const aiGate = Bun.spawnSync(["bun", "test", "test/ai-trainee.test.ts", "test/replay.test.ts"], {
    cwd: resolve(root, "packages/embodied-runtime"), stdout: "inherit", stderr: "inherit",
  })
  if (aiGate.exitCode !== 0) process.exit(aiGate.exitCode)
  console.log("[Embodied Agent] AI Trainee decision, permission, Replay, and fixture gates passed")
}

if (checkValidateTraining) {
  const validationTests = Bun.spawnSync(["bun", "test", "test/validation.test.ts", "test/replay.test.ts"], {
    cwd: resolve(root, "packages/embodied-runtime"), stdout: "inherit", stderr: "inherit",
  })
  if (validationTests.exitCode !== 0) process.exit(validationTests.exitCode)
  const validationGate = Bun.spawnSync([
    "bun", "run", "src/validation-cli.ts", "fixtures/equipment-isolation-quality.json",
    "--json", join(checkOutput, "validate-training.json"),
    "--html", join(checkOutput, "validate-training.html"),
    "--junit", join(checkOutput, "validate-training.junit.xml"),
  ], { cwd: resolve(root, "packages/embodied-runtime"), stdout: "inherit", stderr: "inherit" })
  if (validationGate.exitCode !== 0) process.exit(validationGate.exitCode)
  console.log("[Embodied Agent] Validate Training orchestration, qualification, report and Replay gates passed")
}

if (checkUnity) {
  const configured = process.env.OPENCODE_UNITY_EDITOR
  const hubs = "/Applications/Unity/Hub/Editor"
  const detected = existsSync(hubs)
    ? readdirSync(hubs)
        .filter((version) => version.startsWith("6000."))
        .sort((left, right) => Number(right.includes("f")) - Number(left.includes("f")) || right.localeCompare(left))
        .map((version) => join(hubs, version, "Unity.app/Contents/MacOS/Unity"))
        .find(existsSync)
    : undefined
  const editor = configured || detected
  if (!editor || !existsSync(editor)) {
    console.error("[Embodied Agent] Unity 6 was not found. Set OPENCODE_UNITY_EDITOR.")
    process.exit(1)
  }
  const project = mkdtempSync(join(tmpdir(), "embodied-agent-unity-"))
  const runUnity = (name: string, args: string[], environment: Record<string, string> = {}) => {
    console.log(`\n[Embodied Agent] ${name}`)
    const result = Bun.spawnSync([editor, "-batchmode", "-nographics", ...args], {
      env: { ...process.env, ...environment }, stdout: "inherit", stderr: "inherit",
    })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  }
  runUnity("Creating clean Unity project", ["-createProject", project, "-quit", "-logFile", "-"])
  const unityManifest = await Bun.file(join(project, "Packages/manifest.json")).json()
  await Bun.write(join(project, "Packages/manifest.json"), JSON.stringify({
    ...unityManifest,
    dependencies: {
      ...unityManifest.dependencies,
      "com.embodiedagent.sdk": `file:${packageRoot}`,
    },
    testables: [...new Set([...(unityManifest.testables ?? []), "com.embodiedagent.sdk"])],
  }, null, 2))
  mkdirSync(join(project, "Assets"), { recursive: true })
  cpSync(resolve(packageRoot, "Samples~/SafetyInstructor"), join(project, "Assets/SafetyInstructor"), { recursive: true })
  runUnity("Compiling SDK and Safety Instructor", ["-projectPath", project, "-quit", "-logFile", "-"])
  runUnity("Running SDK EditMode tests", [
    "-projectPath", project, "-runTests", "-testPlatform", "EditMode",
    "-testResults", join(project, "editmode-results.xml"), "-logFile", "-",
  ])
  runUnity("Running SDK PlayMode tests", [
    "-projectPath", project, "-runTests", "-testPlatform", "PlayMode",
    "-testResults", join(project, "playmode-results.xml"), "-logFile", "-",
  ])
  runUnity("Generating Equipment Isolation scene", [
    "-projectPath", project,
    "-executeMethod", "EmbodiedAgent.SafetyInstructor.Editor.SafetyInstructorSceneBuilder.Create",
    "-quit", "-logFile", "-",
  ])
  if (checkQuest) {
    const questApk = resolve(root, "packages/embodied-runtime/dist/quest/Embodied-Agent-Safety-Instructor.apk")
    mkdirSync(resolve(questApk, ".."), { recursive: true })
    runUnity("Configuring Quest 3 pilot", [
      "-projectPath", project, "-buildTarget", "Android",
      "-executeMethod", "EmbodiedAgent.SafetyInstructor.Editor.PilotQuestBuild.Configure",
      "-quit", "-logFile", "-",
    ])
    runUnity("Building Quest 3 development APK", [
      "-projectPath", project, "-buildTarget", "Android",
      "-executeMethod", "EmbodiedAgent.SafetyInstructor.Editor.PilotQuestBuild.BuildFromCommandLine",
      "-quit", "-logFile", "-",
    ], { EMBODIED_QUEST_APK: questApk })
    console.log(`[Embodied Agent] Quest development APK: ${questApk}`)
  }
  console.log(`\n[Embodied Agent] Unity validation artifacts: ${project}`)
}

if (buildRuntime) {
  for (const [name, command] of [
    ["macOS ARM64 Runtime", ["bun", "run", "build:mac"]],
    ["macOS ARM64 Replay CLI", ["bun", "run", "build:replay:mac"]],
    ["Windows x64 Runtime", ["bun", "run", "build:win"]],
    ["Windows x64 Replay CLI", ["bun", "run", "build:replay:win"]],
  ] as const) {
    console.log(`\n[Embodied Agent] Building ${name}`)
    const result = Bun.spawnSync(command, {
      cwd: resolve(root, "packages/embodied-runtime"),
      stdout: "inherit",
      stderr: "inherit",
    })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  }
  console.log("\n[Embodied Agent] Packaging installers, UPM archive, checksums, and SBOM")
  const packaged = Bun.spawnSync(["bun", "run", checkBeta ? "package:beta" : "package:alpha"], {
    cwd: resolve(root, "packages/embodied-runtime"), stdout: "inherit", stderr: "inherit",
  })
  if (packaged.exitCode !== 0) process.exit(packaged.exitCode)
}

if (checkBeta) {
  const required = [
    "EMBODIED_CODESIGN_IDENTITY", "EMBODIED_INSTALLER_IDENTITY", "EMBODIED_NOTARY_PROFILE",
    "EMBODIED_AUDIT_SIGNING_KEY", "EMBODIED_UPDATE_SIGNING_KEY", "EMBODIED_WINDOWS_MSI",
    "EMBODIED_WINDOWS_VALIDATION_REPORT", "EMBODIED_QUEST_SOAK_REPORT", "EMBODIED_DEPENDENCY_SCAN_REPORT",
  ]
  const missing = required.filter((name) => !process.env[name])
  const partners = Number(process.env.EMBODIED_PAID_DESIGN_PARTNERS ?? 0)
  const onboarding = Number(process.env.EMBODIED_CLEAN_ONBOARDING_MINUTES ?? Number.POSITIVE_INFINITY)
  if (missing.length || partners < 2 || onboarding > 30) {
    console.error("[Embodied Agent] Beta release gate is blocked")
    if (missing.length) console.error("  Missing evidence or credentials: " + missing.join(", "))
    if (partners < 2) console.error("  Paid design partners: " + partners + "/2")
    if (onboarding > 30) console.error("  Clean onboarding must be 30 minutes or less")
    process.exit(1)
  }
  console.log("[Embodied Agent] Beta commercial, signing, Windows, Quest and onboarding evidence is present")
}
console.log(`\n[Embodied Agent] ${checkBeta ? "Beta" : "Alpha"} reliability checks passed`)
