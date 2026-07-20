import type {
  RepositoryMapKnowledgeScope,
  RepositoryMapMemoryEntry,
  RepositoryMapRagEntry,
} from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { TextField } from "@opencode-ai/ui/text-field"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import { createResource, createSignal, For, Show, type JSXElement } from "solid-js"

const LIMIT = "200"

export function DialogRagMemoryViewer() {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [scope, setScope] = createSignal<RepositoryMapKnowledgeScope>("rag")
  const [draft, setDraft] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [refresh, setRefresh] = createSignal(0)
  const [knowledge] = createResource(
    () => ({ context: sdk(), search: search(), refresh: refresh() }),
    async (input) => {
      const result = await input.context.client.v2.repositoryMap.knowledge({
        search: input.search || undefined,
        limit: LIMIT,
      })
      if (result.error) throw result.error
      return result.data?.data
    },
  )
  const fail = (error: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  }

  const remove = async (target: RepositoryMapKnowledgeScope, id: string) => {
    const result = await sdk().client.v2.repositoryMap.removeKnowledge({ scope: target, id })
    if (result.error) throw result.error
    setRefresh((value) => value + 1)
    showToast({ variant: "success", title: language.t("knowledge.removed") })
  }

  const clear = async (target: RepositoryMapKnowledgeScope) => {
    const result = await sdk().client.v2.repositoryMap.clearKnowledge({ scope: target })
    if (result.error) throw result.error
    setRefresh((value) => value + 1)
    showToast({ variant: "success", title: language.t("knowledge.cleared") })
  }

  const confirmRemove = (target: RepositoryMapKnowledgeScope, id: string) => {
    const label = target === "rag" ? language.t("knowledge.tab.rag") : language.t("knowledge.tab.memory")
    void dialog.push(() => (
      <DialogKnowledgeConfirm
        title={language.t("knowledge.remove.title")}
        description={language.t("knowledge.remove.confirm", { scope: label })}
        action={language.t("knowledge.remove")}
        run={() => remove(target, id)}
        onError={fail}
      />
    ))
  }

  const confirmClear = (target: RepositoryMapKnowledgeScope) => {
    const label = target === "rag" ? language.t("knowledge.tab.rag") : language.t("knowledge.tab.memory")
    const count = target === "rag" ? (knowledge()?.rag.total ?? 0) : (knowledge()?.memory.total ?? 0)
    void dialog.push(() => (
      <DialogKnowledgeConfirm
        title={language.t("knowledge.clear.title", { scope: label })}
        description={language.t("knowledge.clear.confirm", { scope: label, count })}
        action={target === "rag" ? language.t("knowledge.clear.rag") : language.t("knowledge.clear.memory")}
        run={() => clear(target)}
        onError={fail}
      />
    ))
  }

  const submitSearch = (event: SubmitEvent) => {
    event.preventDefault()
    const next = draft().trim()
    if (next === search()) {
      setRefresh((value) => value + 1)
      return
    }
    setSearch(next)
  }

  return (
    <Dialog
      title={language.t("knowledge.title")}
      description={language.t("knowledge.description")}
      size="x-large"
      class="w-full max-w-[840px] mx-auto"
    >
      <div class="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6">
        <form class="flex shrink-0 items-end gap-2" onSubmit={submitSearch}>
          <div class="min-w-0 flex-1">
            <TextField
              autofocus
              hideLabel
              label={language.t("knowledge.search.placeholder")}
              placeholder={language.t("knowledge.search.placeholder")}
              value={draft()}
              onChange={setDraft}
              class="w-full"
            />
          </div>
          <Button type="submit" variant="primary" class="h-8 shrink-0 px-3">
            {language.t("knowledge.search.action")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            class="h-8 shrink-0 px-3"
            disabled={knowledge.loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {language.t("knowledge.refresh")}
          </Button>
        </form>

        <Show when={!knowledge.error} fallback={<KnowledgeError error={knowledge.error} />}>
          <Tabs
            value={scope()}
            onChange={(value) => {
              if (value === "rag" || value === "memory") setScope(value)
            }}
            variant="alt"
            class="!h-auto min-h-0 flex-1"
          >
            <Tabs.List class="gap-4 border-b border-border-weak-base">
              <Tabs.Trigger value="rag" class="text-12-regular">
                {language.t("knowledge.tab.rag")}
              </Tabs.Trigger>
              <Tabs.Trigger value="memory" class="text-12-regular">
                {language.t("knowledge.tab.memory")}
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="rag" class="flex min-h-0 flex-col !overflow-hidden pt-3">
              <Show
                when={!knowledge.loading && knowledge()?.rag}
                fallback={<KnowledgeLoading label={language.t("knowledge.loading")} />}
              >
                {(rag) => (
                  <div class="flex h-full min-h-0 flex-col gap-3">
                    <KnowledgeStats
                      items={[
                        `${rag().total.toLocaleString(language.intl())} ${language.t("knowledge.stats.chunks")}`,
                        `${rag().files.toLocaleString(language.intl())} ${language.t("status.popover.repositoryMap.files").toLocaleLowerCase(language.intl())}`,
                        `${rag().matched.toLocaleString(language.intl())} ${language.t("knowledge.stats.matches")}`,
                      ]}
                      detail={rag().model ? `${language.t("knowledge.model")}: ${rag().model}` : undefined}
                    />
                    <KnowledgeList empty={rag().entries.length === 0} emptyLabel={language.t("knowledge.empty")}>
                      <For each={rag().entries}>
                        {(entry) => (
                          <RagEntry
                            entry={entry}
                            date={(value) => formatDate(value, language.intl())}
                            onRemove={() => confirmRemove("rag", entry.id)}
                          />
                        )}
                      </For>
                    </KnowledgeList>
                  </div>
                )}
              </Show>
            </Tabs.Content>

            <Tabs.Content value="memory" class="flex min-h-0 flex-col !overflow-hidden pt-3">
              <Show
                when={!knowledge.loading && knowledge()?.memory}
                fallback={<KnowledgeLoading label={language.t("knowledge.loading")} />}
              >
                {(memory) => (
                  <div class="flex h-full min-h-0 flex-col gap-3">
                    <KnowledgeStats
                      items={[
                        `${memory().total.toLocaleString(language.intl())} ${language.t("knowledge.stats.entries")}`,
                        `${memory().matched.toLocaleString(language.intl())} ${language.t("knowledge.stats.matches")}`,
                      ]}
                    />
                    <KnowledgeList empty={memory().entries.length === 0} emptyLabel={language.t("knowledge.empty")}>
                      <For each={memory().entries}>
                        {(entry) => (
                          <MemoryEntry
                            entry={entry}
                            date={(value) => formatDate(value, language.intl())}
                            onRemove={() => confirmRemove("memory", entry.id)}
                          />
                        )}
                      </For>
                    </KnowledgeList>
                  </div>
                )}
              </Show>
            </Tabs.Content>
          </Tabs>
        </Show>

        <div class="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-weak-base pt-3">
          <Button
            type="button"
            variant="secondary"
            icon="trash"
            disabled={knowledge.loading || (knowledge()?.memory.total ?? 0) === 0}
            onClick={() => confirmClear("memory")}
          >
            {language.t("knowledge.clear.memory")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon="trash"
            disabled={knowledge.loading || (knowledge()?.rag.total ?? 0) === 0}
            onClick={() => confirmClear("rag")}
          >
            {language.t("knowledge.clear.rag")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function RagEntry(props: { entry: RepositoryMapRagEntry; date: (value: number) => string; onRemove: () => void }) {
  const language = useLanguage()
  return (
    <article class="flex flex-col gap-2 rounded-md bg-surface-raised-base p-3">
      <div class="flex min-w-0 items-start gap-2">
        <span class="min-w-0 flex-1 break-all font-mono text-12-medium text-text-base">
          {props.entry.path}:{props.entry.start}-{props.entry.end}
        </span>
        <IconButton
          type="button"
          icon="trash"
          variant="ghost"
          aria-label={language.t("knowledge.remove")}
          onClick={props.onRemove}
        />
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-10-regular text-text-weaker">
        <span>ID: {props.entry.id}</span>
        <span>
          {props.entry.dimensions.toLocaleString(language.intl())} {language.t("knowledge.dimensions")}
        </span>
        <span>
          {language.t("knowledge.updated")}: {props.date(props.entry.updatedAt)}
        </span>
      </div>
      <span class="break-all font-mono text-10-regular text-text-weaker">hash: {props.entry.fileHash}</span>
    </article>
  )
}

function MemoryEntry(props: {
  entry: RepositoryMapMemoryEntry
  date: (value: number) => string
  onRemove: () => void
}) {
  const language = useLanguage()
  return (
    <article class="flex flex-col gap-2 rounded-md bg-surface-raised-base p-3">
      <div class="flex min-w-0 items-start gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-10-medium uppercase text-text-weaker">{props.entry.kind}</span>
          <p class="whitespace-pre-wrap break-words text-12-regular text-text-base">{props.entry.text}</p>
        </div>
        <IconButton
          type="button"
          icon="trash"
          variant="ghost"
          aria-label={language.t("knowledge.remove")}
          onClick={props.onRemove}
        />
      </div>
      <Show when={props.entry.files.length > 0}>
        <div class="flex flex-col gap-1">
          <span class="text-10-medium text-text-weaker">{language.t("knowledge.files")}</span>
          <For each={props.entry.files}>
            {(file) => <span class="break-all font-mono text-10-regular text-text-base">{file}</span>}
          </For>
        </div>
      </Show>
      <Show when={props.entry.terms.length > 0}>
        <span class="break-words text-10-regular text-text-weaker">
          {language.t("knowledge.terms")}: {props.entry.terms.join(", ")}
        </span>
      </Show>
      <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-10-regular text-text-weaker">
        <span>ID: {props.entry.id}</span>
        <Show when={props.entry.embeddingModel}>
          {(model) => (
            <span>
              {language.t("knowledge.model")}: {model()}
            </span>
          )}
        </Show>
        <span>
          {props.entry.dimensions.toLocaleString(language.intl())} {language.t("knowledge.dimensions")}
        </span>
        <span>
          {language.t("knowledge.updated")}: {props.date(props.entry.updatedAt)}
        </span>
      </div>
    </article>
  )
}

function KnowledgeStats(props: { items: string[]; detail?: string }) {
  return (
    <div class="flex flex-wrap items-center gap-2 text-11-regular text-text-weaker">
      <For each={props.items}>{(item) => <span class="rounded bg-surface-raised-base px-2 py-1">{item}</span>}</For>
      <Show when={props.detail}>{(detail) => <span class="ml-auto min-w-0 truncate font-mono">{detail()}</span>}</Show>
    </div>
  )
}

function KnowledgeList(props: { empty: boolean; emptyLabel: string; children: JSXElement }) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-4 pr-1">
      <Show
        when={!props.empty}
        fallback={<div class="m-auto text-13-regular text-text-weaker">{props.emptyLabel}</div>}
      >
        {props.children}
      </Show>
    </div>
  )
}

function KnowledgeLoading(props: { label: string }) {
  return <div class="flex min-h-0 flex-1 items-center justify-center text-13-regular text-text-weaker">{props.label}</div>
}

function KnowledgeError(props: { error: unknown }) {
  const language = useLanguage()
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
      <span class="text-13-medium text-text-base">{language.t("common.requestFailed")}</span>
      <span class="max-w-lg break-words font-mono text-11-regular text-text-weaker">
        {props.error instanceof Error ? props.error.message : String(props.error)}
      </span>
    </div>
  )
}

function DialogKnowledgeConfirm(props: {
  title: string
  description: string
  action: string
  run: () => Promise<void>
  onError: (error: unknown) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [busy, setBusy] = createSignal(false)

  const confirm = async () => {
    setBusy(true)
    await props
      .run()
      .then(() => dialog.close())
      .catch((error) => {
        setBusy(false)
        props.onError(error)
      })
  }

  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={props.title} description={props.description} />
      </DialogHeader>
      <DialogFooter>
        <ButtonV2 variant="ghost" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant={busy() ? "loading" : "danger"} disabled={busy()} onClick={confirm}>
          {props.action}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function formatDate(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value)
}
