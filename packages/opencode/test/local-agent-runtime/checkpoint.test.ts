import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { completedCheckpoint } from "../../src/local-agent-runtime/checkpoint"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_checkpoint-session")
const parentID = MessageID.make("msg_checkpoint-parent")

function assistant(id: string): SessionV1.Assistant {
  return {
    id: MessageID.make(`msg_${id}`),
    parentID,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("local-model"),
    providerID: ProviderV2.ID.make("lmstudio"),
    time: { created: 1 },
    sessionID,
  }
}

describe("Local Agent Runtime durable checkpoint", () => {
  test("finds the latest completed tool result from the same user turn", () => {
    const previous = assistant("checkpoint-previous")
    const current = assistant("checkpoint-current")
    const checkpoint = completedCheckpoint(
      [
        {
          info: previous,
          parts: [
            {
              id: PartID.make("prt_checkpoint-part"),
              messageID: previous.id,
              sessionID,
              type: "tool",
              tool: "shell",
              callID: "call-1",
              state: {
                status: "completed",
                input: { command: "create artifact" },
                output: "artifact created",
                title: "create artifact",
                metadata: { exit: 0 },
                time: { start: 1, end: 2 },
              },
            },
          ],
        },
        { info: current, parts: [] },
      ],
      current,
    )

    expect(checkpoint).toMatchObject({ tool: "shell", title: "create artifact" })
  })

  test("does not reuse a checkpoint from an older user turn", () => {
    const previous = { ...assistant("checkpoint-previous-old"), parentID: MessageID.make("msg_older-user") }
    const current = assistant("checkpoint-current-new")
    expect(
      completedCheckpoint(
        [
          {
            info: previous,
            parts: [
              {
                id: PartID.make("prt_checkpoint-old-part"),
                messageID: previous.id,
                sessionID,
                type: "tool",
                tool: "shell",
                callID: "call-old",
                state: {
                  status: "completed",
                  input: {},
                  output: "old result",
                  title: "old result",
                  metadata: {},
                  time: { start: 1, end: 2 },
                },
              },
            ],
          },
          { info: current, parts: [] },
        ],
        current,
      ),
    ).toBeUndefined()
  })

  test("recognizes a completed tool in the current assistant before a local model crash", () => {
    const current = assistant("checkpoint-current-tool")
    expect(
      completedCheckpoint(
        [
          {
            info: current,
            parts: [
              {
                id: PartID.make("prt_checkpoint-current-part"),
                messageID: current.id,
                sessionID,
                type: "tool",
                tool: "shell",
                callID: "call-current",
                state: {
                  status: "completed",
                  input: { command: "create artifact" },
                  output: "artifact created",
                  title: "create artifact",
                  metadata: { exit: 0 },
                  time: { start: 1, end: 2 },
                },
              },
            ],
          },
        ],
        current,
      ),
    ).toMatchObject({ messageID: current.id, tool: "shell" })
  })
})
