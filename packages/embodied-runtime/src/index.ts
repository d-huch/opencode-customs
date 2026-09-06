#!/usr/bin/env bun
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { chmod, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { aiTraineeRuntimeConfig, validateRuntimeConfig, type RuntimeConfig } from "./config"
import { aiTraineeJUnit, aiTraineeReplay, createAITraineeCoordinator, runAITraineeFixtureBatch, type AITraineeBatch, type AITraineeFixture, type AITraineeRun } from "./ai-trainee"
import { controlCenter } from "./control-center"
import { createDiagnosticsBundle } from "./diagnostics"
import { createDemonstrationStore } from "./demonstration"
import { instructorConsole } from "./instructor-console"
import { createInstructorState, type InstructorCommandResult, type InstructorEvent, type InstructorScenarioSnapshot } from "./instructor"
import { applyReplayFaults, compareReplays, evaluateReplay, type ReplayEvaluation, type ReplayFixture } from "./replay"
import { applyRetention, openRuntimeState } from "./runtime-state"
import { deleteProtectedSecret, readProtectedSecret, writeProtectedSecret } from "./secret-store"
import { RuntimeProduct, RuntimeVersion } from "./version"
import { createPCMRecognition, synthesizeSpeech } from "./voice"
import { XApiOutbox, type ScenarioLifecycle } from "./xapi"
import { getScenarioReport, listScenarioReports, qualifyAITraineeModel, scenarioReportHTML, scenarioReportJUnit, validateTraining, type ScenarioQualityReport, type ScenarioValidationInput, type ScenarioValidationRun } from "./validation"

const startedAt = Date.now()
const stateDirectory = process.env.EMBODIED_RUNTIME_STATE ?? defaultStateDirectory()
const controlPort = boundedPort(process.env.EMBODIED_RUNTIME_PORT, 57_110)
const bootstrapPort = boundedPort(process.env.EMBODIED_BOOTSTRAP_PORT, 57_112)
const controlToken = process.env.EMBODIED_RUNTIME_TOKEN ?? randomBytes(32).toString("base64url")
const launchTickets = new Map<string, number>()
const instructorRequestTimes: number[] = []
const runtimeConfigPath = join(stateDirectory, "runtime.json")
await mkdir(stateDirectory, { recursive: true })
await mkdir(join(stateDirectory, "config"), { recursive: true })
await mkdir(join(stateDirectory, "data"), { recursive: true })
await mkdir(join(stateDirectory, "cache"), { recursive: true })
process.env.XDG_CONFIG_HOME = join(stateDirectory, "config")
process.env.XDG_DATA_HOME = join(stateDirectory, "data")
process.env.XDG_CACHE_HOME = join(stateDirectory, "cache")
process.env.OPENCODE_CONFIG_DIR = join(stateDirectory, "config", "opencode")
process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
process.env.OPENCODE_SERVER_PASSWORD = randomBytes(32).toString("base64url")
await mkdir(process.env.OPENCODE_CONFIG_DIR, { recursive: true })
await Bun.write(join(stateDirectory, "control.json"), JSON.stringify({ port: controlPort, token: controlToken }, null, 2))
await chmod(join(stateDirectory, "control.json"), 0o600).catch(() => undefined)
let runtimeConfig = validateRuntimeConfig(await Bun.file(runtimeConfigPath).json().catch(() => undefined))
const startupConfig = runtimeConfig
const runtimeState = await openRuntimeState(stateDirectory)
const instructorState = createInstructorState(stateDirectory)
const demonstrations = await createDemonstrationStore(stateDirectory)
let retentionStatus = await applyRetention(stateDirectory, runtimeConfig?.retention)
const retentionTimer = setInterval(() => void applyRetention(stateDirectory, runtimeConfig?.retention).then((value) => { retentionStatus = value }), 6 * 60 * 60_000)
let xapiOutbox = await createXApiOutbox()
let lastReplayEvaluation: ReplayEvaluation | undefined
const engineConfigPath = join(process.env.OPENCODE_CONFIG_DIR, "opencode.json")
if (runtimeConfig) {
  await Bun.write(engineConfigPath, JSON.stringify({
    provider: {
      [runtimeConfig.providerID]: { options: { baseURL: runtimeConfig.baseURL } },
    },
  }, null, 2))
  process.env.OPENCODE_CONFIG = engineConfigPath
}

type EngineListener = { url: URL; stop: (close?: boolean) => Promise<void> }
type BridgeStatus = {
  protocol: number
  version: string
  bootstrap?: { available?: boolean; port?: number; error?: string }
  sync?: unknown
  connectedClients: Array<{ clientID?: string; scenario?: InstructorScenarioSnapshot }>
  pendingApprovals?: Array<{ id?: string; expiresAt?: number }>
  modelRuntime?: unknown
}
type AITraineeSnapshot = ReturnType<BridgeController["aiTraineeSnapshot"]>
type BridgeController = {
  status: () => BridgeStatus
  configureServer: (connection: { url: string; username: string | null; password: string | null }) => void
  stop: () => Promise<void>
  aiTraineeSnapshot: (characterID?: string) => {
    clientID: string
    characterID: string
    gameID: string
    worldRevision: number
    entities: Array<{ id: string; kind?: string; label?: string; visible?: boolean; state?: Record<string, unknown>; affordances?: string[] }>
    capabilities: Array<{ id: string; title: string; description: string; parameters: Record<string, unknown>; risk: "ambient" | "interaction" | "critical"; permissionCategory: string; preconditions: string[]; postconditions: string[] }>
    scenario: { runID: string; scenarioID: string; scenarioRevision: number; title?: string; status: "running" | "paused" | "completed" | "cancelled" | "failed"; currentStepID?: string; currentInstruction?: string; allowedCapabilityIDs?: string[]; attempt: number; simulation: boolean; criticalAutoApproveCategories: string[]; baselineFingerprint?: string; capabilityRevision?: number }
  } | undefined
  aiTraineeAction: (input: { runID: string; scenarioRunID: string; characterID: string; decision: { capabilityID: string; entityID: string; arguments: Record<string, unknown>; expectedPostconditions: string[] }; idempotencyKey: string; simulationAutoApprove: boolean }) => Promise<{ ok: boolean; code: string; message?: string; autoApproved?: boolean; approved?: boolean }>
  notifyAITrainee: (run: AITraineeRun) => void
  resolveApproval: (id: string, approved: boolean, instructorID?: string) => boolean
  instructorCommand: (input: {
    requestID: string
    runID: string
    scenarioRevision: number
    expectedStepID?: string
    instructorID: string
    command: "pause" | "resume" | "retry_current_step" | "terminate" | "hint" | "evidence"
    text?: string
    evidenceID?: string
    value?: string
    reason?: string
  }) => Promise<InstructorCommandResult>
  scenarioTestReset: (input: { scenarioID: string; scenarioRevision: number; expectedBaselineFingerprint?: string }) => Promise<{ ok: boolean; code: string; baselineFingerprint?: string; capabilityRevision?: number }>
}
type BridgeDemonstrationMessage = ((
  | { type: "demonstration.start"; demonstrationID: string; timestamp: number; title?: string }
  | { type: "demonstration.event"; demonstrationID: string; eventID: string; sequence: number; timestamp: number; entityID: string; capabilityID: string; action: string; ok: boolean; code: string; risk: "ambient" | "interaction" | "critical"; permissionCategory?: string; postconditions: string[] }
  | { type: "demonstration.transcript"; demonstrationID: string; eventID: string; timestamp: number; text: string }
  | { type: "demonstration.complete" | "demonstration.cancel"; demonstrationID: string; timestamp: number }
) & { clientID: string; characterID: string; gameID: string; saveSlotID: string })
type AITraineeControlInput = {
  type: "ai.trainee.control"
  requestID: string
  command: "start" | "pause" | "resume" | "cancel"
  profile?: "guided" | "blind"
  seed?: number
  clientID: string
  characterID: string
}
let handleAITraineeControl: (input: AITraineeControlInput) => Promise<{ ok: boolean; code: string; runID?: string; message?: string }> = async (_input) => ({
  ok: false,
  code: "ai_trainee_unavailable",
  message: "AI Trainee runtime is still starting.",
})
const { Server, startAvatarBridge } = await import("./runtime-adapter.mjs")
const server: { listen: (options: { hostname: string; port: number; portSelection: "ephemeral" }) => Promise<EngineListener> } = Server
const startBridge: (options: {
  stateDirectory: string
  bootstrapPort: number
  log: (category: string, message: string, data?: Record<string, unknown>, level?: "info" | "warn" | "error") => void
  synthesize?: (input: { text: string }, signal: AbortSignal) => Promise<{ contentType: string; audio: ArrayBuffer }>
  startRecognition?: (input: {
    locale: string
    sampleRate: number
    onEvent?: (event: { type: string; text?: string }) => void
    onDrain?: () => void
  }) => {
    write: (chunk: Buffer) => boolean
    finish: () => void
    cancel: () => void
    result: Promise<string>
  }
  onScenarioLifecycle?: (message: ScenarioLifecycle) => void | Promise<void>
  onInstructorEvent?: (message: InstructorEvent) => void | Promise<void>
  onDemonstrationEvent?: (message: BridgeDemonstrationMessage) => void | Promise<void>
  onAITraineeControl?: (message: AITraineeControlInput) => Promise<{ ok: boolean; code: string; runID?: string; message?: string }>
}) => Promise<BridgeController> = startAvatarBridge
const engine = await server.listen({ hostname: "127.0.0.1", port: 0, portSelection: "ephemeral" })
const bridge = await startBridge({
  stateDirectory: join(stateDirectory, "bridge"),
  bootstrapPort,
  log(category, message, data, level = "info") {
    const safe = data
      ? Object.fromEntries(Object.entries(data).filter(([key]) => !/(token|password|secret|audio|prompt)/i.test(key)))
      : undefined
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      JSON.stringify({ timestamp: new Date().toISOString(), category, message, data: safe }),
    )
  },
  ...(startupConfig?.speech?.synthesis
    ? { synthesize: (input, signal) => synthesizeSpeech(startupConfig.speech?.synthesis, input.text, signal) }
    : {}),
  ...(startupConfig?.speech?.transcription
    ? { startRecognition: (input) => createPCMRecognition(startupConfig.speech?.transcription, input) }
    : {}),
  async onScenarioLifecycle(message) {
    await runtimeState.recordScenario(message)
    await xapiOutbox?.enqueue(message)
    await instructorState.record({ type: "scenario.lifecycle", timestamp: Date.now(), data: message })
  },
  async onInstructorEvent(message) {
    await instructorState.record(message)
  },
  async onDemonstrationEvent(message) {
    const result = await demonstrations.record(message)
    if (!result.ok) throw new Error(result.code)
  },
  onAITraineeControl: (message) => handleAITraineeControl(message),
})
bridge.configureServer({ url: engine.url.toString(), username: "opencode", password: process.env.OPENCODE_SERVER_PASSWORD })
const aiTrainee = createAITraineeCoordinator({
  config: () => runtimeConfig ? aiTraineeRuntimeConfig(runtimeConfig) : undefined,
  snapshot: (characterID) => bridge.aiTraineeSnapshot(characterID) as AITraineeSnapshot,
  execute: (input) => bridge.aiTraineeAction(input),
  notify: (run) => bridge.notifyAITrainee(run),
})
handleAITraineeControl = async (input) => {
  if (input.command === "start") {
    if (input.profile !== "guided" && input.profile !== "blind") return { ok: false, code: "profile_required" }
    try {
      const run = aiTrainee.start({
        profile: input.profile,
        characterID: input.characterID,
        ...(Number.isInteger(input.seed) ? { seed: input.seed } : {}),
      })
      return { ok: true, code: "started", runID: run.id }
    } catch (error) {
      return { ok: false, code: "run_conflict", message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (input.command === "pause") return controlAITraineePause("pause")
  if (input.command === "resume") return controlAITraineePause("resume")
  const runID = aiTrainee.active()?.id
  return { ok: aiTrainee.cancel("operator_cancelled"), code: "cancelled", ...(runID ? { runID } : {}) }
}
let aiBatch: AITraineeBatch | undefined
let aiBatchController: AbortController | undefined
const validationReportsDirectory = join(stateDirectory, "results", "validation")
const qualificationDirectory = join(stateDirectory, "cache", "ai-trainee-qualification")
let validationRun: ScenarioValidationRun | undefined
let validationReport = (await listScenarioReports(validationReportsDirectory))[0]
let validationController: AbortController | undefined

async function controlAITraineePause(command: "pause" | "resume") {
  const active = aiTrainee.active()
  const snapshot = bridge.aiTraineeSnapshot(active?.characterID)
  if (!active || !snapshot) return { ok: false, code: "ai_trainee_unavailable" }
  const result = await bridge.instructorCommand({
    requestID: `ai_${randomBytes(16).toString("hex")}`,
    runID: snapshot.scenario.runID,
    scenarioRevision: snapshot.scenario.scenarioRevision,
    ...(snapshot.scenario.currentStepID ? { expectedStepID: snapshot.scenario.currentStepID } : {}),
    instructorID: "ai-trainee",
    command,
  })
  if (!result.ok && result.code !== `already_${command === "pause" ? "paused" : "running"}`)
    return { ok: false, code: result.code, message: result.message, runID: active.id }
  const changed = command === "pause" ? aiTrainee.pause() : aiTrainee.resume()
  return { ok: changed || result.ok, code: command === "pause" ? "paused" : "resumed", runID: active.id }
}

if (startupConfig) await configureDialogueModel(engine.url, process.env.OPENCODE_SERVER_PASSWORD, startupConfig).catch((error) =>
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    category: "model",
    message: "Local model configuration is saved but not ready",
    data: { providerID: startupConfig.providerID, modelID: startupConfig.modelID, error: String(error) },
  })),
)

