import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU } from "./desktop-menu"

describe("desktop menu", () => {
  test("exports logs through the desktop command registry", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.labelKey === "desktop.menu.exportLogs",
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })

  test("provides translated labels for role-backed entries", () => {
    const windowMenu = DESKTOP_MENU.find((menu) => menu.role === "windowMenu")
    const roleItems = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.role && item.labelKey,
    )

    expect(windowMenu?.labelKey).toBe("desktop.menu.window")
    expect(roleItems.length).toBeGreaterThan(0)
  })

  test("does not expose feedback, bug reporting, or Discord", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? [])
    const forbidden = new Set([
      "desktop.menu.supportForum",
      "desktop.menu.shareFeedback",
      "desktop.menu.reportBug",
    ])

    expect(items.some((item) => item.type === "item" && forbidden.has(item.labelKey ?? ""))).toBe(false)
    expect(
      items.some(
        (item) =>
          item.type === "item" &&
          !!item.href &&
          (item.href.includes("discord.com") || item.href.includes("desktop-feedback") || item.href.includes("issues/new")),
      ),
    ).toBe(false)
  })
})
