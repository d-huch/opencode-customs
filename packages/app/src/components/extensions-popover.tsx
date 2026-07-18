import { Popover } from "@opencode-ai/ui/popover"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function ExtensionsPopover() {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  const [extensions] = createResource(
    () => (shown() ? sdk() : undefined),
    async (context) => {
      const result = await context.client.app.extensions()
      return result.data ?? { plugins: [], skills: [] }
    },
  )
  const legacyPlugins = createMemo(() =>
    (sync().data.config.plugin ?? []).map((item) => (typeof item === "string" ? item : item[0])),
  )

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs={IconButtonV2}
      triggerProps={{
        variant: "ghost-muted",
        size: "large",
        class: "!w-9 shrink-0",
        state: shown() ? "pressed" : undefined,
        "aria-label": language.t("extensions.trigger"),
      }}
      trigger={<IconV2 name="grid-plus" />}
      class="[&_[data-slot=popover-body]]:p-0 w-[420px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-end"
      shift={-198}
    >
      <Show when={shown()}>
        <div class="flex items-center gap-1 w-[420px] max-w-[calc(100vw-40px)] rounded-xl shadow-[var(--shadow-lg-border-base)]">
          <Tabs
            aria-label={language.t("extensions.ariaLabel")}
            class="tabs bg-background-strong rounded-xl overflow-hidden"
            data-component="tabs"
            data-active="plugins"
            defaultValue="plugins"
            variant="alt"
          >
            <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-4 h-10">
              <Tabs.Trigger value="plugins" data-slot="tab" class="text-12-regular">
                {(extensions()?.plugins.length ?? 0) + legacyPlugins().length > 0
                  ? `${(extensions()?.plugins.length ?? 0) + legacyPlugins().length} `
                  : ""}
                {language.t("status.popover.tab.plugins")}
              </Tabs.Trigger>
              <Tabs.Trigger value="skills" data-slot="tab" class="text-12-regular">
                {(extensions()?.skills.length ?? 0) > 0 ? `${extensions()?.skills.length} ` : ""}
                {language.t("extensions.tab.skills")}
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="plugins">
              <div class="h-[360px] overflow-y-auto px-2 pb-2">
                <div class="flex min-h-full flex-col gap-1 rounded-sm bg-background-base p-3">
                  <Show when={!extensions.loading} fallback={<Empty>{language.t("common.loading")}</Empty>}>
                    <Show
                      when={(extensions()?.plugins.length ?? 0) + legacyPlugins().length > 0}
                      fallback={<Empty>{language.t("extensions.empty.plugins")}</Empty>}
                    >
                      <For each={extensions()?.plugins ?? []}>
                        {(plugin) => (
                          <div class="flex gap-2 rounded-md px-2 py-2 hover:bg-surface-raised-base-hover">
                            <div
                              classList={{
                                "mt-1.5 size-1.5 shrink-0 rounded-full": true,
                                "bg-icon-success-base": plugin.enabled,
                                "bg-border-weak-base": !plugin.enabled,
                              }}
                            />
                            <div class="min-w-0 flex-1">
                              <div class="flex min-w-0 items-center gap-2">
                                <span class="truncate text-14-medium text-text-base">{plugin.displayName}</span>
                                <Show when={plugin.version}>
                                  <span class="shrink-0 text-11-regular text-text-weaker">v{plugin.version}</span>
                                </Show>
                                <span class="ml-auto shrink-0 text-11-regular text-text-weaker">
                                  {language.t(
                                    plugin.enabled ? "extensions.status.enabled" : "extensions.status.disabled",
                                  )}
                                </span>
                              </div>
                              <Show when={plugin.description}>
                                <div class="mt-0.5 line-clamp-2 text-12-regular text-text-weak">
                                  {plugin.description}
                                </div>
                              </Show>
                              <div class="mt-1.5 flex flex-wrap gap-1">
                                <Show when={plugin.skills > 0}>
                                  <Badge>{`${plugin.skills} Skills`}</Badge>
                                </Show>
                                <Show when={plugin.mcp}>
                                  <Badge>MCP</Badge>
                                </Show>
                                <Show when={plugin.apps}>
                                  <Badge>Apps</Badge>
                                </Show>
                                <Show when={plugin.hooks}>
                                  <Badge>Hooks</Badge>
                                </Show>
                                <Badge>{plugin.id}</Badge>
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                      <For each={legacyPlugins()}>
                        {(plugin) => (
                          <div class="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-surface-raised-base-hover">
                            <div class="size-1.5 shrink-0 rounded-full bg-icon-success-base" />
                            <span class="min-w-0 flex-1 truncate text-14-medium text-text-base">{plugin}</span>
                            <Badge>OpenCode</Badge>
                          </div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="skills">
              <div class="h-[360px] overflow-y-auto px-2 pb-2">
                <div class="flex min-h-full flex-col gap-1 rounded-sm bg-background-base p-3">
                  <Show when={!extensions.loading} fallback={<Empty>{language.t("common.loading")}</Empty>}>
                    <Show
                      when={(extensions()?.skills.length ?? 0) > 0}
                      fallback={<Empty>{language.t("extensions.empty.skills")}</Empty>}
                    >
                      <For each={extensions()?.skills ?? []}>
                        {(skill) => (
                          <div class="rounded-md px-2 py-2 hover:bg-surface-raised-base-hover">
                            <div class="truncate text-14-medium text-text-base">{skill.name}</div>
                            <Show when={skill.description}>
                              <div class="mt-0.5 line-clamp-2 text-12-regular text-text-weak">{skill.description}</div>
                            </Show>
                            <div class="mt-1 truncate text-11-regular text-text-weaker">{skill.location}</div>
                          </div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              </div>
            </Tabs.Content>
          </Tabs>
        </div>
      </Show>
    </Popover>
  )
}

function Badge(props: { children: string | number }) {
  return (
    <span class="max-w-full truncate rounded-md bg-surface-raised-base px-1.5 py-0.5 text-11-regular text-text-weaker">
      {props.children}
    </span>
  )
}

function Empty(props: { children: string }) {
  return <div class="m-auto px-6 text-center text-14-regular text-text-base">{props.children}</div>
}
