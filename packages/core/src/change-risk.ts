export * as ChangeRisk from "./change-risk"

import path from "path"

export type Category =
  | "documentation"
  | "local_ui"
  | "backend_logic"
  | "database"
  | "permissions_auth"
  | "build_config"
  | "public_api"
  | "dependency_changes"
  | "multi_package_refactor"

export type Level = "low" | "medium" | "high" | "critical"

export type Policy = {
  readonly plan: "optional" | "recommended" | "required"
  readonly maxFiles: number
  readonly verification: "focused" | "extended" | "full"
  readonly critic: boolean
  readonly confirmation: boolean
  readonly autoApply: boolean
}

export type Assessment = {
  readonly level: Level
  readonly score: number
  readonly categories: readonly Category[]
  readonly files: readonly string[]
  readonly reasons: readonly string[]
  readonly policy: Policy
}

export function classify(input: {
  readonly tool: string
  readonly args: unknown
  readonly root?: string
  readonly declared?: boolean
}) {
  const files = targets(input.args, input.root)
  const categories = classifyCategories(files, input.args)
  const destructive = destructiveIntent(input.args)
  const undeclared = input.declared === false
  const packageCount = packageScopes(files).size
  const expanded = packageCount > 1 ? [...categories, "multi_package_refactor" as const] : categories
  const unique = Array.from(new Set(expanded))
  const base = Math.max(...unique.map(weight), 3)
  const score = Math.min(
    10,
    base +
      Number(unique.length > 2) +
      Number(files.length > 5) +
      Number(files.length > 12) +
      Number(destructive) * 3 +
      Number(undeclared) * 3,
  )
  const level = destructive || score >= 9 ? "critical" : score >= 6 ? "high" : score >= 4 ? "medium" : "low"
  const reasons = [
    ...unique.map((category) => reason(category)),
    ...(files.length > 5 ? [`The change targets ${files.length} files.`] : []),
    ...(packageCount > 1 ? [`The change crosses ${packageCount} workspace scopes.`] : []),
    ...(destructive ? ["The requested operation contains destructive or difficult-to-recover behavior."] : []),
    ...(undeclared ? [`The tool "${input.tool}" has no trusted mutation metadata.`] : []),
  ]
  return {
    level,
    score,
    categories: unique,
    files,
    reasons,
    policy: policy(level),
  } satisfies Assessment
}

function classifyCategories(files: readonly string[], args: unknown) {
  const categories = new Set<Category>()
  const normalized = files.map((file) => file.toLowerCase())
  if (normalized.length > 0 && normalized.every(isDocumentation)) categories.add("documentation")
  if (normalized.some(isLocalUI)) categories.add("local_ui")
  if (normalized.some(isDatabase)) categories.add("database")
  if (normalized.some(isPermissionsAuth)) categories.add("permissions_auth")
  if (normalized.some(isDependency)) categories.add("dependency_changes")
  if (normalized.some(isBuildConfig)) categories.add("build_config")
  if (normalized.some(isPublicAPI)) categories.add("public_api")
  if (categories.size === 0) categories.add("backend_logic")
  if (normalized.length === 0 && typeof args === "object") categories.add("backend_logic")
  return Array.from(categories)
}

function targets(value: unknown, root?: string) {
  const found = new Set<string>()
  const visit = (item: unknown, key = ""): void => {
    if (typeof item === "string") {
      if (/patch/i.test(key)) {
        for (const match of item.matchAll(/^(?:\*\*\* (?:Add|Update|Delete) File: |\+\+\+ b\/|--- a\/)(.+)$/gm))
          add(match[1])
      }
      if (/(?:path|file|target|destination|directory|cwd)$/i.test(key)) add(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, key))
      return
    }
    if (!item || typeof item !== "object") return
    Object.entries(item).forEach(([name, entry]) => visit(entry, name))
  }
  const add = (file: string | undefined) => {
    if (!file || file.includes("\n") || file.length > 1024) return
    const resolved = root && path.isAbsolute(file) ? path.relative(root, file) : file
    const normalized = resolved.replaceAll("\\", "/").replace(/^\.\/+/, "")
    if (normalized && normalized !== ".") found.add(normalized)
  }
  visit(value)
  return Array.from(found).sort().slice(0, 100)
}

