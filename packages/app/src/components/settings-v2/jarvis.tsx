import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { JarvisConfig, JarvisMemoryRecord } from "@opencode-ai/sdk/v2/client"
import { ModelSelectorPopoverV2 } from "@/components/dialog-select-model"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { agentCatchphrases } from "@/utils/agent-personalization"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export const SettingsJarvisV2: Component<{ onNavigate?: (value: string) => void }> = (props) => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const models = useModels()
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [goalFilter, setGoalFilter] = createSignal<"active" | "suspended" | "history">("active")
  const [memorySearch, setMemorySearch] = createSignal("")
  const [advanced, setAdvanced] = createStore({
    plannerTimeoutMs: 8_000,
    plannerIdleUnloadMs: 600_000,
    plannerEscalationMinWords: 18,
    quietStart: "22:00",
    quietEnd: "08:00",
    reflectionLimit: 2,
    eventLimit: 6,
    topicCooldownMinutes: 30,
    dirty: false,
  })
  let profileSyncTimer: ReturnType<typeof setTimeout> | undefined
  let profileFingerprint = ""

  const [runtime, { refetch }] = createResource(
    () => serverSDK(),
    async (sdk) => {
      const [status, goals, inbox, memories] = await Promise.all([
        sdk.client.v2.jarvis.status(),
        sdk.client.v2.jarvis.goals(),
        sdk.client.v2.jarvis.inbox(),
        sdk.client.v2.jarvis.searchMemory({ jarvisMemorySearch: { query: "", limit: 50 } }),
      ])
      return {
        status: status.data,
        goals: goals.data ?? [],
        inbox: inbox.data ?? [],
        memories: memories.data ?? [],
      }
    },
  )

  const snapshots = () =>
    settings.personalization.presets().map((preset) => ({
      id: preset.id,
      revision: preset.updatedAt,
      name: preset.assistantName.trim() || preset.name,
      userName: preset.userName.trim() || undefined,
      addressAs: preset.addressAs.trim() || undefined,
      language: preset.language,
      archetype: preset.archetype,
      tone: preset.tone,
      detail: preset.detail,
      humor: preset.humor,
      proactivity: preset.proactivity,
      instructions: preset.customInstructions.slice(0, 4_000),
      catchphrases: agentCatchphrases(preset.catchphrases),
      primary: preset.id === runtime()?.status?.config.primaryProfileID,
      updatedAt: preset.updatedAt,
    }))

  const syncProfiles = async (primaryProfileID = runtime()?.status?.config.primaryProfileID) => {
    const profiles = snapshots().map((profile) => ({ ...profile, primary: profile.id === primaryProfileID }))
    await serverSDK().client.v2.jarvis.syncProfiles({
      jarvisProfileSync: { profiles, primaryProfileID },
    })
    await Promise.resolve(refetch())
  }

  createEffect(() => {
    const presetRevision = settings.personalization.presets().map((preset) => `${preset.id}:${preset.updatedAt}`).join("|")
    const primaryProfileID = runtime()?.status?.config.primaryProfileID
    if (!runtime()?.status) return
    const nextFingerprint = `${primaryProfileID ?? ""}|${presetRevision}`
    if (nextFingerprint === profileFingerprint) return
    profileFingerprint = nextFingerprint
    if (profileSyncTimer) clearTimeout(profileSyncTimer)
    profileSyncTimer = setTimeout(
      () => void syncProfiles(primaryProfileID).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error))),
      500,
    )
  })

  createEffect(() => {
    const config = runtime()?.status?.config
    if (!config || advanced.dirty) return
    setAdvanced({
      plannerTimeoutMs: config.plannerTimeoutMs,
      plannerIdleUnloadMs: config.plannerIdleUnloadMs,
      plannerEscalationMinWords: config.plannerEscalationMinWords,
      quietStart: config.initiative.quietStart,
      quietEnd: config.initiative.quietEnd,
      reflectionLimit: config.initiative.reflectionLimit,
      eventLimit: config.initiative.eventLimit,
      topicCooldownMinutes: config.initiative.topicCooldownMinutes,
      dirty: false,
    })
  })

  onMount(() => {
    const timer = setInterval(() => void refetch(), 5_000)
    onCleanup(() => {
      clearInterval(timer)
      if (profileSyncTimer) clearTimeout(profileSyncTimer)
    })
  })

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setMessage("")
    await action()
      .then(() => refetch())
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }

  const updateConfig = (patch: Partial<JarvisConfig>) => {
    const config = runtime()?.status?.config
    if (!config) return
    void run(async () => {
      await serverSDK().client.v2.jarvis.updateConfig({
        jarvisConfig: { ...config, ...patch, updatedAt: Date.now() },
      })
    })
  }

  const setModel = (role: "dialogue" | "planner" | "embedding", value?: { providerID: string; modelID: string }) => {
    const config = runtime()?.status?.config
    if (!config) return
    updateConfig({ models: { ...config.models, [role]: value } })
  }

  const configureManualModel = (role: "dialogue" | "planner" | "embedding") =>
    dialog.show(() => (
      <ManualModelDialog
        role={language.t(`settings.jarvis.models.${role}`)}
        value={runtime()?.status?.config.models[role]}
        save={(value) => setModel(role, value)}
      />
    ))

  const verifyModel = (role: "dialogue" | "planner" | "embedding") => run(async () => {
    const model = runtime()?.status?.config.models[role]
    if (!model) throw new Error(language.t("settings.jarvis.models.verify.unconfigured"))
    const probe =
      model.providerID === "lmstudio"
        ? await serverSDK().client.provider.lmstudio.probe()
        : model.providerID === "llama-server"
          ? await serverSDK().client.provider.llamaServer.probe()
          : undefined
    if (!probe) throw new Error(language.t("settings.jarvis.models.verify.unsupported"))
    if (!probe.data || !["ready", "degraded"].includes(probe.data.status))
      throw new Error(language.t("settings.jarvis.models.verify.failed", { status: probe.data?.status ?? "offline" }))
    if (!probe.data.models.some((candidate) => candidate.id === model.modelID))
      throw new Error(language.t("settings.jarvis.models.verify.missing"))
    setMessage(language.t("settings.jarvis.models.verify.ready"))
  })

  const filteredGoals = createMemo(() =>
    (runtime()?.goals ?? []).filter((goal) =>
      goalFilter() === "active"
        ? ["pending", "planning", "active"].includes(goal.status)
        : goalFilter() === "suspended"
          ? goal.status === "suspended"
          : ["completed", "failed", "cancelled"].includes(goal.status),
    ),
  )
  const filteredMemories = createMemo(() => {
    const query = memorySearch().trim().toLocaleLowerCase()
    if (!query) return runtime()?.memories ?? []
    return (runtime()?.memories ?? []).filter((memory) => memory.text.toLocaleLowerCase().includes(query))
  })

  const runtimeState = () => {
    if (runtime.loading) return "loading"
    if (runtime.error) return "error"
    return runtime()?.status?.state ?? "unavailable"
  }

  const runtimeDescription = () => {
    if (runtime.loading) return language.t("settings.jarvis.runtime.loading.description")
    if (runtime.error) return language.t("settings.jarvis.runtime.error.description")
    const status = runtime()?.status
    if (!status) return language.t("settings.jarvis.runtime.unavailable.description")
    if (status.state === "ready") return language.t("settings.jarvis.runtime.ready.description")
    if (status.state === "suspended") return language.t("settings.jarvis.runtime.suspended.description")
    return language.t("settings.jarvis.runtime.degraded.description")
  }

  const runtimeProblems = () => {
    const status = runtime()?.status
    if (!status) return []
    return [
      !status.primaryProfile ? language.t("settings.jarvis.runtime.reason.profile") : undefined,
      !status.config.models.dialogue ? language.t("settings.jarvis.runtime.reason.dialogue") : undefined,
      !status.config.models.planner ? language.t("settings.jarvis.runtime.reason.planner") : undefined,
    ].filter((reason): reason is string => !!reason)
  }

  const refresh = async () => {
    if (refreshing()) return
    setRefreshing(true)
    setMessage("")
    await Promise.resolve(refetch())
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setRefreshing(false))
  }

  const goalReason = (reason?: string) => {
    if (!reason) return
    if (reason.startsWith("Planner model is not configured"))
      return language.t("settings.jarvis.goals.reason.plannerMissing")
    if (reason.startsWith("Planner model is offline")) return language.t("settings.jarvis.goals.reason.plannerOffline")
    if (reason.startsWith("Planner failed")) return language.t("settings.jarvis.goals.reason.plannerFailed")
    if (reason.startsWith("Planner output did not pass")) return language.t("settings.jarvis.goals.reason.invalidPlan")
    if (reason.startsWith("Runtime restarted")) return language.t("settings.jarvis.goals.reason.restart")
    if (reason.startsWith("Repeated action failed")) return language.t("settings.jarvis.goals.reason.repeatedFailure")
    if (reason.startsWith("Autonomy cycle budget")) return language.t("settings.jarvis.goals.reason.budget")
    return reason
  }

  return (
    <>
      <div class="settings-v2-tab-header" data-component="settings-jarvis-v2">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.jarvis")}</h2>
        <p class="settings-v2-tab-description">{language.t("settings.jarvis.description")}</p>
      </div>

      <div class="settings-v2-tab-body settings-v2-jarvis">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.jarvis.runtime.title")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t(`settings.jarvis.runtime.${runtimeState()}`)}
              description={runtimeDescription()}
            >
              <ButtonV2 size="normal" variant={refreshing() ? "loading" : "neutral"} disabled={busy() || refreshing()} onClick={() => void refresh()}>
                {refreshing() ? language.t("common.loading") : language.t("common.refresh")}
              </ButtonV2>
            </SettingsRowV2>
            <For each={runtimeProblems()}>
              {(problem) => (
                <SettingsRowV2 title={problem} description="">
                  <span class="text-12-regular text-v2-text-text-warning">!</span>
                </SettingsRowV2>
              )}
            </For>
            <Show when={runtime()?.status}>
              {(status) => (
                <SettingsRowV2
                  title={language.t("settings.jarvis.runtime.counts")}
                  description={language.t("settings.jarvis.runtime.counts.description", {
                    goals: status().activeGoals,
                    suspended: status().suspendedGoals,
                    memory: status().memoryRecords,
                    inbox: status().pendingInbox,
                  })}
                >
                  <span />
                </SettingsRowV2>
              )}
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.jarvis.primary.title")}</h3>
          <SettingsListV2>
            <Show when={settings.personalization.presets().length === 0}>
              <SettingsRowV2 title={language.t("settings.jarvis.primary.empty")} description={language.t("settings.jarvis.primary.empty.description")}>
                <span />
              </SettingsRowV2>
            </Show>
            <For each={settings.personalization.presets()}>
              {(preset) => (
                <SettingsRowV2
                  title={preset.assistantName || preset.name}
                  description={`${language.t(`personalization.archetype.${preset.archetype}`)} · ${language.t(`settings.general.voice.fish.language.${preset.language}`)} · ${preset.voice ? language.t("personalization.chat.voice") : language.t("personalization.chat.silent")}`}
                >
                  <ButtonV2
                    size="normal"
                    variant={runtime()?.status?.config.primaryProfileID === preset.id ? "contrast" : "neutral"}
                    disabled={busy()}
                    onClick={() => void run(() => syncProfiles(preset.id))}
                  >
                    {runtime()?.status?.config.primaryProfileID === preset.id
                      ? language.t("settings.jarvis.primary.active")
                      : language.t("settings.jarvis.primary.select")}
                  </ButtonV2>
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.jarvis.models.title")}</h3>
          <SettingsListV2>
            <For each={["dialogue", "planner", "embedding"] as const}>
              {(role) => (
                <SettingsRowV2
                  title={language.t(`settings.jarvis.models.${role}`)}
                  description={
                    runtime()?.status?.config.models[role]
                      ? `${runtime()?.status?.config.models[role]?.providerID}/${runtime()?.status?.config.models[role]?.modelID}`
                      : language.t("settings.jarvis.models.unconfigured")
                  }
                >
                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <Show when={runtime()?.status?.config.models[role]}>
                      <ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => setModel(role)}>
                        {language.t("common.clear")}
                      </ButtonV2>
                    </Show>
                    <ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => void verifyModel(role)}>
                      {language.t("settings.jarvis.models.verify")}
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => configureManualModel(role)}>
                      {language.t("settings.jarvis.models.manual")}
                    </ButtonV2>
                    <ModelSelectorPopoverV2
                      catalog={models}
                      value={() => runtime()?.status?.config.models[role]}
                      onSelect={(model) => setModel(role, model)}
                      onManage={() => props.onNavigate?.("models")}
                      trigger={(triggerProps) => (
                        <ButtonV2
                          {...triggerProps}
                          data-action={`settings-jarvis-model-${role}`}
                          size="normal"
                          variant="neutral"
                          disabled={busy()}
                        >
                          {language.t("settings.jarvis.models.configure")}
                        </ButtonV2>
                      )}
                    />
                  </div>
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.jarvis.initiative.title")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.jarvis.initiative.enabled")}
              description={language.t("settings.jarvis.initiative.description")}
            >
              <Switch
                checked={runtime()?.status?.config.initiative.enabled ?? false}
                disabled={busy() || !runtime()?.status}
                onChange={(enabled) => {
                  const config = runtime()?.status?.config
                  if (config) updateConfig({ initiative: { ...config.initiative, enabled } })
                }}
              />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.jarvis.initiative.limits")}
              description={language.t("settings.jarvis.initiative.limits.description", {
                quiet: `${runtime()?.status?.config.initiative.quietStart ?? "22:00"}–${runtime()?.status?.config.initiative.quietEnd ?? "08:00"}`,
                reflections: runtime()?.status?.config.initiative.reflectionLimit ?? 2,
                events: runtime()?.status?.config.initiative.eventLimit ?? 6,
              })}
            >
              <span />
            </SettingsRowV2>
            <div class="grid gap-3 p-4 md:grid-cols-2">
              <NumberField label={language.t("settings.jarvis.advanced.timeout")} value={advanced.plannerTimeoutMs / 1_000} min={2} max={60} update={(value) => setAdvanced({ plannerTimeoutMs: value * 1_000, dirty: true })} />
              <NumberField label={language.t("settings.jarvis.advanced.unload")} value={advanced.plannerIdleUnloadMs / 1_000} min={0} max={3_600} update={(value) => setAdvanced({ plannerIdleUnloadMs: value * 1_000, dirty: true })} />
              <NumberField label={language.t("settings.jarvis.advanced.escalation")} value={advanced.plannerEscalationMinWords} min={4} max={100} update={(value) => setAdvanced({ plannerEscalationMinWords: value, dirty: true })} />
              <NumberField label={language.t("settings.jarvis.advanced.reflections")} value={advanced.reflectionLimit} min={0} max={2} update={(value) => setAdvanced({ reflectionLimit: value, dirty: true })} />
              <NumberField label={language.t("settings.jarvis.advanced.events")} value={advanced.eventLimit} min={0} max={20} update={(value) => setAdvanced({ eventLimit: value, dirty: true })} />
              <NumberField label={language.t("settings.jarvis.advanced.cooldown")} value={advanced.topicCooldownMinutes} min={5} max={240} update={(value) => setAdvanced({ topicCooldownMinutes: value, dirty: true })} />
              <label class="grid gap-1 text-12-medium text-v2-text-text-muted">{language.t("settings.jarvis.advanced.quietStart")}<TextInputV2 type="time" value={advanced.quietStart} onInput={(event) => setAdvanced({ quietStart: event.currentTarget.value, dirty: true })} /></label>
              <label class="grid gap-1 text-12-medium text-v2-text-text-muted">{language.t("settings.jarvis.advanced.quietEnd")}<TextInputV2 type="time" value={advanced.quietEnd} onInput={(event) => setAdvanced({ quietEnd: event.currentTarget.value, dirty: true })} /></label>
              <div class="flex items-center gap-2 md:col-span-2">
                <ButtonV2 variant="contrast" disabled={!advanced.dirty || busy()} onClick={() => {
                  const config = runtime()?.status?.config
                  if (!config) return
                  updateConfig({
                    plannerTimeoutMs: advanced.plannerTimeoutMs,
                    plannerIdleUnloadMs: advanced.plannerIdleUnloadMs,
                    plannerEscalationMinWords: advanced.plannerEscalationMinWords,
                    initiative: { ...config.initiative, quietStart: advanced.quietStart, quietEnd: advanced.quietEnd, reflectionLimit: advanced.reflectionLimit, eventLimit: advanced.eventLimit, topicCooldownMinutes: advanced.topicCooldownMinutes },
                  })
                  setAdvanced("dirty", false)
                }}>{language.t("common.save")}</ButtonV2>
                <ButtonV2 variant="ghost" disabled={!advanced.dirty || busy()} onClick={() => {
                  const config = runtime()?.status?.config
                  if (!config) return
                  setAdvanced({ plannerTimeoutMs: config.plannerTimeoutMs, plannerIdleUnloadMs: config.plannerIdleUnloadMs, plannerEscalationMinWords: config.plannerEscalationMinWords, quietStart: config.initiative.quietStart, quietEnd: config.initiative.quietEnd, reflectionLimit: config.initiative.reflectionLimit, eventLimit: config.initiative.eventLimit, topicCooldownMinutes: config.initiative.topicCooldownMinutes, dirty: false })
                }}>{language.t("common.cancel")}</ButtonV2>
                <span class="text-12-regular text-v2-text-text-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
              </div>
            </div>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="settings-v2-section-title">{language.t("settings.jarvis.goals.title")}</h3>
            <div class="flex flex-wrap gap-2">
              <For each={["active", "suspended", "history"] as const}>{(filter) => <ButtonV2 size="normal" variant={goalFilter() === filter ? "contrast" : "ghost"} onClick={() => setGoalFilter(filter)}>{language.t(`settings.jarvis.goals.filter.${filter}`)}</ButtonV2>}</For>
            </div>
          </div>
          <SettingsListV2>
            <Show
              when={filteredGoals().length}
              fallback={
                <SettingsRowV2 title={language.t("settings.jarvis.goals.empty")} description="">
                  <span />
                </SettingsRowV2>
              }
            >
              <For each={filteredGoals()}>
                {(goal) => (
                  <SettingsRowV2
                    title={goal.objective}
                    description={`${language.t(`settings.jarvis.goals.status.${goal.status}`)}${goalReason(goal.suspensionReason) ? ` · ${goalReason(goal.suspensionReason)}` : ""}`}
                  >
                    <div class="flex flex-wrap gap-2">
                      <Show when={goal.status === "suspended" && goal.mode === "chat"}>
                        <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => void run(async () => { await serverSDK().client.v2.jarvis.resumeGoal({ goalID: goal.id, jarvisGoalResume: { worldRevision: 0, capabilityRevision: "chat" } }) })}>{language.t("settings.jarvis.goals.resume")}</ButtonV2>
                      </Show>
                      <Show when={!(["completed", "failed", "cancelled"] as string[]).includes(goal.status)}>
                        <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => void run(async () => { await serverSDK().client.v2.jarvis.replanGoal({ goalID: goal.id, jarvisGoalReplan: { reason: "Requested from Settings." } }) })}>{language.t("settings.jarvis.goals.replan")}</ButtonV2>
                        <ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => dialog.show(() => <ConfirmDialog title={language.t("settings.jarvis.goals.cancel")} description={goal.objective} confirm={language.t("settings.jarvis.goals.cancel")} run={() => run(async () => { await serverSDK().client.v2.jarvis.cancelGoal({ goalID: goal.id, jarvisGoalCancel: { summary: "Cancelled from Settings." } }) })} />)}>{language.t("settings.jarvis.goals.cancel")}</ButtonV2>
                      </Show>
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="settings-v2-section-title">{language.t("settings.jarvis.memory.title")}</h3>
            <div class="flex flex-wrap gap-2">
              <TextInputV2 value={memorySearch()} placeholder={language.t("settings.jarvis.memory.search")} onInput={(event) => setMemorySearch(event.currentTarget.value)} />
              <ButtonV2 size="normal" variant="neutral" onClick={() => dialog.show(() => <MemoryDialog save={(memory) => run(async () => { await serverSDK().client.v2.jarvis.remember({ jarvisMemoryRecord: memory }) })} />)}>{language.t("settings.jarvis.memory.create")}</ButtonV2>
              <ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => void run(async () => { await serverSDK().client.v2.jarvis.reindexMemory() })}>{language.t("settings.jarvis.memory.backfill")}</ButtonV2>
            </div>
          </div>
          <Show when={runtime()?.status?.embeddings}>
            {(embedding) => <p class="text-12-regular text-v2-text-text-muted">{language.t(`settings.jarvis.memory.embedding.${embedding().state}`)} · {embedding().remaining}</p>}
          </Show>
          <SettingsListV2>
            <Show
              when={runtime()?.memories.length}
              fallback={
                <SettingsRowV2 title={language.t("settings.jarvis.memory.empty")} description="">
                  <span />
                </SettingsRowV2>
              }
            >
              <For each={filteredMemories()}>
                {(memory) => (
                  <SettingsRowV2
                    title={memory.text}
                    description={`${language.t(`settings.jarvis.memory.scope.${memory.scope}`)} · ${language.t(`settings.jarvis.memory.lifecycle.${memory.lifecycle}`)} · ${Math.round(Number(memory.confidence) * 100)}%${memory.conflictsWith.length ? ` · ${language.t("settings.jarvis.memory.conflict")}` : ""}`}
                  >
                    <div class="flex flex-wrap gap-2">
                      <ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => void run(async () => { await serverSDK().client.v2.jarvis.patchMemory({ memoryID: memory.id, jarvisMemoryPatch: { pinned: !memory.pinned } }) })}>{memory.pinned ? language.t("settings.avatarBridge.memory.unpin") : language.t("settings.avatarBridge.memory.pin")}</ButtonV2>
                      <ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => void run(async () => { await serverSDK().client.v2.jarvis.patchMemory({ memoryID: memory.id, jarvisMemoryPatch: { lifecycle: memory.lifecycle === "verified" ? "candidate" : "verified" } }) })}>{language.t("settings.jarvis.memory.verify")}</ButtonV2>
                      <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => dialog.show(() => <MemoryDialog memory={memory} save={(value) => run(async () => { await serverSDK().client.v2.jarvis.patchMemory({ memoryID: memory.id, jarvisMemoryPatch: { text: value.text, lifecycle: value.lifecycle, pinned: value.pinned, confidence: value.confidence, importance: value.importance } }) })} />)}>{language.t("settings.jarvis.memory.edit")}</ButtonV2>
                      <Show when={memory.conflictsWith[0]}>{(otherMemoryID) => <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => dialog.show(() => <ConflictDialog resolve={(action) => run(async () => { await serverSDK().client.v2.jarvis.resolveMemoryConflict({ memoryID: memory.id, jarvisMemoryConflictResolution: { action, otherMemoryID: otherMemoryID() } }) })} />)}>{language.t("settings.jarvis.memory.resolve")}</ButtonV2>}</Show>
                      <ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => dialog.show(() => <ConfirmDialog title={language.t("settings.jarvis.memory.delete")} description={memory.text} confirm={language.t("settings.jarvis.memory.delete")} run={() => run(async () => { await serverSDK().client.v2.jarvis.removeMemory({ memoryID: memory.id }) })} />)}>{language.t("settings.jarvis.memory.delete")}</ButtonV2>
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <div class="flex items-center justify-between gap-2">
            <h3 class="settings-v2-section-title">{language.t("settings.jarvis.inbox.title")}</h3>
            <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => void run(async () => { await serverSDK().client.v2.jarvis.wake({ jarvisWakeCreate: { kind: "manual", topic: `manual-${Date.now()}`, text: language.t("settings.jarvis.inbox.manual.text"), priority: 50 } }) })}>{language.t("settings.jarvis.inbox.manual")}</ButtonV2>
          </div>
          <SettingsListV2>
            <Show
              when={runtime()?.inbox.length}
              fallback={
                <SettingsRowV2 title={language.t("settings.jarvis.inbox.empty")} description="">
                  <span />
                </SettingsRowV2>
              }
            >
              <For each={runtime()?.inbox}>
                {(wake) => (
                  <SettingsRowV2
                    title={wake.text}
                    description={`${language.t(`settings.jarvis.inbox.kind.${wake.kind}`)} · ${language.t(`settings.jarvis.inbox.status.${wake.status}`)} · ${wake.topic}`}
                  >
                    <div class="flex gap-2">
                      <Show when={wake.status === "blocked"}><ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => void run(async () => { await serverSDK().client.v2.jarvis.retryInbox({ wakeID: wake.id }) })}>{language.t("settings.jarvis.inbox.retry")}</ButtonV2></Show>
                      <Show when={wake.status !== "dismissed"}><ButtonV2 size="normal" variant="ghost" disabled={busy()} onClick={() => void run(async () => { await serverSDK().client.v2.jarvis.dismissInbox({ wakeID: wake.id }) })}>{language.t("settings.jarvis.inbox.dismiss")}</ButtonV2></Show>
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <Show when={message()}>{(value) => <p class="text-12-regular text-v2-text-text-danger">{value()}</p>}</Show>
      </div>
    </>
  )
}

