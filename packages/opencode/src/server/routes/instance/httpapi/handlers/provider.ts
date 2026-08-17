import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"

import { mapValues } from "remeda"
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError } from "../groups/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { probeLmStudio } from "@/local-agent-runtime/lmstudio"
import { probeLlamaServer } from "@/local-agent-runtime/llama-server"
import { snapshot } from "@/local-agent-runtime/resource-governor"
import { CapabilityRouter } from "@/local-agent-runtime/capability-router"
import { Database } from "@opencode-ai/core/database/database"
import { SessionExecutionCheckpoint } from "@opencode-ai/core/session/execution-checkpoint"
import { SessionExecutionBudget } from "@/session/execution-budget"

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const database = yield* Database.Service

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
      )
      const lmstudio = config.provider?.lmstudio
      const llamaServer = config.provider?.["llama-server"]
      return {
        all: Object.values(providers).map(Provider.toPublicInfo),
        default: yield* Effect.promise(() =>
          Provider.runtimeDefaultModelIDs(providers, {
            baseURL: lmstudio?.options?.baseURL,
            apiKey: lmstudio?.options?.apiKey,
            llamaServer: {
              baseURL: llamaServer?.options?.baseURL,
              apiKey: llamaServer?.options?.apiKey,
            },
          }),
        ),
        connected: Object.keys(connected),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const lmStudioProbe = Effect.fn("ProviderHttpApi.lmStudioProbe")(function* () {
      const config = yield* cfg.get()
      const info = config.provider?.lmstudio
      return yield* Effect.promise(() =>
        probeLmStudio({
          baseURL: info?.options?.baseURL,
          apiKey: info?.options?.apiKey,
        }),
      )
    })

    const llamaServerProbe = Effect.fn("ProviderHttpApi.llamaServerProbe")(function* () {
      const config = yield* cfg.get()
      const info = config.provider?.["llama-server"]
      return yield* Effect.promise(() =>
        probeLlamaServer({
          baseURL: info?.options?.baseURL,
          apiKey: info?.options?.apiKey,
        }),
      )
    })

    const resourceGovernor = Effect.fn("ProviderHttpApi.resourceGovernor")(function* () {
      return snapshot()
    })

    const capabilityRouter = Effect.fn("ProviderHttpApi.capabilityRouter")(function* () {
      const config = yield* cfg.get()
      const latest = CapabilityRouter.latest(config)
      if (latest) return latest
      return yield* Effect.promise(() =>
        CapabilityRouter.route({
          config,
          requestShape: { textCharacters: 0, files: 0, images: 0, tools: 0 },
        }),
      )
    })

    const agentTurn = Effect.fn("ProviderHttpApi.agentTurn")(function* () {
      return {
        turn: yield* SessionExecutionCheckpoint.latest(database.db),
        limits: {
          classifierTurns: SessionExecutionBudget.limits.classifier_turns,
          ragRetrievals: SessionExecutionBudget.limits.rag_retrievals,
          memoryRetrievals: SessionExecutionBudget.limits.memory_retrievals,
          memoryWrites: SessionExecutionBudget.limits.memory_writes,
          verificationTurns: SessionExecutionBudget.limits.verification_turns,
          criticTurns: SessionExecutionBudget.limits.critic_turns,
          providerTurns: SessionExecutionBudget.limits.provider_turns,
          toolCalls: SessionExecutionBudget.limits.tool_calls,
          compactions: SessionExecutionBudget.limits.compactions,
        },
      }
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      return true
    })

    return handlers
      .handle("list", list)
      .handle("lmStudioProbe", lmStudioProbe)
      .handle("llamaServerProbe", llamaServerProbe)
      .handle("resourceGovernor", resourceGovernor)
      .handle("capabilityRouter", capabilityRouter)
      .handle("agentTurn", agentTurn)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
)
