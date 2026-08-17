import { Jarvis } from "@opencode-ai/schema/jarvis"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const JarvisGroup = HttpApiGroup.make("server.jarvis")
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
  .annotateMerge(
    OpenApi.annotations({
      title: "jarvis",
      description: "Local-first Jarvis profiles, model roles, durable goals, hybrid memory, and initiative Inbox.",
    }),
  )
