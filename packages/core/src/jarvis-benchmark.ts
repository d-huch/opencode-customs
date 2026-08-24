export * as JarvisBenchmark from "./jarvis-benchmark"

import { Jarvis } from "@opencode-ai/schema/jarvis"
import { LLM, LLMEvent, SystemPart } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import type { LLMClientShape } from "@opencode-ai/llm/route"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { Catalog } from "./catalog"
import { Database } from "./database/database"
import { makeLocationNode } from "./effect/app-node"
import { llmClient } from "./effect/app-node-platform"
import { JarvisRuntime } from "./jarvis"
import { ModelV2 } from "./model"
import { SessionRunnerModel } from "./session/runner/model"

const TTL = 7 * 24 * 60 * 60_000
const ToolGate = Schema.Struct({ marker: Schema.Literal("PULSE-7"), ok: Schema.Literal(true) })

export interface Interface {
  readonly status: () => Effect.Effect<Jarvis.BenchmarkState>
  readonly run: (profile: Jarvis.ReactorProfile) => Effect.Effect<Jarvis.BenchmarkState, Error>
  readonly cancel: () => Effect.Effect<Jarvis.BenchmarkState>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/JarvisBenchmark") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const database = yield* Database.Service
    const llm = yield* LLMClient.Service
    let cancelled = false

    const status = Effect.fn("JarvisBenchmark.status")(function* () {
      return (yield* JarvisRuntime.getConfig(database.db).pipe(Effect.orDie)).benchmark
    })

    const cancel = Effect.fn("JarvisBenchmark.cancel")(function* () {
      cancelled = true
      const config = yield* JarvisRuntime.getConfig(database.db).pipe(Effect.orDie)
      if (config.benchmark.status !== "running") return config.benchmark
      const benchmark: Jarvis.BenchmarkState = {
        ...config.benchmark,
        status: "cancelled",
        activeModel: undefined,
        completedAt: Date.now(),
      }
      yield* JarvisRuntime.updateConfig(database.db, { ...config, benchmark, updatedAt: Date.now() }).pipe(Effect.orDie)
      return benchmark
    })

    const run = Effect.fn("JarvisBenchmark.run")(function* (profile: Jarvis.ReactorProfile) {
      if (JarvisRuntime.hasActiveTurn()) return yield* Effect.fail(new Error("A Jarvis turn is active; wait for it to finish."))
      const initial = yield* JarvisRuntime.getConfig(database.db).pipe(Effect.orDie)
      if (initial.benchmark.status === "running") return yield* Effect.fail(new Error("A model benchmark is already running."))
      cancelled = false
      const startedAt = Date.now()
      const candidates = (yield* catalog.model.available()).filter(
        (model) =>
          (model.providerID === "lmstudio" || model.providerID === "llama-server") &&
          (model.providerID !== "lmstudio" || model.runtime?.instanceID !== undefined) &&
          model.capabilities.input.includes("text") &&
          model.capabilities.output.includes("text"),
      )
      const running: Jarvis.BenchmarkState = {
        status: "running",
        profile,
        startedAt,
        results: [],
        fallback: [],
      }
      yield* JarvisRuntime.updateConfig(database.db, { ...initial, benchmark: running, updatedAt: Date.now() }).pipe(
        Effect.orDie,
      )

      const results: Jarvis.BenchmarkResult[] = []
      for (const candidate of candidates) {
        if (cancelled) break
        const activeModel = { providerID: candidate.providerID, modelID: candidate.id }
        yield* JarvisRuntime.updateConfig(database.db, {
          ...(yield* JarvisRuntime.getConfig(database.db).pipe(Effect.orDie)),
          benchmark: { ...running, results, activeModel },
          updatedAt: Date.now(),
        }).pipe(Effect.orDie)
        const result = yield* benchmark(candidate, llm, profile).pipe(
          Effect.timeout("60 seconds"),
          Effect.match({
            onFailure: (error): Jarvis.BenchmarkResult => ({
              model: activeModel,
              endpoint: candidate.api.url ?? "",
              instance: instance(candidate),
              testedAt: Date.now(),
              expiresAt: Date.now() + TTL,
              ttftMs: 0,
              totalMs: 0,
              tokensPerSecond: 0,
              outputTokens: 0,
              context: Math.max(0, candidate.limit.context),
              ...(candidate.runtime?.sizeBytes ? { memoryBytes: Math.max(0, candidate.runtime.sizeBytes) } : {}),
              ukrainian: false,
              instructions: false,
              toolCalling: false,
              accepted: false,
              score: 0,
              error: error instanceof Error ? error.message : String(error),
            }),
            onSuccess: (value) => value,
          }),
        )
        results.push(result)
      }

      const ranked = results.filter((result) => result.accepted).sort((a, b) => b.score - a.score)
      const selected = ranked[0]?.model
      const completed: Jarvis.BenchmarkState = {
        status: cancelled ? "cancelled" : selected ? "completed" : "error",
        profile,
        startedAt,
        completedAt: Date.now(),
        results,
        selected,
        fallback: ranked.slice(1).map((result) => result.model),
        ...(!cancelled && !selected ? { error: candidates.length ? "No local model passed all benchmark gates." : "No local dialogue models are available." } : {}),
      }
      const config = yield* JarvisRuntime.getConfig(database.db).pipe(Effect.orDie)
      yield* JarvisRuntime.updateConfig(database.db, {
        ...config,
        models: selected ? { ...config.models, dialogue: selected } : config.models,
        reactor: { ...config.reactor, profile },
        benchmark: completed,
        updatedAt: Date.now(),
      }).pipe(Effect.orDie)
      return completed
    })

