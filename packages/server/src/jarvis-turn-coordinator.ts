import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { JarvisRuntime } from "@opencode-ai/core/jarvis"
import { Hash } from "@opencode-ai/core/util/hash"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { AgentV2 } from "@opencode-ai/core/agent"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Jarvis } from "@opencode-ai/protocol/groups/jarvis"
import { Effect, Semaphore } from "effect"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const conversationLock = Semaphore.makeUnsafe(1)
const admissionLock = Semaphore.makeUnsafe(1)
const partials = new Map<string, Jarvis.PrewarmState>()
const PREWARM_TTL = 15_000

export const conversation = Effect.fn("JarvisTurnCoordinator.conversation")(function* (
  db: Database.Interface["db"],
  sessions: SessionV2.Interface,
  input: Jarvis.ConversationAdopt,
) {
  return yield* conversationLock.withPermit(
    Effect.gen(function* () {
      const current = yield* JarvisRuntime.conversation(db)
      if (current && (yield* validSession(sessions, current.sessionID))) {
        if (current.profileID === input.profileID && current.profileRevision === input.profileRevision) return current
        return yield* JarvisRuntime.adoptConversation(db, {
          ...current,
          profileID: input.profileID ?? current.profileID,
          profileRevision: input.profileRevision ?? current.profileRevision,
        })
      }
      const candidate = input.sessionID && (yield* validSession(sessions, input.sessionID)) ? input.sessionID : undefined
      const directory = join(Global.Path.data, "chat")
      if (!candidate) yield* Effect.promise(() => mkdir(directory, { recursive: true }))
      const session = candidate
        ? yield* sessions.get(SessionV2.ID.make(candidate))
        : yield* sessions.create({
            agent: AgentV2.ID.make("chat"),
            location: { directory: AbsolutePath.make(directory) },
            mode: "chat",
            jarvis: {
              profileID: input.profileID,
              profileRevision: input.profileRevision,
              mode: input.surface === "desktop" ? "chat" : "unity",
            },
          })
      if (candidate)
        yield* sessions.updateJarvis({
          sessionID: session.id,
          jarvis: {
            profileID: input.profileID,
            profileRevision: input.profileRevision,
            mode: input.surface === "desktop" ? "chat" : "unity",
          },
        })
      return yield* JarvisRuntime.adoptConversation(db, {
        sessionID: session.id,
        profileID: input.profileID,
        profileRevision: input.profileRevision,
        recoveredAt: current && current.sessionID !== session.id ? Date.now() : undefined,
      })
    }),
  )
})

export const prewarm = Effect.fn("JarvisTurnCoordinator.prewarm")(function* (
  db: Database.Interface["db"],
  input: Jarvis.PartialTranscript,
) {
  const current = partials.get(input.requestID)
  if (current && current.sequence >= input.sequence && current.expiresAt > Date.now()) return current
  const config = yield* JarvisRuntime.getConfig(db)
  const text = input.text.trim().slice(0, 2_000)
  const memory = text
    ? yield* JarvisRuntime.searchMemory(db, {
        query: text,
        profileID: config.primaryProfileID,
        limit: 4,
      }).pipe(Effect.catch(() => Effect.succeed([])))
    : []
  const state: Jarvis.PrewarmState = {
    requestID: input.requestID,
    surface: input.surface,
    sequence: input.sequence,
    language: input.language,
    profileRevision: input.profileRevision,
    modelReady: !!config.models.dialogue,
    memoryReady: memory.length > 0 || !text,
    worldReady: input.worldContext !== undefined,
    expiresAt: Date.now() + PREWARM_TTL,
  }
  partials.set(input.requestID, state)
  for (const [requestID, value] of partials) if (value.expiresAt <= Date.now()) partials.delete(requestID)
  return state
})

export const admit = Effect.fn("JarvisTurnCoordinator.admit")(function* (
  db: Database.Interface["db"],
  sessions: SessionV2.Interface,
  input: Jarvis.FinalAdmission,
) {
  return yield* admissionLock.withPermit(
    Effect.gen(function* () {
      const canonical = yield* conversation(db, sessions, {
        profileID: input.profileID,
        profileRevision: input.profileRevision,
        surface: input.surface,
      })
      const existing = yield* JarvisRuntime.turnByRequest(db, input.requestID)
      const created = yield* JarvisRuntime.createTurn(db, {
        requestID: input.requestID,
        sessionID: canonical.sessionID,
        profileID: input.profileID,
        surface: input.surface,
        responseMode: input.responseMode,
        phase: "understanding",
      })
      const text = input.worldContext?.trim()
        ? `${input.transcript.trim()}\n\n${input.worldContext.trim().slice(0, 24_000)}`
        : input.transcript.trim()
      const messageID = SessionMessage.ID.make(`msg_jarvis_${Hash.sha256(input.requestID).slice(0, 40)}`)
      const cached = partials.get(input.requestID)
      if (existing?.metrics.admittedAt) {
        if (cached) partials.delete(input.requestID)
        return {
          conversation: canonical,
          turn: existing,
          messageID,
          admitted: false,
          prewarm: cached && cached.expiresAt > Date.now() ? cached : undefined,
        } satisfies Jarvis.FinalAdmissionResult
      }
      yield* sessions.prompt({
        id: messageID,
        sessionID: SessionV2.ID.make(canonical.sessionID),
        prompt: { text },
      })
      const config = yield* JarvisRuntime.getConfig(db)
      const phase = JarvisRuntime.shouldPlan({
        text: input.transcript,
        minWords: config.plannerEscalationMinWords,
      })
        ? ("planning" as const)
        : ("responding" as const)
      const updated =
        (yield* JarvisRuntime.updateTurn(db, created.id, {
          phase,
          sequence: created.sequence + 1,
          metrics: { admittedAt: Date.now() },
        })) ?? created
      if (cached) partials.delete(input.requestID)
      return {
        conversation: canonical,
        turn: updated,
        messageID,
        admitted: true,
        prewarm: cached && cached.expiresAt > Date.now() ? cached : undefined,
      } satisfies Jarvis.FinalAdmissionResult
    }),
  )
})

function validSession(sessions: SessionV2.Interface, sessionID: string) {
  return sessions
    .get(SessionV2.ID.make(sessionID))
    .pipe(
      Effect.map((session) => session.mode === "chat"),
      Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)),
    )
}

export const JarvisTurnCoordinator = { conversation, prewarm, admit }
