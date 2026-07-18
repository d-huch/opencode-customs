import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { showToast } from "@/utils/toast"
import { useNavigate } from "@solidjs/router"
import {
  type Accessor,
  createEffect,
  createMemo,
  createResource,
  For,
  type JSXElement,
  onCleanup,
  Show,
} from "solid-js"
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

const pluginEmptyMessage = (value: string, file: string): JSXElement => {
  const parts = value.split(file)
  if (parts.length === 1) return value
  return (
    <>
      {parts[0]}
      <code class="bg-surface-raised-base px-1.5 py-0.5 rounded-sm text-text-base">{file}</code>
      {parts.slice(1).join(file)}
    </>
  )
}

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
    <div class="flex items-center gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
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
  const [repositoryMapState, setRepositoryMapState] = createStore({ refreshing: false })
  const repositoryMapStatus = createMemo(() => {
    if (repositoryMap()?.status === "complete") return language.t("status.popover.repositoryMap.status.complete")
    if (repositoryMap()?.status === "truncated") return language.t("status.popover.repositoryMap.status.truncated")
    return language.t("status.popover.repositoryMap.status.unavailable")
  })
  const repositorySemanticStatus = createMemo(() => {
    if (repositoryMap()?.semantic.status === "indexing") return language.t("common.loading")
    if (repositoryMap()?.semantic.status === "ready")
      return language.t("status.popover.repositoryMap.status.complete")
    return language.t("status.popover.repositoryMap.status.unavailable")
  })

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
  const plugins = createMemo(() =>
    (sync().data.config.plugin ?? []).map((item) => (typeof item === "string" ? item : item[0])),
  )
  const pluginCount = createMemo(() => plugins().length)
  const pluginEmpty = createMemo(() => pluginEmptyMessage(language.t("dialog.plugins.empty"), "opencode.json"))
  const refreshRepositoryMap = async () => {
    if (repositoryMapState.refreshing) return
    setRepositoryMapState("refreshing", true)
    await sdk()
      .client.v2.repositoryMap.refresh()
      .then((result) => setRepositoryMap(result.data?.data))
      .catch(fail)
      .finally(() => setRepositoryMapState("refreshing", false))
  }

  return (
    <div class="flex items-center gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
      <Tabs
        aria-label={language.t("status.popover.ariaLabel")}
        class="tabs bg-background-strong rounded-xl overflow-hidden"
        data-component="tabs"
        data-active={settings.general.newLayoutDesigns() ? "mcp" : "servers"}
        defaultValue={settings.general.newLayoutDesigns() ? "mcp" : "servers"}
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
          <Tabs.Trigger value="plugins" data-slot="tab" class="text-12-regular">
            {pluginCount() > 0 ? `${pluginCount()} ` : ""}
            {language.t("status.popover.tab.plugins")}
          </Tabs.Trigger>
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

        <Tabs.Content value="plugins">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
              <Show
                when={plugins().length > 0}
                fallback={<div class="text-14-regular text-text-base text-center my-auto">{pluginEmpty()}</div>}
              >
                <For each={plugins()}>
                  {(plugin) => (
                    <div class="flex items-center gap-2 w-full px-2 py-1">
                      <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                      <span class="text-14-regular text-text-base truncate">{plugin}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Show when={desktop()}>
          <Tabs.Content value="repository-map">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col gap-3 p-3 bg-background-base rounded-sm min-h-32">
                <Show
                  when={!repositoryMap.loading}
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

                  <Show when={repositoryMap()} keyed>
                    {(map) => (
                      <>
                        <div class="flex items-center gap-2 px-1 min-w-0">
                          <span class="text-12-regular text-text-weaker shrink-0">
                            {language.t("status.popover.tab.lsp")}: {repositorySemanticStatus()}
                          </span>
                          <Show when={map.semantic.servers.length > 0}>
                            <span class="text-12-regular text-text-base truncate">
                              {map.semantic.servers.join(", ")}
                            </span>
                          </Show>
                          <span class="ml-auto text-11-regular text-text-weaker shrink-0">
                            {map.semantic.files} {language.t("status.popover.repositoryMap.files")}
                          </span>
                        </div>

                        <div class="grid grid-cols-4 gap-2">
                          <RepositoryMapMetric
                            label={language.t("status.popover.repositoryMap.files")}
                            value={map.files}
                          />
                          <RepositoryMapMetric
                            label={language.t("status.popover.repositoryMap.areas")}
                            value={map.modules.length}
                          />
                          <RepositoryMapMetric
                            label={language.t("status.popover.repositoryMap.symbols")}
                            value={map.symbols.length}
                          />
                          <RepositoryMapMetric
                            label={language.t("status.popover.repositoryMap.links")}
                            value={map.edges.length}
                          />
                        </div>

                        <For each={map.modules.slice(0, 4)}>
                          {(module) => (
                            <div class="flex items-center gap-2 px-1 min-w-0">
                              <span class="text-12-regular text-text-base truncate">{module.name ?? module.path}</span>
                              <span class="flex-1 border-t border-border-weak-base" />
                              <span class="text-11-regular text-text-weaker shrink-0">{module.files}</span>
                            </div>
                          )}
                        </For>
                      </>
                    )}
                  </Show>
                </Show>

                <Button
                  variant="secondary"
                  class="self-start h-8 px-3 py-1.5"
                  disabled={repositoryMapState.refreshing}
                  onClick={() => void refreshRepositoryMap()}
                >
                  {repositoryMapState.refreshing
                    ? language.t("common.loading")
                    : language.t("status.popover.repositoryMap.reindex")}
                </Button>
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