function packageScopes(files: readonly string[]) {
  const containers = new Set(["apps", "crates", "libs", "modules", "packages", "plugins", "projects", "services"])
  return new Set(
    files
      .map((file) => file.split("/").filter(Boolean))
      .map((parts) =>
        parts.length > 1 && containers.has(parts[0] ?? "") ? `${parts[0]}/${parts[1]}` : parts.length > 0 ? "root" : "",
      )
      .filter(Boolean),
  )
}

function isDocumentation(file: string) {
  return /\.(?:md|mdx|rst|adoc|txt)$/.test(file) || /(?:^|\/)docs?(?:\/|$)/.test(file)
}

function isLocalUI(file: string) {
  return (
    /\.(?:css|scss|sass|less|html|vue|svelte|astro)$/.test(file) ||
    /(?:^|\/)(?:components?|views?|screens?|pages?|ui)(?:\/|$)/.test(file)
  )
}

function isDatabase(file: string) {
  return (
    /\.sql$/.test(file) ||
    /(?:^|\/)(?:database|migrations?|seeds?)(?:\/|$)/.test(file) ||
    /(?:^|[._-])migration(?:[._-]|$)/.test(path.basename(file))
  )
}

function isPermissionsAuth(file: string) {
  return /(?:^|\/)(?:auth|permissions?|policies|security|credentials?|access)(?:\/|$)/.test(file)
}

function isDependency(file: string) {
  return /(?:^|\/)(?:package\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|cargo\.toml|cargo\.lock|go\.mod|go\.sum|composer\.json|composer\.lock|requirements[^/]*\.txt|pyproject\.toml|podfile(?:\.lock)?|packages\.lock\.json)$/.test(
    file,
  )
}

function isBuildConfig(file: string) {
  return (
    /(?:^|\/)(?:\.github|\.gitlab|ci|build|scripts?|config|configs?)(?:\/|$)/.test(file) ||
    /(?:^|\/)(?:dockerfile|makefile|justfile|vite\.config[^/]*|webpack[^/]*|tsconfig[^/]*|electron-builder[^/]*)$/.test(
      file,
    ) ||
    /\.(?:ya?ml|toml)$/.test(file)
  )
}

function isPublicAPI(file: string) {
  return /(?:^|\/)(?:api|protocol|sdk|contracts?|generated|schema)(?:\/|$)/.test(file)
}

function destructiveIntent(value: unknown): boolean {
  const text = strings(value).join("\n")
  return (
    /(?:^|[\s;&|])rm\s+(?:-[^\s]*r|--recursive)/i.test(text) ||
    /\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f)/i.test(text) ||
    /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i.test(text) ||
    /\b(?:delete|remove)\b[\s\S]{0,40}\b(?:all|recursive|force)\b/i.test(text)
  )
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (!value || typeof value !== "object") return []
  return Object.values(value).flatMap(strings)
}

function weight(category: Category) {
  if (category === "documentation") return 1
  if (category === "local_ui") return 2
  if (category === "backend_logic") return 4
  if (category === "build_config") return 4
  if (category === "database") return 6
  if (category === "permissions_auth") return 7
  if (category === "public_api") return 6
  if (category === "dependency_changes") return 6
  return 8
}

function policy(level: Level): Policy {
  if (level === "low")
    return {
      plan: "optional",
      maxFiles: 3,
      verification: "focused",
      critic: false,
      confirmation: false,
      autoApply: true,
    }
  if (level === "medium")
    return {
      plan: "recommended",
      maxFiles: 6,
      verification: "focused",
      critic: false,
      confirmation: false,
      autoApply: true,
    }
  if (level === "high")
    return {
      plan: "required",
      maxFiles: 10,
      verification: "extended",
      critic: true,
      confirmation: true,
      autoApply: false,
    }
  return {
    plan: "required",
    maxFiles: 20,
    verification: "full",
    critic: true,
    confirmation: true,
    autoApply: false,
  }
}

function reason(category: Category) {
  if (category === "documentation") return "Only documentation artifacts are affected."
  if (category === "local_ui") return "User-interface artifacts are affected."
  if (category === "backend_logic") return "Executable application logic is affected."
  if (category === "database") return "Database schema, migration, or query artifacts are affected."
  if (category === "permissions_auth") return "Authorization, authentication, or access-control artifacts are affected."
  if (category === "build_config") return "Build, automation, or runtime configuration is affected."
  if (category === "public_api") return "A public contract, protocol, schema, or generated client may be affected."
  if (category === "dependency_changes") return "Dependency resolution or package manifests are affected."
  return "The change crosses independently deployable workspace scopes."
}
