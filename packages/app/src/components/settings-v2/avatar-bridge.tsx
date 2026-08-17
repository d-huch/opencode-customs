import { createResource, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export const SettingsAvatarBridgeV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [copied, setCopied] = createSignal(false)
  const [status, { refetch }] = createResource(() => platform.getAvatarBridgeStatus?.())

  onMount(() => {
    const timer = setInterval(() => void refetch(), 2_000)
    onCleanup(() => clearInterval(timer))
  })

  const copy = async () => {
    const value = status()
    if (!value?.url || !value.token) return
    await navigator.clipboard.writeText(
      JSON.stringify({ url: value.url, token: value.token, protocol: value.protocol }, null, 2),
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2_000)
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.avatarBridge")}</h2>
        <p class="settings-v2-tab-description">{language.t("settings.avatarBridge.description")}</p>
      </div>
      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={
                status()?.available
                  ? language.t("settings.avatarBridge.status.ready")
                  : language.t("settings.avatarBridge.status.unavailable")
              }
              description={status()?.message ?? status()?.url ?? language.t("settings.avatarBridge.status.loading")}
            >
              <ButtonV2
                size="normal"
                variant="neutral"
                disabled={!status()?.url || !status()?.token}
                onClick={() => void copy()}
              >
                {copied()
                  ? language.t("settings.avatarBridge.copy.done")
                  : language.t("settings.avatarBridge.copy.action")}
              </ButtonV2>
            </SettingsRowV2>
          </SettingsListV2>
        </div>
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.clients.title")}</h3>
          <SettingsListV2>
            <Show
              when={status()?.connectedClients.length}
              fallback={
                <SettingsRowV2
                  title={language.t("settings.avatarBridge.clients.empty")}
                  description={language.t("settings.avatarBridge.clients.empty.description")}
                >
                  <span />
                </SettingsRowV2>
              }
            >
              <For each={status()?.connectedClients ?? []}>
                {(client) => (
                  <SettingsRowV2
                    title={client.characterID}
                    description={`${client.clientID} · ${client.actions.join(", ") || "—"}`}
                  >
                    <span class="text-12-regular text-v2-text-text-muted">
                      {client.sessionID ?? language.t("settings.avatarBridge.clients.newSession")}
                    </span>
                  </SettingsRowV2>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>
        <p class="text-12-regular text-v2-text-text-muted">{language.t("settings.avatarBridge.security")}</p>
      </div>
    </>
  )
}
