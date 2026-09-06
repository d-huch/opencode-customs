import { createHash } from "node:crypto"
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import type { RuntimeConfig } from "./config"
import type { ReplayEvaluation } from "./replay"

export async function createDiagnosticsBundle(input: {
  stateDirectory: string
  startedAt: number
  config?: RuntimeConfig
  bridge: Record<string, unknown>
  model: Record<string, unknown>
  replay?: ReplayEvaluation
  supervisor?: Record<string, unknown>
  retention?: Record<string, unknown>
  xapi?: Record<string, unknown>
}) {
  const files = await inventory(input.stateDirectory)
  const payload = {
    format: "embodied-agent-diagnostics-v1",
    generatedAt: new Date().toISOString(),
    runtime: { platform: process.platform, architecture: process.arch, bun: Bun.version, uptimeMs: Date.now() - input.startedAt },
    configuration: input.config ? {
      providerID: input.config.providerID,
      baseURL: input.config.baseURL,
      modelID: input.config.modelID,
      voice: {
        transcription: Boolean(input.config.speech?.transcription),
        synthesis: Boolean(input.config.speech?.synthesis),
      },
    } : { status: "unconfigured" },
    bridge: input.bridge,
    model: input.model,
    replay: input.replay ?? { status: "not_evaluated" },
    supervisor: input.supervisor ?? { status: "unknown" },
    retention: input.retention ?? { status: "unknown" },
    xapi: input.xapi ?? { configured: false },
    stateFiles: files,
  }
  return {
    ...payload,
    sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  }
}

async function inventory(directory: string) {
  const names = await readdir(directory).catch(() => [])
  return Promise.all(names.filter((name) => !/(control|token|secret|audio|prompt|transcript|password)/i.test(name)).map(async (name) => {
    const value = await stat(join(directory, name)).catch(() => undefined)
    return { name, kind: value?.isDirectory() ? "directory" : "file", bytes: value?.isFile() ? value.size : undefined }
  }))
}
