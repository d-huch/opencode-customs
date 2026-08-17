import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export const SettingsAvatarBridgeV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [copied, setCopied] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [pairingQR, setPairingQR] = createSignal<string>()
  const [status, { refetch }] = createResource(() => platform.getAvatarBridgeStatus?.())

  createEffect(() => {
    const pairing = status()?.lan?.pairing
    if (!pairing) {
      setPairingQR()
      return
    }
    const payload = JSON.stringify({ protocol: 2, ...pairing })
    void import("qrcode").then(({ toDataURL }) =>
      toDataURL(payload, { width: 144, margin: 1, errorCorrectionLevel: "M" }).then(setPairingQR),
    )
  })

  onMount(() => {
    const timer = setInterval(() => void refetch(), 2_000)
    onCleanup(() => clearInterval(timer))
  })

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError()
    await action()
      .then(() => refetch())
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  const copy = async () => {
    const value = status()
    if (!value?.url || !value.token) return
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          url: value.url,
          token: value.token,
          protocol: value.protocol,
          protocolMinor: 2,
          clientID: "jarvis-lab-pcvr",
          characterID: "jarvis",
          gameID: "jarvis-lab",
          saveSlotID: "slot-1",
        },
        null,
        2,
      ),
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2_000)
  }
  const startPairing = () => run(async () => platform.startAvatarBridgePairing?.())
  const updateConfig = (input: Parameters<NonNullable<typeof platform.updateAvatarBridgeConfig>>[0]) =>
    run(async () => platform.updateAvatarBridgeConfig?.(input))
  const clearMemories = () => {
    if (!window.confirm(language.t("settings.avatarBridge.memory.clear.confirm"))) return
    void run(async () => platform.clearAvatarBridgeMemories?.())
  }
  const configureModel = (role: "dialogueModel" | "plannerModel") => {
    const current = status()?.config?.[role]
    const value = window.prompt(
      language.t(role === "dialogueModel" ? "settings.avatarBridge.models.dialogue.prompt" : "settings.avatarBridge.models.planner.prompt"),
      current ? `${current.providerID}/${current.modelID}` : "lmstudio/",
    )
    if (value === null) return
    const separator = value.indexOf("/")
    if (!value.trim()) {
      void updateConfig({ [role]: undefined })
      return
    }
    if (separator <= 0 || separator === value.length - 1) {
      setError(language.t("settings.avatarBridge.models.invalid"))
      return
    }
    void updateConfig({ [role]: { providerID: value.slice(0, separator).trim(), modelID: value.slice(separator + 1).trim() } })
  }
  const configureTrust = (gameID: string) => {
    const profiles = status()?.config?.trustedProfiles ?? []
    const current = profiles.find((profile) => profile.gameID === gameID)
    const value = window.prompt(
      language.t("settings.avatarBridge.autonomy.critical.prompt"),
      current?.allowedCriticalCategories.join(", ") ?? "",
    )
    if (value === null) return
    const profile = {
      gameID,
      allowInteraction: true,
      allowedCriticalCategories: [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))],
    }
    void updateConfig({ trustedProfiles: [...profiles.filter((item) => item.gameID !== gameID), profile] })
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
              title={status()?.available ? language.t("settings.avatarBridge.status.ready") : language.t("settings.avatarBridge.status.unavailable")}
              description={status()?.message ?? status()?.url ?? language.t("settings.avatarBridge.status.loading")}
            >
              <ButtonV2 size="normal" variant="neutral" disabled={!status()?.url || !status()?.token} onClick={() => void copy()}>
                {copied() ? language.t("settings.avatarBridge.copy.done") : language.t("settings.avatarBridge.copy.action")}
              </ButtonV2>
            </SettingsRowV2>
            <Show when={error()}>{(value) => <SettingsRowV2 title={value()} description=""><span /></SettingsRowV2>}</Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.models.title")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.avatarBridge.models.dialogue")}
              description={status()?.config?.dialogueModel ? `${status()?.config?.dialogueModel?.providerID}/${status()?.config?.dialogueModel?.modelID}` : language.t("settings.avatarBridge.models.sessionDefault")}
            >
              <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => configureModel("dialogueModel")}>{language.t("settings.avatarBridge.models.configure")}</ButtonV2>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.avatarBridge.models.planner")}
              description={status()?.config?.plannerModel ? `${status()?.config?.plannerModel?.providerID}/${status()?.config?.plannerModel?.modelID}` : language.t("settings.avatarBridge.models.unconfigured")}
            >
              <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => configureModel("plannerModel")}>{language.t("settings.avatarBridge.models.configure")}</ButtonV2>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.avatarBridge.models.runtime")}
              description={`${status()?.modelRuntime?.activeRole ?? "—"} · ${status()?.modelRuntime?.selectedModel ? `${status()?.modelRuntime?.selectedModel?.providerID}/${status()?.modelRuntime?.selectedModel?.modelID}` : language.t("settings.avatarBridge.models.sessionDefault")} · ${status()?.modelRuntime?.reason ?? "—"}`}
            ><span /></SettingsRowV2>
          </SettingsListV2>
        </div>

        <Show when={(status()?.connectedClients ?? []).some((client) => client.gameID)}>
          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.autonomy.trusted.title")}</h3>
            <SettingsListV2>
              <For each={[...new Set((status()?.connectedClients ?? []).flatMap((client) => client.gameID ? [client.gameID] : []))]}>
                {(gameID) => {
                  const profile = () => status()?.config?.trustedProfiles.find((item) => item.gameID === gameID)
                  return (
                    <SettingsRowV2 title={gameID} description={profile()?.allowedCriticalCategories.length ? profile()?.allowedCriticalCategories.join(", ") : language.t("settings.avatarBridge.autonomy.critical.none")}>
                      <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => configureTrust(gameID)}>{language.t("settings.avatarBridge.autonomy.critical.configure")}</ButtonV2>
                    </SettingsRowV2>
                  )
                }}
              </For>
            </SettingsListV2>
          </div>
        </Show>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.lan.title")}</h3>
          <SettingsListV2>
            <SettingsRowV2 title={language.t("settings.avatarBridge.lan.enabled")} description={language.t("settings.avatarBridge.lan.description")}>
              <Switch checked={status()?.config?.lanEnabled ?? false} disabled={busy() || !platform.updateAvatarBridgeConfig} onChange={(lanEnabled) => void updateConfig({ lanEnabled })} />
            </SettingsRowV2>
            <SettingsRowV2 title={language.t("settings.avatarBridge.autonomy.interaction")} description={language.t("settings.avatarBridge.autonomy.interaction.description")}>
              <Switch checked={status()?.config?.interactionAutoApprove ?? false} disabled={busy() || !platform.updateAvatarBridgeConfig} onChange={(interactionAutoApprove) => void updateConfig({ interactionAutoApprove })} />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.avatarBridge.pairing.title")}
              description={status()?.lan?.pairing ? `${status()?.lan?.pairing?.pin} · ${status()?.lan?.pairing?.addresses.join(", ")}` : `${language.t("settings.avatarBridge.pairing.fingerprint")}: ${status()?.lan?.certificateFingerprint ?? "—"}`}
            >
              <div class="flex items-center gap-3">
                <Show when={pairingQR()}>{(source) => <img src={source()} width="96" height="96" alt={language.t("settings.avatarBridge.pairing.qr")} />}</Show>
                <ButtonV2 size="normal" variant="neutral" disabled={busy() || !status()?.lan?.enabled || !platform.startAvatarBridgePairing} onClick={() => void startPairing()}>
                  {language.t("settings.avatarBridge.pairing.start")}
                </ButtonV2>
              </div>
            </SettingsRowV2>
            <For each={status()?.pairedDevices ?? []}>
              {(device) => (
                <SettingsRowV2 title={device.name} description={`${device.id} · ${device.revokedAt ? language.t("settings.avatarBridge.device.revoked") : language.t("settings.avatarBridge.device.paired")}`}>
                  <ButtonV2 size="normal" variant="neutral" disabled={busy() || !!device.revokedAt || !platform.revokeAvatarBridgeDevice} onClick={() => void run(async () => platform.revokeAvatarBridgeDevice?.(device.id))}>
                    {language.t("settings.avatarBridge.device.revoke")}
                  </ButtonV2>
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
        </div>

        <Show when={status()?.pendingApprovals?.length}>
          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.approvals.title")}</h3>
            <SettingsListV2>
              <For each={status()?.pendingApprovals ?? []}>
                {(approval) => (
                  <SettingsRowV2 title={approval.title} description={`${approval.characterID} · ${approval.risk} · ${approval.actionID}`}>
                    <div class="flex items-center gap-2">
                      <ButtonV2 size="normal" variant="neutral" onClick={() => void run(async () => platform.resolveAvatarBridgeApproval?.(approval.id, false))}>{language.t("settings.avatarBridge.approvals.deny")}</ButtonV2>
                      <ButtonV2 size="normal" variant="neutral" onClick={() => void run(async () => platform.resolveAvatarBridgeApproval?.(approval.id, true))}>{language.t("settings.avatarBridge.approvals.allow")}</ButtonV2>
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </div>
        </Show>

        <Show when={status()?.goals?.length}>
          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.goals.title")}</h3>
            <SettingsListV2>
              <For each={status()?.goals ?? []}>
                {(goal) => <SettingsRowV2 title={goal.text} description={`${goal.characterID} · ${goal.status} · ${goal.steps.find((step) => step.status === "active")?.text ?? goal.steps.find((step) => step.status === "pending")?.text ?? "—"}${goal.replanReason ? ` · ${goal.replanReason}` : ""}`}><span /></SettingsRowV2>}
              </For>
            </SettingsListV2>
          </div>
        </Show>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.clients.title")}</h3>
          <SettingsListV2>
            <Show when={status()?.connectedClients.length} fallback={<SettingsRowV2 title={language.t("settings.avatarBridge.clients.empty")} description={language.t("settings.avatarBridge.clients.empty.description")}><span /></SettingsRowV2>}>
              <For each={status()?.connectedClients ?? []}>
                {(client) => (
                  <SettingsRowV2 title={client.characterID} description={`${client.remote ? "Quest/LAN" : "PCVR"} · v${client.protocol ?? 1} · ${client.world?.entities.length ?? 0} entities · ${client.capabilities?.map((capability) => `${capability.id} [${capability.permissionCategory}]`).join(", ") || client.actions.join(", ") || "—"}`}>
                    <span class="text-12-regular text-v2-text-text-muted">{client.sessionID ?? language.t("settings.avatarBridge.clients.newSession")}</span>
                  </SettingsRowV2>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <div class="flex items-center justify-between gap-2 pb-2">
            <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.memory.title")}</h3>
            <ButtonV2 size="normal" variant="neutral" disabled={busy() || !status()?.memories?.length || !platform.clearAvatarBridgeMemories} onClick={clearMemories}>{language.t("settings.avatarBridge.memory.clear")}</ButtonV2>
          </div>
          <SettingsListV2>
            <Show when={status()?.memories?.length} fallback={<SettingsRowV2 title={language.t("settings.avatarBridge.memory.empty")} description=""><span /></SettingsRowV2>}>
              <For each={status()?.memories ?? []}>
                {(memory) => (
                  <SettingsRowV2 title={memory.text} description={`${memory.gameID} · ${memory.saveSlotID} · ${memory.characterID} · ${memory.kind} · ${memory.scope} · ${Math.round(memory.confidence * 100)}%${memory.conflictWith ? ` · ${language.t("settings.avatarBridge.memory.conflict")}` : ""}`}>
                    <div class="flex items-center gap-2">
                      <ButtonV2 size="normal" variant="neutral" disabled={busy() || !platform.updateAvatarBridgeMemory} onClick={() => void run(async () => platform.updateAvatarBridgeMemory?.(memory.id, { pinned: !memory.pinned }))}>{memory.pinned ? language.t("settings.avatarBridge.memory.unpin") : language.t("settings.avatarBridge.memory.pin")}</ButtonV2>
                      <ButtonV2 size="normal" variant="neutral" disabled={busy() || !platform.updateAvatarBridgeMemory} onClick={() => {
                        const text = window.prompt(language.t("settings.avatarBridge.memory.edit.prompt"), memory.text)
                        if (text?.trim() && text.trim() !== memory.text) void run(async () => platform.updateAvatarBridgeMemory?.(memory.id, text.trim()))
                      }}>{language.t("settings.avatarBridge.memory.edit")}</ButtonV2>
                      <ButtonV2 size="normal" variant="neutral" disabled={busy() || !platform.deleteAvatarBridgeMemory} onClick={() => void run(async () => platform.deleteAvatarBridgeMemory?.(memory.id))}>{language.t("settings.avatarBridge.memory.delete")}</ButtonV2>
                    </div>
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
