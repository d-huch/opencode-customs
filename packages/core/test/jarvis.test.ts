import { describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { JarvisRuntime } from "@opencode-ai/core/jarvis"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node])))

const profile = {
  id: "profile-primary",
  revision: 1,
  name: "Jarvis",
  userName: "Denys",
  addressAs: "Denys",
  language: "uk",
  archetype: "jarvis" as const,
  tone: "natural",
  detail: "balanced",
  humor: "subtle",
  proactivity: "proactive",
  instructions: "Be concise.",
  catchphrases: ["До ваших послуг."],
  primary: true,
  updatedAt: 1,
}

describe("JarvisRuntime", () => {
  it.effect("stores a primary profile and exposes degraded model diagnostics", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* JarvisRuntime.syncProfiles(db, { profiles: [profile], primaryProfileID: profile.id })

      const status = yield* JarvisRuntime.status(db)

      expect(status.primaryProfile).toMatchObject({ id: profile.id, userName: "Denys" })
      expect(status.state).toBe("degraded")
      expect(status.degradedReasons).toContain("Dialogue model is not configured.")
    }),
  )

  it.effect("recalls FTS memories by scope and keeps verified corrections", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const now = Date.now()
      yield* JarvisRuntime.remember(db, {
        id: "memory-shared",
        scope: "user",
        kind: "preference",
        text: "Denys prefers concise Ukrainian replies",
        sourceID: "test:shared",
        confidence: 0.8,
        importance: 0.7,
        lifecycle: "candidate",
        pinned: false,
        conflictsWith: [],
        createdAt: now,
        updatedAt: now,
      })
      yield* JarvisRuntime.remember(db, {
        id: "memory-correction",
        profileID: profile.id,
        scope: "profile",
        kind: "correction",
        text: "The preferred assistant name is Jarvis",
        sourceID: "test:correction",
        confidence: 1,
        importance: 1,
        lifecycle: "candidate",
        pinned: true,
        conflictsWith: ["memory-old-name"],
        createdAt: now,
        updatedAt: now,
      })

      expect((yield* JarvisRuntime.searchMemory(db, { query: "concise Ukrainian", profileID: "other" })).map((item) => item.id)).toEqual([
        "memory-shared",
      ])
      expect(yield* JarvisRuntime.searchMemory(db, { query: "assistant name", profileID: profile.id })).toEqual([
        expect.objectContaining({ id: "memory-correction", lifecycle: "verified", conflictsWith: ["memory-old-name"] }),
      ])
    }),
  )

  it.effect("rejects invalid plans and suspends a goal after two identical failures", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const goal = yield* JarvisRuntime.createGoal(db, {
        profileID: profile.id,
        mode: "unity",
        gameID: "lab",
        saveSlotID: "slot-1",
        characterID: "jarvis",
        objective: "Bring the cube to the table",
      })
      expect(yield* JarvisRuntime.applyPlan(db, goal.id, { goal: goal.objective, steps: [] })).toBeUndefined()

      const stepID = "step-1"
      yield* JarvisRuntime.applyPlan(db, goal.id, {
        goal: goal.objective,
        steps: [
          {
            id: stepID,
            goalID: goal.id,
            position: 0,
            action: "pick_up",
            arguments: { entityID: "cube" },
            expectedPostconditions: ["cube is held"],
            status: "pending",
            attempts: 0,
            updatedAt: Date.now(),
          },
        ],
        stopConditions: ["cube is on table"],
        riskBudget: "interaction",
        replanConditions: ["path blocked"],
      })
      yield* JarvisRuntime.recordStepResult(db, { goalID: goal.id, stepID, success: false, error: "blocked" })
      const failed = yield* JarvisRuntime.recordStepResult(db, {
        goalID: goal.id,
        stepID,
        success: false,
        error: "blocked",
      })

      expect(failed).toMatchObject({ status: "suspended", actionCount: 2 })
      expect(failed?.suspensionReason).toContain("failed twice")

      const outcome = yield* JarvisRuntime.completeGoal(db, goal.id, {
        status: "failed",
        summary: "The path remained blocked.",
        changedEntityIDs: ["cube"],
      })
      expect(outcome).toMatchObject({ goalID: goal.id, status: "failed", changedEntityIDs: ["cube"] })
      expect(yield* JarvisRuntime.outcomes(db, goal.id)).toEqual([expect.objectContaining({ id: outcome?.id })])
      expect(yield* JarvisRuntime.goals(db, "failed")).toEqual([expect.objectContaining({ id: goal.id })])
    }),
  )

  it.effect("deduplicates wake topics and enforces per-day limits", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* JarvisRuntime.syncProfiles(db, { profiles: [profile], primaryProfileID: profile.id })
      const config = yield* JarvisRuntime.getConfig(db)
      yield* JarvisRuntime.updateConfig(db, {
        ...config,
        initiative: {
          ...config.initiative,
          quietStart: "00:00",
          quietEnd: "00:00",
          reflectionLimit: 1,
          eventLimit: 1,
        },
      })
      expect(yield* JarvisRuntime.enqueueWake(db, { kind: "attention", topic: "door", text: "Door opened", priority: 5 })).toBeDefined()
      expect(yield* JarvisRuntime.enqueueWake(db, { kind: "attention", topic: "door", text: "Door opened", priority: 5 })).toBeUndefined()
      expect((yield* JarvisRuntime.claimWake(db))?.topic).toBe("door")
      yield* JarvisRuntime.enqueueWake(db, { kind: "attention", topic: "window", text: "Window opened", priority: 5 })
      expect(yield* JarvisRuntime.claimWake(db)).toBeUndefined()
    }),
  )
})

describe("Jarvis deterministic routing", () => {
  it.effect("escalates explicit plans and localizes acknowledgements", () =>
    Effect.sync(() => {
      expect(JarvisRuntime.shouldPlan({ text: "Спочатку знайди ключ, потім відкрий двері" })).toBe(true)
      expect(JarvisRuntime.shouldPlan({ text: "Як тебе звати?" })).toBe(false)
      expect(JarvisRuntime.plannerAcknowledgement(profile)).toContain("Прораховую")
    }),
  )
})
