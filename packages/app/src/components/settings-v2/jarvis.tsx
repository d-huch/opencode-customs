import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import type { JarvisConfig } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { agentCatchphrases } from "@/utils/agent-personalization"
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export const SettingsJarvisV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal("")
  let profileSyncTimer: ReturnType<typeof setTimeout> | undefined

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
    await refetch()
  }

  createEffect(() => {
    JSON.stringify(settings.personalization.presets())
    const primaryProfileID = runtime()?.status?.config.primaryProfileID
    if (!runtime()?.status) return
    if (profileSyncTimer) clearTimeout(profileSyncTimer)
    profileSyncTimer = setTimeout(() => void syncProfiles(primaryProfileID).catch(() => undefined), 500)
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

  const configureModel = (role: "dialogue" | "planner" | "embedding") => {
    const config = runtime()?.status?.config
    if (!config) return
    const current = config.models[role]
    const value = window.prompt(
      language.t(`settings.jarvis.models.${role}.prompt`),
      current ? `${current.providerID}/${current.modelID}` : "lmstudio/",
    )
    if (value === null) return
    if (!value.trim()) {
      updateConfig({ models: { ...config.models, [role]: undefined } })
      return
    }
    const separator = value.indexOf("/")
    if (separator <= 0 || separator === value.length - 1) {
      setMessage(language.t("settings.jarvis.models.invalid"))
      return
    }
    updateConfig({
      models: {
        ...config.models,
        [role]: { providerID: value.slice(0, separator).trim(), modelID: value.slice(separator + 1).trim() },
      },
    })
  }

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
    const reasons = [
      !status.primaryProfile ? language.t("settings.jarvis.runtime.reason.profile") : undefined,
      !status.config.models.dialogue ? language.t("settings.jarvis.runtime.reason.dialogue") : undefined,
      !status.config.models.planner ? language.t("settings.jarvis.runtime.reason.planner") : undefined,
    ].filter((reason): reason is string => !!reason)
    return reasons.join(" · ") || language.t("settings.jarvis.runtime.degraded.description")
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
              <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => void refetch()}>
                {language.t("common.refresh")}
              </ButtonV2>
            </SettingsRowV2>
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
                  <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => configureModel(role)}>
                    {language.t("settings.jarvis.models.configure")}
                  </ButtonV2>
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
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.jarvis.goals.title")}</h3>
          <SettingsListV2>
            <Show
              when={runtime()?.goals.length}
              fallback={
                <SettingsRowV2 title={language.t("settings.jarvis.goals.empty")} description="">
                  <span />
                </SettingsRowV2>
              }
            >
              <For each={runtime()?.goals}>
                {(goal) => (
                  <SettingsRowV2
                    title={goal.objective}
                    description={`${language.t(`settings.jarvis.goals.status.${goal.status}`)}${goalReason(goal.suspensionReason) ? ` · ${goalReason(goal.suspensionReason)}` : ""}`}
                  >
                    <Show when={goal.status === "suspended" && goal.mode === "chat"} fallback={<span />}>
                      <ButtonV2
                        size="normal"
                        variant="neutral"
                        disabled={busy()}
                        onClick={() =>
                          void run(async () => {
                            await serverSDK().client.v2.jarvis.resumeGoal({
                              goalID: goal.id,
                              jarvisGoalResume: { worldRevision: 0, capabilityRevision: "chat" },
                            })
                          })
                        }
                      >
                        {language.t("settings.jarvis.goals.resume")}
                      </ButtonV2>
                    </Show>
                  </SettingsRowV2>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.jarvis.memory.title")}</h3>
          <SettingsListV2>
            <Show
              when={runtime()?.memories.length}
              fallback={
                <SettingsRowV2 title={language.t("settings.jarvis.memory.empty")} description="">
                  <span />
                </SettingsRowV2>
              }
            >
              <For each={runtime()?.memories}>
                {(memory) => (
                  <SettingsRowV2
                    title={memory.text}
                    description={`${language.t(`settings.jarvis.memory.scope.${memory.scope}`)} · ${language.t(`settings.jarvis.memory.lifecycle.${memory.lifecycle}`)} · ${Math.round(Number(memory.confidence) * 100)}%${memory.conflictsWith.length ? ` · ${language.t("settings.jarvis.memory.conflict")}` : ""}`}
                  >
                    <ButtonV2
                      size="normal"
                      variant="neutral"
                      disabled={busy()}
                      onClick={() =>
                        void run(async () => serverSDK().client.v2.jarvis.removeMemory({ memoryID: memory.id }))
                      }
                    >
                      {language.t("settings.jarvis.memory.delete")}
                    </ButtonV2>
                  </SettingsRowV2>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.jarvis.inbox.title")}</h3>
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
                    <span />
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
