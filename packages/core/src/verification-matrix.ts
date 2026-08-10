export * as VerificationMatrix from "./verification-matrix"

import { ChangeRisk } from "./change-risk"

export type Kind =
  | "formatter"
  | "typecheck"
  | "unit_test"
  | "feature_test"
  | "component_test"
  | "migration_validation"
  | "build"
  | "lint"
  | "api_contract_generation"
  | "screenshot_comparison"
  | "git_diff_inspection"

export type Requirement = "required" | "conditional"

export type Selection = {
  readonly kind: Kind
  readonly requirement: Requirement
  readonly files: readonly string[]
  readonly reasons: readonly string[]
}

export type Plan = {
  readonly depth: ChangeRisk.Policy["verification"]
  readonly files: readonly string[]
  readonly categories: readonly ChangeRisk.Category[]
  readonly checks: readonly Selection[]
  readonly rationale: string
}

export type Coverage = {
  readonly unrelated: readonly Kind[]
  readonly missing: readonly Selection[]
  readonly requiredOmissions: readonly Selection[]
}

export function select(input: {
  readonly files: readonly string[]
  readonly risk?: ChangeRisk.Assessment
}) {
  const files = Array.from(new Set(input.files.map(normalize).filter(Boolean))).sort()
  const risk =
    input.risk ??
    ChangeRisk.classify({
      tool: "verification",
      args: { target: files },
      declared: true,
    })
  const candidates: {
    readonly kind: Kind
    readonly requirement: Requirement
    readonly files: readonly string[]
    readonly reason: string
  }[] = [
    {
      kind: "git_diff_inspection",
      requirement: "required",
      files,
      reason: "Every mutation needs a final inspection for unintended or malformed changes.",
    },
    ...(risk.categories.includes("documentation")
      ? [
          {
            kind: "formatter" as const,
            requirement: "conditional" as const,
            files: matching(files, isDocumentation),
            reason: "Documentation formatting should be checked when the repository provides a focused formatter.",
          },
        ]
      : []),
    ...(risk.categories.includes("local_ui")
      ? [
          {
            kind: "component_test" as const,
            requirement: "required" as const,
            files: matching(files, isLocalUI),
            reason: "The changed user-interface behavior needs focused component coverage.",
          },
          {
            kind: "screenshot_comparison" as const,
            requirement: "conditional" as const,
            files: matching(files, isVisual),
            reason: "Visible UI output should be compared when a screenshot baseline or render workflow exists.",
          },
        ]
      : []),
    ...(risk.categories.includes("backend_logic")
      ? [
          {
            kind: "unit_test" as const,
            requirement: "required" as const,
            files,
            reason: "Executable logic needs the narrowest unit test covering the changed behavior.",
          },
          {
            kind: "typecheck" as const,
            requirement: "conditional" as const,
            files,
            reason: "Static type validation is relevant when the affected package provides it.",
          },
        ]
      : []),
    ...(risk.categories.includes("database")
      ? [
          {
            kind: "migration_validation" as const,
            requirement: "required" as const,
            files: matching(files, isDatabase),
            reason: "Database artifacts require validation of migration or schema compatibility.",
          },
          {
            kind: "feature_test" as const,
            requirement: "required" as const,
            files,
            reason: "Database behavior should be exercised through the smallest relevant integration boundary.",
          },
        ]
      : []),
    ...(risk.categories.includes("permissions_auth")
      ? [
          {
            kind: "unit_test" as const,
            requirement: "required" as const,
            files,
            reason: "Access-control decisions need focused allow and deny coverage.",
          },
          {
            kind: "feature_test" as const,
            requirement: "required" as const,
            files,
            reason: "Authorization changes need verification at the externally observable boundary.",
          },
        ]
      : []),
    ...(risk.categories.includes("build_config")
      ? [
          {
            kind: "build" as const,
            requirement: "required" as const,
            files: matching(files, isBuildConfig),
            reason: "Build or runtime configuration must be exercised by the affected build target.",
          },
          {
            kind: "lint" as const,
            requirement: "conditional" as const,
            files,
            reason: "Configuration linting is relevant when the repository exposes a focused command.",
          },
        ]
      : []),
    ...(risk.categories.includes("public_api")
      ? [
          {
            kind: "api_contract_generation" as const,
            requirement: "required" as const,
            files: matching(files, isPublicAPI),
            reason: "Public contract changes must regenerate or validate their derived API artifacts.",
          },
          {
            kind: "typecheck" as const,
            requirement: "required" as const,
            files,
            reason: "Public contracts need consumer-facing static compatibility validation.",
          },
        ]
      : []),
    ...(risk.categories.includes("dependency_changes")
      ? [
          {
            kind: "build" as const,
            requirement: "required" as const,
            files,
            reason: "Dependency changes must prove that the affected target still resolves and builds.",
          },
          {
            kind: "lint" as const,
            requirement: "conditional" as const,
            files,
            reason: "Manifest or lockfile validation should run when a focused repository command exists.",
          },
        ]
      : []),
    ...(risk.categories.includes("multi_package_refactor")
      ? [
          {
            kind: "typecheck" as const,
            requirement: "required" as const,
            files,
            reason: "Cross-package changes need compatibility validation across affected package boundaries.",
          },
          {
            kind: "build" as const,
            requirement: "required" as const,
            files,
            reason: "The smallest build spanning the affected packages must still compose successfully.",
          },
        ]
      : []),
    ...(risk.policy.verification === "full"
      ? [
          {
            kind: "lint" as const,
            requirement: "conditional" as const,
            files,
            reason: "Critical changes warrant the affected scope's focused static policy checks.",
          },
        ]
      : []),
  ]
  const checks = Array.from(new Set(candidates.map((candidate) => candidate.kind))).map((kind) => {
    const matches = candidates.filter((candidate) => candidate.kind === kind)
    return {
      kind,
      requirement: matches.some((candidate) => candidate.requirement === "required") ? "required" : "conditional",
      files: Array.from(new Set(matches.flatMap((candidate) => candidate.files))).sort(),
      reasons: Array.from(new Set(matches.map((candidate) => candidate.reason))),
    } satisfies Selection
  })
  return {
    depth: risk.policy.verification,
    files,
    categories: risk.categories,
    checks,
    rationale: `Selected ${checks.length} minimal check type${checks.length === 1 ? "" : "s"} for ${risk.categories.join(", ")} artifacts at ${risk.policy.verification} depth; unrelated test suites are excluded.`,
  } satisfies Plan
}

