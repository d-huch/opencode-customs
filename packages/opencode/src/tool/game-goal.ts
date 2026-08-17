import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { gameBridgeRequest } from "./game-bridge"
import DESCRIPTION from "./game-goal.txt"

export const Parameters = Schema.Struct({
  operation: Schema.optional(Schema.Literals(["create", "step", "finish"])),
  goal: Schema.optional(Schema.String).annotate({ description: "One concrete objective when creating a goal" }),
  characterID: Schema.optional(Schema.String),
  cycleID: Schema.optional(Schema.String).annotate({ description: "Stable ID when continuing the same goal cycle" }),
  parentID: Schema.optional(Schema.String),
  steps: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Up to eight observable plan steps" }),
  stopConditions: Schema.optional(Schema.Array(Schema.String)),
  riskBudget: Schema.optional(Schema.Array(Schema.Literals(["ambient", "interaction", "critical"]))),
  goalID: Schema.optional(Schema.String),
  stepID: Schema.optional(Schema.String),
  stepStatus: Schema.optional(Schema.Literals(["pending", "active", "completed", "failed", "skipped"])),
  outcomeStatus: Schema.optional(Schema.Literals(["completed", "cancelled", "failed"])),
  reason: Schema.optional(Schema.String),
})

export const GameGoalTool = Tool.define(
  "game_goal",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execution: { access: "control" } as const,
    execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "game_goal",
          patterns: [input.characterID ?? "*"],
          always: ["*"],
          metadata: { characterID: input.characterID, cycleID: input.cycleID },
        })
        const operation = input.operation ?? "create"
        if (operation === "create" && !input.goal?.trim()) throw new Error("A concrete goal is required")
        if (operation !== "create" && !input.goalID) throw new Error("goalID is required when updating a goal")
        const payload =
          operation === "create"
            ? input
            : operation === "step"
              ? { goalID: input.goalID, stepID: input.stepID, stepStatus: input.stepStatus, reason: input.reason }
              : { goalID: input.goalID, status: input.outcomeStatus, reason: input.reason ?? "Goal finished" }
        const result = yield* gameBridgeRequest(
          operation === "create" ? "/goal" : "/goal/update",
          { method: "POST", body: JSON.stringify(payload) },
          ctx.abort,
        )
        return {
          title: input.goal ?? `${operation} ${input.goalID ?? "goal"}`,
          output: JSON.stringify(result),
          metadata: { characterID: input.characterID, cycleID: input.cycleID },
        }
      }).pipe(Effect.orDie),
  }),
)