const instructorStatusTimer = setInterval(() => instructorState.publishStatus(instructorSession()), 500)
instructorStatusTimer.unref()

const control = Bun.serve({
  hostname: "127.0.0.1",
  port: controlPort,
  async fetch(request) {
    const url = new URL(request.url)
    if (!validLocalHost(request)) return Response.json({ error: "invalid_host" }, { status: 403 })
    if (url.pathname === "/v1/launch" && request.method === "POST") {
      const ticket = randomBytes(24).toString("base64url")
      launchTickets.set(ticket, Date.now() + 30_000)
      pruneLaunchTickets()
      return Response.json({ url: `http://127.0.0.1:${controlPort}/v1/open?ticket=${ticket}`, expiresAt: Date.now() + 30_000 }, {
        headers: { "cache-control": "no-store" },
      })
    }
    if (url.pathname === "/v1/open" && request.method === "GET") {
      const ticket = url.searchParams.get("ticket") ?? ""
      const expiresAt = launchTickets.get(ticket)
      launchTickets.delete(ticket)
      if (!expiresAt || expiresAt < Date.now()) return Response.json({ error: "invalid_or_expired_ticket" }, { status: 401 })
      return new Response(null, {
        status: 303,
        headers: {
          location: "/",
          "cache-control": "no-store",
          "set-cookie": `embodied_control=${controlToken}; HttpOnly; SameSite=Strict; Path=/`,
        },
      })
    }
    if (url.pathname === "/v1/health" && request.method === "GET") {
      const model = await probeModel(runtimeConfig)
      return Response.json({
        product: RuntimeProduct,
        version: RuntimeVersion,
        status: runtimeState.status().previousUncleanShutdown ? "recovered" : "ready",
        uptimeMs: Date.now() - startedAt,
        bridge: {
          protocol: bridge.status().protocol,
          version: bridge.status().version,
          bootstrapAvailable: bridge.status().bootstrap?.available ?? false,
          connectedClients: bridge.status().connectedClients.length,
        },
        voice: {
          transcription: runtimeConfig?.speech?.transcription ? "configured" : "unconfigured",
          synthesis: runtimeConfig?.speech?.synthesis ? "configured" : "unconfigured",
        },
        model,
      })
    }
    if (url.pathname === "/v1/auth" && request.method === "POST")
      return request.json().then((value) => {
        if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).token !== "string")
          return Response.json({ error: "invalid_request" }, { status: 400 })
        if (!constantTimeEqual((value as Record<string, unknown>).token as string, controlToken))
          return Response.json({ error: "unauthorized" }, { status: 401 })
        return Response.json({ ok: true }, { headers: { "set-cookie": `embodied_control=${controlToken}; HttpOnly; SameSite=Strict; Path=/` } })
      }).catch(() => Response.json({ error: "invalid_json" }, { status: 400 }))
    if (!authorized(request, controlToken))
      return Response.json({ error: "unauthorized" }, { status: 401 })
    if (url.pathname === "/" && request.method === "GET")
      return new Response(controlCenter, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
    if (url.pathname === "/instructor" && request.method === "GET")
      return new Response(instructorConsole, { headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      } })
    if (url.pathname === "/v1/instructor/session" && request.method === "GET")
      return Response.json(instructorSession())
    if (url.pathname === "/v1/ai-trainee" && request.method === "GET")
      return Response.json({ active: aiTrainee.active(), runs: aiTrainee.list(), batch: aiBatch })
    if (url.pathname === "/v1/ai-trainee/export.json" && request.method === "GET")
      return Response.json({
        generatedAt: new Date().toISOString(),
        active: aiTrainee.active(),
        runs: aiTrainee.list(),
        batch: aiBatch,
        replays: aiTrainee.list().map(aiTraineeReplay),
      }, { headers: { "content-disposition": "attachment; filename=embodied-ai-trainee.json", "cache-control": "no-store" } })
    if (url.pathname === "/v1/ai-trainee/junit" && request.method === "GET")
      return new Response(aiTraineeJUnit(aiBatch, aiTrainee.list()), { headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": "attachment; filename=embodied-ai-trainee.junit.xml",
        "cache-control": "no-store",
      } })
    if (url.pathname === "/v1/ai-trainee/live" && request.method === "POST") {
      const value = await boundedJSON(request)
      if (!value || (value.profile !== "guided" && value.profile !== "blind")) return Response.json({ error: "invalid_ai_trainee_profile" }, { status: 400 })
      const characterID = value.characterID === undefined ? undefined : identifier(value.characterID, 128) ? value.characterID : null
      if (characterID === null) return Response.json({ error: "invalid_character_id" }, { status: 400 })
      try {
        return Response.json(aiTrainee.start({ profile: value.profile, ...(characterID ? { characterID } : {}), ...(Number.isInteger(value.seed) ? { seed: value.seed as number } : {}) }), { status: 201 })
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 })
      }
    }
    if (url.pathname === "/v1/ai-trainee/pause" && request.method === "POST")
      return Response.json(await controlAITraineePause("pause"))
    if (url.pathname === "/v1/ai-trainee/resume" && request.method === "POST")
      return Response.json(await controlAITraineePause("resume"))
    if (url.pathname === "/v1/ai-trainee/cancel" && request.method === "POST") {
      aiBatchController?.abort("operator_cancelled")
      return Response.json({ changed: aiTrainee.cancel() || !!aiBatchController })
    }
    if (url.pathname === "/v1/ai-trainee/batch" && request.method === "POST") {
      if (!runtimeConfig) return Response.json({ error: "model_unconfigured" }, { status: 409 })
      if (aiBatch?.status === "running") return Response.json({ error: "batch_already_running" }, { status: 409 })
      const value = await boundedJSON(request, 2 * 1024 * 1024)
      if (!value || typeof value !== "object" || Array.isArray(value)) return Response.json({ error: "invalid_batch" }, { status: 400 })
      const input = value as Record<string, unknown>
      if ((input.profile !== "guided" && input.profile !== "blind") || !Number.isInteger(input.runs) || (input.runs as number) < 1 || (input.runs as number) > 100)
        return Response.json({ error: "invalid_batch" }, { status: 400 })
      if (!input.fixture || typeof input.fixture !== "object" || Array.isArray(input.fixture)) return Response.json({ error: "invalid_fixture" }, { status: 400 })
      aiBatchController = new AbortController()
      const pending = runAITraineeFixtureBatch(aiTraineeRuntimeConfig(runtimeConfig), input.fixture as AITraineeFixture, {
        profile: input.profile,
        runs: input.runs as number,
        ...(Number.isInteger(input.seed) ? { seed: input.seed as number } : {}),
      }, aiBatchController.signal, (batch) => { aiBatch = batch })
      void pending.then((result) => { aiBatch = result }, () => { if (aiBatch) aiBatch.status = "failed" }).finally(() => { aiBatchController = undefined })
      return Response.json({ started: true }, { status: 202 })
    }
    if (url.pathname === "/v1/validation/model/qualification" && request.method === "GET") {
      if (!runtimeConfig) return Response.json({ error: "model_unconfigured" }, { status: 409 })
      const extended = url.searchParams.get("mode") === "extended"
      return Response.json(await qualifyAITraineeModel(aiTraineeRuntimeConfig(runtimeConfig), qualificationDirectory, extended ? "extended" : "standard"))
    }
    if (url.pathname === "/v1/validation/runs" && request.method === "GET")
      return Response.json({ active: validationRun, report: validationReport, reports: await listScenarioReports(validationReportsDirectory) })
    if (url.pathname === "/v1/validation/runs" && request.method === "POST") {
      if (!runtimeConfig) return Response.json({ error: "model_unconfigured" }, { status: 409 })
      if (validationRun?.status === "running") return Response.json({ error: "validation_already_running", runID: validationRun.id }, { status: 409 })
      const value = await boundedJSON(request, 512 * 1024)
      if (!validValidationInput(value)) return Response.json({ error: "invalid_validation_request" }, { status: 400 })
      validationController = new AbortController()
      validationReport = undefined
      const pending = validateTraining(value, {
        config: aiTraineeRuntimeConfig(runtimeConfig),
        qualificationDirectory,
        reportsDirectory: validationReportsDirectory,
        reset: (input, signal) => Promise.race([
          bridge.scenarioTestReset(input),
          new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
        ]),
        run: (profile, characterID, signal) => runValidationAITrainee(profile, characterID, signal),
        replay: aiTraineeReplay,
        snapshot: (characterID) => bridge.aiTraineeSnapshot(characterID) as AITraineeSnapshot,
      }, (run) => { validationRun = run }, validationController.signal)
      void pending.then((result) => {
        validationRun = result.run
        validationReport = result.report
      }).finally(() => { validationController = undefined })
      await Bun.sleep(0)
      return Response.json(validationRun ?? { started: true }, { status: 202 })
    }
    if (url.pathname === "/v1/validation/cancel" && request.method === "POST") {
      validationController?.abort("operator_cancelled")
      aiTrainee.cancel("validation_cancelled")
      return Response.json({ changed: !!validationController })
    }
    if (url.pathname.startsWith("/v1/validation/reports/") && request.method === "GET") {
      const suffix = decodeURIComponent(url.pathname.slice("/v1/validation/reports/".length))
      const format = suffix.endsWith(".html") ? "html" : suffix.endsWith(".junit.xml") ? "junit" : "json"
      const id = suffix.replace(/\.junit\.xml$|\.html$|\.json$/, "")
      const report = await getScenarioReport(validationReportsDirectory, id)
      if (!report) return Response.json({ error: "validation_report_not_found" }, { status: 404 })
      if (format === "html") return new Response(scenarioReportHTML(report), { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="${id}.html"` } })
      if (format === "junit") return new Response(scenarioReportJUnit(report), { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${id}.junit.xml"` } })
      return Response.json(report, { headers: { "content-disposition": `attachment; filename="${id}.json"` } })
    }
    if (url.pathname === "/v1/demonstrations" && request.method === "GET")
      return Response.json(await demonstrations.list())
    if (url.pathname.startsWith("/v1/demonstrations/") && request.method === "GET") {
      const suffix = decodeURIComponent(url.pathname.slice("/v1/demonstrations/".length))
      const draft = suffix.endsWith("/draft")
      const id = draft ? suffix.slice(0, -"/draft".length) : suffix
      if (!identifier(id, 160)) return Response.json({ error: "invalid_demonstration_id" }, { status: 400 })
      const value = draft ? await demonstrations.draft(id, runtimeConfig) : await demonstrations.get(id)
      return value ? Response.json(value) : Response.json({ error: "demonstration_not_found" }, { status: 404 })
    }
    if (url.pathname === "/v1/instructor/events" && request.method === "GET")
      return instructorState.stream(instructorSession())
    if (url.pathname.startsWith("/v1/instructor/") && request.method === "POST" && !allowInstructorRequest())
      return Response.json({ error: "rate_limited" }, { status: 429 })
    if (url.pathname === "/v1/instructor/control" && request.method === "POST")
      return instructorRequest(request, "control")
    if (url.pathname === "/v1/instructor/hint" && request.method === "POST")
      return instructorRequest(request, "hint")
    if (url.pathname === "/v1/instructor/evidence" && request.method === "POST")
      return instructorRequest(request, "evidence")
    if (url.pathname.startsWith("/v1/instructor/approvals/") && request.method === "POST")
      return instructorApproval(request, decodeURIComponent(url.pathname.slice("/v1/instructor/approvals/".length)))
    if (url.pathname === "/v1/status" && request.method === "GET") {
      const status = bridge.status()
      return Response.json({
        product: RuntimeProduct,
        version: RuntimeVersion,
        status: runtimeState.status().previousUncleanShutdown ? "recovered" : "ready",
        configuration: runtimeConfig ? { ...runtimeConfig, restartRequired: false } : { restartRequired: false },
        engine: { url: engine.url.toString() },
        bridge: {
          protocol: status.protocol,
          version: status.version,
          bootstrap: status.bootstrap,
          sync: status.sync,
          connectedClients: status.connectedClients,
          pendingApprovals: status.pendingApprovals,
          modelRuntime: status.modelRuntime,
        },
        supervisor: runtimeState.status(),
        retention: retentionStatus,
        xapi: runtimeConfig?.xapi ? { configured: true, ...(await xapiOutbox?.status()) } : { configured: false },
        aiTrainee: { active: aiTrainee.active(), batch: aiBatch },
        validation: { active: validationRun, report: validationReport },
      })
    }
    if (url.pathname === "/v1/config" && request.method === "GET")
      return Response.json(runtimeConfig ?? {})
    if (url.pathname === "/v1/config" && request.method === "PUT")
      return request.json().then(validateRuntimeConfig).then(async (config) => {
        if (!config) return Response.json({ error: "invalid_local_model_config" }, { status: 400 })
        if (validationRun?.status === "running") return Response.json({ error: "validation_model_locked", runID: validationRun.id }, { status: 409 })
        await Bun.write(runtimeConfigPath, JSON.stringify(config, null, 2))
        runtimeConfig = config
        retentionStatus = await applyRetention(stateDirectory, config.retention)
        return Response.json({ ...config, restartRequired: true })
      }).catch(() => Response.json({ error: "invalid_json" }, { status: 400 }))
    if (url.pathname === "/v1/xapi/credential" && request.method === "PUT")
      return request.json().then(async (value) => {
        if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).bearerToken !== "string")
          return Response.json({ error: "invalid_credential" }, { status: 400 })
        const token = ((value as Record<string, unknown>).bearerToken as string).trim()
        if (!token || token.length > 8_192) return Response.json({ error: "invalid_credential" }, { status: 400 })
        await writeProtectedSecret(stateDirectory, "xapi-bearer", token)
        xapiOutbox = await createXApiOutbox()
        return Response.json({ stored: true, protectedBy: process.platform === "darwin" ? "keychain" : "dpapi" })
      }).catch((error) => Response.json({ error: String(error) }, { status: 400 }))
    if (url.pathname === "/v1/xapi/credential" && request.method === "DELETE") {
      await deleteProtectedSecret(stateDirectory, "xapi-bearer")
      xapiOutbox = undefined
      return Response.json({ removed: true })
    }
    if (url.pathname === "/v1/xapi/test" && request.method === "POST")
      return xapiOutbox ? Response.json(await xapiOutbox.test()) : Response.json({ error: "xapi_unconfigured" }, { status: 409 })
    if (url.pathname === "/v1/xapi/retry" && request.method === "POST")
      return request.json().catch(() => ({})).then(async (value) => {
        if (!xapiOutbox) return Response.json({ error: "xapi_unconfigured" }, { status: 409 })
        const statementID = value && typeof value === "object" && typeof (value as Record<string, unknown>).statementID === "string"
          ? (value as Record<string, unknown>).statementID as string
          : undefined
        await xapiOutbox.retry(statementID)
        return Response.json(await xapiOutbox.status())
      })
    if (url.pathname === "/v1/replay/evaluate" && request.method === "POST")
      return request.json().then((value) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).events))
          return Response.json({ error: "invalid_replay_fixture" }, { status: 400 })
        const fixture = value as ReplayFixture
        lastReplayEvaluation = evaluateReplay(fixture.faults?.length ? applyReplayFaults(fixture) : fixture)
        return Response.json(lastReplayEvaluation)
      }).catch(() => Response.json({ error: "invalid_json" }, { status: 400 }))
    if (url.pathname === "/v1/replay/compare" && request.method === "POST")
      return request.json().then((value) => {
        if (!value || typeof value !== "object") return Response.json({ error: "invalid_replay_comparison" }, { status: 400 })
        const input = value as Record<string, unknown>
        if (!validReplay(input.baseline) || !validReplay(input.candidate))
          return Response.json({ error: "invalid_replay_comparison" }, { status: 400 })
        return Response.json(compareReplays(input.baseline, input.candidate))
      }).catch(() => Response.json({ error: "invalid_json" }, { status: 400 }))
    if (url.pathname === "/v1/diagnostics" && request.method === "GET") {
      const status = bridge.status()
      return Response.json(await createDiagnosticsBundle({
        stateDirectory,
        startedAt,
        config: runtimeConfig,
        bridge: {
          protocol: status.protocol,
          version: status.version,
          bootstrapAvailable: status.bootstrap?.available ?? false,
          connectedClients: status.connectedClients.length,
          pendingApprovals: status.pendingApprovals?.length ?? 0,
        },
        model: await probeModel(runtimeConfig),
        replay: lastReplayEvaluation,
        supervisor: runtimeState.status(),
        retention: retentionStatus,
        xapi: runtimeConfig?.xapi ? { configured: true, ...(await xapiOutbox?.status()) } : { configured: false },
      }), { headers: { "content-disposition": `attachment; filename="embodied-agent-diagnostics-${Date.now()}.json"` } })
    }
    return Response.json({ error: "not_found" }, { status: 404 })
  },
})

