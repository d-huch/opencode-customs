import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { compileDraft, createDemonstrationStore, type DemonstrationRun } from "../src/demonstration"

describe("demonstration store", () => {
  test("records typed actions idempotently and attaches narration to the nearest action", async () => {
    const store = await createDemonstrationStore(await mkdtemp(join(tmpdir(), "embodied-demo-")))
    await store.record({ type: "demonstration.start", demonstrationID: "demo-1", timestamp: 100, gameID: "loto", saveSlotID: "one", characterID: "instructor", clientID: "unity" })
    const event = {
      type: "demonstration.event" as const, demonstrationID: "demo-1", eventID: "event-1", sequence: 1, timestamp: 200,
      entityID: "disconnect-switch", capabilityID: "safety.disconnect", action: "open_disconnect", ok: true, code: "completed",
      risk: "critical" as const, permissionCategory: "equipment-isolation", postconditions: ["disconnect.open=true"],
    }
    await store.record(event)
    await store.record(event)
    await store.record({ type: "demonstration.transcript", demonstrationID: "demo-1", eventID: "speech-1", timestamp: 210, text: "Open the disconnect switch." })
    await store.record({ type: "demonstration.transcript", demonstrationID: "demo-1", eventID: "speech-1", timestamp: 210, text: "Open the disconnect switch." })
    await store.record({ type: "demonstration.complete", demonstrationID: "demo-1", timestamp: 300 })
    const run = await store.get("demo-1")
    expect(run?.events).toHaveLength(1)
    expect(run?.events[0]?.narration).toBe("Open the disconnect switch.")
    expect((await store.draft("demo-1"))?.steps[0]).toMatchObject({ entityID: "disconnect-switch", risk: "critical", permissionCategory: "equipment-isolation" })
  })

  test("keeps failed actions as negative examples", () => {
    const run: DemonstrationRun = {
      format: "embodied-demonstration-v1", demonstrationID: "demo", title: "LOTO", gameID: "loto", saveSlotID: "one",
      characterID: "instructor", clientID: "unity", status: "completed", startedAt: 1, completedAt: 3, transcriptCharacters: 0, transcriptEventIDs: [],
      events: [{ type: "demonstration.event", demonstrationID: "demo", eventID: "bad", sequence: 1, timestamp: 2, entityID: "lock", capabilityID: "safety.lock", action: "apply_lock", ok: false, code: "ppe_required", risk: "critical", postconditions: [] }],
    }
    const draft = compileDraft(run)
    expect(draft.steps).toHaveLength(0)
    expect(draft.negativeExamples).toEqual([expect.objectContaining({ eventID: "bad", code: "ppe_required" })])
  })

  test("keeps one active recording across a Runtime restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "embodied-demo-restart-"))
    const first = await createDemonstrationStore(directory)
    const now = Date.now()
    await first.record({ type: "demonstration.start", demonstrationID: "demo-active", timestamp: now, gameID: "loto", saveSlotID: "one", characterID: "instructor", clientID: "unity" })
    const restarted = await createDemonstrationStore(directory)
    expect(await restarted.record({ type: "demonstration.start", demonstrationID: "demo-conflict", timestamp: now + 1_000, gameID: "loto", saveSlotID: "one", characterID: "instructor", clientID: "unity" })).toMatchObject({ ok: false, code: "recording_in_progress" })
    expect(await restarted.record({ type: "demonstration.start", demonstrationID: "demo-active", timestamp: now + 1_000, gameID: "loto", saveSlotID: "one", characterID: "instructor", clientID: "unity" })).toMatchObject({ ok: true, code: "already_recording" })
  })
})