export function audit(
  plan: Plan,
  input: {
    readonly covered: readonly Kind[]
    readonly omissions: readonly { readonly kind: Kind; readonly reason: string }[]
  },
) {
  const selected = new Set(plan.checks.map((check) => check.kind))
  const covered = new Set(input.covered)
  const omitted = new Set(input.omissions.map((omission) => omission.kind))
  return {
    unrelated: Array.from(new Set([...covered, ...omitted])).filter((kind) => !selected.has(kind)),
    missing: plan.checks.filter((check) => !covered.has(check.kind) && !omitted.has(check.kind)),
    requiredOmissions: plan.checks.filter(
      (check) => check.requirement === "required" && omitted.has(check.kind),
    ),
  } satisfies Coverage
}

function normalize(file: string) {
  return file.replaceAll("\\", "/").replace(/^\.\/+/, "")
}

function matching(files: readonly string[], predicate: (file: string) => boolean) {
  const matched = files.filter((file) => predicate(file.toLowerCase()))
  return matched.length ? matched : files
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

function isVisual(file: string) {
  return isLocalUI(file) || /\.(?:png|jpe?g|webp|gif|svg|avif)$/.test(file)
}

function isDatabase(file: string) {
  return (
    /\.sql$/.test(file) ||
    /(?:^|\/)(?:database|migrations?|seeds?)(?:\/|$)/.test(file) ||
    /(?:^|[._-])migration(?:[._-]|$)/.test(file)
  )
}

function isBuildConfig(file: string) {
  return (
    /(?:^|\/)(?:\.github|\.gitlab|ci|build|scripts?|config|configs?)(?:\/|$)/.test(file) ||
    /\.(?:ya?ml|toml)$/.test(file)
  )
}

function isPublicAPI(file: string) {
  return /(?:^|\/)(?:api|protocol|sdk|contracts?|generated|schema)(?:\/|$)/.test(file)
}
