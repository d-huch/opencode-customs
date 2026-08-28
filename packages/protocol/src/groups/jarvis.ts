import { Jarvis } from "@opencode-ai/schema/jarvis"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export { Jarvis }

export const JarvisGroup = HttpApiGroup.make("server.jarvis")
  .add(
    HttpApiEndpoint.get("jarvis.conversation", "/api/jarvis/conversation", {
      success: Jarvis.ConversationState,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.conversation", summary: "Get or recover the canonical Primary Jarvis session" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.adoptConversation", "/api/jarvis/conversation/adopt", {
      payload: Jarvis.ConversationAdopt,
      success: Jarvis.ConversationState,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.adoptConversation", summary: "Atomically adopt or recover the canonical Jarvis session" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.prewarm", "/api/jarvis/turns/prewarm", {
      payload: Jarvis.PartialTranscript,
      success: Jarvis.PrewarmState,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.prewarm", summary: "Prewarm a Jarvis turn without admitting a message" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.admitFinal", "/api/jarvis/turns/admit", {
      payload: Jarvis.FinalAdmission,
      success: Jarvis.FinalAdmissionResult,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.admitFinal", summary: "Atomically admit a final transcript to the canonical Jarvis session" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.controlStatus", "/api/jarvis/control", { success: Jarvis.ControlStatus }).annotateMerge(
      OpenApi.annotations({ identifier: "v2.jarvis.controlStatus", summary: "Get aggregated Jarvis Live status" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("jarvis.updateMediaState", "/api/jarvis/media", {
      payload: Jarvis.MediaStateUpdate,
      success: Jarvis.MediaState,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.updateMediaState", summary: "Update the live Jarvis media queue snapshot" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.runDiagnostics", "/api/jarvis/diagnostics", { success: Jarvis.Diagnostics }).annotateMerge(
      OpenApi.annotations({ identifier: "v2.jarvis.runDiagnostics", summary: "Run bounded Jarvis diagnostics" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("jarvis.createTurn", "/api/jarvis/turns", {
      payload: Jarvis.TurnCreate,
      success: Jarvis.Turn,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.createTurn", summary: "Create or adopt an idempotent Jarvis turn" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.currentTurn", "/api/jarvis/turns/current", {
      success: Schema.NullOr(Jarvis.Turn),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.currentTurn", summary: "Get the latest Jarvis turn" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.turn", "/api/jarvis/turns/:turnID", {
      params: { turnID: Schema.String },
      success: Schema.NullOr(Jarvis.Turn),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.turn", summary: "Get a Jarvis turn" })),
  )
  .add(
    HttpApiEndpoint.patch("jarvis.updateTurn", "/api/jarvis/turns/:turnID", {
      params: { turnID: Schema.String },
      payload: Jarvis.TurnUpdate,
      success: Schema.NullOr(Jarvis.Turn),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.updateTurn", summary: "Advance a Jarvis turn" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.cancelTurn", "/api/jarvis/turns/:turnID/cancel", {
      params: { turnID: Schema.String },
      payload: Jarvis.TurnCancel,
      success: Schema.NullOr(Jarvis.Turn),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.cancelTurn", summary: "Cancel a Jarvis turn" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.presence", "/api/jarvis/presence", { success: Jarvis.Presence }).annotateMerge(
      OpenApi.annotations({ identifier: "v2.jarvis.presence", summary: "Get Jarvis surface ownership" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("jarvis.handoffPresence", "/api/jarvis/presence/handoff", {
      payload: Jarvis.PresenceHandoff,
      success: Jarvis.Presence,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.handoffPresence", summary: "Transfer Jarvis media ownership" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.status", "/api/jarvis/status", { success: Jarvis.RuntimeStatus }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.jarvis.status",
        summary: "Get Jarvis runtime status",
        description: "Inspect the Primary Jarvis profile, local model roles, goals, Inbox, and memory diagnostics.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("jarvis.config", "/api/jarvis/config", { success: Jarvis.Config }).annotateMerge(
      OpenApi.annotations({ identifier: "v2.jarvis.config", summary: "Get Jarvis configuration" }),
    ),
  )
  .add(
    HttpApiEndpoint.put("jarvis.updateConfig", "/api/jarvis/config", {
      payload: Jarvis.Config,
      success: Jarvis.Config,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.updateConfig", summary: "Update Jarvis configuration" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.benchmarkStatus", "/api/jarvis/benchmark", {
      success: Jarvis.BenchmarkState,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.benchmarkStatus", summary: "Get Jarvis model benchmark status" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.runBenchmark", "/api/jarvis/benchmark", {
      payload: Jarvis.BenchmarkRun,
      success: Jarvis.BenchmarkState,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.runBenchmark", summary: "Benchmark local Jarvis models sequentially" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.cancelBenchmark", "/api/jarvis/benchmark/cancel", {
      success: Jarvis.BenchmarkState,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.cancelBenchmark", summary: "Cancel a running Jarvis model benchmark" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.profiles", "/api/jarvis/profiles", {
      success: Schema.Array(Jarvis.ProfileSnapshot),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.profiles", summary: "List synchronized Jarvis profiles" })),
  )
  .add(
    HttpApiEndpoint.put("jarvis.syncProfiles", "/api/jarvis/profiles", {
      payload: Jarvis.ProfileSync,
      success: Schema.Array(Jarvis.ProfileSnapshot),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.syncProfiles", summary: "Synchronize sanitized Jarvis profiles" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.goals", "/api/jarvis/goals", {
      query: Schema.Struct({ status: Schema.optional(Jarvis.Goal.fields.status) }),
      success: Schema.Array(Jarvis.Goal),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.goals", summary: "List durable Jarvis goals" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.createGoal", "/api/jarvis/goals", {
      payload: Jarvis.GoalCreate,
      success: Jarvis.Goal,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.createGoal", summary: "Create a durable Jarvis goal" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.resumeGoal", "/api/jarvis/goals/:goalID/resume", {
      params: { goalID: Schema.String },
      payload: Jarvis.GoalResume,
      success: Schema.NullOr(Jarvis.Goal),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.resumeGoal", summary: "Resume a revalidated Jarvis goal" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.replanGoal", "/api/jarvis/goals/:goalID/replan", {
      params: { goalID: Schema.String },
      payload: Jarvis.GoalReplan,
      success: Schema.NullOr(Jarvis.Goal),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.replanGoal", summary: "Discard and rebuild a Jarvis goal plan" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.cancelGoal", "/api/jarvis/goals/:goalID/cancel", {
      params: { goalID: Schema.String },
      payload: Jarvis.GoalCancel,
      success: Schema.NullOr(Jarvis.GoalOutcome),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.cancelGoal", summary: "Cancel a durable Jarvis goal" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.recordGoalStep", "/api/jarvis/goals/:goalID/steps/result", {
      params: { goalID: Schema.String },
      payload: Jarvis.GoalStepResult,
      success: Schema.NullOr(Jarvis.Goal),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.recordGoalStep", summary: "Record a Jarvis plan step result" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.outcomes", "/api/jarvis/outcomes", {
      query: Schema.Struct({ goalID: Schema.optional(Schema.String) }),
      success: Schema.Array(Jarvis.GoalOutcome),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.outcomes", summary: "List durable Jarvis goal outcomes" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.completeGoal", "/api/jarvis/goals/:goalID/outcome", {
      params: { goalID: Schema.String },
      payload: Jarvis.GoalOutcomeCreate,
      success: Schema.NullOr(Jarvis.GoalOutcome),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.completeGoal", summary: "Complete a durable Jarvis goal" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.searchMemory", "/api/jarvis/memory/search", {
      payload: Jarvis.MemorySearch,
      success: Schema.Array(Jarvis.MemoryRecord),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.searchMemory", summary: "Search hybrid Jarvis memory" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.remember", "/api/jarvis/memory", {
      payload: Jarvis.MemoryRecord,
      success: Jarvis.MemoryRecord,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.remember", summary: "Store a Jarvis memory record" })),
  )
  .add(
    HttpApiEndpoint.delete("jarvis.removeMemory", "/api/jarvis/memory/:memoryID", {
      params: { memoryID: Schema.String },
      success: Jarvis.MemoryMutation,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.removeMemory", summary: "Delete a Jarvis memory record" })),
  )
  .add(
    HttpApiEndpoint.patch("jarvis.patchMemory", "/api/jarvis/memory/:memoryID", {
      params: { memoryID: Schema.String },
      payload: Jarvis.MemoryPatch,
      success: Schema.NullOr(Jarvis.MemoryRecord),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.patchMemory", summary: "Edit or classify a Jarvis memory record" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.resolveMemoryConflict", "/api/jarvis/memory/:memoryID/conflict", {
      params: { memoryID: Schema.String },
      payload: Jarvis.MemoryConflictResolution,
      success: Schema.NullOr(Jarvis.MemoryRecord),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.resolveMemoryConflict", summary: "Resolve a Jarvis memory conflict" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.reindexMemory", "/api/jarvis/memory/reindex", {
      success: Jarvis.MemoryBackfillResult,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.reindexMemory", summary: "Schedule bounded Jarvis memory embedding backfill" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.memoryUses", "/api/jarvis/memory/uses", {
      query: Schema.Struct({
        memoryID: Schema.optional(Schema.String),
        turnID: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.NumberFromString),
      }),
      success: Schema.Array(Jarvis.MemoryUse),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.memoryUses", summary: "Explain Jarvis memory recall" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.recordMemoryUse", "/api/jarvis/memory/uses", {
      payload: Jarvis.MemoryUseCreate,
      success: Jarvis.MemoryUse,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.recordMemoryUse", summary: "Record a Jarvis memory recall decision" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.replays", "/api/jarvis/replays", {
      query: Schema.Struct({ limit: Schema.optional(Schema.NumberFromString) }),
      success: Schema.Array(Jarvis.ReplayRun),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.replays", summary: "List bounded Jarvis replay runs" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.recordReplay", "/api/jarvis/replays", {
      payload: Jarvis.ReplayCreate,
      success: Jarvis.ReplayRun,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.recordReplay", summary: "Store a sanitized Jarvis replay run" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.replay", "/api/jarvis/replays/:replayID", {
      params: { replayID: Schema.String },
      success: Schema.NullOr(Jarvis.ReplayRun),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.replay", summary: "Get a Jarvis replay run" })),
  )
  .add(
    HttpApiEndpoint.delete("jarvis.removeReplay", "/api/jarvis/replays/:replayID", {
      params: { replayID: Schema.String },
      success: Jarvis.ReplayMutation,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.removeReplay", summary: "Delete a Jarvis replay run" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.executeReplay", "/api/jarvis/replays/:replayID/execute", {
      params: { replayID: Schema.String },
      payload: Jarvis.ReplayExecute,
      success: Schema.NullOr(Jarvis.ReplayExecution),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.executeReplay", summary: "Execute a Jarvis replay through fixture-only adapters" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.replayExecution", "/api/jarvis/replay-executions/:executionID", {
      params: { executionID: Schema.String },
      success: Schema.NullOr(Jarvis.ReplayExecution),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.replayExecution", summary: "Get a Jarvis replay execution" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.compareReplays", "/api/jarvis/replay-executions/compare", {
      payload: Jarvis.ReplayCompare,
      success: Schema.NullOr(Jarvis.ReplayComparison),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.compareReplays", summary: "Compare two Jarvis replay executions" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.inbox", "/api/jarvis/inbox", {
      success: Schema.Array(Jarvis.WakeCandidate),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.inbox", summary: "List Primary Jarvis Inbox candidates" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.wake", "/api/jarvis/wake", {
      payload: Jarvis.WakeCreate,
      success: Schema.NullOr(Jarvis.WakeCandidate),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.wake", summary: "Queue a bounded Jarvis wake candidate" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.dismissInbox", "/api/jarvis/inbox/:wakeID/dismiss", {
      params: { wakeID: Schema.String },
      success: Schema.NullOr(Jarvis.WakeCandidate),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.dismissInbox", summary: "Dismiss a Jarvis Inbox item" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.retryInbox", "/api/jarvis/inbox/:wakeID/retry", {
      params: { wakeID: Schema.String },
      success: Schema.NullOr(Jarvis.WakeCandidate),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.retryInbox", summary: "Retry a blocked Jarvis Inbox item" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.companionStatus", "/api/jarvis/companion/status", {
      success: Jarvis.DailyCompanionStatus,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.companionStatus", summary: "Get Daily Companion status" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.companionConfig", "/api/jarvis/companion/config", {
      success: Jarvis.DailyCompanionConfig,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.companionConfig", summary: "Get Daily Companion configuration" })),
  )
  .add(
    HttpApiEndpoint.put("jarvis.updateCompanionConfig", "/api/jarvis/companion/config", {
      payload: Jarvis.DailyCompanionConfig,
      success: Jarvis.DailyCompanionConfig,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.updateCompanionConfig", summary: "Update Daily Companion configuration" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.runDailyBriefing", "/api/jarvis/companion/briefings/run", {
      payload: Jarvis.DailyBriefingRunRequest,
      success: Jarvis.DailyBriefingRun,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.runDailyBriefing", summary: "Run a bounded daily briefing" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.dailyBriefings", "/api/jarvis/companion/briefings", {
      query: Schema.Struct({ limit: Schema.optional(Schema.NumberFromString) }),
      success: Schema.Array(Jarvis.DailyBriefing),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.dailyBriefings", summary: "List daily briefings" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.dailyBriefing", "/api/jarvis/companion/briefings/:briefingID", {
      params: { briefingID: Schema.String },
      success: Schema.NullOr(Jarvis.DailyBriefing),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.dailyBriefing", summary: "Get a daily briefing" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.prepareCompanionAction", "/api/jarvis/companion/actions", {
      payload: Jarvis.CompanionActionPrepare,
      success: Jarvis.CompanionActionProposal,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.prepareCompanionAction", summary: "Prepare a companion action for approval" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.companionActions", "/api/jarvis/companion/actions", {
      query: Schema.Struct({ limit: Schema.optional(Schema.NumberFromString) }),
      success: Schema.Array(Jarvis.CompanionActionProposal),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.companionActions", summary: "List companion action proposals" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.approveCompanionAction", "/api/jarvis/companion/actions/:actionID/approve", {
      params: { actionID: Schema.String },
      payload: Jarvis.CompanionActionApprove,
      success: Schema.NullOr(Jarvis.CompanionActionExecution),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.approveCompanionAction", summary: "Approve one companion action" })),
  )
  .add(
    HttpApiEndpoint.post("jarvis.cancelCompanionAction", "/api/jarvis/companion/actions/:actionID/cancel", {
      params: { actionID: Schema.String },
      success: Schema.NullOr(Jarvis.CompanionActionProposal),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.cancelCompanionAction", summary: "Cancel a prepared companion action" })),
  )
  .add(
    HttpApiEndpoint.get("jarvis.companionActionAudit", "/api/jarvis/companion/actions/audit", {
      query: Schema.Struct({ limit: Schema.optional(Schema.NumberFromString) }),
      success: Schema.Array(Jarvis.CompanionActionExecution),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.jarvis.companionActionAudit", summary: "List confirmed companion action executions" })),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "jarvis",
      description: "Local-first Jarvis profiles, model roles, durable goals, hybrid memory, and initiative Inbox.",
    }),
  )