console.log(`Embodied Agent Runtime ready on http://127.0.0.1:${control.port}`)
console.log(`Unity bootstrap ready on http://127.0.0.1:${bootstrapPort}`)

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  aiTrainee.cancel("runtime_stopping")
  aiBatchController?.abort("runtime_stopping")
  validationController?.abort("runtime_stopping")
  clearInterval(retentionTimer)
  clearInterval(instructorStatusTimer)
  control.stop(true)
  await bridge.stop()
  await engine.stop(true)
  await runtimeState.close()
  process.exit(0)
}

function instructorSession() {
  const status = bridge.status()
  return instructorState.session({
    connectedClients: status.connectedClients,
    pendingApprovals: status.pendingApprovals,
    modelRuntime: status.modelRuntime,
    voice: {
      transcription: runtimeConfig?.speech?.transcription ? "configured" : "unconfigured",
      synthesis: runtimeConfig?.speech?.synthesis ? "configured" : "unconfigured",
    },
  })
}

function allowInstructorRequest() {
  const cutoff = Date.now() - 60_000
  while (instructorRequestTimes[0] !== undefined && instructorRequestTimes[0] < cutoff) instructorRequestTimes.shift()
  if (instructorRequestTimes.length >= 120) return false
  instructorRequestTimes.push(Date.now())
  return true
}

