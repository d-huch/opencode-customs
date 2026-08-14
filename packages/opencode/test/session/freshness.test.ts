import { describe, expect, test } from "bun:test"
import { SessionFreshness } from "@/session/freshness"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { MockLanguageModelV3 } from "ai/test"

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

  test("never reuses the primary LM Studio model for hidden classification", () => {
    const primary = { providerID: "lmstudio", id: "primary-26b" }
    expect(SessionFreshness.classifierModel({ primary, utility: undefined })).toBeUndefined()
    expect(SessionFreshness.classifierModel({ primary, utility: primary })).toBeUndefined()

    const utility = { providerID: "lmstudio", id: "utility-1b" }
    expect(SessionFreshness.classifierModel({ primary, utility })).toBe(utility)
  })

  test("preserves the existing classifier path for non-local providers", () => {
    const primary = { providerID: "test-provider", id: "primary" }
    expect(SessionFreshness.classifierModel({ primary, utility: undefined })).toBe(primary)
  })

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

  test("offers exactly websearch without forcing incompatible provider tool choice", () => {
    const routed = SessionFreshness.route({
      decision,
      evidence: "missing",
      tools: { websearch: "search", webfetch: "fetch", grep: "grep" },
    })
    expect(routed.tools).toEqual({ websearch: "search" })
    expect(routed.requiredTools).toEqual([])
    expect(routed.toolChoice).toBeUndefined()
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

  test("parses durable memory without hardcoded user language", () => {
    expect(
      SessionFreshness.parse(
        "LOCAL\nThe user supplied a stable preference\nMEMORY\nCATEGORY: preference\nSCOPE: global\nTOPIC: user.color.preference\nCORRECTION: no\nCONFIDENCE: 0.96\nTEXT: Користувач віддає перевагу зеленому кольору.",
        "Мій улюблений колір — зелений.",
      ),
    ).toMatchObject({
      scope: "local",
      required: false,
      memory: "Користувач віддає перевагу зеленому кольору.",
      memoryCategory: "preference",
      memoryTopic: "user.color.preference",
      memoryConfidence: 0.96,
      memoryScope: "global",
      memoryCorrection: false,
      source: "model",
    })
  })

  test.each([
    ["cross-project", "Universal rule: run only targeted tests."],
    ["pattern", "Reusable pattern: preserve the stable prompt prefix."],
  ] as const)("parses the %s managed-memory scope", (scope, text) => {
    expect(
      SessionFreshness.parse(
        `LOCAL\nStable knowledge\nMEMORY\nCATEGORY: constraint\nSCOPE: ${scope}\nTOPIC: workflow.rule\nCORRECTION: no\nCONFIDENCE: 0.94\nTEXT: ${text}`,
        text,
      ),
    ).toMatchObject({
      memory: text,
      memoryScope: scope,
      memoryConfidence: 0.94,
    })
  })

  test("supplies the previous assistant question as context for a short durable answer", () => {
    const question = message({
      id: assistantID,
      role: "assistant",
      parts: [
        {
          id: PartID.make("prt_question"),
          sessionID,
          messageID: assistantID,
          type: "text",
          text: "Скільки Віталік проїхав на велосипеді минулої неділі?",
        },
      ],
    })
    if (question.info.role !== "assistant") throw new Error("Expected assistant message")
    question.info.finish = "stop"
    const answerID = MessageID.make("msg_z_answer")
    const answer = message({
      id: answerID,
      role: "user",
      parts: [
        {
          id: PartID.make("prt_answer"),
          sessionID,
          messageID: answerID,
          type: "text",
          text: "Нескільки",
        },
      ],
    })

    expect(SessionFreshness.memoryContext([question, answer], answerID)).toContain(
      "Previous assistant message:\nСкільки Віталік проїхав на велосипеді минулої неділі?",
    )
    expect(SessionFreshness.memoryContext([question, answer], answerID)).toContain("Latest user message:\nНескільки")
  })

  test("uses only the latest message when there is no preceding assistant context", () => {
    const answerID = MessageID.make("msg_z_answer")
    const answer = message({
      id: answerID,
      role: "user",
      parts: [
        {
          id: PartID.make("prt_answer"),
          sessionID,
          messageID: answerID,
          type: "text",
          text: "Давай",
        },
      ],
    })

    expect(SessionFreshness.memoryContext([answer], answerID)).toBe("Latest user message:\nДавай")
  })

  test("rejects low-confidence automatic memory", () => {
    expect(
      SessionFreshness.parse(
        "LOCAL\nA transient statement\nMEMORY\nCATEGORY: context\nSCOPE: session\nTOPIC: transient.note\nCORRECTION: no\nCONFIDENCE: 0.42\nTEXT: Можливо, це знадобиться.",
        "Можливо, це знадобиться.",
      ),
    ).not.toHaveProperty("memory")
  })

  test("does not turn malformed classifier output into hidden web search", () => {
    expect(SessionFreshness.parse("I should inspect the workspace first", "коротке уточнення")).toMatchObject({
      scope: "local",
      required: false,
      source: "conservative",
    })
  })

  test("reuses an exact successful classifier decision without another provider call", async () => {
    const model = new MockLanguageModelV3({
      provider: "cache-test",
      modelId: "freshness-cache",
      doGenerate: {
        content: [{ type: "text", text: "LOCAL\nConversation answer\nNO_MEMORY" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 4, text: 4, reasoning: 0 },
        },
        warnings: [],
      },
    })
    const input = {
      model,
      request: "exact classifier cache request 7b1a9c",
      memoryContext: "Latest user message:\nexact classifier cache request 7b1a9c",
      memoryAdmission: "automatic" as const,
    }

    expect(await SessionFreshness.classify(input)).toMatchObject({ scope: "local", source: "model" })
    expect(await SessionFreshness.classify(input)).toMatchObject({ scope: "local", source: "model" })
    expect(model.doGenerateCalls).toHaveLength(1)
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
