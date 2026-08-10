import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionVerification } from "@/session/verification"
import type { ChangeRisk } from "@opencode-ai/core/change-risk"

const sessionID = SessionID.make("ses_verification")
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") }

function user(
  id: string,
  text: string,
  synthetic?: "compaction" | "verification",
): SessionV1.WithParts {
  const messageID = MessageID.make(id)
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      agent: "build",
      model,
      time: { created: 1 },
    },
    parts: [
      {
        id: PartID.make(`prt_${id}_part`),
        messageID,
        sessionID,
        type: "text",
        text,
        synthetic: synthetic !== undefined,
        ...(synthetic
          ? { metadata: { [synthetic === "compaction" ? "compaction_continue" : "verification_continue"]: true } }
          : {}),
      },
    ],
  }
}

function assistant(input: {
  id: string
  parentID: string
  files?: string[]
  owned?: boolean
  verification?: { passed: boolean; files: string[]; attempt: number }
  risk?: ChangeRisk.Assessment
}): SessionV1.WithParts {
  const messageID = MessageID.make(input.id)
  return {
    info: {
      id: messageID,
      sessionID,
      parentID: MessageID.make(input.parentID),
      role: "assistant",
      mode: "build",
      agent: "build",
      modelID: ModelV2.ID.make("model"),
      providerID: ProviderV2.ID.make("test"),
      path: { cwd: "/project", root: "/project" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, completed: 2 },
      finish: "stop",
    },
    parts: [
      ...(input.files?.length && input.owned !== false
        ? [
            {
              id: PartID.make(`prt_${input.id}_mutation`),
              messageID,
              sessionID,
              type: "tool" as const,
              tool: "apply_patch",
              callID: `${input.id}_mutation_call`,
              state: {
                status: "completed" as const,
                input: {},
                title: "Applied patch",
                output: "done",
                metadata: {
                  files: input.files.map((file) => ({ relativePath: file })),
                  ...(input.risk ? { planner: { risk: input.risk } } : {}),
                },
                time: { start: 1, end: 2 },
              },
            },
          ]
        : []),
      ...(input.files?.length
        ? [
            {
              id: PartID.make(`prt_${input.id}_patch`),
              messageID,
              sessionID,
              type: "patch" as const,
              hash: `${input.id}_hash`,
              files: input.files,
            },
          ]
        : []),
      ...(input.verification
        ? [
            {
              id: PartID.make(`prt_${input.id}_verification`),
              messageID,
              sessionID,
              type: "tool" as const,
              tool: SessionVerification.TOOL_ID,
              callID: `${input.id}_call`,
              state: {
                status: "completed" as const,
                input: {},
                title: "Verification",
                output: "evidence",
                metadata: { verification: true, ...input.verification },
                time: { start: 1, end: 2 },
              },
            },
          ]
        : []),
    ],
  }
}