async function instructorRequest(request: Request, kind: "control" | "hint" | "evidence") {
  const value = await boundedJSON(request)
  if (!value) return Response.json({ error: "invalid_request" }, { status: 400 })
  if (!identifier(value.requestID, 128)) return Response.json({ error: "invalid_request_id" }, { status: 400 })
  const common = instructorCommandCommon(value)
  if (!common) return Response.json({ error: "invalid_command_context" }, { status: 400 })
  const controlCommand = kind === "control" && typeof value.command === "string" && ["pause", "resume", "retry_current_step", "terminate"].includes(value.command)
    ? value.command as "pause" | "resume" | "retry_current_step" | "terminate"
    : undefined
  if (kind === "control" && !controlCommand) return Response.json({ error: "invalid_control" }, { status: 400 })
  const command = kind === "hint" ? "hint" : kind === "evidence" ? "evidence" : controlCommand!
  const text = kind === "hint" && typeof value.text === "string" && value.text.trim().length > 0 && value.text.trim().length <= 500
    ? value.text.trim()
    : undefined
  if (kind === "hint" && !text) return Response.json({ error: "invalid_hint" }, { status: 400 })
  const evidenceID = kind === "evidence" && identifier(value.evidenceID, 160) ? value.evidenceID : undefined
  const evidenceValue = kind === "evidence" && typeof value.value === "string" && value.value.trim().length <= 2_000 ? value.value.trim() || "verified" : undefined
  const reason = kind === "evidence" && typeof value.reason === "string" && value.reason.trim().length > 0 && value.reason.trim().length <= 500 ? value.reason.trim() : undefined
  if (kind === "evidence" && (!evidenceID || !evidenceValue || !reason)) return Response.json({ error: "invalid_instructor_evidence" }, { status: 400 })
  const requestID = value.requestID
  await instructorState.record({
    type: "instructor.command.sent", timestamp: Date.now(), requestID, runID: common.runID, command,
    instructorID: common.instructorID, stepID: common.expectedStepID, evidenceID, reason,
    valueHash: evidenceValue ? createHash("sha256").update(evidenceValue).digest("hex") : undefined,
  })
  const result = await bridge.instructorCommand({
    requestID,
    ...common,
    command,
    ...(text ? { text } : {}),
    ...(evidenceID && evidenceValue && reason ? { evidenceID, value: evidenceValue, reason } : {}),
  })
  return Response.json(result, { status: result.ok ? 200 : result.code === "command_timeout" ? 504 : 409 })
}

