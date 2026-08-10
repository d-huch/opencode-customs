import type {
  RepositoryMapKnowledgeScope,
  RepositoryMapMemoryEntry,
  RepositoryMapMemoryConsolidationPreview,
  RepositoryMapRagEntry,
  RepositoryMapRetrievalEntry,
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
  const [consolidating, setConsolidating] = createSignal(false)
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

  const updateMemory = async (
    id: string,
    input: {
      pinned?: boolean
      expiresAt?: number
      clearExpiration?: boolean
      resolve?: boolean
      lifecycle?: "candidate" | "verified" | "durable" | "rejected" | "expired" | "archived"
    },
  ) => {
    const result = await sdk().client.v2.repositoryMap.updateMemory({
      id,
      repositoryMapMemoryLifecycleUpdate: input,
    })
    if (result.error) throw result.error
    setRefresh((value) => value + 1)
    showToast({ variant: "success", title: language.t("knowledge.memory.updated") })
  }

  const previewConsolidation = async () => {
    setConsolidating(true)
    const result = await sdk().client.v2.repositoryMap.previewMemoryConsolidation()
    setConsolidating(false)
    if (result.error) throw result.error
    const preview = result.data?.data
    if (!preview) throw new Error(language.t("knowledge.consolidation.unavailable"))
    void dialog.push(() => (
      <DialogMemoryConsolidation
        preview={preview}
        run={async () => {
          const applied = await sdk().client.v2.repositoryMap.applyMemoryConsolidation({
            repositoryMapMemoryConsolidationApply: {
              fingerprint: preview.fingerprint,
              generatedAt: preview.generatedAt,
            },
          })
          if (applied.error) throw applied.error
          if (applied.data?.data.stale) throw new Error(language.t("knowledge.consolidation.stale"))
          setRefresh((value) => value + 1)
          showToast({ variant: "success", title: language.t("knowledge.consolidation.applied") })
        }}
        onError={fail}
      />
    ))
  }

  const feedbackRetrieval = async (id: string, path: string, relevance: "used" | "rejected" | "clear") => {
    const result = await sdk().client.v2.repositoryMap.feedbackRetrieval({
      id,
      repositoryMapRetrievalFeedback: { path, relevance },
    })
    if (result.error) throw result.error
    setRefresh((value) => value + 1)
    showToast({ variant: "success", title: language.t("knowledge.retrieval.feedbackSaved") })
  }

  const confirmRemove = (target: RepositoryMapKnowledgeScope, id: string) => {
    const label =
      target === "rag"
        ? language.t("knowledge.tab.rag")
        : target === "memory"
          ? language.t("knowledge.tab.memory")
          : language.t("knowledge.tab.retrieval")
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
    const label =
      target === "rag"
        ? language.t("knowledge.tab.rag")
        : target === "memory"
          ? language.t("knowledge.tab.memory")
          : language.t("knowledge.tab.retrieval")
    const count =
      target === "rag"
        ? (knowledge()?.rag.total ?? 0)
        : target === "memory"
          ? (knowledge()?.memory.total ?? 0)
          : (knowledge()?.retrieval.total ?? 0)
    void dialog.push(() => (
      <DialogKnowledgeConfirm
        title={language.t("knowledge.clear.title", { scope: label })}
        description={language.t("knowledge.clear.confirm", { scope: label, count })}
        action={
          target === "rag"
            ? language.t("knowledge.clear.rag")
            : target === "memory"
              ? language.t("knowledge.clear.memory")
              : language.t("knowledge.clear.retrieval")
        }
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
              if (value === "rag" || value === "memory" || value === "retrieval") setScope(value)
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
              <Tabs.Trigger value="retrieval" class="text-12-regular">
                {language.t("knowledge.tab.retrieval")}
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
                            onUpdate={(input) => updateMemory(entry.id, input).catch(fail)}
                          />
                        )}
                      </For>
                    </KnowledgeList>
                  </div>
                )}
              </Show>
            </Tabs.Content>

            <Tabs.Content value="retrieval" class="flex min-h-0 flex-col !overflow-hidden pt-3">
              <Show
                when={!knowledge.loading && knowledge()?.retrieval}
                fallback={<KnowledgeLoading label={language.t("knowledge.loading")} />}
              >
                {(retrieval) => (
                  <div class="flex h-full min-h-0 flex-col gap-3">
                    <KnowledgeStats
                      items={[
                        `${retrieval().total.toLocaleString(language.intl())} ${language.t("knowledge.stats.retrievals")}`,
                        `${retrieval().matched.toLocaleString(language.intl())} ${language.t("knowledge.stats.matches")}`,
                        `Recall@5 ${percentage(retrieval().recallAt5, language.intl())}`,
                        `Recall@10 ${percentage(retrieval().recallAt10, language.intl())}`,
                      ]}
                    />
                    <KnowledgeList empty={retrieval().entries.length === 0} emptyLabel={language.t("knowledge.empty")}>
                      <For each={retrieval().entries}>
                        {(entry) => (
                          <RetrievalEntry
                            entry={entry}
                            date={(value) => formatDate(value, language.intl())}
                            onFeedback={(path, relevance) => feedbackRetrieval(entry.id, path, relevance).catch(fail)}
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
            variant="primary"
            disabled={knowledge.loading || consolidating() || (knowledge()?.memory.total ?? 0) === 0}
            onClick={() =>
              previewConsolidation().catch((error) => {
                setConsolidating(false)
                fail(error)
              })
            }
          >
            {consolidating()
              ? language.t("knowledge.consolidation.loading")
              : language.t("knowledge.consolidation.preview")}
          </Button>
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
          <Button
            type="button"
            variant="secondary"
            icon="trash"
            disabled={knowledge.loading || (knowledge()?.retrieval.total ?? 0) === 0}
            onClick={() => confirmClear("retrieval")}
          >
            {language.t("knowledge.clear.retrieval")}
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

function RetrievalEntry(props: {
  entry: RepositoryMapRetrievalEntry
  date: (value: number) => string
  onFeedback: (path: string, relevance: "used" | "rejected" | "clear") => void
}) {
  const language = useLanguage()
  return (
    <article class="flex flex-col gap-3 rounded-md bg-surface-raised-base p-3">
      <div class="flex min-w-0 flex-col gap-1">
        <p class="whitespace-pre-wrap break-words text-12-medium text-text-base">{props.entry.query}</p>
        <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-10-regular text-text-weaker">
          <span>ID: {props.entry.id}</span>
          <span>{props.date(props.entry.updatedAt)}</span>
          <Show when={typeof props.entry.recallAt5 === "number"}>
            <span>Recall@5 {percentage(props.entry.recallAt5, language.intl())}</span>
          </Show>
          <Show when={typeof props.entry.recallAt10 === "number"}>
            <span>Recall@10 {percentage(props.entry.recallAt10, language.intl())}</span>
          </Show>
        </div>
      </div>
      <For each={props.entry.files}>
        {(file) => (
          <div class="flex flex-col gap-2 rounded bg-surface-base p-2">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 break-all font-mono text-11-medium text-text-base">{file.path}</span>
              <span class="rounded bg-surface-raised-base px-2 py-1 text-10-medium uppercase text-text-weaker">
                {language.t(`knowledge.retrieval.classification.${file.classification}`)}
              </span>
              <span class="text-10-regular text-text-weaker">
                {language.t("knowledge.retrieval.confidence")} {percentage(file.confidence, language.intl())}
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <For each={file.reasons}>
                {(reason) => (
                  <span class="break-words text-10-regular text-text-weaker">
                    <span class="font-mono text-text-base">{reason.stage}</span>: {reason.detail}
                  </span>
                )}
              </For>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={file.used ? "primary" : "secondary"}
                class="h-7 px-2"
                onClick={() => props.onFeedback(file.path, file.used ? "clear" : "used")}
              >
                {language.t("knowledge.retrieval.used")}
              </Button>
              <Button
                type="button"
                variant={file.rejected ? "primary" : "secondary"}
                class="h-7 px-2"
                onClick={() => props.onFeedback(file.path, file.rejected ? "clear" : "rejected")}
              >
                {language.t("knowledge.retrieval.irrelevant")}
              </Button>
            </div>
          </div>
        )}
      </For>
    </article>
  )
}

function MemoryEntry(props: {
  entry: RepositoryMapMemoryEntry
  date: (value: number) => string
  onRemove: () => void
  onUpdate: (input: {
    pinned?: boolean
    expiresAt?: number
    clearExpiration?: boolean
    resolve?: boolean
    lifecycle?: "candidate" | "verified" | "durable" | "rejected" | "expired" | "archived"
  }) => void
}) {
  const language = useLanguage()
  return (
    <article class="flex flex-col gap-2 rounded-md bg-surface-raised-base p-3">
      <div class="flex min-w-0 items-start gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-10-medium uppercase text-text-weaker">
            {language.t(`knowledge.memory.kind.${props.entry.kind}`)}
          </span>
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
      <Show when={props.entry.category || props.entry.topic || props.entry.confidence !== undefined}>
        <div class="flex flex-wrap gap-2 text-10-regular text-text-weaker">
          <Show when={props.entry.category}>
            {(category) => (
              <span class="rounded bg-surface-base px-2 py-1">
                {language.t("knowledge.memory.category")}: {language.t(`knowledge.memory.category.${category()}`)}
              </span>
            )}
          </Show>
          <Show when={props.entry.topic}>
            {(topic) => (
              <span class="rounded bg-surface-base px-2 py-1 font-mono">
                {language.t("knowledge.memory.topic")}: {topic()}
              </span>
            )}
          </Show>
          <Show when={typeof props.entry.confidence === "number" ? props.entry.confidence : undefined}>
            {(confidence) => (
              <span class="rounded bg-surface-base px-2 py-1">
                {language.t("knowledge.memory.confidence")}:{" "}
                {Math.round(confidence() * 100).toLocaleString(language.intl())}%
              </span>
            )}
          </Show>
        </div>
      </Show>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={props.entry.lifecycle === "candidate"}>
          <Button
            type="button"
            variant="primary"
            class="h-7 px-2"
            onClick={() => props.onUpdate({ lifecycle: "verified" })}
          >
            {language.t("knowledge.memory.verify")}
          </Button>
        </Show>
        <Show when={props.entry.lifecycle === "verified"}>
          <Button
            type="button"
            variant="primary"
            class="h-7 px-2"
            onClick={() => props.onUpdate({ lifecycle: "durable" })}
          >
            {language.t("knowledge.memory.makeDurable")}
          </Button>
        </Show>
        <Show
          when={
            props.entry.lifecycle === "rejected" ||
            props.entry.lifecycle === "expired" ||
            props.entry.lifecycle === "archived"
          }
        >
          <Button
            type="button"
            variant="primary"
            class="h-7 px-2"
            onClick={() => props.onUpdate({ lifecycle: "verified" })}
          >
            {language.t("knowledge.memory.restore")}
          </Button>
        </Show>
        <Show when={props.entry.lifecycle !== "rejected"}>
          <Button
            type="button"
            variant="secondary"
            class="h-7 px-2"
            onClick={() => props.onUpdate({ lifecycle: "rejected" })}
          >
            {language.t("knowledge.memory.reject")}
          </Button>
        </Show>
        <Show when={props.entry.status === "conflict"}>
          <Button type="button" variant="primary" class="h-7 px-2" onClick={() => props.onUpdate({ resolve: true })}>
            {language.t("knowledge.memory.resolve")}
          </Button>
        </Show>
        <Button
          type="button"
          variant="secondary"
          class="h-7 px-2"
          onClick={() => props.onUpdate({ pinned: !props.entry.pinned })}
        >
          {props.entry.pinned ? language.t("knowledge.memory.unpin") : language.t("knowledge.memory.pin")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          class="h-7 px-2"
          disabled={props.entry.pinned}
          onClick={() =>
            props.onUpdate({
              ...(props.entry.expiresAt
                ? { clearExpiration: true }
                : { expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30 }),
            })
          }
        >
          {props.entry.expiresAt ? language.t("knowledge.memory.noExpiry") : language.t("knowledge.memory.expire30")}
        </Button>
      </div>
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
        <Show when={props.entry.source}>
          {(source) => (
            <span>
              {language.t("knowledge.memory.source")}: {language.t(`knowledge.memory.source.${source()}`)}
            </span>
          )}
        </Show>
        <Show when={props.entry.evidence}>
          {(evidence) => (
            <span>
              {language.t("knowledge.memory.evidence")}: {evidence()}
            </span>
          )}
        </Show>
        <Show when={props.entry.scope}>
          {(scope) => (
            <span>
              {language.t("knowledge.memory.scope")}: {language.t(`knowledge.memory.scope.${scope()}`)}
            </span>
          )}
        </Show>
        <Show when={props.entry.originProject}>
          {(project) => (
            <span>
              {language.t("knowledge.memory.originProject")}: {project()}
            </span>
          )}
        </Show>
        <Show when={props.entry.lifecycle}>
          {(lifecycle) => (
            <span>
              {language.t("knowledge.memory.lifecycle")}: {language.t(`knowledge.memory.lifecycle.${lifecycle()}`)}
            </span>
          )}
        </Show>
        <Show when={props.entry.classification}>
          {(classification) => (
            <span>
              {language.t("knowledge.memory.classification")}:{" "}
              {language.t(`knowledge.memory.classification.${classification()}`)}
            </span>
          )}
        </Show>
        <Show when={props.entry.status === "conflict"}>
          <span>{language.t("knowledge.memory.conflict")}</span>
        </Show>
        <Show when={props.entry.conflicts?.length}>
          <span>
            {language.t("knowledge.memory.conflicts")}: {props.entry.conflicts?.join(", ")}
          </span>
        </Show>
        <Show when={props.entry.pinned}>
          <span>{language.t("knowledge.memory.pinned")}</span>
        </Show>
        <Show when={props.entry.expiresAt}>
          {(expiresAt) => (
            <span>
              {language.t("knowledge.memory.expires")}: {props.date(expiresAt())}
            </span>
          )}
        </Show>
        <Show when={props.entry.lastUsedAt}>
          {(lastUsedAt) => (
            <span>
              {language.t("knowledge.memory.lastUsed")}: {props.date(lastUsedAt())}
            </span>
          )}
        </Show>
        <Show when={props.entry.createdAt}>
          {(createdAt) => (
            <span>
              {language.t("knowledge.memory.created")}: {props.date(createdAt())}
            </span>
          )}
        </Show>
        <Show when={props.entry.verifiedAt}>
          {(verifiedAt) => (
            <span>
              {language.t("knowledge.memory.verified")}: {props.date(verifiedAt())}
            </span>
          )}
        </Show>
        <Show when={props.entry.ttl}>
          {(ttl) => <span>TTL: {Math.round(ttl() / (1000 * 60 * 60)).toLocaleString(language.intl())}h</span>}
        </Show>
        <Show when={typeof props.entry.useCount === "number" ? props.entry.useCount : undefined}>
          {(useCount) => (
            <span>
              {language.t("knowledge.memory.useCount")}: {useCount().toLocaleString(language.intl())}
            </span>
          )}
        </Show>
        <Show when={typeof props.entry.confirmationCount === "number" ? props.entry.confirmationCount : undefined}>
          {(confirmationCount) => (
            <span>
              {language.t("knowledge.memory.confirmationCount")}:{" "}
              {confirmationCount().toLocaleString(language.intl())}
            </span>
          )}
        </Show>
        <Show when={props.entry.matchReason}>
          {(reason) => (
            <span>
              {language.t("knowledge.memory.matchReason")}: {language.t(`knowledge.memory.matchReason.${reason()}`)}
            </span>
          )}
        </Show>
        <Show when={props.entry.lastQuery}>
          {(query) => (
            <span>
              {language.t("knowledge.memory.lastQuery")}: {query()}
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
      <Show when={props.entry.usage?.length}>
        <details class="text-10-regular text-text-weaker">
          <summary class="cursor-pointer select-none">
            {language.t("knowledge.memory.usageHistory")} ({props.entry.usage?.length})
          </summary>
          <div class="mt-2 flex flex-col gap-1 pl-2 font-mono">
            <For each={props.entry.usage?.slice(-5).toReversed()}>
              {(usage) => (
                <span class="break-words">
                  {props.date(usage.at)} · {usage.classification} · {usage.reason} · {usage.project} · {usage.query}
                </span>
              )}
            </For>
          </div>
        </details>
      </Show>
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
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center text-13-regular text-text-weaker">{props.label}</div>
  )
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

function DialogMemoryConsolidation(props: {
  preview: RepositoryMapMemoryConsolidationPreview
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
    <DialogV2 class="max-h-[80vh] w-[min(720px,calc(100vw-48px))]">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("knowledge.consolidation.title")}
          description={language.t("knowledge.consolidation.description")}
        />
      </DialogHeader>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 pb-4">
        <KnowledgeStats
          items={[
            language.t("knowledge.consolidation.actionable", { count: props.preview.actionable }),
            language.t("knowledge.consolidation.unresolved", { count: props.preview.unresolved }),
            language.t("knowledge.consolidation.protected", { count: props.preview.protected }),
          ]}
          detail={formatDate(props.preview.generatedAt, language.intl())}
        />
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
          <Show
            when={props.preview.actions.length > 0}
            fallback={
              <span class="m-auto text-13-regular text-text-weaker">{language.t("knowledge.consolidation.empty")}</span>
            }
          >
            <For each={props.preview.actions}>
              {(action) => (
                <article class="flex flex-col gap-1 rounded-md bg-surface-raised-base p-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-11-medium text-text-base">
                      {language.t(`knowledge.consolidation.action.${action.type}`)}
                    </span>
                    <span class="break-all font-mono text-10-regular text-text-weaker">{action.id}</span>
                  </div>
                  <span class="text-11-regular text-text-weaker">{action.reason}</span>
                  <Show when={action.relatedIDs.length > 0}>
                    <span class="break-all font-mono text-10-regular text-text-weaker">
                      {action.relatedIDs.join(", ")}
                    </span>
                  </Show>
                  <Show
                    when={
                      typeof action.beforeConfidence === "number" && typeof action.afterConfidence === "number"
                        ? action
                        : undefined
                    }
                  >
                    {(confidence) => (
                      <span class="text-10-regular text-text-weaker">
                        {language.t("knowledge.memory.confidence")}:{" "}
                        {percentage(confidence().beforeConfidence, language.intl())} →{" "}
                        {percentage(confidence().afterConfidence, language.intl())}
                      </span>
                    )}
                  </Show>
                </article>
              )}
            </For>
          </Show>
        </div>
      </div>
      <DialogFooter>
        <ButtonV2 variant="ghost" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant={busy() ? "loading" : "contrast"}
          disabled={busy() || props.preview.actionable === 0}
          onClick={confirm}
        >
          {language.t("knowledge.consolidation.apply")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
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

function percentage(value: number | string | undefined, locale: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${(value * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`
}