describe("SessionVerification", () => {
  test("does not gate read-only turns", () => {
    expect(
      SessionVerification.inspect({
        messages: [user("msg_01", "Explain this project"), assistant({ id: "msg_02", parentID: "msg_01" })],
        directory: "/project",
        repairAttempts: 2,
      }),
    ).toEqual({ type: "none" })
  })

  test("requires focused verification after changed files", () => {
    const decision = SessionVerification.inspect({
      messages: [
        user("msg_01", "Change the feature"),
        assistant({ id: "msg_02", parentID: "msg_01", files: ["src/a.ts", "/project/src/b.ts"] }),
      ],
      directory: "/project",
      repairAttempts: 2,
    })
    expect(decision).toEqual({
      type: "verify",
      files: ["src/a.ts", "src/b.ts"],
      attempt: 1,
      maxAttempts: 3,
      matrix: {
        depth: "focused",
        files: ["src/a.ts", "src/b.ts"],
        categories: ["backend_logic"],
        checks: [
          {
            kind: "git_diff_inspection",
            requirement: "required",
            files: ["src/a.ts", "src/b.ts"],
            reasons: ["Every mutation needs a final inspection for unintended or malformed changes."],
          },
          {
            kind: "unit_test",
            requirement: "required",
            files: ["src/a.ts", "src/b.ts"],
            reasons: ["Executable logic needs the narrowest unit test covering the changed behavior."],
          },
          {
            kind: "typecheck",
            requirement: "conditional",
            files: ["src/a.ts", "src/b.ts"],
            reasons: ["Static type validation is relevant when the affected package provides it."],
          },
        ],
        rationale:
          "Selected 3 minimal check types for backend_logic artifacts at focused depth; unrelated test suites are excluded.",
      },
    })
    if (decision.type === "verify") expect(SessionVerification.prompt(decision)).toContain("src/a.ts")
  })

  test("selects extended checks without embedding the separate critic pass", () => {
    const risk = {
      level: "high",
      score: 7,
      categories: ["permissions_auth"],
      files: ["src/permissions/access.ts"],
      reasons: ["Authorization artifacts are affected."],
      policy: {
        plan: "required",
        maxFiles: 10,
        verification: "extended",
        critic: true,
        confirmation: true,
        autoApply: false,
      },
    } satisfies ChangeRisk.Assessment
    const decision = SessionVerification.inspect({
      messages: [
        user("msg_01", "Change access rules"),
        assistant({
          id: "msg_02",
          parentID: "msg_01",
          files: ["src/permissions/access.ts"],
          risk,
        }),
      ],
      directory: "/project",
      repairAttempts: 2,
    })

    expect(decision.type).toBe("verify")
    if (decision.type !== "verify") return
    expect(decision.risk).toEqual(risk)
    expect(SessionVerification.prompt(decision)).not.toContain("critic pass")
    expect(SessionVerification.prompt(decision)).toContain("Required verification depth: extended")
    expect(SessionVerification.prompt(decision)).toContain("feature_test [required]")
  })

  test("ignores a workspace patch not produced by the current request", () => {
    expect(
      SessionVerification.inspect({
        messages: [
          user("msg_01", "Explain this project"),
          assistant({ id: "msg_02", parentID: "msg_01", files: ["src/external.ts"], owned: false }),
        ],
        directory: "/project",
        repairAttempts: 2,
      }),
    ).toEqual({ type: "none" })
  })

  test("keeps verification active after only a trusted continuation remains projected", () => {
    expect(
      SessionVerification.inspect({
        messages: [
          user("msg_01", "Change the feature", "compaction"),
          user("msg_02", "verify", "verification"),
          assistant({ id: "msg_03", parentID: "msg_01", files: ["src/a.ts"] }),
        ],
        directory: "/project",
        repairAttempts: 2,
      }),
    ).toMatchObject({ type: "verify", files: ["src/a.ts"], attempt: 2, maxAttempts: 3 })
  })

  test("accepts passed evidence that covers the current change", () => {
    expect(
      SessionVerification.inspect({
        messages: [
          user("msg_01", "Change the feature"),
          assistant({ id: "msg_02", parentID: "msg_01", files: ["src/a.ts"] }),
          assistant({
            id: "msg_03",
            parentID: "msg_01",
            verification: { passed: true, files: ["src/a.ts"], attempt: 1 },
          }),
        ],
        directory: "/project",
        repairAttempts: 2,
      }).type,
    ).toBe("passed")
  })

  test("invalidates passed evidence after a later edit", () => {
    expect(
      SessionVerification.inspect({
        messages: [
          user("msg_01", "Change the feature"),
          assistant({ id: "msg_02", parentID: "msg_01", files: ["src/a.ts"] }),
          assistant({
            id: "msg_03",
            parentID: "msg_01",
            verification: { passed: true, files: ["src/a.ts"], attempt: 1 },
          }),
          assistant({ id: "msg_04", parentID: "msg_01", files: ["src/a.ts"] }),
        ],
        directory: "/project",
        repairAttempts: 2,
      }).type,
    ).toBe("verify")
  })

  test("bounds repair prompts after failed verification", () => {
    const base = [
      user("msg_01", "Change the feature"),
      assistant({ id: "msg_02", parentID: "msg_01", files: ["src/a.ts"] }),
      assistant({
        id: "msg_03",
        parentID: "msg_01",
        verification: { passed: false, files: ["src/a.ts"], attempt: 1 },
      }),
    ]
    expect(
      SessionVerification.inspect({
        messages: [...base, user("msg_04", "repair", "verification")],
        directory: "/project",
        repairAttempts: 2,
      }).type,
    ).toBe("repair")
    expect(
      SessionVerification.inspect({
        messages: [
          ...base,
          user("msg_04", "repair", "verification"),
          user("msg_05", "repair", "verification"),
          user("msg_06", "repair", "verification"),
        ],
        directory: "/project",
        repairAttempts: 2,
      }).type,
    ).toBe("exhausted")
  })
})
