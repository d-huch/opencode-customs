import { describe, expect, test } from "bun:test"
import { RequestPipelineScheduler } from "@/session/request-pipeline"
import { SessionID } from "@/session/schema"

describe("RequestPipelineScheduler", () => {
  test("deduplicates an identical request", () => {
    const sessionID = SessionID.make("ses_pipeline_deduplicate")
    const first = RequestPipelineScheduler.claim({
      sessionID,
      requestMessageID: "msg_request",
      executionID: "exec_request",
      generation: 1,
    })
    const duplicate = RequestPipelineScheduler.claim({
      sessionID,
      requestMessageID: "msg_request",
      executionID: "exec_request",
      generation: 1,
    })

    expect(first.deduplicated).toBe(false)
    expect(duplicate.deduplicated).toBe(true)
    expect(duplicate.signal).toBe(first.signal)
    expect(RequestPipelineScheduler.current(first)).toBe(true)

    RequestPipelineScheduler.release(duplicate)
    expect(RequestPipelineScheduler.current(first)).toBe(false)
  })

  test("cancels stale preparation when a newer request claims the session", () => {
    const sessionID = SessionID.make("ses_pipeline_supersede")
    const stale = RequestPipelineScheduler.claim({
      sessionID,
      requestMessageID: "msg_old",
      executionID: "exec_request",
      generation: 1,
    })
    const current = RequestPipelineScheduler.claim({
      sessionID,
      requestMessageID: "msg_new",
      executionID: "exec_request",
      generation: 1,
    })

    expect(stale.signal.aborted).toBe(true)
    expect(RequestPipelineScheduler.current(stale)).toBe(false)
    expect(RequestPipelineScheduler.current(current)).toBe(true)

    RequestPipelineScheduler.cancel(sessionID)
    expect(current.signal.aborted).toBe(true)
    expect(RequestPipelineScheduler.current(current)).toBe(false)
  })
})
