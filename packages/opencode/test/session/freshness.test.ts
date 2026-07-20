import { describe, expect, test } from "bun:test"
import { SessionFreshness } from "@/session/freshness"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

const sessionID = SessionID.make("ses_test")
const userID = MessageID.make("msg_user")
const assistantID = MessageID.make("msg_assistant")
const providerID = ProviderV2.ID.make("lmstudio")
const modelID = ModelV2.ID.make("coder")

function message(input: { id: MessageID; role: "user" | "assistant"; parts: SessionV1.Part[] }): SessionV1.WithParts {
  if (input.role === "user")
    return {
      info: {
        id: input.id,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID, modelID },
      },
      parts: input.parts,
    }
  return {
    info: {
      id: input.id,
      sessionID,
      role: "assistant",
      time: { created: 2 },
      parentID: userID,
      modelID,
      providerID,
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: input.parts,
  }
}

function tool(status: "completed" | "error"): SessionV1.ToolPart {
  return {
    id: PartID.make("prt_tool"),
    sessionID,
    messageID: assistantID,
    type: "tool",
    callID: "call_1",
    tool: "websearch",
    state:
      status === "completed"
        ? {
            status,
            input: { query: "current facts" },
            output: "source",
            title: "Web Search",
            metadata: {},
            time: { start: 1, end: 2 },
          }
        : {
            status,
            input: { query: "current facts" },
            error: "offline",
            time: { start: 1, end: 2 },
          },
  }
}

describe("session freshness", () => {
  const decision: SessionFreshness.Decision = {
    scope: "external",
    required: true,
    reason: "Changing external facts",
    query: "compare current specifications",
    source: "model",
  }

  test("persists and restores a decision on the genuine user text", () => {
    const part: SessionV1.TextPart = {
      id: PartID.make("prt_user"),
      sessionID,
      messageID: userID,
      type: "text",
      text: "request",
    }
    const request = message({ id: userID, role: "user", parts: [SessionFreshness.write(part, decision)] })
    expect(SessionFreshness.read(request)).toEqual(decision)
  })

  test("requires exactly websearch before external evidence exists", () => {
    const routed = SessionFreshness.route({
      decision,
      evidence: "missing",
      tools: { websearch: "search", webfetch: "fetch", grep: "grep" },
    })
    expect(routed.tools).toEqual({ websearch: "search" })
    expect(routed.requiredTools).toEqual(["websearch"])
    expect(routed.toolChoice).toBe("required")
  })

  test("restores normal tools after completed evidence", () => {
    const tools = { websearch: "search", webfetch: "fetch", grep: "grep" }
    const routed = SessionFreshness.route({ decision, evidence: "completed", tools })
    expect(routed.tools).toEqual({ websearch: "search", webfetch: "fetch" })
    expect(routed.toolChoice).toBeUndefined()
  })

  test("does not loop after failed evidence", () => {
    const routed = SessionFreshness.route({
      decision,
      evidence: "failed",
      tools: { websearch: "search", webfetch: "fetch" },
    })
    expect(routed.toolChoice).toBe("none")
    expect(routed.unavailable).toBe(true)
    expect(routed.tools).toEqual({})
  })

  test("keeps repository tools only for an explicit repository route", () => {
    const tools = { websearch: "search", grep: "grep", read: "read" }
    const routed = SessionFreshness.route({
      decision: { ...decision, scope: "repository", required: false },
      evidence: "missing",
      tools,
    })
    expect(routed.tools).toBe(tools)
    expect(routed.toolChoice).toBeUndefined()
  })

  test("does not expose workspace tools to a local conversation", () => {
    const routed = SessionFreshness.route({
      decision: { ...decision, scope: "local", required: false },
      evidence: "missing",
      tools: { websearch: "search", grep: "grep", read: "read" },
    })
    expect(routed.tools).toEqual({})
    expect(routed.toolChoice).toBe("none")
  })

  test("derives evidence state from tool completion", () => {
    const request = message({ id: userID, role: "user", parts: [] })
    expect(SessionFreshness.evidence([request], request.info.id)).toBe("missing")
    expect(
      SessionFreshness.evidence(
        [request, message({ id: assistantID, role: "assistant", parts: [tool("completed")] })],
        request.info.id,
      ),
    ).toBe("completed")
    expect(
      SessionFreshness.evidence(
        [request, message({ id: assistantID, role: "assistant", parts: [tool("error")] })],
        request.info.id,
      ),
    ).toBe("failed")
  })

  test("preserves scope and web evidence across a compaction continuation", () => {
    const part = SessionFreshness.write(
      {
        id: PartID.make("prt_original"),
        sessionID,
        messageID: userID,
        type: "text",
        text: "compare current specifications",
      },
      decision,
    )
    const request = message({ id: userID, role: "user", parts: [part] })
    const searched = message({ id: assistantID, role: "assistant", parts: [tool("completed")] })
    const continuationID = MessageID.make("msg_continue")
    const continuation = message({
      id: continuationID,
      role: "user",
      parts: [
        {
          id: PartID.make("prt_continue"),
          sessionID,
          messageID: continuationID,
          type: "text",
          text: "compare current specifications",
          synthetic: true,
          metadata: SessionFreshness.continuationMetadata({ messages: [request, searched], request }),
        },
      ],
    })

    expect(SessionFreshness.read(continuation)).toEqual(decision)
    expect(SessionFreshness.evidence([continuation], continuation.info.id)).toBe("completed")
  })
})
