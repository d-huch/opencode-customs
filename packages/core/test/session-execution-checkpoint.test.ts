import { describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecutionCheckpoint } from "@opencode-ai/core/session/execution-checkpoint"
import { SessionExecutionCheckpointTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"
import { ModelCapabilityRouter } from "@opencode-ai/core/model-capability-router"
import { ChangeRisk } from "@opencode-ai/core/change-risk"
import { VerificationMatrix } from "@opencode-ai/core/verification-matrix"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node])))

const setup = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: sessionID,
        directory: "/project",
        title: "checkpoint",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    return db
  })

describe("SessionExecutionCheckpoint", () => {
  it.effect("persists execution phases and terminal completion", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_checkpoint_phases")
      const db = yield* setup(sessionID)
      const checkpoint = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v2")
      const route = ModelCapabilityRouter.plan({
        providerID: "lmstudio",
        pressure: "healthy",
        complexity: "medium",
        preferredModelID: "coding",
        candidates: [
          {
            providerID: "lmstudio",
            modelID: "coding",
            name: "Coding",
            loaded: true,
            type: "llm",
            context: 16_384,
            capabilities: { tools: true, vision: false, reasoning: true, embeddings: false },
          },
        ],
      })
      const activated = {
        ...route,
        activation: {
          status: "switched" as const,
          checkedAt: Date.now(),
          role: "coding" as const,
          requestedModelID: "coding",
          activeModelID: "coding",
          activeInstanceID: "coding-instance",
          attempts: 1,
          failover: false,
          rollback: false,
          reason: ["switch.ready"],
        },
        vision: {
          status: "completed" as const,
          checkedAt: Date.now(),
          modelID: "coding",
          instanceID: "coding-instance",
          imageCount: 1,
          originalBytes: 4_096,
          preparedBytes: 2_048,
          estimatedTokens: 170,
          requestTokens: 2_400,
          assistantMessageID: "msg_vision_result",
          failover: false,
          reason: ["vision.file_reference", "vision.compressed", "vision.completed"],
          artifacts: [
            {
              fileURL: "file:///runtime/vision/screenshot.jpg",
              filename: "screenshot.jpg",
              mime: "image/jpeg",
              originalWidth: 1_440,
              originalHeight: 900,
              originalBytes: 4_096,
              preparedWidth: 1_024,
              preparedHeight: 640,
              preparedBytes: 2_048,
              compressed: true,
              estimatedTokens: 170,
              reason: ["vision.file_reference", "vision.compressed"],
            },
          ],
        },
      }
      const risk = ChangeRisk.classify({
        tool: "write",
        args: { filePath: "/project/src/permissions/access.ts" },
        root: "/project",
        declared: true,
      })
      const verificationPlan = VerificationMatrix.select({
        files: risk.files,
        risk,
      })

      expect(checkpoint.recovered).toBe(false)
      expect(yield* SessionExecutionCheckpoint.bindRequest(db, checkpoint, "msg_request")).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.pinModel(db, checkpoint, {
          providerID: "lmstudio",
          modelID: "coding",
          instanceID: "coding-instance",
        }),
      ).toBe(true)
      expect(yield* SessionExecutionCheckpoint.setPhase(db, checkpoint, { phase: "classify", step: 1 })).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.consume(db, checkpoint, { counter: "classifier_turns", limit: 1 }),
      ).toEqual({ used: 1 })
      expect(yield* SessionExecutionCheckpoint.setPhase(db, checkpoint, { phase: "recall", step: 1 })).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.consume(db, checkpoint, { counter: "rag_retrievals", limit: 1 }),
      ).toEqual({ used: 1 })
      expect(
        yield* SessionExecutionCheckpoint.consume(db, checkpoint, { counter: "memory_retrievals", limit: 1 }),
      ).toEqual({ used: 1 })
      expect(yield* SessionExecutionCheckpoint.setRepositoryContext(db, checkpoint, "repository context")).toBe(true)
      expect(yield* SessionExecutionCheckpoint.setMemoryContext(db, checkpoint, ["User prefers Ukrainian."])).toBe(true)
      expect(yield* SessionExecutionCheckpoint.setPhase(db, checkpoint, { phase: "execute", step: 2 })).toBe(true)
      expect(yield* SessionExecutionCheckpoint.setModelRoute(db, checkpoint, activated)).toBe(true)
      expect(yield* SessionExecutionCheckpoint.setRiskAssessment(db, checkpoint, risk)).toBe(true)
      expect(yield* SessionExecutionCheckpoint.setVerificationPlan(db, checkpoint, verificationPlan)).toBe(true)
      expect(yield* SessionExecutionCheckpoint.advance(db, checkpoint, { state: "streaming", step: 2 })).toBe(true)
      expect(yield* SessionExecutionCheckpoint.advance(db, checkpoint, { state: "verifying", step: 3 })).toBe(true)
      expect(yield* SessionExecutionCheckpoint.advance(db, checkpoint, { state: "repairing", step: 4 })).toBe(true)
      expect(yield* SessionExecutionCheckpoint.advance(db, checkpoint, { state: "verified", step: 5 })).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.consume(db, checkpoint, { counter: "evidence_attempts", limit: 2 }),
      ).toEqual({ used: 1 })
      expect(
        yield* SessionExecutionCheckpoint.consume(db, checkpoint, { counter: "evidence_attempts", limit: 2 }),
      ).toEqual({ used: 2 })
      expect(
        yield* SessionExecutionCheckpoint.consume(db, checkpoint, { counter: "evidence_attempts", limit: 2 }),
      ).toBeUndefined()
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        execution_id: checkpoint.executionID,
        runtime: "v2",
        generation: 1,
        state: "verified",
        step: 5,
        owner_pid: process.pid,
        phase: "execute",
        request_message_id: "msg_request",
        model_route: activated,
        risk_assessment: risk,
        verification_plan: verificationPlan,
        selected_provider_id: "lmstudio",
        selected_model_id: "coding",
        selected_instance_id: "coding-instance",
        repository_context: "repository context",
        memory_context: ["User prefers Ukrainian."],
        evidence_attempts: 2,
        classifier_turns: 1,
        rag_retrievals: 1,
        memory_retrievals: 1,
        provider_turns: 0,
        tool_calls: 0,
        compactions: 0,
      })

      expect(yield* SessionExecutionCheckpoint.finish(db, checkpoint, { state: "completed" })).toBe(true)
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        state: "completed",
        phase: "complete",
        time_completed: expect.any(Number),
      })
      expect(yield* SessionExecutionCheckpoint.latest(db)).toMatchObject({
        sessionID,
        phase: "complete",
        selectedModelID: "coding",
        counters: {
          evidenceAttempts: 2,
          classifierTurns: 1,
          ragRetrievals: 1,
          memoryRetrievals: 1,
        },
      })
    }),
  )

  it.effect("preserves evidence budgets across compaction and recovery while rejecting stale writes", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_checkpoint_recovery")
      const db = yield* setup(sessionID)
      const abandoned = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v2")
      expect(yield* SessionExecutionCheckpoint.consume(db, abandoned, { counter: "tool_calls", limit: 4 })).toEqual({
        used: 1,
      })
      expect(
        yield* SessionExecutionCheckpoint.consume(db, abandoned, { counter: "evidence_attempts", limit: 2 }),
      ).toEqual({ used: 1 })
      expect(yield* SessionExecutionCheckpoint.consume(db, abandoned, { counter: "compactions", limit: 12 })).toEqual({
        used: 1,
      })
      const verificationPlan = VerificationMatrix.select({ files: ["src/service.ts"] })
      expect(yield* SessionExecutionCheckpoint.setVerificationPlan(db, abandoned, verificationPlan)).toBe(true)
      yield* db
        .update(SessionExecutionCheckpointTable)
        .set({ state: "continuing", owner_pid: 2_147_483_647 })
        .where(eq(SessionExecutionCheckpointTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)

      expect(yield* SessionExecutionCheckpoint.abandoned(db, "v2")).toEqual([sessionID])
      expect(yield* SessionExecutionCheckpoint.abandoned(db, "v1")).toEqual([])
      const recovered = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v2")

      expect(recovered.recovered).toBe(true)
      expect(recovered.generation).toBe(2)
      expect(
        yield* SessionExecutionCheckpoint.setModelRoute(
          db,
          abandoned,
          ModelCapabilityRouter.plan({
            providerID: "lmstudio",
            pressure: "critical",
            complexity: "high",
            candidates: [],
          }),
        ),
      ).toBe(false)
      expect(yield* SessionExecutionCheckpoint.advance(db, abandoned, { state: "streaming", step: 3 })).toBe(false)
      expect(
        yield* SessionExecutionCheckpoint.setVerificationPlan(
          db,
          abandoned,
          VerificationMatrix.select({ files: ["src/stale.ts"] }),
        ),
      ).toBe(false)
      expect(
        yield* SessionExecutionCheckpoint.consume(db, recovered, { counter: "evidence_attempts", limit: 2 }),
      ).toEqual({ used: 2 })
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        execution_id: recovered.executionID,
        generation: 2,
        state: "preparing",
        recoveries: 1,
        evidence_attempts: 2,
        compactions: 1,
        tool_calls: 1,
        verification_plan: verificationPlan,
      })
      expect(
        yield* SessionExecutionCheckpoint.consume(db, abandoned, { counter: "tool_calls", limit: 4 }),
      ).toBeUndefined()
    }),
  )

  it.effect("starts a fresh budget boundary when a queued request is promoted", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_checkpoint_next_request")
      const db = yield* setup(sessionID)
      const checkpoint = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v1")

      expect(yield* SessionExecutionCheckpoint.bindRequest(db, checkpoint, "msg_first")).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.pinModel(db, checkpoint, {
          providerID: "lmstudio",
          modelID: "coding",
          instanceID: "coding-instance",
        }),
      ).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.consume(db, checkpoint, { counter: "classifier_turns", limit: 1 }),
      ).toEqual({ used: 1 })
      expect(
        yield* SessionExecutionCheckpoint.consume(db, checkpoint, { counter: "provider_turns", limit: 12 }),
      ).toEqual({ used: 1 })
      expect(yield* SessionExecutionCheckpoint.setRepositoryContext(db, checkpoint, "first context")).toBe(true)
      expect(yield* SessionExecutionCheckpoint.setMemoryContext(db, checkpoint, ["first memory"])).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.setRiskAssessment(
          db,
          checkpoint,
          ChangeRisk.classify({
            tool: "write",
            args: { filePath: "/project/database/migrations/change.sql" },
            root: "/project",
            declared: true,
          }),
        ),
      ).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.setVerificationPlan(
          db,
          checkpoint,
          VerificationMatrix.select({ files: ["src/service.ts"] }),
        ),
      ).toBe(true)

      expect(
        yield* SessionExecutionCheckpoint.advanceRequest(db, checkpoint, {
          previousMessageID: "msg_first",
          messageID: "msg_second",
          step: 2,
        }),
      ).toBe(true)
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        request_message_id: "msg_second",
        phase: "classify",
        step: 2,
        classifier_turns: 0,
        provider_turns: 0,
        selected_provider_id: null,
        selected_model_id: null,
        selected_instance_id: null,
        repository_context: null,
        memory_context: null,
        risk_assessment: null,
        verification_plan: null,
      })
    }),
  )

  it.effect("persists pipeline phases and rejects stale generation updates", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_checkpoint_pipeline")
      const db = yield* setup(sessionID)
      const abandoned = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v1")

      expect(yield* SessionExecutionCheckpoint.bindRequest(db, abandoned, "msg_first")).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.setPipelinePhase(db, abandoned, {
          phase: "prompt_admission",
          status: "completed",
        }),
      ).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.setPipelinePhase(db, abandoned, {
          phase: "classification",
          status: "running",
        }),
      ).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.setPipelinePhase(db, abandoned, {
          phase: "classification",
          status: "completed",
          detail: "repository",
        }),
      ).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.setPipelinePhase(db, abandoned, {
          phase: "classification",
          status: "skipped",
          detail: "continuation",
        }),
      ).toBe(true)

      const classified = yield* SessionExecutionCheckpoint.load(db, sessionID)
      expect(classified?.pipeline_state.find((item) => item.phase === "classification")).toMatchObject({
        status: "completed",
        detail: "repository",
        startedAt: expect.any(Number),
        completedAt: expect.any(Number),
      })

      yield* db
        .update(SessionExecutionCheckpointTable)
        .set({ state: "continuing", owner_pid: 2_147_483_647 })
        .where(eq(SessionExecutionCheckpointTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      const recovered = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v1")

      expect(
        yield* SessionExecutionCheckpoint.setPipelinePhase(db, abandoned, {
          phase: "repository_recall",
          status: "completed",
        }),
      ).toBe(false)
      expect(
        yield* SessionExecutionCheckpoint.setPipelinePhase(db, recovered, {
          phase: "execution",
          status: "running",
        }),
      ).toBe(true)
      expect(yield* SessionExecutionCheckpoint.finish(db, recovered, { state: "interrupted" })).toBe(true)

      const interrupted = yield* SessionExecutionCheckpoint.load(db, sessionID)
      expect(interrupted?.pipeline_state.find((item) => item.phase === "execution")).toMatchObject({
        status: "cancelled",
        completedAt: expect.any(Number),
      })
      expect(interrupted?.pipeline_state.find((item) => item.phase === "completion")).toMatchObject({
        status: "cancelled",
        completedAt: expect.any(Number),
      })
    }),
  )

  it.effect("persists one critic pass across recovery and resets it for the next request", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_checkpoint_critic")
      const db = yield* setup(sessionID)
      const abandoned = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v1")
      const review = {
        requestMessageID: "msg_first",
        status: "pending" as const,
        model: { providerID: "lmstudio", modelID: "strong" },
        files: ["src/a.ts"],
        findings: [],
        startedAt: 1,
      }

      expect(yield* SessionExecutionCheckpoint.bindRequest(db, abandoned, "msg_first")).toBe(true)
      expect(
        yield* SessionExecutionCheckpoint.consume(db, abandoned, {
          counter: "critic_turns",
          limit: 1,
        }),
      ).toEqual({ used: 1 })
      expect(
        yield* SessionExecutionCheckpoint.consume(db, abandoned, {
          counter: "critic_turns",
          limit: 1,
        }),
      ).toBeUndefined()
      expect(yield* SessionExecutionCheckpoint.setCriticPass(db, abandoned, review)).toBe(true)

      yield* db
        .update(SessionExecutionCheckpointTable)
        .set({ state: "reviewing", owner_pid: 2_147_483_647 })
        .where(eq(SessionExecutionCheckpointTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      const recovered = yield* SessionExecutionCheckpoint.begin(db, sessionID, "v1")
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        execution_id: recovered.executionID,
        generation: 2,
        critic_turns: 1,
        critic_pass: review,
      })
      expect(
        yield* SessionExecutionCheckpoint.setCriticPass(db, abandoned, {
          ...review,
          status: "clean",
          completedAt: 2,
        }),
      ).toBe(false)
      expect(
        yield* SessionExecutionCheckpoint.pinReviewerModel(db, abandoned, {
          providerID: "lmstudio",
          modelID: "stale-reviewer",
          instanceID: "stale-reviewer-instance",
        }),
      ).toBe(false)
      expect(
        yield* SessionExecutionCheckpoint.pinReviewerModel(db, recovered, {
          providerID: "lmstudio",
          modelID: "reviewer",
          instanceID: "reviewer-instance",
        }),
      ).toBe(true)
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        selected_provider_id: "lmstudio",
        selected_model_id: "reviewer",
        selected_instance_id: "reviewer-instance",
      })

      expect(
        yield* SessionExecutionCheckpoint.advanceRequest(db, recovered, {
          previousMessageID: "msg_first",
          messageID: "msg_second",
          step: 2,
        }),
      ).toBe(true)
      expect(yield* SessionExecutionCheckpoint.load(db, sessionID)).toMatchObject({
        request_message_id: "msg_second",
        critic_turns: 0,
        critic_pass: null,
      })
    }),
  )
})
