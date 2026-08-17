import { Effect, Schema } from "effect"
import DESCRIPTION from "./avatar-control.txt"
import * as Tool from "./tool"

const Vector = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite })

export const Parameters = Schema.Struct({
  action: Schema.Literals([
    "animation.trigger",
    "emotion.set",
    "gesture.play",
    "look_at",
    "move_to",
    "speech.stop",
  ]),
  characterID: Schema.String.pipe(Schema.optional),
  name: Schema.String.pipe(Schema.optional),
  emotion: Schema.String.pipe(Schema.optional),
  position: Vector.pipe(Schema.optional),
  target: Vector.pipe(Schema.optional),
  speed: Schema.Finite.pipe(Schema.optional),
  intensity: Schema.Finite.pipe(Schema.optional),
  durationMs: Schema.Finite.pipe(Schema.optional),
})

export const AvatarControlTool = Tool.define(
  "avatar_control",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execution: { access: "control" } as const,
    execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const endpoint = bridgeEndpoint()
        if (!endpoint) throw new Error("No local Unity/VR character bridge is available")
        validate(input)
        yield* ctx.ask({
          permission: "avatar_control",
          patterns: [input.characterID ? `${input.characterID}:${input.action}` : input.action],
          always: [input.characterID ? `${input.characterID}:*` : "*"],
          metadata: { action: input.action, characterID: input.characterID },
        })
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(new URL("/action", endpoint.url), {
              method: "POST",
              headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
              body: JSON.stringify(input),
              signal: AbortSignal.any([ctx.abort, AbortSignal.timeout(20_000)]),
            }),
          catch: (error) => new Error(`Avatar Bridge request failed: ${error instanceof Error ? error.message : error}`),
        })
        const result = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: () => new Error("Avatar Bridge returned an invalid response"),
        })
        if (!response.ok) {
          const message = isRecord(result) && typeof result.message === "string" ? result.message : `HTTP ${response.status}`
          throw new Error(message)
        }
        return {
          title: input.action,
          output: JSON.stringify(result),
          metadata: { action: input.action, characterID: input.characterID },
        }
      }).pipe(Effect.orDie),
  }),
)

function bridgeEndpoint() {
  const value = process.env.OPENCODE_AVATAR_BRIDGE_URL
  const token = process.env.OPENCODE_AVATAR_BRIDGE_TOKEN
  if (!value || !token) return
  const url = new URL(value)
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]"))
    return
  return { url, token }
}

function validate(input: Schema.Schema.Type<typeof Parameters>) {
  if ((input.action === "animation.trigger" || input.action === "gesture.play") && !input.name?.trim())
    throw new Error(`${input.action} requires name`)
  if (input.action === "emotion.set" && !input.emotion?.trim()) throw new Error("emotion.set requires emotion")
  if (input.action === "look_at" && !input.target) throw new Error("look_at requires target")
  if (input.action === "move_to" && !input.position) throw new Error("move_to requires position")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
