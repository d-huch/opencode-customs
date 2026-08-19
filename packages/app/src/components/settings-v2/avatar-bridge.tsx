import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { createStore } from "solid-js/store"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export const SettingsAvatarBridgeV2: Component<{ onNavigate?: (tab: string) => void }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const dialog = useDialog()
  const [copied, setCopied] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [pairingQR, setPairingQR] = createSignal<string>()
  const [now, setNow] = createSignal(Date.now())
  const [status, { refetch }] = createResource(() => platform.getAvatarBridgeStatus?.())
  const [jarvis] = createResource(() => serverSDK(), (sdk) => sdk.client.v2.jarvis.status().then((result) => result.data))
  const [advanced, setAdvanced] = createStore({ maximumActionsPerCycle: 8, cycleTimeoutMs: 60_000, attentionThreshold: 0.65, attentionCooldownMs: 5_000, dirty: false })

  createEffect(() => {
    const config = status()?.config
    if (!config || advanced.dirty) return
    setAdvanced({ maximumActionsPerCycle: config.maximumActionsPerCycle, cycleTimeoutMs: config.cycleTimeoutMs, attentionThreshold: config.attentionThreshold, attentionCooldownMs: config.attentionCooldownMs, dirty: false })
  })

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
    const timer = setInterval(() => { setNow(Date.now()); void refetch() }, 1_000)
    onCleanup(() => clearInterval(timer))
  })

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError()
    return action()
      .then(async () => {
        await refetch()
        return true
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      })
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
  const startPairing = () => run(async () => {
    if (!platform.startAvatarBridgePairing) throw new Error(language.t("settings.avatarBridge.action.unavailable"))
    await platform.startAvatarBridgePairing()
  })
  const cancelPairing = () => run(async () => {
    if (!platform.cancelAvatarBridgePairing) throw new Error(language.t("settings.avatarBridge.pairing.cancelUnavailable"))
    await platform.cancelAvatarBridgePairing()
  })
  const updateConfig = (input: Parameters<NonNullable<typeof platform.updateAvatarBridgeConfig>>[0]) =>
    run(async () => {
      if (!platform.updateAvatarBridgeConfig) throw new Error(language.t("settings.avatarBridge.action.unavailable"))
      await platform.updateAvatarBridgeConfig(input)
    })
  const resolveApproval = (id: string, approved: boolean) => run(async () => {
    if (!platform.resolveAvatarBridgeApproval) throw new Error(language.t("settings.avatarBridge.action.unavailable"))
    if (!(await platform.resolveAvatarBridgeApproval(id, approved)))
      throw new Error(language.t("settings.avatarBridge.approvals.expired"))
  })
  const configureTrust = (gameID: string) => {
    const profiles = status()?.config?.trustedProfiles ?? []
    const current = profiles.find((profile) => profile.gameID === gameID)
    dialog.show(() => <TrustDialog gameID={gameID} profile={current} save={(profile) => updateConfig({ trustedProfiles: [...profiles.filter((item) => item.gameID !== gameID), profile] })} />)
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
            <Show when={status()?.sync}>
              {(sync) => <SettingsRowV2 title={language.t(`settings.avatarBridge.sync.${sync().state}`)} description={sync().error ?? language.t("settings.avatarBridge.sync.pending", { count: sync().pending })}><Show when={sync().state === "error" || sync().pending > 0} fallback={<span />}><ButtonV2 size="normal" variant="neutral" disabled={busy() || !platform.retryAvatarBridgeSync} onClick={() => void run(async () => { if (!platform.retryAvatarBridgeSync) throw new Error(language.t("settings.avatarBridge.sync.unavailable")); await platform.retryAvatarBridgeSync() })}>{language.t("settings.avatarBridge.sync.retry")}</ButtonV2></Show></SettingsRowV2>}
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.avatarBridge.models.title")}</h3>
          <SettingsListV2>
            <For each={["dialogue", "planner", "embedding"] as const}>{(role) => <SettingsRowV2 title={language.t(`settings.jarvis.models.${role}`)} description={jarvis()?.config.models[role] ? `${jarvis()?.config.models[role]?.providerID}/${jarvis()?.config.models[role]?.modelID}` : language.t("settings.jarvis.models.unconfigured")}><ButtonV2 size="normal" variant="neutral" onClick={() => props.onNavigate?.("jarvis")}>{language.t("settings.avatarBridge.models.configureJarvis")}</ButtonV2></SettingsRowV2>}</For>
            <SettingsRowV2
              title={language.t("settings.avatarBridge.models.runtime")}
              description={status()?.modelRuntime?.selectedModel ? `${status()?.modelRuntime?.selectedModel?.providerID}/${status()?.modelRuntime?.selectedModel?.modelID}` : language.t("settings.avatarBridge.models.runtimeIdle")}
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
            <div class="grid gap-3 p-4 md:grid-cols-2">
              <AvatarNumberField label={language.t("settings.avatarBridge.advanced.actions")} value={advanced.maximumActionsPerCycle} min={1} max={8} update={(value) => setAdvanced({ maximumActionsPerCycle: value, dirty: true })} />
              <AvatarNumberField label={language.t("settings.avatarBridge.advanced.cycle")} value={advanced.cycleTimeoutMs / 1_000} min={5} max={60} update={(value) => setAdvanced({ cycleTimeoutMs: value * 1_000, dirty: true })} />
              <AvatarNumberField label={language.t("settings.avatarBridge.advanced.threshold")} value={advanced.attentionThreshold} min={0} max={1} step={0.05} update={(value) => setAdvanced({ attentionThreshold: value, dirty: true })} />
              <AvatarNumberField label={language.t("settings.avatarBridge.advanced.cooldown")} value={advanced.attentionCooldownMs / 1_000} min={0.5} max={60} step={0.5} update={(value) => setAdvanced({ attentionCooldownMs: value * 1_000, dirty: true })} />
              <div class="flex gap-2 md:col-span-2">
                <ButtonV2 variant="contrast" disabled={!advanced.dirty || busy()} onClick={() => void updateConfig({ maximumActionsPerCycle: advanced.maximumActionsPerCycle, cycleTimeoutMs: advanced.cycleTimeoutMs, attentionThreshold: advanced.attentionThreshold, attentionCooldownMs: advanced.attentionCooldownMs }).then((saved) => { if (saved) setAdvanced("dirty", false) })}>{language.t("common.save")}</ButtonV2>
                <ButtonV2 variant="ghost" disabled={!advanced.dirty || busy()} onClick={() => { const config = status()?.config; if (config) setAdvanced({ maximumActionsPerCycle: config.maximumActionsPerCycle, cycleTimeoutMs: config.cycleTimeoutMs, attentionThreshold: config.attentionThreshold, attentionCooldownMs: config.attentionCooldownMs, dirty: false }) }}>{language.t("common.cancel")}</ButtonV2>
              </div>
            </div>
            <SettingsRowV2
              title={language.t("settings.avatarBridge.pairing.title")}
              description={status()?.lan?.pairing ? `${status()?.lan?.pairing?.pin} · ${Math.max(0, Math.ceil(((status()?.lan?.pairing?.expiresAt ?? now()) - now()) / 1_000))} ${language.t("settings.avatarBridge.pairing.seconds")}` : status()?.lan?.certificateFingerprint ? `${language.t("settings.avatarBridge.pairing.fingerprint")}: ${status()?.lan?.certificateFingerprint}` : language.t("settings.avatarBridge.pairing.notReady")}
            >
              <div class="flex items-center gap-3">
                <Show when={pairingQR()}>{(source) => <img src={source()} width="96" height="96" alt={language.t("settings.avatarBridge.pairing.qr")} />}</Show>
                <ButtonV2 size="normal" variant="neutral" disabled={busy() || !status()?.lan?.enabled || !platform.startAvatarBridgePairing} onClick={() => void startPairing()}>
                  {status()?.lan?.pairing ? language.t("settings.avatarBridge.pairing.regenerate") : language.t("settings.avatarBridge.pairing.start")}
                </ButtonV2>
                <Show when={status()?.lan?.pairing}><ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => void cancelPairing()}>{language.t("common.cancel")}</ButtonV2></Show>
              </div>
            </SettingsRowV2>
            <For each={status()?.pairedDevices ?? []}>
              {(device) => (
                <SettingsRowV2 title={device.name} description={`${device.id} · ${device.revokedAt ? language.t("settings.avatarBridge.device.revoked") : language.t("settings.avatarBridge.device.paired")}`}>
                  <ButtonV2 size="normal" variant="neutral" disabled={busy() || !!device.revokedAt || !platform.revokeAvatarBridgeDevice} onClick={() => dialog.show(() => <AvatarConfirmDialog title={language.t("settings.avatarBridge.device.revoke")} description={device.name} run={() => run(async () => { if (!platform.revokeAvatarBridgeDevice) throw new Error(language.t("settings.avatarBridge.action.unavailable")); await platform.revokeAvatarBridgeDevice(device.id) })} />)}>
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
                  <SettingsRowV2 title={approval.title} description={`${language.t(`settings.avatarBridge.approvals.risk.${approval.risk}`)} · ${approval.actionID} · ${Math.max(0, Math.ceil((approval.expiresAt - now()) / 1_000))} ${language.t("settings.avatarBridge.pairing.seconds")} · ${JSON.stringify(approval.args)}`}>
                    <div class="flex items-center gap-2">
                      <ButtonV2 size="normal" variant="neutral" disabled={busy() || approval.expiresAt <= now() || !platform.resolveAvatarBridgeApproval} onClick={() => void resolveApproval(approval.id, false)}>{language.t("settings.avatarBridge.approvals.deny")}</ButtonV2>
                      <ButtonV2 size="normal" variant="neutral" disabled={busy() || approval.expiresAt <= now() || !platform.resolveAvatarBridgeApproval} onClick={() => void resolveApproval(approval.id, true)}>{language.t("settings.avatarBridge.approvals.allow")}</ButtonV2>
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
            <ButtonV2 size="normal" variant="neutral" disabled={busy() || !status()?.memories?.length || !platform.clearAvatarBridgeMemories} onClick={() => dialog.show(() => <AvatarConfirmDialog title={language.t("settings.avatarBridge.memory.clear")} description={language.t("settings.avatarBridge.memory.clear.confirm")} run={() => run(async () => { if (!platform.clearAvatarBridgeMemories) throw new Error(language.t("settings.avatarBridge.action.unavailable")); await platform.clearAvatarBridgeMemories() })} />)}>{language.t("settings.avatarBridge.memory.clear")}</ButtonV2>
          </div>
          <SettingsListV2>
            <Show when={status()?.memories?.length} fallback={<SettingsRowV2 title={language.t("settings.avatarBridge.memory.empty")} description=""><span /></SettingsRowV2>}>
              <For each={status()?.memories ?? []}>
                {(memory) => (
                  <SettingsRowV2 title={memory.text} description={`${memory.gameID} · ${memory.saveSlotID} · ${memory.characterID} · ${memory.kind} · ${memory.scope} · ${Math.round(memory.confidence * 100)}%${memory.conflictWith ? ` · ${language.t("settings.avatarBridge.memory.conflict")}` : ""}`}>
                    <div class="flex items-center gap-2">
                      <ButtonV2 size="normal" variant="neutral" disabled={busy() || !platform.updateAvatarBridgeMemory} onClick={() => void run(async () => { if (!platform.updateAvatarBridgeMemory) throw new Error(language.t("settings.avatarBridge.action.unavailable")); await platform.updateAvatarBridgeMemory(memory.id, { pinned: !memory.pinned }) })}>{memory.pinned ? language.t("settings.avatarBridge.memory.unpin") : language.t("settings.avatarBridge.memory.pin")}</ButtonV2>
                      <ButtonV2 size="normal" variant="neutral" disabled={busy() || !platform.updateAvatarBridgeMemory} onClick={() => dialog.show(() => <AvatarMemoryDialog text={memory.text} save={(text) => run(async () => { if (!platform.updateAvatarBridgeMemory) throw new Error(language.t("settings.avatarBridge.action.unavailable")); await platform.updateAvatarBridgeMemory(memory.id, text) })} />)}>{language.t("settings.avatarBridge.memory.edit")}</ButtonV2>
                      <ButtonV2 size="normal" variant="neutral" disabled={busy() || !platform.deleteAvatarBridgeMemory} onClick={() => dialog.show(() => <AvatarConfirmDialog title={language.t("settings.avatarBridge.memory.delete")} description={memory.text} run={() => run(async () => { if (!platform.deleteAvatarBridgeMemory) throw new Error(language.t("settings.avatarBridge.action.unavailable")); await platform.deleteAvatarBridgeMemory(memory.id) })} />)}>{language.t("settings.avatarBridge.memory.delete")}</ButtonV2>
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

function AvatarNumberField(props: { label: string; value: number; min: number; max: number; step?: number; update: (value: number) => void }) {
  return <label class="grid gap-1 text-12-medium text-v2-text-text-muted">{props.label}<TextInputV2 type="number" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onInput={(event) => props.update(Math.min(props.max, Math.max(props.min, Number(event.currentTarget.value) || props.min)))} /></label>
}

function TrustDialog(props: {
  gameID: string
  profile?: { gameID: string; allowInteraction: boolean; allowedCriticalCategories: string[] }
  save: (profile: { gameID: string; allowInteraction: boolean; allowedCriticalCategories: string[] }) => Promise<boolean>
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [form, setForm] = createStore({ allowInteraction: props.profile?.allowInteraction ?? false, categories: props.profile?.allowedCriticalCategories.join(", ") ?? "", busy: false, error: "" })
  const save = async () => {
    setForm({ busy: true, error: "" })
    await props.save({ gameID: props.gameID, allowInteraction: form.allowInteraction, allowedCriticalCategories: [...new Set(form.categories.split(",").map((item) => item.trim()).filter(Boolean))] }).then((saved) => { if (saved) dialog.close() }).catch((error: unknown) => setForm({ busy: false, error: error instanceof Error ? error.message : String(error) }))
  }
  return <DialogV2><DialogHeader><DialogTitle>{props.gameID}</DialogTitle></DialogHeader><DialogBody class="grid gap-3"><label class="flex items-center justify-between gap-3 text-13-regular">{language.t("settings.avatarBridge.autonomy.interaction")}<Switch checked={form.allowInteraction} onChange={(value) => setForm("allowInteraction", value)} /></label><label class="grid gap-1 text-12-medium text-v2-text-text-muted">{language.t("settings.avatarBridge.autonomy.critical.categories")}<TextareaV2 rows={4} value={form.categories} onInput={(event) => setForm("categories", event.currentTarget.value)} /></label><Show when={form.error}><p class="text-12-regular text-v2-text-text-danger">{form.error}</p></Show></DialogBody><DialogFooter><ButtonV2 variant="ghost" disabled={form.busy} onClick={() => dialog.close()}>{language.t("common.cancel")}</ButtonV2><ButtonV2 variant={form.busy ? "loading" : "contrast"} disabled={form.busy} onClick={() => void save()}>{language.t("common.save")}</ButtonV2></DialogFooter></DialogV2>
}

function AvatarMemoryDialog(props: { text: string; save: (text: string) => Promise<boolean> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [text, setText] = createSignal(props.text)
  const [busy, setBusy] = createSignal(false)
  const save = async () => {
    if (!text().trim()) return
    setBusy(true)
    await props.save(text().trim()).then((saved) => { if (saved) dialog.close() }).finally(() => setBusy(false))
  }
  return <DialogV2><DialogHeader><DialogTitle>{language.t("settings.avatarBridge.memory.edit")}</DialogTitle></DialogHeader><DialogBody><TextareaV2 autofocus rows={6} value={text()} onInput={(event) => setText(event.currentTarget.value)} /></DialogBody><DialogFooter><ButtonV2 variant="ghost" disabled={busy()} onClick={() => dialog.close()}>{language.t("common.cancel")}</ButtonV2><ButtonV2 variant={busy() ? "loading" : "contrast"} disabled={busy() || !text().trim()} onClick={() => void save()}>{language.t("common.save")}</ButtonV2></DialogFooter></DialogV2>
}

function AvatarConfirmDialog(props: { title: string; description: string; run: () => Promise<boolean> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)
  const run = async () => {
    setBusy(true)
    await props.run().then((completed) => { if (completed) dialog.close() }).finally(() => setBusy(false))
  }
  return <DialogV2 fit><DialogHeader><DialogTitle>{props.title}</DialogTitle></DialogHeader><DialogBody><p class="text-13-regular text-v2-text-text-muted">{props.description}</p></DialogBody><DialogFooter><ButtonV2 variant="ghost" disabled={busy()} onClick={() => dialog.close()}>{language.t("common.cancel")}</ButtonV2><ButtonV2 variant={busy() ? "loading" : "contrast"} disabled={busy()} onClick={() => void run()}>{language.t("common.confirm")}</ButtonV2></DialogFooter></DialogV2>
}