async function instructorApproval(request: Request, approvalID: string) {
  if (!identifier(approvalID, 160)) return Response.json({ error: "invalid_approval" }, { status: 400 })
  const value = await boundedJSON(request)
  if (!value || typeof value.approved !== "boolean" || !identifier(value.instructorID, 128))
    return Response.json({ error: "invalid_approval_request" }, { status: 400 })
  const approval = bridge.status().pendingApprovals?.find((item) => item.id === approvalID)
  if (!approval) return Response.json({ error: "approval_not_found" }, { status: 404 })
  if (typeof approval.expiresAt !== "number" || approval.expiresAt <= Date.now()) return Response.json({ error: "approval_expired" }, { status: 409 })
  if (!bridge.resolveApproval(approvalID, value.approved, value.instructorID)) return Response.json({ error: "approval_not_found" }, { status: 404 })
  await instructorState.record({ type: "approval.resolved", timestamp: Date.now(), approvalID, approved: value.approved, instructorID: value.instructorID })
  return Response.json({ resolved: true, approvalID, approved: value.approved })
}

function instructorCommandCommon(value: Record<string, unknown>) {
  if (!identifier(value.runID, 128) || !Number.isInteger(value.scenarioRevision) || (value.scenarioRevision as number) < 1) return
  if (!identifier(value.instructorID, 128)) return
  if (value.expectedStepID !== undefined && !identifier(value.expectedStepID, 160)) return
  return {
    runID: value.runID,
    scenarioRevision: value.scenarioRevision as number,
    instructorID: value.instructorID,
    ...(typeof value.expectedStepID === "string" ? { expectedStepID: value.expectedStepID } : {}),
  }
}

