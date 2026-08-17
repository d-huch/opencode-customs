import { createResource, createSignal, onCleanup, onMount, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings, type ResearchBrowserVisibility, type WebSearchEngine } from "@/context/settings"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { useServer } from "@/context/server"

const engines: WebSearchEngine[] = ["duckduckgo", "google", "bing"]
const visibility: ResearchBrowserVisibility[] = ["background", "always", "hidden"]

export const SettingsWebSearchV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const settings = useSettings()
  const [clearing, setClearing] = createSignal(false)
  const [status, { refetch }] = createResource(() => platform.getResearchBrowserStatus?.())

  onMount(() => {
    const timer = setInterval(() => void refetch(), 2_000)
    onCleanup(() => clearInterval(timer))
  })

  const open = async () => {
    await platform.showResearchBrowser?.()
    await refetch()
  }
  const clear = async () => {
    if (!window.confirm(language.t("settings.webSearch.browser.clearConfirm"))) return
    setClearing(true)
    await platform.clearResearchBrowserData?.().finally(() => setClearing(false))
    await refetch()
  }
  const statusLabel = () => {
    if (!server.isLocal() || !platform.getResearchBrowserStatus)
      return language.t("settings.webSearch.status.unavailable")
    const value = status()
    if (!value) return language.t("settings.webSearch.status.loading")
    return language.t(`settings.webSearch.status.${value.phase}`)
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.webSearch")}</h2>
        <p class="settings-v2-tab-description">{language.t("settings.webSearch.description")}</p>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.webSearch.enabled.title")}
              description={language.t("settings.webSearch.enabled.description")}
            >
              <Switch checked={settings.webSearch.enabled()} onChange={settings.webSearch.setEnabled} />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webSearch.engine.title")}
              description={language.t("settings.webSearch.engine.description")}
            >
              <SelectV2
                appearance="inline"
                options={engines}
                current={settings.webSearch.engine()}
                label={(option) => language.t(`settings.webSearch.engine.${option}`)}
                onSelect={(option) => option && settings.webSearch.setEngine(option)}
              />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webSearch.visibility.title")}
              description={language.t("settings.webSearch.visibility.description")}
            >
              <SelectV2
                appearance="inline"
                options={visibility}
                current={settings.webSearch.visibility()}
                label={(option) => language.t(`settings.webSearch.visibility.${option}`)}
                onSelect={(option) => option && settings.webSearch.setVisibility(option)}
              />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webSearch.authenticated.title")}
              description={language.t("settings.webSearch.authenticated.description")}
            >
              <Switch
                checked={settings.webSearch.authenticatedPages()}
                onChange={settings.webSearch.setAuthenticatedPages}
              />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webSearch.privateNetwork.title")}
              description={language.t("settings.webSearch.privateNetwork.description")}
            >
              <Switch checked={settings.webSearch.privateNetwork()} onChange={settings.webSearch.setPrivateNetwork} />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webSearch.externalFallback.title")}
              description={language.t("settings.webSearch.externalFallback.description")}
            >
              <Switch
                checked={settings.webSearch.externalFallback()}
                onChange={settings.webSearch.setExternalFallback}
              />
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.webSearch.browser.title")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={statusLabel()}
              description={
                status()?.domain ??
                status()?.query ??
                status()?.message ??
                language.t("settings.webSearch.browser.localOnly")
              }
            >
              <div class="flex items-center gap-2">
                <ButtonV2
                  size="normal"
                  variant="neutral"
                  disabled={!server.isLocal() || !platform.showResearchBrowser}
                  onClick={() => void open()}
                >
                  {language.t("settings.webSearch.browser.open")}
                </ButtonV2>
                <ButtonV2
                  size="normal"
                  variant="neutral"
                  disabled={!server.isLocal() || !platform.clearResearchBrowserData || clearing()}
                  onClick={() => void clear()}
                >
                  {language.t("settings.webSearch.browser.clear")}
                </ButtonV2>
              </div>
            </SettingsRowV2>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}
