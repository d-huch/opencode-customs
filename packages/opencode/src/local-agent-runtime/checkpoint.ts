import type { SessionV1 } from "@opencode-ai/core/v1/session"

export function completedCheckpoint(messages: SessionV1.WithParts[], current: SessionV1.Assistant) {
  return messages
    .filter(
      (message) =>
        message.info.role === "assistant" &&
        message.info.parentID === current.parentID,
    )
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool" && part.state.status === "completed"
          ? [
              {
                messageID: message.info.id,
                partID: part.id,
                tool: part.tool,
                title: part.state.title,
              },
            ]
          : [],
      ),
    )
    .at(-1)
}
