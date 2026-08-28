import { describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { JarvisCompanion } from "@opencode-ai/core/jarvis-companion"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node])))

const config = (enabled = true) => ({
  enabled,
  schedule: "08:30",
  timezone: "Europe/Kyiv",
  catchUpUntil: "18:00",
  sources: { gmail: true, calendar: true, drive: true, goals: true, promises: true, inbox: true },
  updatedAt: 0,
})

describe("Jarvis Daily Companion scheduler", () => {
  test("runs at the scheduled Kyiv minute and catches up before 18:00", () => {
    expect(JarvisCompanion.scheduleDecision(Date.parse("2026-08-28T05:30:00Z"), config())).toBe("scheduled")
    expect(JarvisCompanion.scheduleDecision(Date.parse("2026-08-28T09:00:00Z"), config())).toBe("catch_up")
  })

  test("does not duplicate a completed local date or run after catch-up", () => {
    const now = Date.parse("2026-08-28T09:00:00Z")
    expect(JarvisCompanion.scheduleDecision(now, config(), "2026-08-28")).toBeUndefined()
    expect(JarvisCompanion.scheduleDecision(Date.parse("2026-08-28T16:00:00Z"), config())).toBeUndefined()
  })

  test("respects disabled configuration", () => {
    expect(JarvisCompanion.scheduleDecision(Date.parse("2026-08-28T05:30:00Z"), config(false))).toBeUndefined()
  })
})

describe("Jarvis Daily Companion storage", () => {
  it.effect("normalizes configuration and keeps one action per idempotency key", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const stored = yield* JarvisCompanion.updateConfig(db, {
        ...config(),
        schedule: "invalid",
        timezone: "Invalid/Timezone",
        catchUpUntil: "25:99",
      })
      expect(stored).toMatchObject({ schedule: "08:30", timezone: "Europe/Kyiv", catchUpUntil: "18:00" })

      const input = {
        kind: "jarvis_reminder" as const,
        title: "Follow up",
        preview: "Remind me to follow up tomorrow.",
        input: { topic: "follow-up" },
        idempotencyKey: "companion:test:follow-up",
      }
      const first = yield* JarvisCompanion.prepareAction(db, input)
      const retry = yield* JarvisCompanion.prepareAction(db, input)
      expect(retry.id).toBe(first.id)

      const execution = yield* JarvisCompanion.completeLocalAction(db, first.id, { wakeID: "wake-1" })
      expect(execution?.status).toBe("completed")
      expect(yield* JarvisCompanion.completeLocalAction(db, first.id, { wakeID: "wake-2" })).toBeUndefined()
      expect((yield* JarvisCompanion.actionAudit(db)).filter((item) => item.proposalID === first.id)).toHaveLength(1)
    }),
  )
})
