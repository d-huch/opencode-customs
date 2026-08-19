import { expect, test } from "bun:test"

const appKeys = [
  "desktop.menu.app",
  "desktop.menu.documentation",
  "desktop.menu.ariaLabel",
  "desktop.recovery.loadFailed",
  "desktop.recovery.terminated",
  "desktop.recovery.unresponsive",
  "desktop.researchBrowser.title",
  "help.tabs.introduction",
  "toast.update.description",
  "sidebar.gettingStarted.line1",
  "settings.general.row.language.description",
  "settings.general.row.appearance.description",
  "settings.general.row.colorScheme.description",
  "settings.general.row.theme.description",
  "settings.updates.row.startup.description",
  "settings.updates.toast.latest.description",
  "provider.connect.apiKey.description",
  "provider.connect.oauth.code.visit.suffix",
  "provider.connect.oauth.auto.visit.suffix",
  "wsl.onboarding.wslNotInstalled.description",
  "wsl.onboarding.wslUnavailable.description",
  "wsl.onboarding.windowsRestartRequired",
  "error.chain.mcpFailed",
  "status.popover.runtime.router.reason.switchPreviousExternal",
  "status.popover.runtime.router.reason.switchContextPreserved",
  "settings.avatarBridge.security",
  "settings.general.voice.fish.endpoint.description",
  "provider.llamaServer.description",
]

test("product-facing locale copy uses the OpenCode Customs name", async () => {
  const app = new Bun.Glob("*.ts")
  for await (const file of app.scan(new URL(".", import.meta.url).pathname)) {
    if (file.endsWith(".test.ts") || file === "desktop-native.ts") continue
    const source = await Bun.file(new URL(file, import.meta.url)).text()
    for (const key of appKeys) {
      const value = source.match(new RegExp(`"${key.replaceAll(".", "\\.")}"\\s*:\\s*(["'])(.*?)\\1`, "s"))?.[2]
      if (!value?.includes("OpenCode")) continue
      expect({ file, key, value }).toEqual({ file, key, value: expect.stringContaining("OpenCode Customs") })
    }
  }

  const desktopRoot = new URL("../../../desktop/src/renderer/i18n/", import.meta.url)
  const desktop = new Bun.Glob("*.ts")
  for await (const file of desktop.scan(desktopRoot.pathname)) {
    if (file === "index.ts") continue
    const source = await Bun.file(new URL(file, desktopRoot)).text()
    for (const key of ["desktop.updater.none.message", "desktop.updater.downloaded.prompt"]) {
      const value = source.match(new RegExp(`"${key.replaceAll(".", "\\.")}"\\s*:\\s*(["'])(.*?)\\1`, "s"))?.[2]
      expect({ file, key, value }).toEqual({ file, key, value: expect.stringContaining("OpenCode Customs") })
    }
  }
})
