import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/VoiceModeMenu"
const sessionID = "ses_voice_mode_menu"

for (const layout of ["v2", "legacy"] as const) {
  test(`${layout} composer persists the voice mode and keeps its trigger visible when off`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: "proj_voice_mode_menu",
        worktree: directory,
        vcs: "git",
        name: "voice-mode-menu",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: { all: [], connected: [], default: {} },
      sessions: [
        {
          id: sessionID,
          slug: "voice-mode-menu",
          projectID: "proj_voice_mode_menu",
          directory,
          title: "Voice mode menu",
          version: "dev",
          time: { created: 1700000000000, updated: 1700000000000 },
        },
      ],
      pageMessages: () => ({ items: [] }),
    })
    await page.addInitScript((newLayoutDesigns) => {
      if (localStorage.getItem("settings.v3")) return
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({
          general: { newLayoutDesigns },
          voice: { enabled: true, listeningEnabled: true, speakResponses: true },
        }),
      )
    }, layout === "v2")

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    const trigger = page.locator('[data-action="voice-mode"]')
    const microphone = page.locator('[data-action="voice-agent"]')
    await expectAppVisible(trigger)

    await trigger.focus()
    await trigger.press("Enter")
    await page.locator('[data-action="voice-mode-speak"]').click()
    await expect(microphone).toBeDisabled()
    await expect.poll(() => page.evaluate(() => localStorage.getItem("settings.v3"))).toContain('"listeningEnabled":false')

    await trigger.click()
    const off = page.locator('[data-action="voice-mode-off"]')
    await expect(off).toBeVisible()
    await off.click({ force: true })
    await expect(trigger).toBeVisible()
    await expect(microphone).toBeDisabled()
    await expect(trigger).toHaveAttribute("aria-label", /Off/)
    await expect.poll(() => page.evaluate(() => localStorage.getItem("settings.v3"))).toContain('"enabled":false')

    await page.reload()
    await expectAppVisible(trigger)
    await expect(trigger).toHaveAttribute("aria-label", /Off/)
  })
}
