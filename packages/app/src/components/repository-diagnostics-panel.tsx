import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useRepositoryDiagnostics } from "@/context/repository-diagnostics"

export function RepositoryDiagnosticsPanel() {
  const language = useLanguage()
  const diagnostics = useRepositoryDiagnostics()

  return (
    <Show when={diagnostics.data()?.enabled}>
      <div class="shrink-0 border-t border-border-weak-base bg-background-base px-4 py-2">
        <div class="mx-auto flex w-full max-w-180 flex-col gap-1.5 rounded-md bg-surface-raised-base px-3 py-2 font-mono">
          <div class="flex items-center gap-2 text-11-medium text-text-weak">
            <span class="size-1.5 shrink-0 rounded-full bg-icon-success-base" />
            <span>{language.t("status.popover.repositoryMap.diagnostics")}</span>
            <span class="ml-auto text-10-regular text-text-weaker">{diagnostics.data()?.entries.length ?? 0}</span>
          </div>
          <Show
            when={(diagnostics.data()?.entries.length ?? 0) > 0}
            fallback={
              <span class="text-11-regular text-text-weaker">
                {language.t("status.popover.repositoryMap.diagnosticsEmpty")}
              </span>
            }
          >
            <For each={diagnostics.data()?.entries.slice(-5) ?? []}>
              {(entry) => (
                <div class="flex min-w-0 items-start gap-2 text-11-regular">
                  <span
                    classList={{
                      "mt-1 size-1.5 shrink-0 rounded-full": true,
                      "bg-icon-success-base": entry.level === "info",
                      "bg-icon-warning-base": entry.level === "warning",
                      "bg-icon-critical-base": entry.level === "error",
                    }}
                  />
                  <span class="shrink-0 uppercase text-text-weaker">{entry.stage}</span>
                  <span class="min-w-0 break-words text-text-base">{entry.message}</span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </Show>
  )
}
