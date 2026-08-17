import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { gameBridgeRequest } from "./game-bridge"
import DESCRIPTION from "./game-observe.txt"

export const Parameters = Schema.Struct({
  characterID: Schema.optional(Schema.String).annotate({ description: "Optional connected character ID" }),
  includeMemory: Schema.optional(Schema.Boolean).annotate({ description: "Include save-slot memory when available" }),
  camera: Schema.optional(Schema.Boolean).annotate({ description: "Request one compressed camera frame only when visual evidence is necessary" }),
})

export const GameObserveTool = Tool.define(
  "game_observe",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execution: { access: "read", cache: false } as const,
    execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "game_observe",
          patterns: [input.characterID ?? "*"],
          always: ["*"],
          metadata: { characterID: input.characterID, camera: input.camera },
        })
        const query = input.characterID ? `?characterID=${encodeURIComponent(input.characterID)}` : ""
        const world = yield* gameBridgeRequest(`/world${query}`, { method: "GET" }, ctx.abort)
        const capabilities = yield* gameBridgeRequest(`/capabilities${query}`, { method: "GET" }, ctx.abort)
        const goals = yield* gameBridgeRequest(`/goals${query}`, { method: "GET" }, ctx.abort)
        const memory = input.includeMemory
          ? yield* gameBridgeRequest(`/memory${query}`, { method: "GET" }, ctx.abort)
          : undefined
        const camera = input.camera
          ? yield* gameBridgeRequest(
              "/camera",
              { method: "POST", body: JSON.stringify({ characterID: input.characterID }) },
              ctx.abort,
            )
          : undefined
        const frame = isRecord(camera) && camera.contentType === "image/jpeg" && typeof camera.data === "string"
          ? camera
          : undefined
        return {
          title: input.characterID ? `Observe ${input.characterID}` : "Observe game world",
          output: JSON.stringify({ world, capabilities, goals, ...(memory ? { memory } : {}), ...(frame ? { camera: "attached" } : {}) }),
          metadata: { characterID: input.characterID },
          ...(frame
            ? { attachments: [{ type: "file" as const, mime: "image/jpeg", url: `data:image/jpeg;base64,${frame.data}` }] }
            : {}),
        }
      }).pipe(Effect.orDie),
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
