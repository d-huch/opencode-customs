import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

const service = "dev.embodied-agent.runtime"

export async function writeProtectedSecret(stateDirectory: string, account: string, value: string) {
  if (process.platform === "darwin") {
    const result = Bun.spawnSync(["security", "add-generic-password", "-U", "-a", account, "-s", service, "-w", value], { stdout: "ignore", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error("macOS Keychain rejected the credential")
    return
  }
  if (process.platform === "win32") {
    const directory = join(stateDirectory, "secrets")
    const path = join(directory, account + ".dpapi")
    await mkdir(directory, { recursive: true })
    const script = "$value=[Convert]::FromBase64String($env:EMBODIED_SECRET_INPUT);$data=[Security.Cryptography.ProtectedData]::Protect($value,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[IO.File]::WriteAllBytes($env:EMBODIED_SECRET_PATH,$data)"
    const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, EMBODIED_SECRET_INPUT: Buffer.from(value).toString("base64"), EMBODIED_SECRET_PATH: path },
      stdout: "ignore", stderr: "pipe",
    })
    if (result.exitCode !== 0) throw new Error("Windows DPAPI rejected the credential")
    return
  }
  throw new Error("OS-protected credential storage is unavailable on this platform")
}

export async function readProtectedSecret(stateDirectory: string, account: string) {
  if (process.platform === "darwin") {
    const result = Bun.spawnSync(["security", "find-generic-password", "-a", account, "-s", service, "-w"], { stdout: "pipe", stderr: "ignore" })
    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined
  }
  if (process.platform === "win32") {
    const path = join(stateDirectory, "secrets", account + ".dpapi")
    if (!(await Bun.file(path).exists())) return
    const script = "$data=[IO.File]::ReadAllBytes($env:EMBODIED_SECRET_PATH);$value=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($value))"
    const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, EMBODIED_SECRET_PATH: path }, stdout: "pipe", stderr: "ignore",
    })
    return result.exitCode === 0 ? Buffer.from(result.stdout.toString(), "base64").toString() : undefined
  }
}

export async function deleteProtectedSecret(stateDirectory: string, account: string) {
  if (process.platform === "darwin") {
    Bun.spawnSync(["security", "delete-generic-password", "-a", account, "-s", service], { stdout: "ignore", stderr: "ignore" })
    return
  }
  if (process.platform === "win32") await rm(join(stateDirectory, "secrets", account + ".dpapi"), { force: true })
}

