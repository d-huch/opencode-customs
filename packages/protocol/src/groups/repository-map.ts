import { Location } from "@opencode-ai/schema/location"
import { RepositoryMap } from "@opencode-ai/schema/repository-map"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const KnowledgeQuery = Schema.Struct({
  location: LocationQuery.fields.location,
  search: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500)),
  ),
})

export const RepositoryMapGroup = HttpApiGroup.make("server.repositoryMap")
  .add(
    HttpApiEndpoint.get("repositoryMap.get", "/api/repository-map", {
      query: LocationQuery,
      success: Location.response(RepositoryMap.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.get",
          summary: "Get repository map",
          description: "Get the current incremental structural index for the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("repositoryMap.refresh", "/api/repository-map/refresh", {
      query: LocationQuery,
      success: Location.response(RepositoryMap.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.refresh",
          summary: "Refresh repository map",
          description: "Rebuild the structural index for the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("repositoryMap.diagnostics", "/api/repository-map/diagnostics", {
      query: LocationQuery,
      success: Location.response(RepositoryMap.Diagnostics),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.diagnostics",
          summary: "Get repository diagnostics",
          description: "Get the location-scoped repository routing and LSP diagnostic timeline.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("repositoryMap.configureDiagnostics", "/api/repository-map/diagnostics", {
      query: LocationQuery,
      payload: RepositoryMap.DiagnosticsConfig,
      success: Location.response(RepositoryMap.Diagnostics),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.configureDiagnostics",
          summary: "Configure repository diagnostics",
          description: "Enable, disable, or clear the location-scoped diagnostic timeline.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("repositoryMap.knowledge", "/api/repository-map/knowledge", {
      query: KnowledgeQuery,
      success: Location.response(RepositoryMap.Knowledge),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.knowledge",
          summary: "Inspect repository RAG and memory",
          description:
            "Inspect location-scoped repository memory and embedding index metadata without returning vector payloads.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("repositoryMap.removeKnowledge", "/api/repository-map/knowledge/:scope/:id", {
      params: { scope: RepositoryMap.KnowledgeScope, id: Schema.String },
      query: LocationQuery,
      success: Location.response(RepositoryMap.KnowledgeMutation),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.removeKnowledge",
          summary: "Remove a repository knowledge entry",
          description: "Remove one location-scoped memory item or RAG chunk by ID.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("repositoryMap.updateMemory", "/api/repository-map/knowledge/memory/:id", {
      params: { id: Schema.String },
      query: LocationQuery,
      payload: RepositoryMap.MemoryLifecycleUpdate,
      success: Location.response(RepositoryMap.KnowledgeMutation),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.updateMemory",
          summary: "Update a memory lifecycle",
          description: "Pin, expire, or resolve a conflicted location-scoped memory item.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get(
      "repositoryMap.previewMemoryConsolidation",
      "/api/repository-map/knowledge/memory/consolidation",
      {
        query: LocationQuery,
        success: Location.response(RepositoryMap.MemoryConsolidationPreview),
      },
    )
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.previewMemoryConsolidation",
          summary: "Preview memory consolidation",
          description:
            "Build a deterministic, non-mutating preview for duplicate removal, conflict resolution, confidence maintenance, and archival.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "repositoryMap.applyMemoryConsolidation",
      "/api/repository-map/knowledge/memory/consolidation",
      {
        query: LocationQuery,
        payload: RepositoryMap.MemoryConsolidationApply,
        success: Location.response(RepositoryMap.MemoryConsolidationResult),
      },
    )
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.applyMemoryConsolidation",
          summary: "Apply memory consolidation",
          description:
            "Apply a previously reviewed consolidation preview only when its fingerprint still matches the memory store.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("repositoryMap.feedbackRetrieval", "/api/repository-map/knowledge/retrieval/:id", {
      params: { id: Schema.String },
      query: LocationQuery,
      payload: RepositoryMap.RetrievalFeedback,
      success: Location.response(RepositoryMap.KnowledgeMutation),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.feedbackRetrieval",
          summary: "Record repository retrieval feedback",
          description:
            "Mark a selected repository file as used, irrelevant, or unreviewed so future retrievals can learn from explicit feedback.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("repositoryMap.clearKnowledge", "/api/repository-map/knowledge/:scope", {
      params: { scope: RepositoryMap.KnowledgeScope },
      query: LocationQuery,
      success: Location.response(RepositoryMap.KnowledgeMutation),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.repositoryMap.clearKnowledge",
          summary: "Clear repository knowledge",
          description: "Clear all location-scoped memory items or RAG chunks for the selected store.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "repositoryMap",
      description: "Location-scoped repository structure index.",
    }),
  )
