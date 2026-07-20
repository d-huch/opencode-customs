import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionEvidence } from "@/session/evidence"

const sessionID = SessionID.make("ses_evidence")
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") }

function user(id: string, synthetic?: "compaction" | "evidence"): SessionV1.WithParts {
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
        id: PartID.make(`prt_${id}`),
        messageID,
        sessionID,
        type: "text",
        text: "Знайди реалізацію і перевір її роботу",
        synthetic: synthetic !== undefined,
        ...(synthetic
          ? { metadata: { [synthetic === "compaction" ? "compaction_continue" : "evidence_continue"]: true } }
          : {}),
      },
    ],
  }
}

function assistant(input: {
  id: string
  parentID?: string
  tool: string
  metadata?: Record<string, unknown>
  output?: string
}): SessionV1.WithParts {
  const messageID = MessageID.make(input.id)
  return {
    info: {
      id: messageID,
      sessionID,
      parentID: MessageID.make(input.parentID ?? "msg_01"),
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
      {
        id: PartID.make(`prt_${input.id}_${input.tool}`),
        messageID,
        sessionID,
        type: "tool",
        tool: input.tool,
        callID: `${input.id}_call`,
        state: {
          status: "completed",
          input: {},
          title: input.tool,
          output: input.output ?? "result",
          metadata: input.metadata ?? {},
          time: { start: 1, end: 2 },
        },
      },
    ],
  }
}

const read = (id: string, file = "/project/src/feature.ts") =>
  assistant({
    id,
    tool: "read",
    metadata: { display: { type: "file", path: file } },
  })

const evidence = (id: string, input: { status: "complete" | "blocked"; files?: string[]; unresolved?: number }) =>
  assistant({
    id,
    tool: SessionEvidence.TOOL_ID,
    metadata: {
      evidence: true,
      status: input.status,
      files: input.files ?? [],
      findings: input.status === "complete" ? 1 : 0,
      unresolved: input.unresolved ?? 0,
    },
  })

describe("SessionEvidence", () => {
  test("does not gate ordinary turns without repository evidence", () => {
    expect(
      SessionEvidence.inspect({
        messages: [user("msg_01")],
        directory: "/project",
        followupAttempts: 2,
      }),
    ).toEqual({ type: "none" })
  })

  test("does not gate a routed context until repository tools actually run", () => {
    expect(
      SessionEvidence.inspect({
        messages: [user("msg_01")],
        directory: "/project",
        followupAttempts: 2,
      }),
    ).toEqual({ type: "none" })
  })

  test("keeps evidence gating after only a trusted continuation remains projected", () => {
    expect(
      SessionEvidence.inspect({
        messages: [user("msg_01", "compaction"), user("msg_02", "evidence"), read("msg_03")],
        directory: "/project",
        followupAttempts: 2,
      }),
    ).toEqual({ type: "continue", attempt: 2, maxAttempts: 3, reason: "missing" })
  })

  test("requires an evidence submission after repository tools", () => {
    expect(
      SessionEvidence.inspect({
        messages: [user("msg_01"), assistant({ id: "msg_02", tool: "grep" }), read("msg_03")],
        directory: "/project",
        followupAttempts: 2,
      }).type,
    ).toBe("continue")
  })

  test("accepts complete findings only for files actually read", () => {
    expect(
      SessionEvidence.inspect({
        messages: [
          user("msg_01"),
          read("msg_02"),
          evidence("msg_03", { status: "complete", files: ["src/feature.ts"] }),
        ],
        directory: "/project",
        followupAttempts: 2,
      }),
    ).toEqual({ type: "accepted", status: "complete" })

    expect(
      SessionEvidence.inspect({
        messages: [
          user("msg_01"),
          read("msg_02"),
          evidence("msg_03", { status: "complete", files: ["src/guessed.ts"] }),
        ],
        directory: "/project",
        followupAttempts: 2,
      }),
    ).toEqual({ type: "continue", attempt: 1, maxAttempts: 3, reason: "ungrounded" })
  })

  test("accepts an honest blocked result after repository research", () => {
    expect(
      SessionEvidence.inspect({
        messages: [
          user("msg_01"),
          assistant({ id: "msg_02", tool: "grep", output: "No files found" }),
          evidence("msg_03", { status: "blocked", unresolved: 1 }),
        ],
        directory: "/project",
        followupAttempts: 2,
      }),
    ).toEqual({ type: "accepted", status: "blocked" })
  })

  test("invalidates evidence followed by more repository research", () => {
    expect(
      SessionEvidence.inspect({
        messages: [
          user("msg_01"),
          read("msg_02"),
          evidence("msg_03", { status: "complete", files: ["src/feature.ts"] }),
          assistant({ id: "msg_04", tool: "grep" }),
        ],
        directory: "/project",
        followupAttempts: 2,
      }).type,
    ).toBe("continue")
  })

  test("bounds evidence follow-up attempts", () => {
    expect(
      SessionEvidence.inspect({
        messages: [
          user("msg_01"),
          read("msg_01a"),
          user("msg_02", "evidence"),
          user("msg_03", "evidence"),
          user("msg_04", "evidence"),
        ],
        directory: "/project",
        followupAttempts: 2,
      }),
    ).toEqual({ type: "exhausted" })
  })

  test("keeps the durable evidence bound after compaction removes earlier checkpoints", () => {
    expect(
      SessionEvidence.inspect({
        messages: [user("msg_01", "compaction"), read("msg_02")],
        directory: "/project",
        followupAttempts: 2,
        attempts: 3,
      }),
    ).toEqual({ type: "exhausted" })
  })

  test("checkpoint prompt advances evidence work without repeating the user request", () => {
    const text = SessionEvidence.prompt({ type: "continue", attempt: 1, maxAttempts: 3, reason: "missing" })

    expect(text).toContain("<evidence-checkpoint>")
    expect(text).toContain("Do not restart the task")
    expect(text).not.toContain("Знайди реалізацію")
  })

  test("only enables the evidence instruction after current-turn repository research", () => {
    expect(SessionEvidence.requiresDeclaration([user("msg_01")])).toBe(false)
    expect(SessionEvidence.requiresDeclaration([user("msg_01"), read("msg_02")])).toBe(true)
  })
})
