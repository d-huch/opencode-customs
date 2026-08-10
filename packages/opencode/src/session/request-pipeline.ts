export * as RequestPipelineScheduler from "./request-pipeline"

import { SessionExecutionCheckpoint } from "@opencode-ai/core/session/execution-checkpoint"
import type { Database } from "@opencode-ai/core/database/database"
import { Cause, Effect, Exit, Option } from "effect"
import { SessionID } from "./schema"
import { SessionLog } from "@/local-agent-runtime/session-log"

type DatabaseService = Database.Interface["db"]

export type Handle = {
  readonly sessionID: SessionID
  readonly requestMessageID: string
  readonly executionID: string
  readonly generation: number
  readonly signal: AbortSignal
  readonly deduplicated: boolean
}

type Entry = {
  readonly requestMessageID: string
  readonly executionID: string
  readonly generation: number
  readonly controller: AbortController
}

export class StaleRequestError extends Error {
  override readonly name = "StaleRequestError"

  constructor() {
    super("Request preparation was superseded by a newer user message")
  }
}

const active = new Map<SessionID, Entry>()

export function claim(input: {
  readonly sessionID: SessionID
  readonly requestMessageID: string
  readonly executionID: string
  readonly generation: number
}) {
  const current = active.get(input.sessionID)
  if (
    current?.requestMessageID === input.requestMessageID &&
    current.executionID === input.executionID &&
    current.generation === input.generation
  )
    return {
      ...input,
      signal: current.controller.signal,
      deduplicated: true,
    } satisfies Handle
  current?.controller.abort(new StaleRequestError())
  const controller = new AbortController()
  active.set(input.sessionID, { ...input, controller })
  return {
    ...input,
    signal: controller.signal,
    deduplicated: false,
  } satisfies Handle
}

export function release(handle: Handle) {
  const current = active.get(handle.sessionID)
  if (
    current?.requestMessageID !== handle.requestMessageID ||
    current.executionID !== handle.executionID ||
    current.generation !== handle.generation
  )
    return
  active.delete(handle.sessionID)
}

export function cancel(sessionID: SessionID) {
  const current = active.get(sessionID)
  if (!current) return
  current.controller.abort(new StaleRequestError())
  active.delete(sessionID)
}

export function current(handle: Handle) {
  const entry = active.get(handle.sessionID)
  return (
    entry?.requestMessageID === handle.requestMessageID &&
    entry.executionID === handle.executionID &&
    entry.generation === handle.generation &&
    !handle.signal.aborted
  )
}

export function phase<A, E, R>(input: {
  readonly db: DatabaseService
  readonly checkpoint: SessionExecutionCheckpoint.Token
  readonly handle: Handle
  readonly phase: SessionExecutionCheckpoint.PipelinePhase
  readonly effect: Effect.Effect<A, E, R>
  readonly detail?: string
}): Effect.Effect<A, E, R> {
  if (!current(input.handle)) return Effect.interrupt
  const startedAt = Date.now()
  return mark({
    db: input.db,
    checkpoint: input.checkpoint,
    phase: input.phase,
    status: "running",
    detail: input.detail,
  }).pipe(
    Effect.flatMap(() => input.effect.pipe(Effect.raceFirst(aborted(input.handle.signal)))),
    Effect.onExit((exit) =>
      mark({
        db: input.db,
        checkpoint: input.checkpoint,
        phase: input.phase,
        status: Exit.isSuccess(exit)
          ? "completed"
          : Cause.hasInterrupts(exit.cause) || input.handle.signal.aborted
            ? "cancelled"
            : "failed",
        detail: Exit.isFailure(exit) ? Cause.pretty(exit.cause).split("\n")[0] : input.detail,
        startedAt,
      }).pipe(Effect.asVoid),
    ),
  )
}

export function optional<A, E, R>(input: {
  readonly db: DatabaseService
  readonly checkpoint: SessionExecutionCheckpoint.Token
  readonly handle: Handle
  readonly phase: SessionExecutionCheckpoint.PipelinePhase
  readonly effect: Effect.Effect<A, E, R>
  readonly timeout: number
  readonly fallback: A
  readonly detail?: string
}): Effect.Effect<A, E, R> {
  return phase({
    ...input,
    effect: input.effect.pipe(Effect.timeoutOption(input.timeout)),
  }).pipe(
    Effect.flatMap((result) => {
      if (Option.isSome(result)) return Effect.succeed(result.value)
      return mark({
        db: input.db,
        checkpoint: input.checkpoint,
        phase: input.phase,
        status: "timed_out",
        detail: `Optional source exceeded ${input.timeout} ms`,
      }).pipe(Effect.as(input.fallback))
    }),
  )
}

export function skip(input: {
  readonly db: DatabaseService
  readonly checkpoint: SessionExecutionCheckpoint.Token
  readonly phase: SessionExecutionCheckpoint.PipelinePhase
  readonly detail: string
}) {
  return mark({
    db: input.db,
    checkpoint: input.checkpoint,
    phase: input.phase,
    status: "skipped",
    detail: input.detail,
  })
}

export function mark(input: {
  readonly db: DatabaseService
  readonly checkpoint: SessionExecutionCheckpoint.Token
  readonly phase: SessionExecutionCheckpoint.PipelinePhase
  readonly status: Exclude<SessionExecutionCheckpoint.PipelineStatus, "pending">
  readonly detail?: string
  readonly startedAt?: number
}) {
  const now = Date.now()
  return SessionExecutionCheckpoint.setPipelinePhase(input.db, input.checkpoint, {
    phase: input.phase,
    status: input.status,
    detail: input.detail,
  }).pipe(
    Effect.tap((updated) =>
      updated
        ? Effect.promise(() =>
            SessionLog.write({
              sessionID: input.checkpoint.sessionID,
              executionID: input.checkpoint.executionID,
              type: "pipeline.phase",
              data: {
                phase: input.phase,
                status: input.status,
                ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
                ...(input.status !== "running" ? { completedAt: now } : { startedAt: now }),
                ...(input.startedAt !== undefined && input.status !== "running"
                  ? { durationMs: Math.max(0, now - input.startedAt) }
                  : {}),
                detail: input.detail,
              },
            }),
          )
        : Effect.void,
    ),
  )
}

function aborted(signal: AbortSignal) {
  return Effect.callback<never>((resume) => {
    if (signal.aborted) {
      resume(Effect.interrupt)
      return
    }
    const onAbort = () => resume(Effect.interrupt)
    signal.addEventListener("abort", onAbort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", onAbort))
  })
}
