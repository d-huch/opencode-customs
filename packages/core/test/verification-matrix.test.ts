import { describe, expect, test } from "bun:test"
import { ChangeRisk } from "../src/change-risk"
import { VerificationMatrix } from "../src/verification-matrix"

describe("verification matrix", () => {
  test("keeps documentation verification focused", () => {
    const plan = VerificationMatrix.select({ files: ["docs/runtime.md"] })

    expect(plan.categories).toEqual(["documentation"])
    expect(plan.checks.map((check) => check.kind)).toEqual(["git_diff_inspection", "formatter"])
    expect(plan.checks.find((check) => check.kind === "git_diff_inspection")?.requirement).toBe("required")
    expect(plan.checks.find((check) => check.kind === "formatter")?.requirement).toBe("conditional")
    expect(plan.rationale).toContain("unrelated test suites are excluded")
  })

  test("selects component and visual checks for local UI changes", () => {
    const plan = VerificationMatrix.select({ files: ["src/components/status.css"] })

    expect(plan.checks.map((check) => check.kind)).toEqual([
      "git_diff_inspection",
      "component_test",
      "screenshot_comparison",
    ])
  })

  test("selects migration and feature checks for database changes", () => {
    const risk = ChangeRisk.classify({
      tool: "write",
      args: { filePath: "database/migrations/add_status.sql", content: "ALTER TABLE entries ADD status text;" },
      declared: true,
    })
    const plan = VerificationMatrix.select({
      files: ["database/migrations/add_status.sql"],
      risk,
    })

    expect(plan.depth).toBe("extended")
    expect(plan.checks.map((check) => check.kind)).toEqual([
      "git_diff_inspection",
      "migration_validation",
      "feature_test",
    ])
  })

  test("deduplicates checks across public multi-package changes", () => {
    const risk = ChangeRisk.classify({
      tool: "apply_patch",
      args: {
        patchText: [
          "*** Begin Patch",
          "*** Update File: packages/protocol/src/api.ts",
          "*** Update File: packages/client/src/generated.ts",
          "*** End Patch",
        ].join("\n"),
      },
      declared: true,
    })
    const plan = VerificationMatrix.select({
      files: ["packages/protocol/src/api.ts", "packages/client/src/generated.ts"],
      risk,
    })

    expect(plan.depth).toBe("extended")
    expect(plan.checks.filter((check) => check.kind === "typecheck")).toHaveLength(1)
    expect(plan.checks.map((check) => check.kind)).toEqual([
      "git_diff_inspection",
      "api_contract_generation",
      "typecheck",
      "build",
    ])
  })

  test("audits required coverage without forcing unavailable conditional checks", () => {
    const plan = VerificationMatrix.select({ files: ["docs/runtime.md"] })
    const covered = VerificationMatrix.audit(plan, {
      covered: ["git_diff_inspection"],
      omissions: [{ kind: "formatter", reason: "No focused documentation formatter is configured." }],
    })
    const blocked = VerificationMatrix.audit(plan, {
      covered: [],
      omissions: [{ kind: "git_diff_inspection", reason: "The repository is unavailable." }],
    })

    expect(covered).toEqual({
      unrelated: [],
      missing: [],
      requiredOmissions: [],
    })
    expect(blocked.missing.map((check) => check.kind)).toEqual(["formatter"])
    expect(blocked.requiredOmissions.map((check) => check.kind)).toEqual(["git_diff_inspection"])
  })
})
