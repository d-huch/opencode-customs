import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { gameBridgeRequest } from "./game-bridge"
import DESCRIPTION from "./game-act.txt"

export const Parameters = Schema.Struct({
  actionID: Schema.String.annotate({ description: "Exact capability ID returned by game_observe" }),
  args: Schema.Record(Schema.String, Schema.Unknown).annotate({ description: "Arguments matching the capability schema" }),
  characterID: Schema.optional(Schema.String),
  cycleID: Schema.optional(Schema.String).annotate({ description: "Goal cycle ID for the autonomy budget" }),
  idempotencyKey: Schema.optional(Schema.String).annotate({ description: "Stable unique key for safe retry" }),
})

export const GameActTool = Tool.define(
  "game_act",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execution: { access: "control" } as const,
    execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "game_act",
          patterns: [input.characterID ? `${input.characterID}:${input.actionID}` : input.actionID],
          always: [input.characterID ? `${input.characterID}:*` : "*"],
          metadata: { actionID: input.actionID, characterID: input.characterID, cycleID: input.cycleID },
        })
        const result = yield* gameBridgeRequest("/action", { method: "POST", body: JSON.stringify(input) }, ctx.abort)
        return {
          title: input.actionID,
          output: JSON.stringify(result),
          metadata: { actionID: input.actionID, characterID: input.characterID, cycleID: input.cycleID },
        }
      }).pipe(Effect.orDie),
  }),
)
