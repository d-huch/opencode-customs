export const Server: {
  listen(options: { hostname: string; port: number; portSelection: "ephemeral" }): Promise<{
    url: URL
    stop(close?: boolean): Promise<void>
  }>
}

export function startAvatarBridge(options: {
  stateDirectory: string
  bootstrapPort: number
  log(category: string, message: string, data?: Record<string, unknown>, level?: "info" | "warn" | "error"): void
  synthesize?: (input: { text: string }, signal: AbortSignal) => Promise<{ contentType: string; audio: ArrayBuffer }>
  startRecognition?: (input: {
    locale: string
    sampleRate: number
    onEvent?: (event: { type: string; text?: string }) => void
    onDrain?: () => void
  }) => {
    write(chunk: Buffer): boolean
    finish(): void
    cancel(): void
    result: Promise<string>
  }
  onScenarioLifecycle?: (message: {
    type: "scenario.started" | "scenario.step" | "scenario.completed" | "scenario.cancelled" | "scenario.failed"
    runID: string
    scenarioID: string
    scenarioRevision: number
    timestamp: number
    sessionID?: string
    traineeID?: string
    stepID?: string
    outcome?: string
    reason?: string
    durationMs?: number
    demonstrationRevision?: string
  }) => void | Promise<void>
  onDemonstrationEvent?: (message: ((
    | { type: "demonstration.start"; demonstrationID: string; timestamp: number; title?: string }
    | { type: "demonstration.event"; demonstrationID: string; eventID: string; sequence: number; timestamp: number; entityID: string; capabilityID: string; action: string; ok: boolean; code: string; risk: "ambient" | "interaction" | "critical"; permissionCategory?: string; postconditions: string[] }
    | { type: "demonstration.transcript"; demonstrationID: string; eventID: string; timestamp: number; text: string }
    | { type: "demonstration.complete" | "demonstration.cancel"; demonstrationID: string; timestamp: number }
  ) & { clientID: string; characterID: string; gameID: string; saveSlotID: string })) => void | Promise<void>
  onInstructorEvent?: (message:
    | {
        type: "scenario.snapshot"
        runID: string
        scenarioID: string
        scenarioRevision: number
        timestamp: number
        sessionID?: string
        traineeID?: string
        instructorID?: string
        status: "running" | "paused" | "completed" | "cancelled" | "failed"
        currentStepID?: string
        attempt: number
        timeoutRemainingMs: number
        evidence: Record<string, unknown>
        instructorEvidenceIDs: string[]
        deploymentID?: string
        scenarioTitle?: string
        currentInstruction?: string
        allowedCapabilityIDs?: string[]
        simulation?: boolean
        criticalAutoApproveCategories?: string[]
        baselineFingerprint?: string
        capabilityRevision?: number
      }
    | {
        type: "instructor.command.result"
        requestID: string
        runID: string
        ok: boolean
        code: string
        timestamp: number
        stepID?: string
        attempt?: number
        message?: string
      }
    | { type: "client.connected" | "client.disconnected"; clientID: string; timestamp: number }
  ) => void | Promise<void>
  onAITraineeControl?: (message: {
    type: "ai.trainee.control"
    requestID: string
    command: "start" | "pause" | "resume" | "cancel"
    profile?: "guided" | "blind"
    seed?: number
    clientID: string
    characterID: string
  }) => Promise<{ ok: boolean; code: string; runID?: string; message?: string }>
}): Promise<{
  status(): {
    protocol: number
    version: string
    bootstrap?: { available?: boolean; port?: number; error?: string }
    sync?: unknown
    connectedClients: Array<{
      clientID?: string
      scenario?: {
        type: "scenario.snapshot"
        runID: string
        scenarioID: string
        scenarioRevision: number
        timestamp: number
        sessionID?: string
        traineeID?: string
        instructorID?: string
        status: "running" | "paused" | "completed" | "cancelled" | "failed"
        currentStepID?: string
        attempt: number
        timeoutRemainingMs: number
        evidence: Record<string, unknown>
        instructorEvidenceIDs: string[]
        deploymentID?: string
        scenarioTitle?: string
        currentInstruction?: string
        allowedCapabilityIDs?: string[]
        simulation?: boolean
        criticalAutoApproveCategories?: string[]
      }
    }>
    pendingApprovals?: Array<{ id?: string; expiresAt?: number }>
    modelRuntime?: unknown
  }
  configureServer(connection: { url: string; username: string | null; password: string | null }): void
  aiTraineeSnapshot(characterID?: string): {
    clientID: string
    characterID: string
    gameID: string
    worldRevision: number
    entities: Array<{ id: string; kind?: string; label?: string; visible?: boolean; state?: Record<string, unknown>; affordances?: string[] }>
    capabilities: Array<{ id: string; title: string; description: string; parameters: Record<string, unknown>; risk: "ambient" | "interaction" | "critical"; permissionCategory: string; preconditions: string[]; postconditions: string[] }>
    scenario: { runID: string; scenarioID: string; scenarioRevision: number; title?: string; status: "running" | "paused" | "completed" | "cancelled" | "failed"; currentStepID?: string; currentInstruction?: string; allowedCapabilityIDs?: string[]; attempt: number; simulation: boolean; criticalAutoApproveCategories: string[]; baselineFingerprint?: string; capabilityRevision?: number }
  } | undefined
  aiTraineeAction(input: {
    runID: string
    scenarioRunID: string
    characterID: string
    decision: { capabilityID: string; entityID: string; arguments: Record<string, unknown>; expectedPostconditions: string[] }
    idempotencyKey: string
    simulationAutoApprove: boolean
  }): Promise<{ ok: boolean; code: string; message?: string; autoApproved?: boolean; approved?: boolean }>
  notifyAITrainee(run: { id: string; status: string; profile: string; modelRoute?: string; currentStepID?: string; currentDecision?: { capabilityID: string; entityID: string }; reason?: string; attempts: unknown[]; characterID?: string }): void
  stop(): Promise<void>
  resolveApproval(id: string, approved: boolean, instructorID?: string): boolean
  instructorCommand(input: {
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
  }): Promise<{
    requestID: string
    runID: string
    ok: boolean
    code: string
    timestamp: number
    stepID?: string
    attempt?: number
    message?: string
  }>
  scenarioTestReset(input: { scenarioID: string; scenarioRevision: number; expectedBaselineFingerprint?: string }): Promise<{
    requestID: string
    ok: boolean
    code: string
    timestamp: number
    scenarioID: string
    scenarioRevision: number
    baselineFingerprint?: string
    capabilityRevision?: number
    worldRevision?: number
    runID?: string
    message?: string
  }>
}>
