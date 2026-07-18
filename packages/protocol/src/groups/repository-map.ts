import { Location } from "@opencode-ai/schema/location"
import { RepositoryMap } from "@opencode-ai/schema/repository-map"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

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
  .annotateMerge(
    OpenApi.annotations({
      title: "repositoryMap",
      description: "Location-scoped repository structure index.",
    }),
  )
