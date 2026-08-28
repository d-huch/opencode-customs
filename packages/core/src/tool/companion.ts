export * as CompanionTools from "./companion"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { JarvisCompanion } from "../jarvis-companion"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { ToolRegistry } from "./registry"
import { Tools } from "./tools"

const BriefingInput = Schema.Struct({ force: Schema.optional(Schema.Boolean) })
const ActionInput = Schema.Struct({
  kind: Schema.Literals(["gmail_draft", "calendar_create", "calendar_update", "jarvis_reminder", "jarvis_goal"]),
  title: Schema.String,
  preview: Schema.String,
  input: Schema.Record(Schema.String, Schema.Json),
  requiredScopes: Schema.optional(Schema.Array(Schema.String)),
  idempotencyKey: Schema.String,
  externalRevision: Schema.optional(Schema.String),
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const db = (yield* Database.Service).db
    yield* tools.register({
      companion_briefing: Tool.withPermission(
        Tool.make({
          description: "Create or retrieve today's bounded Daily Companion briefing. This reads only configured Calendar, Gmail metadata/snippets, Drive metadata, and local Jarvis sources. It never performs a write action.",
          input: BriefingInput,
          output: Schema.String,
          execute: (input) =>
            JarvisCompanion.run(db, { trigger: "manual", force: input.force }).pipe(
              Effect.flatMap((run) => run.briefingID ? JarvisCompanion.briefing(db, run.briefingID) : Effect.succeed(undefined)),
              Effect.map((briefing) => briefing ? JSON.stringify(briefing) : "No briefing is available."),
              Effect.mapError((error) => new ToolFailure({ message: String(error) })),
            ),
        }),
        "companion.read",
      ),
      companion_prepare_action: Tool.withPermission(
        Tool.make({
          description: "Prepare exactly one Daily Companion action for user review. This never executes the action. Gmail drafts, calendar changes, reminders, and goals require a separate explicit approval in the UI.",
          input: ActionInput,
          output: Schema.String,
          execute: (input) =>
            JarvisCompanion.prepareAction(db, input).pipe(
              Effect.map((proposal) => JSON.stringify(proposal)),
              Effect.mapError((error) => new ToolFailure({ message: String(error) })),
            ),
        }),
        "companion.prepare",
      ),
    }).pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/companion",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, Database.node],
})
