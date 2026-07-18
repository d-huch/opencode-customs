import path from "path"
import { Schema } from "effect"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { Glob } from "@opencode-ai/core/util/glob"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"

const CACHE_TTL = 5_000
const MANIFEST = ".codex-plugin/plugin.json"

export const Source = Schema.Literals(["installed", "repository", "personal"])
export type Source = typeof Source.Type

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  displayName: Schema.String,
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  location: Schema.String,
  source: Source,
  enabled: Schema.Boolean,
  skills: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  mcp: Schema.Boolean,
  apps: Schema.Boolean,
  hooks: Schema.Boolean,
}).annotate({ identifier: "ExtensionPlugin" })
export type Info = typeof Info.Type

export const SkillInfo = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
}).annotate({ identifier: "ExtensionSkill" })

export const Overview = Schema.Struct({
  plugins: Schema.Array(Info),
  skills: Schema.Array(SkillInfo),
}).annotate({ identifier: "ExtensionOverview" })

type Bundle = Info & {
  skillDirectory?: string
  mcpFile?: string
}

type ManifestData = {
  name: string
  version?: string
  description?: string
  skills?: string
  mcpServers?: string
  apps?: string
  hooks?: string
  interface?: {
    displayName?: string
    shortDescription?: string
  }
}

type Input = {
  home: string
  worktree?: string
  refresh?: boolean
}

const cache = new Map<string, { expires: number; bundles: Bundle[] }>()

export async function list(input: Input) {
  return (await discover(input)).map(({ skillDirectory: _skillDirectory, mcpFile: _mcpFile, ...info }) => info)
}

export async function skillDirectories(input: Input) {
  return (await discover(input)).flatMap((plugin) =>
    plugin.enabled && plugin.skillDirectory ? [plugin.skillDirectory] : [],
  )
}

export async function mcpServers(input: Input) {
  const result: Record<string, ConfigMCPV1.Info> = {}
  for (const plugin of await discover(input)) {
    if (!plugin.enabled || !plugin.mcpFile) continue
    const config = await Filesystem.readJson<unknown>(plugin.mcpFile).catch(() => undefined)
    if (!isRecord(config) || !isRecord(config.mcpServers)) continue

    for (const [name, value] of Object.entries(config.mcpServers)) {
      if (!isRecord(value)) continue
      const key = `${plugin.name}/${name}`
      if (typeof value.command === "string") {
        const args = Array.isArray(value.args)
          ? value.args.filter((item): item is string => typeof item === "string")
          : []
        const environment = isRecord(value.env)
          ? Object.fromEntries(
              Object.entries(value.env).filter((item): item is [string, string] => typeof item[1] === "string"),
            )
          : undefined
        const timeout =
          typeof value.tool_timeout_sec === "number" ? Math.max(1, value.tool_timeout_sec * 1_000) : undefined
        result[key] = {
          type: "local",
          command: [value.command, ...args],
          cwd: typeof value.cwd === "string" ? path.resolve(plugin.location, value.cwd) : plugin.location,
          environment,
          timeout,
        }
        continue
      }

      if (typeof value.url !== "string") continue
      result[key] = {
        type: "remote",
        url: value.url,
        headers: isRecord(value.headers)
          ? Object.fromEntries(
              Object.entries(value.headers).filter((item): item is [string, string] => typeof item[1] === "string"),
            )
          : undefined,
        timeout: typeof value.tool_timeout_sec === "number" ? Math.max(1, value.tool_timeout_sec * 1_000) : undefined,
      }
    }
  }
  return result
}

async function discover(input: Input) {
  const key = `${input.home}\0${input.worktree ?? ""}`
  const hit = cache.get(key)
  if (!input.refresh && hit && hit.expires > Date.now()) return hit.bundles

  const enabled = await readEnabled(input.home)
  const installed = await installedBundles(input.home, enabled)
  const repository = input.worktree
    ? await marketplaceBundles(
        path.join(input.worktree, ".agents/plugins/marketplace.json"),
        input.worktree,
        "repository",
      )
    : []
  const legacyRepository = input.worktree
    ? await marketplaceBundles(
        path.join(input.worktree, ".claude-plugin/marketplace.json"),
        input.worktree,
        "repository",
      )
    : []
  const personal = await marketplaceBundles(
    path.join(input.home, ".agents/plugins/marketplace.json"),
    input.home,
    "personal",
  )
  const bundles = [...installed, ...repository, ...legacyRepository, ...personal].reduce((result, plugin) => {
    const previous = result.get(plugin.id)
    if (!previous || plugin.source === "installed") result.set(plugin.id, plugin)
    return result
  }, new Map<string, Bundle>())
  const value = Array.from(bundles.values()).toSorted((a, b) => a.displayName.localeCompare(b.displayName))
  cache.set(key, { expires: Date.now() + CACHE_TTL, bundles: value })
  return value
}