function NumberField(props: { label: string; value: number; min: number; max: number; update: (value: number) => void }) {
  return (
    <label class="grid gap-1 text-12-medium text-v2-text-text-muted">
      {props.label}
      <TextInputV2
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onInput={(event) => props.update(Math.min(props.max, Math.max(props.min, Number(event.currentTarget.value) || props.min)))}
      />
    </label>
  )
}

function ManualModelDialog(props: {
  role: string
  value?: { providerID: string; modelID: string }
  save: (value?: { providerID: string; modelID: string }) => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [form, setForm] = createStore({ providerID: props.value?.providerID ?? "lmstudio", modelID: props.value?.modelID ?? "", error: "" })
  const save = () => {
    if (!form.providerID.trim() || !form.modelID.trim()) {
      setForm("error", language.t("settings.jarvis.models.invalid"))
      return
    }
    props.save({ providerID: form.providerID.trim(), modelID: form.modelID.trim() })
    dialog.close()
  }
  return (
    <DialogV2>
      <DialogHeader><DialogTitle>{props.role}</DialogTitle></DialogHeader>
      <DialogBody class="grid gap-3">
        <label class="grid gap-1 text-12-medium text-v2-text-text-muted">Provider ID<TextInputV2 autofocus value={form.providerID} onInput={(event) => setForm("providerID", event.currentTarget.value)} /></label>
        <label class="grid gap-1 text-12-medium text-v2-text-text-muted">Model ID<TextInputV2 value={form.modelID} onInput={(event) => setForm("modelID", event.currentTarget.value)} /></label>
        <Show when={form.error}><p class="text-12-regular text-v2-text-text-danger">{form.error}</p></Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>{language.t("common.cancel")}</ButtonV2>
        <ButtonV2 variant="contrast" onClick={save}>{language.t("common.save")}</ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function MemoryDialog(props: { memory?: JarvisMemoryRecord; save: (memory: JarvisMemoryRecord) => Promise<unknown> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [form, setForm] = createStore({
    text: props.memory?.text ?? "",
    confidence: Number(props.memory?.confidence ?? 1),
    importance: Number(props.memory?.importance ?? 0.5),
    lifecycle: props.memory?.lifecycle ?? ("candidate" as const),
    pinned: props.memory?.pinned ?? false,
    busy: false,
    error: "",
  })
  const save = async () => {
    if (!form.text.trim()) {
      setForm("error", language.t("settings.jarvis.memory.emptyText"))
      return
    }
    setForm({ busy: true, error: "" })
    const now = Date.now()
    await props
      .save({
        id: props.memory?.id ?? crypto.randomUUID(),
        profileID: props.memory?.profileID,
        scope: props.memory?.scope ?? "user",
        gameID: props.memory?.gameID,
        saveSlotID: props.memory?.saveSlotID,
        characterID: props.memory?.characterID,
        kind: props.memory?.kind ?? "preference",
        text: form.text.trim(),
        sourceID: props.memory?.sourceID ?? `settings:${crypto.randomUUID()}`,
        confidence: form.confidence,
        importance: form.importance,
        lifecycle: form.lifecycle,
        pinned: form.pinned,
        conflictsWith: props.memory?.conflictsWith ?? [],
        embedding: props.memory?.embedding,
        embeddingModel: props.memory?.embeddingModel,
        createdAt: props.memory?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: props.memory?.lastUsedAt,
      })
      .then(() => dialog.close())
      .catch((error: unknown) => setForm({ busy: false, error: error instanceof Error ? error.message : String(error) }))
  }
  return (
    <DialogV2>
      <DialogHeader><DialogTitle>{props.memory ? language.t("settings.jarvis.memory.edit") : language.t("settings.jarvis.memory.create")}</DialogTitle></DialogHeader>
      <DialogBody class="grid gap-3">
        <TextareaV2 autofocus rows={6} value={form.text} onInput={(event) => setForm("text", event.currentTarget.value)} />
        <div class="grid grid-cols-2 gap-3">
          <NumberField label={language.t("settings.jarvis.memory.confidence")} value={form.confidence * 100} min={0} max={100} update={(value) => setForm("confidence", value / 100)} />
          <NumberField label={language.t("settings.jarvis.memory.importance")} value={form.importance * 100} min={0} max={100} update={(value) => setForm("importance", value / 100)} />
        </div>
        <Show when={form.error}><p class="text-12-regular text-v2-text-text-danger">{form.error}</p></Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="ghost" disabled={form.busy} onClick={() => dialog.close()}>{language.t("common.cancel")}</ButtonV2>
        <ButtonV2 variant={form.busy ? "loading" : "contrast"} disabled={form.busy || !form.text.trim()} onClick={() => void save()}>{language.t("common.save")}</ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function ConfirmDialog(props: { title: string; description: string; confirm: string; run: () => Promise<unknown> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)
  const confirm = async () => {
    setBusy(true)
    await props.run().then(() => dialog.close()).finally(() => setBusy(false))
  }
  return (
    <DialogV2 fit>
      <DialogHeader><DialogTitle>{props.title}</DialogTitle></DialogHeader>
      <DialogBody><p class="text-13-regular text-v2-text-text-muted">{props.description}</p></DialogBody>
      <DialogFooter>
        <ButtonV2 variant="ghost" disabled={busy()} onClick={() => dialog.close()}>{language.t("common.cancel")}</ButtonV2>
        <ButtonV2 variant={busy() ? "loading" : "contrast"} disabled={busy()} onClick={() => void confirm()}>{props.confirm}</ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function ConflictDialog(props: { resolve: (action: "keep_both" | "choose_current" | "choose_other") => Promise<unknown> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)
  const resolve = async (action: "keep_both" | "choose_current" | "choose_other") => {
    setBusy(true)
    await props.resolve(action).then(() => dialog.close()).finally(() => setBusy(false))
  }
  return <DialogV2 fit><DialogHeader><DialogTitle>{language.t("settings.jarvis.memory.resolve")}</DialogTitle></DialogHeader><DialogBody><p class="text-13-regular text-v2-text-text-muted">{language.t("settings.jarvis.memory.resolve.description")}</p></DialogBody><DialogFooter><ButtonV2 variant="ghost" disabled={busy()} onClick={() => void resolve("keep_both")}>{language.t("settings.jarvis.memory.resolve.both")}</ButtonV2><ButtonV2 variant="neutral" disabled={busy()} onClick={() => void resolve("choose_other")}>{language.t("settings.jarvis.memory.resolve.other")}</ButtonV2><ButtonV2 variant={busy() ? "loading" : "contrast"} disabled={busy()} onClick={() => void resolve("choose_current")}>{language.t("settings.jarvis.memory.resolve.current")}</ButtonV2></DialogFooter></DialogV2>
}