async function runValidationAITrainee(profile: "guided" | "blind", characterID: string | undefined, signal: AbortSignal) {
  const started = aiTrainee.start({ profile, ...(characterID ? { characterID } : {}), seed: 1 })
  const cancel = () => {
    if (aiTrainee.active()?.id === started.id) aiTrainee.cancel("validation_cancelled")
  }
  signal.addEventListener("abort", cancel, { once: true })
  const deadline = Date.now() + 5 * 60_000
  try {
    while (!signal.aborted && Date.now() < deadline) {
      const current = aiTrainee.list().find((run) => run.id === started.id)
      if (current && ["completed", "cancelled", "failed"].includes(current.status)) return current
      await Bun.sleep(200)
    }
    if (signal.aborted) throw signal.reason
    aiTrainee.cancel("validation_timeout")
    const timedOut = aiTrainee.list().find((run) => run.id === started.id)
    if (timedOut) return timedOut
    throw new Error("validation_timeout")
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

function validValidationInput(value: Record<string, unknown> | undefined): value is ScenarioValidationInput {
  if (!value || !identifier(value.scenarioID, 160) || !Number.isInteger(value.scenarioRevision) || (value.scenarioRevision as number) < 1) return false
  if (value.target !== undefined && value.target !== "desktop" && value.target !== "quest") return false
  if (value.characterID !== undefined && !identifier(value.characterID, 128)) return false
  if (value.qualificationMode !== undefined && value.qualificationMode !== "standard" && value.qualificationMode !== "extended") return false
  if (value.goldenPath !== undefined && (!Array.isArray(value.goldenPath) || value.goldenPath.length > 128 || !value.goldenPath.every((item) => identifier(item, 160)))) return false
  if (value.deterministicIssues !== undefined && (!Array.isArray(value.deterministicIssues) || value.deterministicIssues.length > 256 || !value.deterministicIssues.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const issue = item as Record<string, unknown>
    if (!identifier(issue.code, 160) || !["error", "warning", "info"].includes(String(issue.severity))) return false
    if (typeof issue.message !== "string" || issue.message.length > 2_000) return false
    if (issue.stepID !== undefined && !identifier(issue.stepID, 160)) return false
    return issue.capabilityID === undefined || identifier(issue.capabilityID, 160)
  }))) return false
  return true
}

