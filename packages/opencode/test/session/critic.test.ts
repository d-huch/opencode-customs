import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionCritic } from "@/session/critic"
import { MessageID, PartID, SessionID } from "@/session/schema"

const sessionID = SessionID.make("ses_critic")
const model = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("strong"),
}

function user(id: string, text: string): SessionV1.WithParts {
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
        text,
      },
    ],
  }
}

function result(id: string, parentID: string): SessionV1.WithParts {
  const messageID = MessageID.make(id)
  return {
    info: {
      id: messageID,
      sessionID,
      parentID: MessageID.make(parentID),
      role: "assistant",
      mode: "build",
      agent: "build",
      modelID: model.modelID,
      providerID: model.providerID,
      path: { cwd: "/project", root: "/project" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, completed: 2 },
      finish: "tool-calls",
    },
    parts: [
      {
        id: PartID.make(`prt_${id}`),
        messageID,
        sessionID,
        type: "tool",
        tool: SessionCritic.TOOL_ID,
        callID: `call_${id}`,
        state: {
          status: "completed",
          input: {},
          title: "Critic found 1 issue",
          output: "evidence",
          metadata: {
            critic: true,
            status: "findings",
            startedAt: 1,
            findings: [
              {
                severity: "error",
                title: "Broken contract",
                file: "src/a.ts",
                line: 12,
                consequence: "The caller receives the wrong value.",
                evidence: "The supplied patch removes the return statement.",
              },
            ],
          },
          time: { start: 1, end: 2 },
        },
      },
    ],
  }
}

describe("SessionCritic", () => {
  test("builds a compact review packet from the request patch and verification only", () => {
    const payload = SessionCritic.build({
      task: "Fix the return value",
      files: ["src/a.ts"],
      diffs: [
        {
          file: "src/a.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -12 +12 @@\n-return value\n+return next",
        },
      ],
      messages: [],
    })
    const prompt = SessionCritic.prompt(payload)

    expect(prompt).toContain("<original_task>\nFix the return value")
    expect(prompt).toContain("<changed_files>\n- src/a.ts")
    expect(prompt).toContain("@@ -12 +12 @@")
    expect(prompt).toContain("<verification_results>")
    expect(prompt).not.toContain("conversation history")
  })

  test("permits one review attempt and then exhausts without a loop", () => {
    const request = user("msg_request", "Fix it")
    expect(
      SessionCritic.inspect({
        messages: [request],
        requestMessageID: request.info.id,
        model,
        files: ["src/a.ts"],
        attempts: 0,
      }),
    ).toEqual({ type: "review" })
    expect(
      SessionCritic.inspect({
        messages: [request],
        requestMessageID: request.info.id,
        model,
        files: ["src/a.ts"],
        attempts: 1,
      }),
    ).toEqual({ type: "exhausted" })
  })

  test("reads a completed evidence-based finding for the current request", () => {
    const request = user("msg_request", "Fix it")
    const decision = SessionCritic.inspect({
      messages: [request, result("msg_review", "msg_request")],
      requestMessageID: request.info.id,
      model,
      files: ["src/a.ts"],
      attempts: 1,
    })

    expect(decision.type).toBe("completed")
    if (decision.type !== "completed") return
    expect(decision.review.status).toBe("findings")
    expect(decision.review.findings).toEqual([
      {
        severity: "error",
        title: "Broken contract",
        file: "src/a.ts",
        line: 12,
        consequence: "The caller receives the wrong value.",
        evidence: "The supplied patch removes the return statement.",
      },
    ])
  })

  test("does not reuse a completed critic result from an older request", () => {
    const first = user("msg_first", "Fix the first issue")
    const second = user("msg_second", "Fix the second issue")

    expect(
      SessionCritic.inspect({
        messages: [first, result("msg_review", "msg_first"), second],
        requestMessageID: second.info.id,
        model,
        files: ["src/b.ts"],
        attempts: 0,
      }),
    ).toEqual({ type: "review" })
  })
})