async function installedBundles(home: string, enabled: Map<string, boolean>) {
  const root = path.join(home, ".codex/plugins/cache")
  const manifests = await Glob.scan(`*/*/*/${MANIFEST}`, {
    cwd: root,
    absolute: true,
    include: "file",
    dot: true,
  }).catch(() => [])
  const result = new Map<string, Bundle>()
  for (const file of manifests.toSorted().toReversed()) {
    const relative = path.relative(root, file).split(path.sep)
    const marketplace = relative[0]
    const plugin = relative[1]
    if (!marketplace || !plugin) continue
    const id = `${plugin}@${marketplace}`
    if (result.has(id)) continue
    const bundle = await readBundle(path.dirname(path.dirname(file)), {
      id,
      source: "installed",
      enabled: enabled.get(id) ?? false,
    })
    if (bundle) result.set(id, bundle)
  }
  return Array.from(result.values())
}

async function marketplaceBundles(file: string, root: string, source: Exclude<Source, "installed">) {
  const data = await Filesystem.readJson<unknown>(file).catch(() => undefined)
  if (!isRecord(data) || !Array.isArray(data.plugins)) return []
  const marketplace = typeof data.name === "string" ? data.name : source
  const result: Bundle[] = []

  for (const entry of data.plugins) {
    if (!isRecord(entry) || typeof entry.name !== "string") continue
    const candidate =
      typeof entry.source === "string"
        ? entry.source
        : isRecord(entry.source) && (entry.source.source === "local" || entry.source.source === undefined)
          ? entry.source.path
          : undefined
    if (typeof candidate !== "string" || !candidate.startsWith("./")) continue
    const location = path.resolve(root, candidate)
    if (!contains(root, location)) continue
    const installation = isRecord(entry.policy) ? entry.policy.installation : undefined
    const bundle = await readBundle(location, {
      id: `${entry.name}@${marketplace}`,
      source,
      enabled: installation === "INSTALLED_BY_DEFAULT",
    })
    if (bundle) result.push(bundle)
  }
  return result
}

async function readBundle(location: string, state: Pick<Bundle, "id" | "source" | "enabled">) {
  const manifest = await Filesystem.readJson<unknown>(path.join(location, MANIFEST)).catch(() => undefined)
  if (!isManifest(manifest)) return
  const skillDirectory = component(location, manifest.skills)
  const mcpFile = component(location, manifest.mcpServers)
  const skills = skillDirectory
    ? await Glob.scan("**/SKILL.md", { cwd: skillDirectory, absolute: true, include: "file", dot: true }).catch(
        () => [],
      )
    : []
  return {
    ...state,
    name: manifest.name,
    displayName: manifest.interface?.displayName ?? manifest.name,
    version: manifest.version,
    description: manifest.interface?.shortDescription ?? manifest.description,
    location,
    skills: skills.length,
    mcp: !!mcpFile,
    apps: !!component(location, manifest.apps),
    hooks: !!component(location, manifest.hooks),
    skillDirectory,
    mcpFile,
  } satisfies Bundle
}

async function readEnabled(home: string) {
  const content = await Filesystem.readText(path.join(home, ".codex/config.toml")).catch(() => "")
  const result = new Map<string, boolean>()
  let plugin: string | undefined
  for (const line of content.split("\n")) {
    const section = line.trim().match(/^\[plugins\."((?:\\.|[^"])*)"\]$/)
    if (section) {
      plugin = section[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\")
      continue
    }
    if (line.trim().startsWith("[")) {
      plugin = undefined
      continue
    }
    if (!plugin) continue
    const value = line.trim().match(/^enabled\s*=\s*(true|false)$/)
    if (value) result.set(plugin, value[1] === "true")
  }
  return result
}

function component(root: string, value: string | undefined) {
  if (!value) return
  const result = path.resolve(root, value)
  if (!contains(root, result)) return
  return result
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isManifest(value: unknown): value is ManifestData {
  if (!isRecord(value) || typeof value.name !== "string") return false
  if (value.version !== undefined && typeof value.version !== "string") return false
  if (value.description !== undefined && typeof value.description !== "string") return false
  if (value.skills !== undefined && typeof value.skills !== "string") return false
  if (value.mcpServers !== undefined && typeof value.mcpServers !== "string") return false
  if (value.apps !== undefined && typeof value.apps !== "string") return false
  if (value.hooks !== undefined && typeof value.hooks !== "string") return false
  if (value.interface !== undefined && !isRecord(value.interface)) return false
  return true
}

export const PluginBundle = {
  Info,
  SkillInfo,
  Overview,
  list,
  skillDirectories,
  mcpServers,
}
