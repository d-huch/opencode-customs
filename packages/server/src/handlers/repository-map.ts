import { RepositoryMap } from "@opencode-ai/core/repository-map"
import { RepositoryContextRouter } from "@opencode-ai/core/repository-context-router"
import { RepositoryEmbeddings } from "@opencode-ai/core/repository-embeddings"
import { RepositoryMemory } from "@opencode-ai/core/repository-memory"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const RepositoryMapHandler = HttpApiBuilder.group(Api, "server.repositoryMap", (handlers) =>
  Effect.succeed(
    handlers
      .handle("repositoryMap.get", () => response(RepositoryMap.Service.use((map) => map.load())))
      .handle("repositoryMap.refresh", () => response(RepositoryMap.Service.use((map) => map.refresh())))
      .handle("repositoryMap.diagnostics", () =>
        response(RepositoryContextRouter.Service.use((router) => router.diagnostics())),
      )
      .handle("repositoryMap.configureDiagnostics", (ctx) =>
        response(RepositoryContextRouter.Service.use((router) => router.configureDiagnostics(ctx.payload))),
      )
      .handle("repositoryMap.knowledge", (ctx) =>
        response(
          Effect.all({
            memory: RepositoryMemory.Service.use((memory) =>
              memory.inspect({ search: ctx.query.search, limit: ctx.query.limit }),
            ),
            rag: RepositoryEmbeddings.Service.use((embeddings) =>
              embeddings.inspect({ search: ctx.query.search, limit: ctx.query.limit }),
            ),
          }),
        ),
      )
      .handle("repositoryMap.removeKnowledge", (ctx) =>
        response(
          Effect.gen(function* () {
            const memory = yield* RepositoryMemory.Service
            const embeddings = yield* RepositoryEmbeddings.Service
            const removed =
              ctx.params.scope === "memory"
                ? yield* memory.remove(ctx.params.id)
                : yield* embeddings.remove(ctx.params.id)
            return { removed }
          }),
        ),
      )
      .handle("repositoryMap.clearKnowledge", (ctx) =>
        response(
          Effect.gen(function* () {
            const memory = yield* RepositoryMemory.Service
            const embeddings = yield* RepositoryEmbeddings.Service
            const removed = ctx.params.scope === "memory" ? yield* memory.clear() : yield* embeddings.clear()
            return { removed }
          }),
        ),
      ),
  ),
)
