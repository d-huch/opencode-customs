import { RepositoryMap } from "@opencode-ai/core/repository-map"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const RepositoryMapHandler = HttpApiBuilder.group(Api, "server.repositoryMap", (handlers) =>
  Effect.succeed(
    handlers
      .handle("repositoryMap.get", () => response(RepositoryMap.Service.use((map) => map.load())))
      .handle("repositoryMap.refresh", () => response(RepositoryMap.Service.use((map) => map.refresh()))),
  ),
)