    return Service.of({ status, run, cancel })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Catalog.node, Database.node, llmClient] })

const benchmark = Effect.fn("JarvisBenchmark.model")(function* (
  candidate: ModelV2.Info,
  llm: LLMClientShape,
  profile: Jarvis.ReactorProfile,
) {
  const model = yield* SessionRunnerModel.fromCatalogModel(candidate)
  const startedAt = Date.now()
  let firstTokenAt: number | undefined
  let output = ""
  let outputTokens = 0
  yield* llm
    .stream(
      LLM.request({
        model,
        system: [
          "Відповідай лише українською. Виконай інструкцію точно, без міркувань уголос.",
          "Твоя манера спокійна і лаконічна. Обов'язково встав маркер PULSE-7.",
        ].map(SystemPart.make),
        prompt: "Одним коротким реченням підтвердь, що локальний Jarvis готовий.",
        generation: { maxTokens: 96, temperature: 0 },
        providerOptions: { openai: { reasoningEffort: "none" } },
      }),
    )
    .pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (LLMEvent.is.textDelta(event)) {
            firstTokenAt ??= Date.now()
            output += event.text
          }
          if ((LLMEvent.is.finish(event) || LLMEvent.is.stepFinish(event)) && event.usage?.outputTokens)
            outputTokens = Math.max(outputTokens, Math.round(event.usage.outputTokens))
          if (LLMEvent.is.providerError(event)) throw new Error(event.message)
        }),
      ),
    )
  const tool = yield* LLM.generateObject({
    model,
    schema: ToolGate,
    system: SystemPart.make("Call the required structured tool once. Use marker PULSE-7 and ok=true."),
    prompt: "Return the required structured result now.",
    generation: { maxTokens: 64, temperature: 0 },
    providerOptions: { openai: { reasoningEffort: "none" } },
  }).pipe(Effect.provideService(LLMClient.Service, llm), Effect.option)
  const completedAt = Date.now()
  const tokens = Math.max(outputTokens, Math.ceil(output.length / 4))
  const generationMs = Math.max(1, completedAt - (firstTokenAt ?? startedAt))
  const ukrainian = /[іїєґ]/iu.test(output)
  const instructions = output.includes("PULSE-7")
  const toolCalling = tool._tag === "Some" && tool.value.object.marker === "PULSE-7" && tool.value.object.ok
  const accepted = benchmarkPassesGates({ ukrainian, instructions, toolCalling, context: candidate.limit.context })
  const ttftMs = Math.max(0, (firstTokenAt ?? completedAt) - startedAt)
  const totalMs = completedAt - startedAt
  const tokensPerSecond = (tokens * 1_000) / generationMs
  return {
    model: { providerID: candidate.providerID, modelID: candidate.id },
    endpoint: candidate.api.url ?? "",
    instance: instance(candidate),
    testedAt: completedAt,
    expiresAt: completedAt + TTL,
    ttftMs,
    totalMs,
    tokensPerSecond,
    outputTokens: tokens,
    context: Math.max(0, candidate.limit.context),
    ...(candidate.runtime?.sizeBytes ? { memoryBytes: Math.max(0, candidate.runtime.sizeBytes) } : {}),
    ukrainian,
    instructions,
    toolCalling,
    accepted,
    score: benchmarkScore(profile, { ttftMs, totalMs, tokensPerSecond, context: candidate.limit.context }),
    ...(!accepted ? { error: "Model did not pass all Ukrainian, instruction, context, and tool-calling gates." } : {}),
  } satisfies Jarvis.BenchmarkResult
})

export function benchmarkScore(
  profile: Jarvis.ReactorProfile,
  value: { ttftMs: number; totalMs: number; tokensPerSecond: number; context: number },
) {
  const speed = 40_000 / Math.max(100, value.ttftMs) + value.tokensPerSecond * 6 - value.totalMs / 1_000
  if (profile === "fast") return speed
  if (profile === "balanced") return speed * 0.65 + Math.min(200, value.context / 512)
  return speed * 0.35 + Math.min(400, value.context / 256)
}

export function benchmarkPassesGates(value: {
  ukrainian: boolean
  instructions: boolean
  toolCalling: boolean
  context: number
}) {
  return value.ukrainian && value.instructions && value.toolCalling && value.context >= 8_192
}

function instance(model: ModelV2.Info) {
  return model.runtime?.instanceID ?? `${model.api.url ?? "local"}#${model.id}`
}
