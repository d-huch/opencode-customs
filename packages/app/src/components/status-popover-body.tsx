import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { showToast } from "@/utils/toast"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, createResource, For, Index, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { type ServerHealth } from "@/utils/server-health"
import { useGlobal } from "@/context/global"
import { useSettings } from "@/context/settings"
import { useMcpToggle } from "@/context/mcp"
import { useSDK } from "@/context/sdk"
import { useRepositoryDiagnostics } from "@/context/repository-diagnostics"
import { useServerSync } from "@/context/server-sync"
import { SettingsModelContextLimit } from "./settings-model-context-limit"

const listServersByHealth = (
  list: ServerConnection.Any[],
  active: ServerConnection.Key | undefined,
  status: Record<ServerConnection.Key, ServerHealth | undefined>,
) => {
  if (!list.length) return list
  const order = new Map(list.map((url, index) => [url, index] as const))
  const rank = (value?: ServerHealth) => {
    if (value?.healthy === true) return 0
    if (value?.healthy === false) return 2
    return 1
  }

  return list.slice().sort((a, b) => {
    if (ServerConnection.key(a) === active) return -1
    if (ServerConnection.key(b) === active) return 1
    const diff = rank(status[ServerConnection.key(a)]) - rank(status[ServerConnection.key(b)])
    if (diff !== 0) return diff
    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

const useDefaultServerKey = (
  get: (() => string | Promise<string | null | undefined> | null | undefined) | undefined,
) => {
  const [state, setState] = createStore({
    key: undefined as ServerConnection.Key | undefined,
    tick: 0,
  })

  createEffect(() => {
    state.tick
    let dead = false
    const result = get?.()
    if (!result) {
      setState("key", undefined)
      onCleanup(() => {
        dead = true
      })
      return
    }

    if (result instanceof Promise) {
      void result.then((next) => {
        if (dead) return
        setState("key", next ?? undefined)
      })
      onCleanup(() => {
        dead = true
      })
      return
    }

    setState("key", ServerConnection.Key.make(result))
    onCleanup(() => {
      dead = true
    })
  })

  return {
    key: () => {
      return state.key
    },
    refresh: () => setState("tick", (value) => value + 1),
  }
}

type ServerStatusState = {
  servers: () => ServerStatusItem[]
  defaultKey: () => ServerConnection.Key | undefined
  ariaLabel: string
  serversLabel: string
  defaultLabel: string
  manageLabel: string
  onManage: () => void
}

type ServerStatusItem = {
  key: ServerConnection.Key
  conn: ServerConnection.Any
  health?: ServerHealth
  blocked: boolean
  active: boolean
  onSelect: () => void
}

export function StatusPopoverServerBody() {
  const global = useGlobal()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  let dialogRun = 0
  let dialogDead = false
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
  })

  const sortedServers = createMemo(() => listServersByHealth(global.servers.list(), server.key, global.servers.health))
  const defaultServer = useDefaultServerKey(platform.getDefaultServer ? () => platform.getDefaultServer?.() : undefined)
  const serverItems = createMemo(() =>
    sortedServers().map((conn) => {
      const key = ServerConnection.key(conn)
      return {
        key,
        conn,
        health: global.servers.health[key],
        blocked: global.servers.health[key]?.healthy === false,
        active: !!server.current && key === ServerConnection.key(server.current),
        onSelect: () => {
          navigate("/")
          queueMicrotask(() => server.setActive(key))
        },
      }
    }),
  )

  return (
    <ServerStatusPopoverView
      state={{
        servers: serverItems,
        defaultKey: defaultServer.key,
        ariaLabel: language.t("status.popover.ariaLabel"),
        serversLabel: language.t("status.popover.tab.servers"),
        defaultLabel: language.t("common.default"),
        manageLabel: language.t("status.popover.action.manageServers"),
        onManage: () => {
          const run = ++dialogRun
          void import("./dialog-select-server").then((x) => {
            if (dialogDead || dialogRun !== run) return
            void dialog.show(() => <x.DialogSelectServer />, defaultServer.refresh)
          })
        },
      }}
    />
  )
}

function ServerStatusPopoverView(props: { state: ServerStatusState }) {
  return (
    <div class="status-popover-layout flex items-stretch gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
      <Tabs
        aria-label={props.state.ariaLabel}
        class="tabs bg-background-strong rounded-xl overflow-hidden"
        data-component="tabs"
        data-active="servers"
        defaultValue="servers"
        variant="alt"
      >
        <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-4 h-10">
          <Tabs.Trigger value="servers" data-slot="tab" class="text-12-regular">
            {props.state.servers().length > 0 ? `${props.state.servers().length} ` : ""}
            {props.state.serversLabel}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="servers">
          <ServerStatusList state={props.state} />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

function ServerStatusList(props: { state: ServerStatusState }) {
  return (
    <div class="flex flex-col px-2 pb-2">
      <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
        <For each={props.state.servers()}>
          {(item) => {
            return (
              <button
                type="button"
                class="flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                classList={{
                  "hover:bg-surface-raised-base-hover": !item.blocked,
                  "cursor-not-allowed": item.blocked,
                }}
                aria-disabled={item.blocked}
                onClick={() => {
                  if (item.blocked) return
                  item.onSelect()
                }}
              >
                <ServerHealthIndicator health={item.health} />
                <ServerRow
                  conn={item.conn}
                  dimmed={item.blocked}
                  status={item.health}
                  class="flex items-center gap-2 w-full min-w-0"
                  nameClass="text-14-regular text-text-base truncate"
                  versionClass="text-12-regular text-text-weak truncate"
                  badge={
                    <Show when={item.key === props.state.defaultKey()}>
                      <span class="text-11-regular text-text-base bg-surface-base px-1.5 py-0.5 rounded-md">
                        {props.state.defaultLabel}
                      </span>
                    </Show>
                  }
                >
                  <div class="flex-1" />
                  <Show when={item.active}>
                    <Icon name="check" size="small" class="text-icon-weak shrink-0" />
                  </Show>
                </ServerRow>
              </button>
            )
          }}
        </For>

        <Button variant="secondary" class="mt-3 self-start h-8 px-3 py-1.5" onClick={props.state.onManage}>
          {props.state.manageLabel}
        </Button>
      </div>
    </div>
  )
}

export function StatusPopoverBody(props: { shown: Accessor<boolean> }) {
  const sync = useSync()
  const serverSync = useServerSync()
  const global = useGlobal()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  const settings = useSettings()
  const sdk = useSDK()
  const desktop = createMemo(() => platform.platform === "desktop")
  const [repositoryMap, { mutate: setRepositoryMap, refetch: refetchRepositoryMap }] = createResource(
    () => (props.shown() && desktop() ? sdk() : undefined),
    (context) => context.client.v2.repositoryMap.get().then((result) => result.data?.data),
  )
  const repositoryDiagnostics = useRepositoryDiagnostics()
  const [lmStudio, { refetch: refetchLmStudio }] = createResource(
    () => (props.shown() && desktop() ? sdk() : undefined),
    (context) => context.client.provider.lmstudio.probe().then((result) => result.data),
  )
  const [governor, { mutate: setGovernor, refetch: refetchGovernor }] = createResource(
    () => (props.shown() && desktop() ? sdk() : undefined),
    (context) => context.client.provider.runtime.resources().then((result) => result.data),
  )
  const [capabilityRouter, { mutate: setCapabilityRouter, refetch: refetchCapabilityRouter }] = createResource(
    () => (props.shown() && desktop() ? sdk() : undefined),
    (context) => context.client.provider.runtime.router().then((result) => result.data),
  )
  const [agentTurn, { mutate: setAgentTurn, refetch: refetchAgentTurn }] = createResource(
    () => (props.shown() && desktop() ? sdk() : undefined),
    (context) => context.client.provider.runtime.turn().then((result) => result.data),
  )
  const [repositoryMapState, setRepositoryMapState] = createStore({ refreshing: false })
  const [runtimeState, setRuntimeState] = createStore({
    activeTab: settings.general.newLayoutDesigns() ? "mcp" : "servers",
    refreshing: false,
    clearingLogs: false,
    contextLocking: undefined as string | undefined,
    routingGlobal: false,
    routingModel: undefined as string | undefined,
  })
  const runtimeLoading = createMemo(
    () =>
      runtimeState.refreshing ||
      (!lmStudio() && lmStudio.loading) ||
      (!governor() && governor.loading) ||
      (!capabilityRouter() && capabilityRouter.loading) ||
      (!agentTurn() && agentTurn.loading),
  )
  const repositoryMapStatus = createMemo(() => {
    if (repositoryMap()?.status === "complete") return language.t("status.popover.repositoryMap.status.complete")
    if (repositoryMap()?.status === "truncated") return language.t("status.popover.repositoryMap.status.truncated")
    return language.t("status.popover.repositoryMap.status.unavailable")
  })
  const repositorySemanticStatus = createMemo(() => {
    if (repositoryMap()?.semantic.status === "indexing") return language.t("common.loading")
    if (repositoryMap()?.semantic.status === "ready") return language.t("status.popover.repositoryMap.status.complete")
    return language.t("status.popover.repositoryMap.status.unavailable")
  })
  const lmStudioStatus = createMemo(() => {
    if (lmStudio()?.status === "ready") return language.t("status.popover.runtime.status.ready")
    if (lmStudio()?.status === "degraded") return language.t("status.popover.runtime.status.degraded")
    if (lmStudio()?.status === "unauthorized") return language.t("status.popover.runtime.status.unauthorized")
    if (lmStudio()?.status === "offline") return language.t("status.popover.runtime.status.offline")
    return language.t("status.popover.runtime.status.unconfigured")
  })
  const lmStudioModels = createMemo(() => lmStudio()?.models ?? [])
  const lmStudioModel = (modelID: string) =>
    Object.values(serverSync().data.provider.all.get("lmstudio")?.models ?? {}).find(
      (model) => model.id === modelID || model.api.id === modelID,
    )
  const lmStudioModelConfig = (modelID: string) =>
    Object.entries(serverSync().data.config.provider?.lmstudio?.models ?? {}).find(
      ([id, model]) => id === modelID || model.id === modelID,
    )
  const governorStatus = createMemo(() => {
    if (governor()?.status === "healthy") return language.t("status.popover.runtime.governor.status.healthy")
    if (governor()?.status === "pressured") return language.t("status.popover.runtime.governor.status.pressured")
    return language.t("status.popover.runtime.governor.status.critical")
  })
  const capabilityRouterStatus = createMemo(() => {
    if (capabilityRouter()?.status === "ready") return language.t("status.popover.runtime.router.status.ready")
    if (capabilityRouter()?.status === "degraded") return language.t("status.popover.runtime.router.status.degraded")
    return language.t("status.popover.runtime.router.status.unavailable")
  })
  const capabilityRole = (role: "embedding" | "utility" | "coding" | "vision" | "fallback") => {
    if (role === "embedding") return language.t("status.popover.runtime.router.role.embedding")
    if (role === "utility") return language.t("status.popover.runtime.router.role.utility")
    if (role === "coding") return language.t("status.popover.runtime.router.role.coding")
    if (role === "vision") return language.t("status.popover.runtime.router.role.vision")
    return language.t("status.popover.runtime.router.role.fallback")
  }
  const capabilityReason = (reason: string) => {
    if (reason === "role.embedding") return language.t("status.popover.runtime.router.reason.embedding")
    if (reason === "role.utility") return language.t("status.popover.runtime.router.reason.utility")
    if (reason === "role.coding") return language.t("status.popover.runtime.router.reason.coding")
    if (reason === "role.vision") return language.t("status.popover.runtime.router.reason.vision")
    if (reason === "role.fallback") return language.t("status.popover.runtime.router.reason.fallback")
    if (reason === "preference.explicit") return language.t("status.popover.runtime.router.reason.preference")
    if (reason === "candidate.unloaded") return language.t("status.popover.runtime.router.reason.candidateUnloaded")
    if (reason === "switch.ready") return language.t("status.popover.runtime.router.reason.switchReady")
    if (reason === "switch.failover.ready")
      return language.t("status.popover.runtime.router.reason.switchFailoverReady")
    if (reason === "switch.previous.busy") return language.t("status.popover.runtime.router.reason.switchPreviousBusy")
    if (reason === "switch.previous.external")
      return language.t("status.popover.runtime.router.reason.switchPreviousExternal")
    if (reason === "switch.previous.unloaded")
      return language.t("status.popover.runtime.router.reason.switchPreviousUnloaded")
    if (reason === "switch.previous.cleanup_failed")
      return language.t("status.popover.runtime.router.reason.switchCleanupFailed")
    if (reason === "switch.context.preserved")
      return language.t("status.popover.runtime.router.reason.switchContextPreserved")
    if (reason === "switch.no_candidate") return language.t("status.popover.runtime.router.reason.switchNoCandidate")
    if (reason === "switch.unconfigured") return language.t("status.popover.runtime.router.reason.switchUnconfigured")
    if (reason === "switch.primary.memory" || reason === "switch.fallback.memory")
      return language.t("status.popover.runtime.router.reason.switchMemory")
    if (reason === "switch.primary.failed" || reason === "switch.fallback.failed")
      return language.t("status.popover.runtime.router.reason.switchFailed")
    if (reason === "vision.file_reference") return language.t("status.popover.runtime.vision.reason.fileReference")
    if (reason === "vision.within_limits") return language.t("status.popover.runtime.vision.reason.withinLimits")
    if (reason === "vision.compressed") return language.t("status.popover.runtime.vision.reason.compressed")
    if (reason === "vision.resources.pressured")
      return language.t("status.popover.runtime.vision.reason.resourcesPressured")
    if (reason === "vision.resources.critical")
      return language.t("status.popover.runtime.vision.reason.resourcesCritical")
    if (reason === "vision.model.selected") return language.t("status.popover.runtime.vision.reason.modelSelected")
    if (reason === "vision.model.unavailable")
      return language.t("status.popover.runtime.vision.reason.modelUnavailable")
    if (reason === "vision.fallback") return language.t("status.popover.runtime.vision.reason.fallback")
    if (reason === "vision.rollback") return language.t("status.popover.runtime.vision.reason.rollback")
    if (reason === "vision.completed") return language.t("status.popover.runtime.vision.reason.completed")
    if (reason === "vision.failed") return language.t("status.popover.runtime.vision.reason.failed")
    return reason
  }
  const activationStatus = (status: "ready" | "switched" | "failed" | "rolled_back" | "degraded") => {
    if (status === "ready") return language.t("status.popover.runtime.router.activation.ready")
    if (status === "switched") return language.t("status.popover.runtime.router.activation.switched")
    if (status === "rolled_back") return language.t("status.popover.runtime.router.activation.rolledBack")
    if (status === "degraded") return language.t("status.popover.runtime.router.activation.degraded")
    return language.t("status.popover.runtime.router.activation.failed")
  }
  const visionStatus = (status: "prepared" | "completed" | "failed") => {
    if (status === "prepared") return language.t("status.popover.runtime.vision.status.prepared")
    if (status === "completed") return language.t("status.popover.runtime.vision.status.completed")
    return language.t("status.popover.runtime.vision.status.failed")
  }
  const agentTurnPhase = (phase: "classify" | "recall" | "execute" | "verify" | "critic" | "complete" | "failed") => {
    if (phase === "classify") return language.t("status.popover.runtime.turn.phase.classify")
    if (phase === "recall") return language.t("status.popover.runtime.turn.phase.recall")
    if (phase === "execute") return language.t("status.popover.runtime.turn.phase.execute")
    if (phase === "verify") return language.t("status.popover.runtime.turn.phase.verify")
    if (phase === "critic") return language.t("status.popover.runtime.turn.phase.critic")
    if (phase === "complete") return language.t("status.popover.runtime.turn.phase.complete")
    return language.t("status.popover.runtime.turn.phase.failed")
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  createEffect(() => {
    if (!props.shown() || repositoryMap.error || repositoryMap()?.semantic.status !== "indexing") return
    const timer = window.setTimeout(() => void refetchRepositoryMap(), 1_500)
    onCleanup(() => window.clearTimeout(timer))
  })

  createEffect(() => {
    if (!props.shown() || !desktop() || runtimeState.activeTab !== "runtime") return
    const context = sdk()
    const polling = { stopped: false, timer: undefined as number | undefined }
    const refresh = async () => {
      if (!runtimeState.refreshing) {
        await Promise.all([
          context.client.provider.runtime
            .resources()
            .then((result) => {
              if (polling.stopped || !result.data) return
              setGovernor(result.data)
            })
            .catch(() => undefined),
          context.client.provider.runtime
            .router()
            .then((result) => {
              if (polling.stopped || !result.data) return
              setCapabilityRouter(result.data)
            })
            .catch(() => undefined),
          context.client.provider.runtime
            .turn()
            .then((result) => {
              if (polling.stopped || !result.data) return
              setAgentTurn(result.data)
            })
            .catch(() => undefined),
        ])
      }
      if (polling.stopped) return
      polling.timer = window.setTimeout(() => void refresh(), 3_000)
    }
    polling.timer = window.setTimeout(() => void refresh(), 3_000)
    onCleanup(() => {
      polling.stopped = true
      if (polling.timer !== undefined) window.clearTimeout(polling.timer)
    })
  })

  let dialogRun = 0
  let dialogDead = false
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
  })
  const sortedServers = createMemo(() => listServersByHealth(global.servers.list(), server.key, global.servers.health))
  const toggleMcp = useMcpToggle()
  const defaultServer = useDefaultServerKey(platform.getDefaultServer ? () => platform.getDefaultServer?.() : undefined)
  const mcpNames = createMemo(() => Object.keys(sync().data.mcp ?? {}).sort((a, b) => a.localeCompare(b)))
  const mcpStatus = (name: string) => sync().data.mcp?.[name]?.status
  const mcpConnected = createMemo(() => mcpNames().filter((name) => mcpStatus(name) === "connected").length)
  const lspItems = createMemo(() => sync().data.lsp ?? [])
  const lspCount = createMemo(() => lspItems().length)
  const lspNameCounts = createMemo(() =>
    lspItems().reduce((result, item) => {
      const name = item.name || item.id
      result.set(name, (result.get(name) ?? 0) + 1)
      return result
    }, new Map<string, number>()),
  )
  const refreshRepositoryMap = async () => {
    if (repositoryMapState.refreshing) return
    setRepositoryMapState("refreshing", true)
    await sdk()
      .client.v2.repositoryMap.refresh()
      .then((result) => setRepositoryMap(result.data?.data))
      .catch(fail)
      .finally(() => setRepositoryMapState("refreshing", false))
  }
  const configureRepositoryDiagnostics = async (enabled: boolean, clear = false) => {
    if (repositoryDiagnostics.updating()) return
    await repositoryDiagnostics.configure(enabled, clear).catch(fail)
  }
  const refreshRuntime = async () => {
    if (runtimeState.refreshing) return
    setRuntimeState("refreshing", true)
    await Promise.all([refetchLmStudio(), refetchGovernor(), refetchCapabilityRouter(), refetchAgentTurn()])
      .catch(fail)
      .finally(() => setRuntimeState("refreshing", false))
  }
  const clearRuntimeLogs = async () => {
    if (!platform.clearDebugLogs || runtimeState.clearingLogs) return
    if (!window.confirm(language.t("status.popover.runtime.logs.clearConfirm"))) return
    setRuntimeState("clearingLogs", true)
    await platform
      .clearDebugLogs()
      .then((result) =>
        showToast({
          variant: "success",
          title: language.t("status.popover.runtime.logs.cleared"),
          description: language.t("status.popover.runtime.logs.clearedDescription", {
            files: result.files.toLocaleString(language.intl()),
          }),
        }),
      )
      .catch(fail)
      .finally(() => setRuntimeState("clearingLogs", false))
  }
  const modelContextLocked = (modelID: string) => lmStudioModelConfig(modelID)?.[1].preserve_context === true
  const modelChatContext = (modelID: string, maximum: number) =>
    Math.min(maximum, lmStudioModelConfig(modelID)?.[1].chat_context ?? 32_768)
  const automaticModelRouting = createMemo(() => serverSync().data.config.provider?.lmstudio?.auto_route !== false)
  const modelAutomaticRouting = (modelID: string) => lmStudioModelConfig(modelID)?.[1].auto_route !== false
  const setModelContextLocked = async (modelID: string, checked: boolean) => {
    if (runtimeState.contextLocking) return
    setRuntimeState("contextLocking", modelID)
    await serverSync()
      .updateConfig({
        provider: {
          lmstudio: {
            models: {
              [modelID]: { preserve_context: checked },
            },
          },
        },
      })
      .catch(fail)
      .finally(() => setRuntimeState("contextLocking", undefined))
  }
  const setModelAutomaticRouting = async (modelID: string, checked: boolean) => {
    if (runtimeState.routingModel) return
    setRuntimeState("routingModel", modelID)
    await serverSync()
      .updateConfig({
        provider: {
          lmstudio: {
            models: {
              [modelID]: { auto_route: checked },
            },
          },
        },
      })
      .then(() => refetchCapabilityRouter())
      .catch(fail)
      .finally(() => setRuntimeState("routingModel", undefined))
  }
  const setAutomaticModelRouting = async (checked: boolean) => {
    if (runtimeState.routingGlobal) return
    setRuntimeState("routingGlobal", true)
    await serverSync()
      .updateConfig({
        provider: {
          lmstudio: {
            auto_route: checked,
          },
        },
      })
      .then(() => refetchCapabilityRouter())
      .catch(fail)
      .finally(() => setRuntimeState("routingGlobal", false))
  }

  return (
    <div class="status-popover-layout flex items-stretch gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
      <Tabs
        aria-label={language.t("status.popover.ariaLabel")}
        class="tabs bg-background-strong rounded-xl overflow-hidden"
        data-component="tabs"
        data-active={runtimeState.activeTab}
        value={runtimeState.activeTab}
        onChange={(value) => setRuntimeState("activeTab", value)}
        variant="alt"
      >
        <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-4 h-10">
          {!settings.general.newLayoutDesigns() && (
            <Tabs.Trigger value="servers" data-slot="tab" class="text-12-regular">
              {global.servers.list().length > 0 ? `${global.servers.list().length} ` : ""}
              {language.t("status.popover.tab.servers")}
            </Tabs.Trigger>
          )}
          <Tabs.Trigger value="mcp" data-slot="tab" class="text-12-regular">
            {mcpConnected() > 0 ? `${mcpConnected()} ` : ""}
            {language.t("status.popover.tab.mcp")}
          </Tabs.Trigger>
          <Tabs.Trigger value="lsp" data-slot="tab" class="text-12-regular">
            {lspCount() > 0 ? `${lspCount()} ` : ""}
            {language.t("status.popover.tab.lsp")}
          </Tabs.Trigger>
          <Show when={desktop()}>
            <Tabs.Trigger value="runtime" data-slot="tab" class="text-12-regular">
              {language.t("status.popover.tab.runtime")}
            </Tabs.Trigger>
          </Show>
          <Show when={desktop()}>
            <Tabs.Trigger value="repository-map" data-slot="tab" class="text-12-regular">
              {language.t("status.popover.tab.repositoryMap")}
            </Tabs.Trigger>
          </Show>
        </Tabs.List>

        {!settings.general.newLayoutDesigns() && (
          <Tabs.Content value="servers">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <For each={sortedServers()}>
                  {(s) => {
                    const key = ServerConnection.key(s)
                    const blocked = () => global.servers.health[key]?.healthy === false
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                        classList={{
                          "hover:bg-surface-raised-base-hover": !blocked(),
                          "cursor-not-allowed": blocked(),
                        }}
                        aria-disabled={blocked()}
                        onClick={() => {
                          if (blocked()) return
                          navigate("/")
                          queueMicrotask(() => server.setActive(key))
                        }}
                      >
                        <ServerHealthIndicator health={global.servers.health[key]} />
                        <ServerRow
                          conn={s}
                          dimmed={blocked()}
                          status={global.servers.health[key]}
                          class="flex items-center gap-2 w-full min-w-0"
                          nameClass="text-14-regular text-text-base truncate"
                          versionClass="text-12-regular text-text-weak truncate"
                          badge={
                            <Show when={key === defaultServer.key()}>
                              <span class="text-11-regular text-text-base bg-surface-base px-1.5 py-0.5 rounded-md">
                                {language.t("common.default")}
                              </span>
                            </Show>
                          }
                        >
                          <div class="flex-1" />
                          <Show when={server.current && key === ServerConnection.key(server.current)}>
                            <Icon name="check" size="small" class="text-icon-weak shrink-0" />
                          </Show>
                        </ServerRow>
                      </button>
                    )
                  }}
                </For>

                <Button
                  variant="secondary"
                  class="mt-3 self-start h-8 px-3 py-1.5"
                  onClick={() => {
                    const run = ++dialogRun
                    void import("./dialog-select-server").then((x) => {
                      if (dialogDead || dialogRun !== run) return
                      void dialog.show(() => <x.DialogSelectServer />, defaultServer.refresh)
                    })
                  }}
                >
                  {language.t("status.popover.action.manageServers")}
                </Button>
              </div>
            </div>
          </Tabs.Content>
        )}

        <Tabs.Content value="mcp">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
              <Show
                when={mcpNames().length > 0}
                fallback={
                  <div class="text-14-regular text-text-base text-center my-auto">{language.t("dialog.mcp.empty")}</div>
                }
              >
                <For each={mcpNames()}>
                  {(name) => {
                    const status = () => mcpStatus(name)
                    const enabled = () => status() === "connected"
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full min-h-8 pl-3 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                        onClick={() => {
                          if (toggleMcp.isPending) return
                          toggleMcp.mutate(name)
                        }}
                        disabled={toggleMcp.isPending && toggleMcp.variables === name}
                      >
                        <div
                          classList={{
                            "size-1.5 rounded-full shrink-0": true,
                            "bg-icon-success-base": status() === "connected",
                            "bg-icon-critical-base": status() === "failed",
                            "bg-border-weak-base": status() === "disabled",
                            "bg-icon-warning-base":
                              status() === "needs_auth" || status() === "needs_client_registration",
                          }}
                        />
                        <span class="flex flex-col min-w-0 flex-1">
                          <span class="flex items-center gap-2 min-w-0">
                            <span class="text-14-regular text-text-base truncate">{name}</span>
                          </span>
                          <Show when={status() === "needs_auth"}>
                            <span class="text-11-regular text-text-weaker truncate">
                              {language.t("mcp.auth.clickToAuthenticate")}
                            </span>
                          </Show>
                        </span>
                        <div onClick={(event) => event.stopPropagation()}>
                          <Switch
                            checked={enabled()}
                            disabled={toggleMcp.isPending && toggleMcp.variables === name}
                            onChange={() => {
                              if (toggleMcp.isPending) return
                              toggleMcp.mutate(name)
                            }}
                          />
                        </div>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="lsp">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
              <Show
                when={lspItems().length > 0}
                fallback={
                  <div class="text-14-regular text-text-base text-center my-auto">{language.t("dialog.lsp.empty")}</div>
                }
              >
                <For each={lspItems()}>
                  {(item) => (
                    <div class="flex items-center gap-2 w-full px-2 py-1">
                      <div
                        classList={{
                          "size-1.5 rounded-full shrink-0": true,
                          "bg-icon-success-base": item.status === "connected",
                          "bg-icon-critical-base": item.status === "error",
                        }}
                      />
                      <span class="text-14-regular text-text-base truncate">
                        {item.name || item.id}
                        {(lspNameCounts().get(item.name || item.id) ?? 0) > 1 ? ` · ${item.root || "."}` : ""}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Show when={desktop()}>
          <Tabs.Content value="runtime">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex min-h-32 flex-col gap-3 rounded-sm bg-background-base p-3">
                <Show when={agentTurn()?.turn}>
                  {(turn) => (
                    <div class="flex flex-col gap-2 border-b border-border-weak-base pb-3">
                      <div class="flex items-center gap-2 px-1">
                        <div
                          classList={{
                            "size-1.5 shrink-0 rounded-full": true,
                            "bg-icon-success-base": turn().phase === "complete",
                            "bg-icon-warning-base": !["complete", "failed"].includes(turn().phase),
                            "bg-icon-critical-base": turn().phase === "failed",
                          }}
                        />
                        <span class="text-14-medium text-text-base">
                          {language.t("status.popover.runtime.turn.title")} · {agentTurnPhase(turn().phase)}
                        </span>
                        <span class="ml-auto text-10-regular tabular-nums text-text-weaker">
                          {language.t("status.popover.runtime.turn.step")} {turn().step}
                        </span>
                      </div>

                      <div class="flex flex-col gap-1 rounded-md bg-surface-raised-base px-2 py-1.5">
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="shrink-0 text-10-medium uppercase text-text-weaker">
                            {language.t("status.popover.runtime.turn.model")}
                          </span>
                          <span class="min-w-0 flex-1 truncate text-12-medium text-text-base">
                            {turn().selectedModelID
                              ? `${turn().selectedProviderID}/${turn().selectedModelID}`
                              : language.t("status.popover.runtime.turn.pending")}
                          </span>
                        </div>
                        <span class="truncate text-10-regular text-text-weaker">
                          {language.t("status.popover.runtime.turn.generation")} {turn().generation}
                          {Number(turn().recoveries) > 0
                            ? ` · ${language.t("status.popover.runtime.turn.recoveries")} ${turn().recoveries}`
                            : ""}
                        </span>
                      </div>

                      <div class="grid grid-cols-2 gap-1.5 text-10-regular text-text-weaker">
                        <span>
                          {language.t("status.popover.runtime.turn.classifier")}: {turn().counters.classifierTurns}/
                          {agentTurn()?.limits.classifierTurns}
                        </span>
                        <span>
                          RAG: {turn().counters.ragRetrievals}/{agentTurn()?.limits.ragRetrievals}
                        </span>
                        <span>
                          {language.t("status.popover.runtime.turn.memory")}: {turn().counters.memoryRetrievals}/
                          {agentTurn()?.limits.memoryRetrievals}
                        </span>
                        <span>
                          {language.t("status.popover.runtime.turn.verification")}: {turn().counters.verificationTurns}/
                          {agentTurn()?.limits.verificationTurns}
                        </span>
                        <span>
                          {language.t("status.popover.runtime.turn.critic")}: {turn().counters.criticTurns}/
                          {agentTurn()?.limits.criticTurns}
                        </span>
                        <span>
                          {language.t("status.popover.runtime.turn.provider")}: {turn().counters.providerTurns}/
                          {agentTurn()?.limits.providerTurns}
                        </span>
                        <span>
                          Tools: {turn().counters.toolCalls}/{agentTurn()?.limits.toolCalls}
                        </span>
                      </div>
                    </div>
                  )}
                </Show>

                <Show when={governor()}>
                  {(runtime) => (
                    <div class="flex flex-col gap-3 border-b border-border-weak-base pb-3">
                      <div class="flex items-center gap-2 px-1">
                        <div
                          classList={{
                            "size-1.5 shrink-0 rounded-full": true,
                            "bg-icon-success-base": runtime().status === "healthy",
                            "bg-icon-warning-base": runtime().status === "pressured",
                            "bg-icon-critical-base": runtime().status === "critical",
                          }}
                        />
                        <span class="text-14-medium text-text-base">
                          {language.t("status.popover.runtime.governor.title")} · {governorStatus()}
                        </span>
                      </div>

                      <div class="grid grid-cols-2 gap-2">
                        <RuntimeMetric
                          label={language.t("status.popover.runtime.governor.availableMemory")}
                          value={`${formatRuntimeBytes(runtime().memory.availableBytes)} · ${Number(runtime().memory.availablePercent).toLocaleString(language.intl())}%`}
                        />
                        <RuntimeMetric
                          label={language.t("status.popover.runtime.governor.processMemory")}
                          value={formatRuntimeBytes(runtime().memory.processRssBytes)}
                        />
                      </div>

                      <div class="flex items-center gap-2 px-1 text-11-regular text-text-weaker">
                        <span>{language.t("status.popover.runtime.governor.requests")}</span>
                        <span class="ml-auto tabular-nums text-text-base">
                          {runtime().activity.activeModelRequests} / {runtime().limits.modelConcurrency}
                          {Number(runtime().activity.waitingModelRequests) > 0
                            ? ` · +${runtime().activity.waitingModelRequests}`
                            : ""}
                        </span>
                      </div>

                      <Show
                        when={runtime().lastDecision}
                        fallback={
                          <span class="px-1 text-11-regular text-text-weaker">
                            {language.t("status.popover.runtime.governor.noDecision")}
                          </span>
                        }
                      >
                        {(decision) => (
                          <div class="flex flex-col gap-1 rounded-md bg-surface-raised-base px-2 py-1.5">
                            <div class="flex items-center gap-2">
                              <span class="text-11-regular text-text-weaker">
                                {language.t("status.popover.runtime.governor.safeContext")}
                              </span>
                              <span class="ml-auto text-12-medium tabular-nums text-text-base">
                                {Number(decision().safeInputTokens).toLocaleString(language.intl())}
                              </span>
                            </div>
                            <span class="truncate text-10-regular text-text-weaker">
                              {decision().modelID} ·{" "}
                              {Number(decision().requestedContext).toLocaleString(language.intl())}
                              {decision().runtimeContext
                                ? ` → ${Number(decision().runtimeContext).toLocaleString(language.intl())}`
                                : ""}
                            </span>
                          </div>
                        )}
                      </Show>

                      <Show when={runtime().providerContext}>
                        {(context) => (
                          <div class="flex flex-col gap-1 rounded-md bg-surface-raised-base px-2 py-1.5">
                            <div class="flex items-center gap-2">
                              <span class="text-11-regular text-text-weaker">
                                {language.t("status.popover.runtime.governor.providerChain")}
                              </span>
                              <span class="ml-auto text-12-medium tabular-nums text-text-base">
                                {(
                                  Number(context().providerTokens) + Number(context().currentTokens)
                                ).toLocaleString(language.intl())}
                                {" / "}
                                {Number(context().contextLimit).toLocaleString(language.intl())}
                              </span>
                            </div>
                            <span class="truncate text-10-regular text-text-weaker">
                              {Number(context().cachedTokens).toLocaleString(language.intl())}{" "}
                              {language.t("status.popover.runtime.governor.cachedTokens")} ·{" "}
                              {Number(context().remainingTokens).toLocaleString(language.intl())}{" "}
                              {language.t("status.popover.runtime.governor.remainingTokens")} · {context().reason}
                            </span>
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>

                <Show when={capabilityRouter()}>
                  {(route) => (
                    <div class="flex flex-col gap-3 border-b border-border-weak-base pb-3">
                      <div class="flex items-center gap-2 px-1">
                        <div
                          classList={{
                            "size-1.5 shrink-0 rounded-full": true,
                            "bg-icon-success-base": route().status === "ready",
                            "bg-icon-warning-base": route().status === "degraded",
                            "bg-icon-critical-base": route().status === "unavailable",
                          }}
                        />
                        <span class="text-14-medium text-text-base">
                          {language.t("status.popover.runtime.router.title")} · {capabilityRouterStatus()}
                        </span>
                        <span class="ml-auto text-10-regular tabular-nums text-text-weaker">
                          {route().candidateCount} {language.t("status.popover.runtime.router.candidates")}
                        </span>
                      </div>

                      <label class="flex items-start gap-2 rounded-md bg-surface-raised-base px-2 py-2 text-11-regular text-text-weaker">
                        <Switch
                          checked={automaticModelRouting()}
                          disabled={runtimeState.routingGlobal}
                          onChange={(checked) => void setAutomaticModelRouting(checked)}
                        />
                        <span class="flex flex-col gap-0.5">
                          <span class="text-12-medium text-text-base">
                            {language.t("status.popover.runtime.router.automatic")}
                          </span>
                          <span>{language.t("status.popover.runtime.router.automaticDescription")}</span>
                        </span>
                      </label>

                      <Show when={route().activation}>
                        {(activation) => (
                          <div class="flex flex-col gap-1 rounded-md border border-border-weak-base bg-surface-raised-base px-2 py-1.5">
                            <div class="flex min-w-0 items-center gap-2">
                              <div
                                classList={{
                                  "size-1.5 shrink-0 rounded-full": true,
                                  "bg-icon-success-base":
                                    activation().status === "ready" || activation().status === "switched",
                                  "bg-icon-warning-base": activation().status === "degraded",
                                  "bg-icon-critical-base":
                                    activation().status === "failed" || activation().status === "rolled_back",
                                }}
                              />
                              <span class="text-10-medium uppercase text-text-weaker">
                                {language.t("status.popover.runtime.router.activation.title")}
                              </span>
                              <span class="min-w-0 flex-1 truncate text-12-medium text-text-base">
                                {activation().activeModelID}
                              </span>
                              <span class="shrink-0 text-10-regular text-text-weaker">
                                {activationStatus(activation().status)}
                              </span>
                            </div>
                            <div class="flex items-center gap-2 text-10-regular text-text-weaker">
                              <span>
                                {activation().attempts}{" "}
                                {language.t("status.popover.runtime.router.activation.attempts")}
                              </span>
                              <Show when={activation().failover}>
                                <span>{language.t("status.popover.runtime.router.activation.failover")}</span>
                              </Show>
                              <Show when={activation().rollback}>
                                <span>{language.t("status.popover.runtime.router.activation.rollback")}</span>
                              </Show>
                            </div>
                            <span
                              class="truncate text-10-regular text-text-weaker"
                              title={activation().reason.map(capabilityReason).join(" · ")}
                            >
                              {capabilityReason(activation().reason[0] ?? "")}
                            </span>
                          </div>
                        )}
                      </Show>

                      <Show when={route().vision}>
                        {(vision) => (
                          <div class="flex flex-col gap-1 rounded-md border border-border-weak-base bg-surface-raised-base px-2 py-1.5">
                            <div class="flex min-w-0 items-center gap-2">
                              <div
                                classList={{
                                  "size-1.5 shrink-0 rounded-full": true,
                                  "bg-icon-success-base": vision().status === "completed",
                                  "bg-icon-warning-base": vision().status === "prepared",
                                  "bg-icon-critical-base": vision().status === "failed",
                                }}
                              />
                              <span class="text-10-medium uppercase text-text-weaker">
                                {language.t("status.popover.runtime.vision.title")}
                              </span>
                              <span class="min-w-0 flex-1 truncate text-12-medium text-text-base">
                                {vision().modelID ?? language.t("status.popover.runtime.vision.noModel")}
                              </span>
                              <span class="shrink-0 text-10-regular text-text-weaker">
                                {visionStatus(vision().status)}
                              </span>
                            </div>
                            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-10-regular tabular-nums text-text-weaker">
                              <span>
                                {vision().imageCount} {language.t("status.popover.runtime.vision.images")}
                              </span>
                              <span>{formatRuntimeBytes(vision().preparedBytes)}</span>
                              <span>
                                ≈ {Number(vision().estimatedTokens).toLocaleString(language.intl())}{" "}
                                {language.t("status.popover.runtime.router.tokens")}
                              </span>
                              <Show when={vision().requestTokens}>
                                {(tokens) => (
                                  <span>
                                    {language.t("status.popover.runtime.vision.requestTokens")}:{" "}
                                    {Number(tokens()).toLocaleString(language.intl())}
                                  </span>
                                )}
                              </Show>
                              <Show when={vision().failover}>
                                <span>{language.t("status.popover.runtime.router.activation.failover")}</span>
                              </Show>
                            </div>
                            <Show when={vision().artifacts[0]}>
                              {(artifact) => (
                                <span class="truncate text-10-regular tabular-nums text-text-weaker">
                                  {Number(artifact().originalWidth).toLocaleString(language.intl())}×
                                  {Number(artifact().originalHeight).toLocaleString(language.intl())}
                                  {artifact().compressed
                                    ? ` → ${Number(artifact().preparedWidth).toLocaleString(language.intl())}×${Number(
                                        artifact().preparedHeight,
                                      ).toLocaleString(language.intl())}`
                                    : ""}
                                  {` · ${formatRuntimeBytes(artifact().originalBytes)} → ${formatRuntimeBytes(
                                    artifact().preparedBytes,
                                  )}`}
                                </span>
                              )}
                            </Show>
                            <span
                              class="truncate text-10-regular text-text-weaker"
                              title={vision().reason.map(capabilityReason).join(" · ")}
                            >
                              {capabilityReason(vision().reason.at(-1) ?? "")}
                            </span>
                          </div>
                        )}
                      </Show>

                      <div class="flex flex-col gap-1">
                        <For each={route().selections.filter((selection) => selection.role !== "fallback")}>
                          {(selection) => (
                            <div class="flex flex-col gap-1 rounded-md bg-surface-raised-base px-2 py-1.5">
                              <div class="flex min-w-0 items-center gap-2">
                                <span class="shrink-0 text-10-medium uppercase text-text-weaker">
                                  {capabilityRole(selection.role)}
                                </span>
                                <span class="min-w-0 flex-1 truncate text-12-medium text-text-base">
                                  {selection.name}
                                </span>
                                <span class="shrink-0 text-10-regular tabular-nums text-text-weaker">
                                  {language.t("status.popover.runtime.router.score")} {selection.score}
                                </span>
                              </div>
                              <div class="flex items-center gap-2 text-10-regular tabular-nums text-text-weaker">
                                <Show when={selection.context}>
                                  {(context) => (
                                    <span>
                                      {Number(context()).toLocaleString(language.intl())}{" "}
                                      {language.t("status.popover.runtime.router.tokens")}
                                    </span>
                                  )}
                                </Show>
                                <Show when={selection.sizeBytes}>
                                  {(size) => <span>{formatRuntimeBytes(size())}</span>}
                                </Show>
                              </div>
                              <span
                                class="truncate text-10-regular text-text-weaker"
                                title={selection.reason.map(capabilityReason).join(" · ")}
                              >
                                {capabilityReason(selection.reason[0] ?? "")}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </Show>

                <Show
                  when={lmStudio() || !lmStudio.loading}
                  fallback={
                    <div class="my-auto text-center text-14-regular text-text-base">{language.t("common.loading")}</div>
                  }
                >
                  <div class="flex items-center gap-2 px-1">
                    <div
                      classList={{
                        "size-1.5 shrink-0 rounded-full": true,
                        "bg-icon-success-base": lmStudio()?.status === "ready",
                        "bg-icon-warning-base": lmStudio()?.status === "degraded",
                        "bg-icon-critical-base":
                          !lmStudio() || lmStudio()?.status === "offline" || lmStudio()?.status === "unauthorized",
                        "bg-border-weak-base": lmStudio()?.status === "unconfigured",
                      }}
                    />
                    <span class="text-14-medium text-text-base">LM Studio · {lmStudioStatus()}</span>
                    <Show when={typeof lmStudio()?.latencyMs === "number" && lmStudio()?.status !== "unconfigured"}>
                      <span class="ml-auto text-11-regular tabular-nums text-text-weaker">
                        {lmStudio()?.latencyMs} ms
                      </span>
                    </Show>
                  </div>

                  <Show when={lmStudio()?.baseURL}>
                    <span class="truncate px-1 font-mono text-11-regular text-text-weaker">{lmStudio()?.baseURL}</span>
                  </Show>

                  <Show when={lmStudio()?.status !== "unconfigured"}>
                    <div class="grid grid-cols-2 gap-2">
                      <RuntimeApiStatus label="Native API" enabled={lmStudio()?.api.native === true} />
                      <RuntimeApiStatus label="OpenAI API" enabled={lmStudio()?.api.openai === true} />
                      <RuntimeApiStatus label="Responses" enabled={lmStudio()?.api.responses === true} />
                      <RuntimeApiStatus label="Embeddings" enabled={lmStudio()?.api.embeddings === true} />
                    </div>

                    <div class="flex flex-col gap-1 border-t border-border-weak-base pt-3">
                      <span class="px-1 text-12-medium text-text-base">
                        {language.t("status.popover.runtime.models")}
                      </span>
                      <Show
                        when={lmStudioModels().length > 0}
                        fallback={
                          <span class="px-1 text-11-regular text-text-weaker">
                            {language.t("status.popover.runtime.noModels")}
                          </span>
                        }
                      >
                        <For each={lmStudioModels()}>
                          {(model) => {
                            const configured = () => lmStudioModel(model.id)
                            const configModelID = () =>
                              lmStudioModelConfig(model.id)?.[0] ?? configured()?.id ?? model.id
                            return (
                              <div class="flex flex-col gap-1 rounded-md bg-surface-raised-base px-2 py-1.5">
                                <div class="flex min-w-0 items-center gap-2">
                                  <div
                                    classList={{
                                      "size-1.5 shrink-0 rounded-full": true,
                                      "bg-icon-success-base": model.loaded,
                                      "bg-border-strong-base": !model.loaded,
                                    }}
                                  />
                                  <span class="min-w-0 flex-1 truncate text-12-regular text-text-base">
                                    {model.name}
                                  </span>
                                  <span class="shrink-0 text-10-regular text-text-weaker">
                                    {language.t(
                                      model.loaded
                                        ? "status.popover.runtime.model.loaded"
                                        : "status.popover.runtime.model.available",
                                    )}
                                  </span>
                                  <Show
                                    when={configured()}
                                    fallback={
                                      <Show when={model.context.active}>
                                        {(context) => (
                                          <span class="shrink-0 text-10-regular tabular-nums text-text-weaker">
                                            {Number(context()).toLocaleString(language.intl())}
                                          </span>
                                        )}
                                      </Show>
                                    }
                                  >
                                    {(info) => (
                                      <SettingsModelContextLimit
                                        providerID="lmstudio"
                                        modelID={info().id}
                                        context={info().limit.context}
                                        input={info().limit.input}
                                        output={info().limit.output}
                                        variant="runtime"
                                      />
                                    )}
                                  </Show>
                                </div>
                                <div class="flex flex-wrap gap-1">
                                  <RuntimeCapability label="Tools" enabled={model.capabilities.tools} />
                                  <RuntimeCapability label="Vision" enabled={model.capabilities.vision} />
                                  <RuntimeCapability
                                    label={language.t("model.tooltip.reasoning")}
                                    enabled={model.capabilities.reasoning}
                                  />
                                  <RuntimeCapability label="Embeddings" enabled={model.capabilities.embeddings} />
                                </div>
                                <Show when={configured()}>
                                  {(info) => (
                                    <div class="flex items-center justify-between gap-2 pt-1">
                                      <span class="text-11-regular text-text-weaker">
                                        {language.t("settings.models.chatContext.label")}
                                      </span>
                                      <SettingsModelContextLimit
                                        providerID="lmstudio"
                                        modelID={configModelID()}
                                        context={modelChatContext(configModelID(), info().limit.context)}
                                        output={info().limit.output}
                                        variant="runtime"
                                        scope="chat"
                                      />
                                    </div>
                                  )}
                                </Show>
                                <label class="flex items-center gap-2 pt-1 text-11-regular text-text-weaker">
                                  <Switch
                                    checked={modelAutomaticRouting(configModelID())}
                                    disabled={runtimeState.routingModel !== undefined}
                                    onChange={(checked) => void setModelAutomaticRouting(configModelID(), checked)}
                                  />
                                  <span>{language.t("status.popover.runtime.model.autoRoute")}</span>
                                </label>
                                <label class="flex items-center gap-2 pt-1 text-11-regular text-text-weaker">
                                  <Switch
                                    checked={modelContextLocked(configModelID())}
                                    disabled={runtimeState.contextLocking !== undefined}
                                    onChange={(checked) => void setModelContextLocked(configModelID(), checked)}
                                  />
                                  <span>{language.t("status.popover.runtime.model.preserveContext")}</span>
                                </label>
                              </div>
                            )
                          }}
                        </For>
                      </Show>
                    </div>
                  </Show>

                  <Show when={lmStudio()?.error}>
                    <span class="px-1 text-11-regular text-text-weaker">{lmStudio()?.error}</span>
                  </Show>
                </Show>

                <div class="flex flex-col gap-2 border-t border-border-weak-base pt-3">
                  <div class="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      class="h-8 px-3 py-1.5"
                      disabled={runtimeLoading()}
                      onClick={() => void refreshRuntime()}
                    >
                      {runtimeLoading() ? language.t("common.loading") : language.t("status.popover.runtime.probe")}
                    </Button>
                    <Show when={platform.exportDebugLogs}>
                      <Button
                        variant="secondary"
                        class="h-8 px-3 py-1.5"
                        onClick={() => void platform.exportDebugLogs?.().catch(fail)}
                      >
                        {language.t("status.popover.runtime.logs.export")}
                      </Button>
                    </Show>
                    <Show when={platform.clearDebugLogs}>
                      <Button
                        variant="secondary"
                        class="h-8 px-3 py-1.5"
                        disabled={runtimeState.clearingLogs}
                        onClick={() => void clearRuntimeLogs()}
                      >
                        {runtimeState.clearingLogs
                          ? language.t("common.loading")
                          : language.t("status.popover.runtime.logs.clear")}
                      </Button>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </Tabs.Content>
        </Show>

        <Show when={desktop()}>
          <Tabs.Content value="repository-map">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col gap-3 p-3 bg-background-base rounded-sm min-h-32">
                <Show
                  when={repositoryMap() || !repositoryMap.loading}
                  fallback={
                    <div class="text-14-regular text-text-base text-center my-auto">{language.t("common.loading")}</div>
                  }
                >
                  <div class="flex items-center gap-2 px-1">
                    <div
                      classList={{
                        "size-1.5 rounded-full shrink-0": true,
                        "bg-icon-success-base": repositoryMap()?.status === "complete",
                        "bg-icon-warning-base": repositoryMap()?.status === "truncated",
                        "bg-icon-critical-base":
                          !repositoryMap() || repositoryMap()?.status === "unavailable" || !!repositoryMap.error,
                      }}
                    />
                    <span class="text-14-medium text-text-base">{repositoryMapStatus()}</span>
                  </div>

                  <Show when={repositoryMap()}>
                    {(map) => (
                      <>
                        <div class="flex items-center gap-2 px-1 min-w-0">
                          <span class="text-12-regular text-text-weaker shrink-0">
                            {language.t("status.popover.tab.lsp")}: {repositorySemanticStatus()}
                          </span>
                          <Show when={map().semantic.servers.length > 0}>
                            <span class="text-12-regular text-text-base truncate">
                              {map().semantic.servers.join(", ")}
                            </span>
                          </Show>
                          <span class="ml-auto text-11-regular text-text-weaker shrink-0">
                            {map().semantic.files} {language.t("status.popover.repositoryMap.files")}
                          </span>
                        </div>

                        <div class="grid grid-cols-4 gap-2">
                          <RepositoryMapMetric
                            label={language.t("status.popover.repositoryMap.files")}
                            value={map().files}
                          />
                          <RepositoryMapMetric
                            label={language.t("status.popover.repositoryMap.areas")}
                            value={map().modules.length}
                          />
                          <RepositoryMapMetric
                            label={language.t("status.popover.repositoryMap.symbols")}
                            value={map().symbols.length}
                          />
                          <RepositoryMapMetric
                            label={language.t("status.popover.repositoryMap.links")}
                            value={map().edges.length}
                          />
                        </div>

                        <Index each={map().modules.slice(0, 4)}>
                          {(module) => (
                            <div class="flex items-center gap-2 px-1 min-w-0">
                              <span class="text-12-regular text-text-base truncate">
                                {module().name ?? module().path}
                              </span>
                              <span class="flex-1 border-t border-border-weak-base" />
                              <span class="text-11-regular text-text-weaker shrink-0">{module().files}</span>
                            </div>
                          )}
                        </Index>
                      </>
                    )}
                  </Show>

                  <div class="flex flex-col gap-2 pt-3 border-t border-border-weak-base">
                    <div class="flex items-center gap-3 px-1">
                      <span class="flex flex-col min-w-0 flex-1">
                        <span class="text-12-medium text-text-base">
                          {language.t("status.popover.repositoryMap.diagnostics")}
                        </span>
                        <span class="text-11-regular text-text-weaker">
                          {language.t("status.popover.repositoryMap.diagnosticsDescription")}
                        </span>
                      </span>
                      <Switch
                        checked={repositoryDiagnostics.data()?.enabled === true}
                        disabled={repositoryDiagnostics.updating()}
                        onChange={(enabled) => void configureRepositoryDiagnostics(enabled, enabled)}
                      />
                    </div>

                    <Show when={repositoryDiagnostics.data()?.enabled}>
                      <div class="flex h-52 flex-col gap-1 overflow-y-auto rounded-md bg-surface-raised-base p-2 font-mono">
                        <Show
                          when={(repositoryDiagnostics.data()?.entries.length ?? 0) > 0}
                          fallback={
                            <span class="text-11-regular text-text-weaker py-2 text-center">
                              {language.t("status.popover.repositoryMap.diagnosticsEmpty")}
                            </span>
                          }
                        >
                          <Index each={repositoryDiagnostics.data()?.entries.slice().reverse() ?? []}>
                            {(entry) => (
                              <div class="flex gap-2 py-1 border-b border-border-weak-base last:border-b-0">
                                <div
                                  classList={{
                                    "mt-1 size-1.5 rounded-full shrink-0": true,
                                    "bg-icon-success-base": entry().level === "info",
                                    "bg-icon-warning-base": entry().level === "warning",
                                    "bg-icon-critical-base": entry().level === "error",
                                  }}
                                />
                                <span class="flex flex-col gap-0.5 min-w-0">
                                  <span class="flex items-center gap-2 text-10-regular text-text-weaker">
                                    <span>{diagnosticTime(entry().time)}</span>
                                    <span class="uppercase text-text-base">{entry().stage}</span>
                                  </span>
                                  <span class="text-11-regular text-text-base break-words">{entry().message}</span>
                                </span>
                              </div>
                            )}
                          </Index>
                        </Show>
                      </div>
                      <Button
                        variant="secondary"
                        class="self-start h-7 px-2.5 py-1"
                        disabled={repositoryDiagnostics.updating()}
                        onClick={() => void configureRepositoryDiagnostics(true, true)}
                      >
                        {language.t("common.clear")}
                      </Button>
                    </Show>
                  </div>
                </Show>

                <div class="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    class="h-8 px-3 py-1.5"
                    onClick={() => {
                      const run = ++dialogRun
                      void import("./dialog-rag-memory-viewer").then((viewer) => {
                        if (dialogDead || dialogRun !== run) return
                        void dialog.show(() => <viewer.DialogRagMemoryViewer />)
                      })
                    }}
                  >
                    {language.t("status.popover.repositoryMap.knowledge")}
                  </Button>
                  <Button
                    variant="secondary"
                    class="h-8 px-3 py-1.5"
                    disabled={repositoryMapState.refreshing}
                    onClick={() => void refreshRepositoryMap()}
                  >
                    {repositoryMapState.refreshing
                      ? language.t("common.loading")
                      : language.t("status.popover.repositoryMap.reindex")}
                  </Button>
                </div>
              </div>
            </div>
          </Tabs.Content>
        </Show>
      </Tabs>
    </div>
  )
}

function RepositoryMapMetric(props: { label: string; value: number }) {
  return (
    <div class="flex flex-col gap-0.5 p-2 rounded-md bg-surface-raised-base">
      <span class="text-16-medium text-text-base tabular-nums">{props.value}</span>
      <span class="text-11-regular text-text-weaker truncate">{props.label}</span>
    </div>
  )
}

function RuntimeApiStatus(props: { label: string; enabled: boolean }) {
  return (
    <div class="flex items-center gap-2 rounded-md bg-surface-raised-base px-2 py-1.5">
      <span
        classList={{
          "size-1.5 shrink-0 rounded-full": true,
          "bg-icon-success-base": props.enabled,
          "bg-border-weak-base": !props.enabled,
        }}
      />
      <span class="truncate text-11-regular text-text-base">{props.label}</span>
    </div>
  )
}

function RuntimeCapability(props: { label: string; enabled: boolean }) {
  return (
    <Show when={props.enabled}>
      <span class="rounded bg-surface-base px-1.5 py-0.5 text-10-regular text-text-weaker">{props.label}</span>
    </Show>
  )
}

function RuntimeMetric(props: { label: string; value: string }) {
  return (
    <div class="flex flex-col gap-0.5 rounded-md bg-surface-raised-base px-2 py-1.5">
      <span class="truncate text-12-medium tabular-nums text-text-base">{props.value}</span>
      <span class="truncate text-10-regular text-text-weaker">{props.label}</span>
    </div>
  )
}

function formatRuntimeBytes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

function diagnosticTime(value: number) {
  const date = new Date(value)
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`
}