async function boundedJSON(request: Request, maximum = 16 * 1024) {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (!Number.isFinite(length) || length > maximum) return
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > maximum) return
  const value = await Promise.resolve(text).then(JSON.parse).catch(() => undefined)
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function identifier(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
}

process.on("SIGINT", () => void stop())
process.on("SIGTERM", () => void stop())

function defaultStateDirectory() {
  if (process.platform === "win32")
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Embodied Agent Runtime")
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Embodied Agent Runtime")
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "embodied-agent-runtime")
}

function boundedPort(value: string | undefined, fallback: number) {
  const port = Number(value ?? fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port: ${value}`)
  return port
}

async function configureDialogueModel(url: URL, password: string, config: RuntimeConfig) {
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    "content-type": "application/json",
  }
  const currentResponse = await fetch(new URL("/api/jarvis/config", url), { headers })
  if (!currentResponse.ok) throw new Error(`Jarvis config returned HTTP ${currentResponse.status}`)
  const current = await currentResponse.json()
  if (!current || typeof current !== "object") throw new Error("Jarvis config response is invalid")
  const currentRecord = current as Record<string, unknown>
  const models = currentRecord.models && typeof currentRecord.models === "object"
    ? currentRecord.models as Record<string, unknown>
    : {}
  const response = await fetch(new URL("/api/jarvis/config", url), {
    method: "PUT",
    headers,
    body: JSON.stringify({
      ...currentRecord,
      models: { ...models, dialogue: { providerID: config.providerID, modelID: config.modelID } },
      updatedAt: Date.now(),
    }),
  })
  if (!response.ok) throw new Error(`Jarvis model update returned HTTP ${response.status}`)
}

function authorized(request: Request, token: string) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "")
  if (bearer && constantTimeEqual(bearer, token)) return true
  const cookie = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith("embodied_control="))
  return constantTimeEqual(cookie?.slice("embodied_control=".length) ?? "", token)
}

function validLocalHost(request: Request) {
  const host = request.headers.get("host")?.split(":")[0]?.replace(/^\[|\]$/g, "")
  return host === "127.0.0.1" || host === "localhost" || host === "::1"
}

function pruneLaunchTickets() {
  const now = Date.now()
  for (const [ticket, expiresAt] of launchTickets)
    if (expiresAt < now) launchTickets.delete(ticket)
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function validReplay(value: unknown): value is ReplayFixture {
  return Boolean(value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).events))
}

async function probeModel(config: RuntimeConfig | undefined) {
  if (!config) return { status: "unconfigured" }
  const endpoint = new URL("models", config.baseURL.endsWith("/") ? config.baseURL : config.baseURL + "/")
  const started = performance.now()
  return fetch(endpoint, { signal: AbortSignal.timeout(3_000) }).then(async (response) => {
    if (response.status === 401 || response.status === 403) return { status: "unauthorized", latencyMs: Math.round(performance.now() - started) }
    if (!response.ok) return { status: "offline", httpStatus: response.status, latencyMs: Math.round(performance.now() - started) }
    const value = await response.json().catch(() => undefined)
    const models = value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).data)
      ? (value as { data: Array<{ id?: unknown }> }).data
      : []
    return {
      status: models.some((model) => model.id === config.modelID) ? "ready" : "missing",
      providerID: config.providerID,
      modelID: config.modelID,
      latencyMs: Math.round(performance.now() - started),
    }
  }).catch(() => ({ status: "offline", providerID: config.providerID, modelID: config.modelID, latencyMs: Math.round(performance.now() - started) }))
}

async function createXApiOutbox() {
  if (!runtimeConfig?.xapi?.enabled) return
  const credential = await readProtectedSecret(stateDirectory, "xapi-bearer")
  if (!credential) return
  const outbox = new XApiOutbox(join(stateDirectory, "results", "xapi-outbox"), runtimeConfig.xapi, credential)
  await outbox.initialize()
  return outbox
}
