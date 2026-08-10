import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionMutation } from "../../src/session/mutation"
import { SessionV1 } from "@opencode-ai/core/v1/session"

describe("session mutation ownership", () => {
  const root = path.join(path.sep, "workspace")

  test("collects files reported by successful mutating tools", () => {
    expect(
      SessionMutation.messageFiles(
        {
          info: {
            role: "assistant",
          },
          parts: [
            {
              type: "tool",
              tool: "apply_patch",
              state: {
                status: "completed",
                metadata: {
                  files: [
                    {
                      relativePath: "src/original.ts",
                      movePath: "src/moved.ts",
                    },
                  ],
                },
              },
            },
            {
              type: "tool",
              tool: "bash",
              state: {
                status: "completed",
                metadata: {
                  files: ["src/generated.ts"],
                },
              },
            },
          ],
        } as unknown as SessionV1.WithParts,
        root,
      ),
    ).toEqual(["src/moved.ts", "src/original.ts", "src/generated.ts"])
  })

  test("ignores reads and unsuccessful tool calls", () => {
    expect(
      SessionMutation.messageFiles(
        {
          info: {
            role: "assistant",
          },
          parts: [
            {
              type: "tool",
              tool: "read",
              state: {
                status: "completed",
                metadata: {
                  filepath: "src/read.ts",
                },
              },
            },
            {
              type: "tool",
              tool: "write",
              state: {
                status: "error",
                metadata: {
                  filepath: "src/failed.ts",
                },
              },
            },
          ],
        } as unknown as SessionV1.WithParts,
        root,
      ),
    ).toEqual([])
  })
})
