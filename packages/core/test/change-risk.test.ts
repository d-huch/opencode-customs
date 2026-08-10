import { describe, expect, test } from "bun:test"
import { ChangeRisk } from "../src/change-risk"

describe("change risk classifier", () => {
  test("allows focused documentation and local UI changes without an extra confirmation", () => {
    const documentation = ChangeRisk.classify({
      tool: "write",
      args: { filePath: "/workspace/docs/runtime.md", content: "Updated documentation" },
      root: "/workspace",
      declared: true,
    })
    const ui = ChangeRisk.classify({
      tool: "edit",
      args: { filePath: "/workspace/src/components/status.vue", oldString: "old", newString: "new" },
      root: "/workspace",
      declared: true,
    })

    expect(documentation.level).toBe("low")
    expect(documentation.categories).toEqual(["documentation"])
    expect(documentation.policy.autoApply).toBe(true)
    expect(documentation.policy.confirmation).toBe(false)
    expect(ui.level).toBe("low")
    expect(ui.categories).toContain("local_ui")
  })

  test("requires a recommended plan for executable backend logic", () => {
    const assessment = ChangeRisk.classify({
      tool: "edit",
      args: { filePath: "/workspace/src/service.ts", oldString: "old", newString: "new" },
      root: "/workspace",
      declared: true,
    })

    expect(assessment.level).toBe("medium")
    expect(assessment.categories).toEqual(["backend_logic"])
    expect(assessment.policy.plan).toBe("recommended")
    expect(assessment.policy.verification).toBe("focused")
  })

  test("requires planning, confirmation, critic, and extended verification for sensitive changes", () => {
    const database = ChangeRisk.classify({
      tool: "apply_patch",
      args: {
        patchText:
          "*** Begin Patch\n*** Update File: database/migrations/20260726_add_index.sql\n@@\n-OLD\n+DROP TABLE users;\n*** End Patch\n",
      },
      declared: true,
    })
    const access = ChangeRisk.classify({
      tool: "write",
      args: { filePath: "src/permissions/access.ts", content: "export const allowed = true" },
      declared: true,
    })

    expect(database.level).toBe("critical")
    expect(database.categories).toContain("database")
    expect(database.policy.plan).toBe("required")
    expect(database.policy.confirmation).toBe(true)
    expect(database.policy.critic).toBe(true)
    expect(database.policy.verification).toBe("full")
    expect(access.level).toBe("high")
    expect(access.categories).toContain("permissions_auth")
  })

  test("recognizes public contracts, dependencies, and multi-package refactors", () => {
    const assessment = ChangeRisk.classify({
      tool: "apply_patch",
      args: {
        patchText: [
          "*** Begin Patch",
          "*** Update File: packages/protocol/src/events.ts",
          "*** Update File: packages/client/package.json",
          "*** Update File: packages/app/src/client.ts",
          "*** End Patch",
        ].join("\n"),
      },
      declared: true,
    })

    expect(assessment.level).toBe("critical")
    expect(assessment.categories).toContain("public_api")
    expect(assessment.categories).toContain("dependency_changes")
    expect(assessment.categories).toContain("multi_package_refactor")
    expect(assessment.files).toHaveLength(3)
  })

  test("treats undeclared mutation tools as high risk", () => {
    const assessment = ChangeRisk.classify({
      tool: "third_party_mutation",
      args: { target: "remote-record", value: "changed" },
      declared: false,
    })

    expect(assessment.level).toBe("high")
    expect(assessment.policy.autoApply).toBe(false)
    expect(assessment.reasons.some((reason) => reason.includes("no trusted mutation metadata"))).toBe(true)
  })
})
