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

  it.effect("edits memory, replans goals, and lets blocked Inbox items retry", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const now = Date.now()
      yield* JarvisRuntime.syncProfiles(db, { profiles: [profile], primaryProfileID: profile.id })
      yield* JarvisRuntime.remember(db, {
        id: "memory-edit",
        scope: "user",
        kind: "preference",
        text: "Old preference",
        sourceID: "test:edit",
        confidence: 0.5,
        importance: 0.5,
        lifecycle: "candidate",
        pinned: false,
        conflictsWith: [],
        createdAt: now,
        updatedAt: now,
      })
      expect(yield* JarvisRuntime.patchMemory(db, "memory-edit", { text: "New preference", pinned: true, lifecycle: "verified" })).toMatchObject({ text: "New preference", pinned: true, lifecycle: "verified" })

      const goal = yield* JarvisRuntime.createGoal(db, { profileID: profile.id, mode: "chat", objective: "Complete a multi-step task" })
      yield* JarvisRuntime.suspendGoal(db, goal.id, "blocked")
      expect(yield* JarvisRuntime.replanGoal(db, goal.id, { reason: "new evidence" })).toMatchObject({ status: "pending", suspensionReason: "new evidence" })
      expect(yield* JarvisRuntime.cancelGoal(db, goal.id, { summary: "Stopped" })).toMatchObject({ status: "cancelled", summary: "Stopped" })

      const wake = yield* JarvisRuntime.enqueueWake(db, { kind: "manual", topic: "manual-test", text: "Check", priority: 1 })
      yield* JarvisRuntime.markWakeBlocked(db, wake?.id ?? "", "offline")
      expect(yield* JarvisRuntime.retryWake(db, wake?.id ?? "")).toMatchObject({ status: "pending", blockedReason: undefined })
      expect(yield* JarvisRuntime.dismissWake(db, wake?.id ?? "")).toMatchObject({ status: "dismissed" })
    }),
  )

  it.effect("bounds planner and initiative configuration", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const config = yield* JarvisRuntime.getConfig(db)
      const updated = yield* JarvisRuntime.updateConfig(db, {
        ...config,
        plannerTimeoutMs: 1,
        plannerIdleUnloadMs: 1,
        plannerEscalationMinWords: 999,
        initiative: { ...config.initiative, quietStart: "invalid", reflectionLimit: 99, eventLimit: 99, topicCooldownMinutes: 1 },
      })
      expect(updated).toMatchObject({ plannerTimeoutMs: 2_000, plannerIdleUnloadMs: 30_000, plannerEscalationMinWords: 100 })
      expect(updated.initiative).toMatchObject({ quietStart: "22:00", reflectionLimit: 2, eventLimit: 20, topicCooldownMinutes: 5 })
    }),
  )

  it.effect("coordinates idempotent turns per session and rejects stale transitions", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const first = yield* JarvisRuntime.createTurn(db, {
        requestID: "request-live-alpha",
        sessionID: "session-live-alpha",
        surface: "desktop",
        responseMode: "voice",
        phase: "understanding",
      })
      const duplicate = yield* JarvisRuntime.createTurn(db, {
        requestID: "request-live-alpha",
        sessionID: "different-session",
        surface: "quest",
        responseMode: "text",
      })
      expect(duplicate.id).toBe(first.id)
      expect(duplicate.sessionID).toBe("session-live-alpha")
      expect(yield* JarvisRuntime.activeTurn(db, "session-live-alpha")).toMatchObject({ id: first.id })

      const responding = yield* JarvisRuntime.updateTurn(db, first.id, {
        phase: "responding",
        sequence: 1,
        metrics: { firstTextAt: Date.now() },
      })
      expect(responding).toMatchObject({ phase: "responding", sequence: 1 })
      expect(yield* JarvisRuntime.presence(db)).toMatchObject({ turnID: first.id, state: "responding" })
      expect(yield* JarvisRuntime.updateTurn(db, first.id, { phase: "planning", sequence: 2 })).toMatchObject({
        phase: "responding",
        sequence: 1,
      })
      expect(yield* JarvisRuntime.updateTurn(db, first.id, { phase: "completed", sequence: 1 })).toMatchObject({
        phase: "responding",
        sequence: 1,
      })
      expect(yield* JarvisRuntime.cancelTurn(db, first.id, { reason: "barge_in" })).toMatchObject({
        phase: "cancelled",
        cancelReason: "barge_in",
      })
      expect(yield* JarvisRuntime.activeTurn(db, "session-live-alpha")).toBeUndefined()
    }),
  )

  it.effect("hands off presence and audits memory without reviving forgotten sources", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const turn = yield* JarvisRuntime.createTurn(db, {
        requestID: "request-memory-audit",
        sessionID: "session-memory-audit",
        surface: "unity-editor",
        responseMode: "text",
        phase: "understanding",
      })
      expect(
        yield* JarvisRuntime.handoffPresence(db, {
          to: "unity-editor",
          sessionID: turn.sessionID,
          turnID: turn.id,
          microphone: true,
          playback: true,
        }),
      ).toMatchObject({ microphoneOwner: "unity-editor", playbackOwner: "unity-editor", turnID: turn.id })

      const now = Date.now()
      const memory = {
        id: "memory-audit",
        scope: "user" as const,
        kind: "preference" as const,
        text: "Denys likes transparent memory explanations",
        sourceID: "test:memory-audit",
        confidence: 1,
        importance: 1,
        lifecycle: "verified" as const,
        pinned: false,
        conflictsWith: [],
        createdAt: now,
        updatedAt: now,
      }
      yield* JarvisRuntime.remember(db, memory)
      yield* JarvisRuntime.recordMemoryUse(db, {
        turnID: turn.id,
        memoryID: memory.id,
        rank: 0,
        lexicalScore: 0.9,
        semanticScore: 0.4,
        reason: "Matched the user's explicit preference.",
      })
      expect(yield* JarvisRuntime.memoryUses(db, { turnID: turn.id })).toEqual([
        expect.objectContaining({ memoryID: memory.id, lexicalScore: 0.9 }),
      ])
      expect(yield* JarvisRuntime.removeMemory(db, memory.id)).toBe(1)
      yield* JarvisRuntime.remember(db, { ...memory, id: "memory-reimport", updatedAt: Date.now() })
      expect(yield* JarvisRuntime.searchMemory(db, { query: "transparent memory" })).toEqual([])
    }),
  )

  it.effect("redacts replay secrets and upserts a turn without duplicating runs", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const created = yield* JarvisRuntime.recordReplay(db, {
        turnID: "turn-replay-alpha",
        sessionID: "session-replay-alpha",
        surface: "pcvr",
        status: "recording",
        events: [
          {
            sequence: 0,
            type: "turn.started",
            timestamp: Date.now(),
            data: { transcript: "Привіт", token: "must-not-survive", nested: { apiKey: "secret", safe: true } },
          },
        ],
      })
      const completed = yield* JarvisRuntime.recordReplay(db, {
        turnID: "turn-replay-alpha",
        sessionID: "session-replay-alpha",
        surface: "pcvr",
        status: "completed",
        events: [{ sequence: 1, type: "turn.completed", timestamp: Date.now(), data: { result: "ok" } }],
      })
      expect(completed.id).toBe(created.id)
      expect(yield* JarvisRuntime.replays(db)).toEqual([
        expect.objectContaining({ id: created.id, status: "completed", events: [expect.objectContaining({ type: "turn.completed" })] }),
      ])
      expect(created.events[0]?.data).toEqual({ transcript: "Привіт", nested: { safe: true } })
    }),
  )

  it.effect("adopts one canonical conversation and atomically replaces its stale session", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      expect(yield* JarvisRuntime.conversation(db)).toBeUndefined()
      expect(
        yield* JarvisRuntime.adoptConversation(db, {
          sessionID: "session-primary",
          profileID: profile.id,
          profileRevision: profile.revision,
        }),
      ).toMatchObject({ sessionID: "session-primary", profileID: profile.id })
      expect(
        yield* JarvisRuntime.adoptConversation(db, {
          sessionID: "session-recovered",
          profileID: profile.id,
          profileRevision: profile.revision + 1,
        }),
      ).toMatchObject({ sessionID: "session-recovered", profileRevision: profile.revision + 1 })
      expect(yield* JarvisRuntime.conversation(db)).toMatchObject({ sessionID: "session-recovered" })
      expect(
        yield* JarvisRuntime.updateMediaState(db, {
          turnID: "turn-live",
          owner: "quest",
          state: "synthesizing",
          queuedSentences: 2,
          activeJobs: 2,
          acknowledgedCancellation: true,
        }),
      ).toMatchObject({ owner: "quest", queuedSentences: 2, activeJobs: 2 })
      expect((yield* JarvisRuntime.controlStatus(db)).media).toMatchObject({ state: "synthesizing", owner: "quest" })
    }),
  )

  it.effect("executes replays only through fixtures and compares assertion regressions", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const baseline = yield* JarvisRuntime.recordReplay(db, {
        surface: "unity-editor",
        status: "completed",
        events: [
          { sequence: 0, type: "game.action", timestamp: Date.now(), data: { risk: "critical", external: true } },
          { sequence: 1, type: "turn.completed", timestamp: Date.now(), data: {} },
        ],
      })
      const candidate = yield* JarvisRuntime.recordReplay(db, {
        surface: "unity-editor",
        status: "completed",
        events: [
          { sequence: 0, type: "assistant.text.done", timestamp: Date.now(), data: { text: "Ready" } },
          { sequence: 1, type: "turn.completed", timestamp: Date.now(), data: {} },
        ],
      })
      const first = yield* JarvisRuntime.executeReplay(db, baseline.id, { fixtureOnly: false })
      const second = yield* JarvisRuntime.executeReplay(db, candidate.id, { fixtureOnly: true })
      expect(first).toMatchObject({ fixtureOnly: true, status: "completed" })
      expect(first?.assertions.find((assertion) => assertion.id === "side-effects-blocked")).toMatchObject({ passed: true })
      expect(yield* JarvisRuntime.replayExecution(db, first?.id ?? "")).toMatchObject({ replayID: baseline.id })
      expect(
        yield* JarvisRuntime.compareReplayExecutions(db, {
          baselineExecutionID: first?.id ?? "",
          candidateExecutionID: second?.id ?? "",
        }),
      ).toMatchObject({ passed: true, regressions: [] })
    }),
  )

  it.effect("keeps a dismissed initiative topic suppressed", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* JarvisRuntime.syncProfiles(db, { profiles: [profile], primaryProfileID: profile.id })
      const wake = yield* JarvisRuntime.enqueueWake(db, {
        kind: "promise",
        topic: "dismissed-promise",
        text: "A promise is due",
        priority: 5,
      })
      yield* JarvisRuntime.dismissWake(db, wake?.id ?? "")
      expect(
        yield* JarvisRuntime.enqueueWake(db, {
          kind: "promise",
          topic: "dismissed-promise",
          text: "A promise is still due",
          priority: 5,
        }),
      ).toBeUndefined()
    }),
  )
})

describe("Jarvis deterministic routing", () => {
  it.effect("escalates explicit plans and localizes acknowledgements", () =>
    Effect.sync(() => {
      expect(JarvisRuntime.shouldPlan({ text: "Спочатку знайди ключ, потім відкрий двері" })).toBe(true)
      expect(JarvisRuntime.shouldPlan({ text: "Як тебе звати?" })).toBe(false)
      expect(JarvisRuntime.shouldPlan({ text: "один два три чотири", minWords: 4 })).toBe(false)
      expect(JarvisRuntime.shouldPlan({ text: "Склади план і виконай його крок за кроком" })).toBe(true)
      expect(JarvisRuntime.plannerAcknowledgement(profile)).toContain("Прораховую")
    }),
  )
})
