import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const skipBuild = process.argv.includes("--skip-build")
const checkUnity = process.argv.includes("--unity")
const commands = [
  { name: "App typecheck", cwd: "packages/app", command: ["bun", "typecheck"] },
  { name: "Desktop typecheck", cwd: "packages/desktop", command: ["bun", "typecheck"] },
  { name: "OpenCode typecheck", cwd: "packages/opencode", command: ["bun", "typecheck"] },
  {
    name: "Avatar protocol and state",
    cwd: "packages/desktop",
    command: ["bun", "test", "src/main/avatar-bridge-protocol.test.ts", "src/main/avatar-bridge-state.test.ts", "src/main/avatar-bridge-lan.test.ts"],
  },
  {
    name: "Avatar loopback smoke and 100-cycle reconnect",
    cwd: "packages/desktop",
    command: ["bun", "test", "src/main/avatar-bridge.test.ts"],
  },
  {
    name: "Chat game-tool policy",
    cwd: "packages/opencode",
    command: ["bun", "test", "test/session/chat-mode.test.ts"],
  },
]

for (const item of commands) {
  console.log(`\n[Jarvis] ${item.name}`)
  const result = Bun.spawnSync(item.command, { cwd: resolve(root, item.cwd), stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

const unityFiles = [
  "integrations/unity/com.opencode.customs.avatar-bridge/package.json",
  "integrations/unity/com.opencode.customs.avatar-bridge/Runtime/AvatarProtocol.cs",
  "integrations/unity/com.opencode.customs.avatar-bridge/Samples~/JarvisLab/Editor/JarvisLabSceneBuilder.cs",
  "integrations/unity/com.opencode.customs.avatar-bridge/Samples~/JarvisLab/Runtime/JarvisLabCapabilities.cs",
  "integrations/unity/com.opencode.customs.avatar-bridge/Samples~/JarvisLab/Scenarios/vertical-slice.jsonl",
]
const missing = unityFiles.filter((file) => !existsSync(resolve(root, file)))
if (missing.length > 0) {
  console.error(`[Jarvis] Unity package is incomplete:\n${missing.join("\n")}`)
  process.exit(1)
}
const manifest = await Bun.file(resolve(root, unityFiles[0])).json()
if (manifest.version !== "2.1.0" || !manifest.samples?.some((sample: { path?: string }) => sample.path === "Samples~/JarvisLab")) {
  console.error("[Jarvis] Unity package manifest does not expose Jarvis Lab v2.1")
  process.exit(1)
}
console.log("\n[Jarvis] Unity UPM manifest and vertical-slice assets are present")

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
    console.error("[Jarvis] Unity 6 was not found. Set OPENCODE_UNITY_EDITOR to the Unity executable.")
    process.exit(1)
  }

  const project = mkdtempSync(join(tmpdir(), "opencode-jarvis-unity-"))
  const runUnity = (name: string, args: string[]) => {
    console.log(`\n[Jarvis] ${name}`)
    const result = Bun.spawnSync([editor, "-batchmode", "-nographics", ...args], { stdout: "inherit", stderr: "inherit" })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  }

  runUnity("Creating Unity 6 validation project", ["-createProject", project, "-quit", "-logFile", "-"])
  const unityManifest = await Bun.file(join(project, "Packages/manifest.json")).json()
  await Bun.write(
    join(project, "Packages/manifest.json"),
    JSON.stringify(
      {
        ...unityManifest,
        testables: ["com.opencode.customs.avatar-bridge"],
        dependencies: {
          ...unityManifest.dependencies,
          "com.opencode.customs.avatar-bridge": `file:${resolve(root, "integrations/unity/com.opencode.customs.avatar-bridge")}`,
          "com.unity.test-framework": "1.6.0",
        },
      },
      null,
      2,
    ),
  )
  mkdirSync(join(project, "Assets"), { recursive: true })
  cpSync(resolve(root, "integrations/unity/com.opencode.customs.avatar-bridge/Samples~/JarvisLab"), join(project, "Assets/JarvisLab"), {
    recursive: true,
  })
  runUnity("Compiling Avatar Bridge and Jarvis Lab", ["-projectPath", project, "-quit", "-logFile", "-"])
  runUnity("Generating Jarvis Lab scene", [
    "-projectPath",
    project,
    "-executeMethod",
    "OpenCode.Customs.AvatarBridge.JarvisLab.Editor.JarvisLabSceneBuilder.Create",
    "-quit",
    "-logFile",
    "-",
  ])
  runUnity("Running Unity EditMode tests", [
    "-projectPath",
    project,
    "-runTests",
    "-testPlatform",
    "editmode",
    "-testResults",
    join(project, "editmode.xml"),
    "-logFile",
    "-",
  ])
  runUnity("Running Unity PlayMode tests", [
    "-projectPath",
    project,
    "-runTests",
    "-testPlatform",
    "playmode",
    "-testResults",
    join(project, "playmode.xml"),
    "-logFile",
    "-",
  ])
  console.log(`\n[Jarvis] Unity 6 validation artifacts: ${project}`)
}

if (!skipBuild) {
  console.log("\n[Jarvis] Building OpenCode Customs renderer and main process")
  const result = Bun.spawnSync(["bun", "run", "build"], {
    cwd: resolve(root, "packages/desktop"),
    env: { ...process.env, OPENCODE_CHANNEL: "dev", OPENCODE_ICON_CHANNEL: "customs" },
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

console.log("\n[Jarvis] Critical checks passed")
