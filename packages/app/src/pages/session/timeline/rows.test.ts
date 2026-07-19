import { describe, expect, mock, test } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"

mock.module("@opencode-ai/session-ui/message-part", () => ({
  groupParts: () => [],
  renderable: () => true,
}))

const { Timeline } = await import("./rows")

describe("timeline rows", () => {
  test("keeps the compaction marker without rendering the internal summary", () => {
    const user = { id: "msg_user", role: "user" } as UserMessage
    const summary = { id: "msg_summary", role: "assistant", summary: true } as AssistantMessage
    const parts = new Map<string, Part[]>([
      ["msg_user", [{ type: "compaction" } as Part]],
      ["msg_summary", [{ type: "text", text: "Objective\nInternal compacted state" } as Part]],
    ])

    const rows = Timeline.constructMessageRows(
      user,
      (messageID) => parts.get(messageID) ?? [],
      [summary],
      0,
      true,
      "idle",
      false,
      false,
    )

    expect(rows.map((row) => row._tag)).toEqual(["UserMessage", "TurnDivider"])
    expect(rows.find((row) => row._tag === "TurnDivider")).toMatchObject({ label: "compaction" })
  })

  test("keeps the active model status visible while assistant content streams", () => {
    const user = { id: "msg_user", role: "user" } as UserMessage
    const assistant = { id: "msg_assistant", role: "assistant", summary: false } as AssistantMessage
    const parts = new Map<string, Part[]>([
      ["msg_assistant", [{ id: "part_text", type: "text", text: "Streaming" } as Part]],
    ])

    const rows = Timeline.constructMessageRows(
      user,
      (messageID) => parts.get(messageID) ?? [],
      [assistant],
      0,
      true,
      "busy",
      true,
      false,
    )

    expect(rows.map((row) => row._tag)).toContain("Thinking")
  })
})
