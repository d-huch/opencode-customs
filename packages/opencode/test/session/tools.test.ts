import { describe, expect, test } from "bun:test"
import { SessionTools } from "../../src/session/tools"

describe("session tools context selection", () => {
  test("filters denied tools before context fitting and preserves an explicit allowlist", () => {
    const selected = SessionTools.forContext(
      {
        bash: "bash",
        "serviceman-db_get_access_context": "context",
        "serviceman-db_search_servicemen": "search",
        "serviceman-db_get_serviceman_profile": "profile",
      },
      [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "serviceman-db_get_access_context", pattern: "*", action: "allow" },
        { permission: "serviceman-db_search_servicemen", pattern: "*", action: "allow" },
        { permission: "serviceman-db_get_serviceman_profile", pattern: "*", action: "allow" },
      ],
    )

    expect(selected.tools).toEqual({
      "serviceman-db_get_access_context": "context",
      "serviceman-db_search_servicemen": "search",
      "serviceman-db_get_serviceman_profile": "profile",
    })
    expect(selected.requiredTools).toEqual([
      "serviceman-db_get_access_context",
      "serviceman-db_search_servicemen",
      "serviceman-db_get_serviceman_profile",
    ])
  })

  test("keeps ordinary allowed tools optional", () => {
    const selected = SessionTools.forContext({ read: "read", grep: "grep" }, [
      { permission: "*", pattern: "*", action: "allow" },
    ])

    expect(selected.tools).toEqual({ read: "read", grep: "grep" })
    expect(selected.requiredTools).toEqual([])
  })
})
