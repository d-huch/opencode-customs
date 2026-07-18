# OpenCode Customs Feature Guide

OpenCode Customs is a desktop-focused customization of OpenCode that builds a live structural and semantic model of the
active repository. Its primary goal is to give the model useful project context before tool-driven exploration begins,
especially when a request is phrased in domain language rather than with an exact class, method, or file name.

The implementation is location-scoped: each opened project has its own repository map, learned vocabulary, routing
results, LSP state, and diagnostic timeline.

## Design principles

- **Learn from the repository.** Domain vocabulary is extracted from nearby identifiers, paths, and source context. The
  router does not contain a hardcoded dictionary such as `journal -> journals` or `soldier -> people`.
- **Follow observed topology.** Candidate files are expanded through actual import, reference, and call relationships
  instead of a predefined `menu -> route -> controller -> page` architecture.
- **Work across stacks.** Structural indexing is independent of any single web framework. Source discovery covers
  TypeScript, JavaScript, Vue, Svelte, PHP, Python, Go, Rust, Java, Kotlin, C#, Ruby, Swift, and common project/configuration
  files. Available language servers can add deeper semantic data.
- **Degrade gracefully.** The structural map and literal evidence remain usable when no LSP server is available or a
  semantic lookup times out.
- **Keep context bounded.** The router ranks a compact selection instead of inserting the whole repository into every
  model request.
- **Protect desktop resources.** Watcher-driven semantic work is coalesced into one bounded queue, background LSP
  enrichment samples a small working set, and short lookup prompts stay on a lightweight routing path.

## Request flow

```text
User prompt
  -> location-scoped repository map
  -> exact-identifier or abstract-concept route
  -> project vocabulary and semantic lookup when applicable
  -> analogous implementation candidates
  -> import/reference/call graph expansion
  -> bounded source-window retrieval
  -> query-relevant project-memory recall
  -> compact repository context budget
  -> model request
```

Routing runs before the provider request. The selected context is added as a `repository_context` system section that
lists likely files, matching symbols, project areas, learned concepts, analogous implementations, and observed semantic
relationships. The model is instructed to inspect that evidence before repeating broad searches.

## Incremental repository map

The repository map is initialized in the background when a project location is opened. It records:

- File and language counts.
- Project areas inferred from manifests and directory structure.
- Package names, manifests, and likely entry points.
- Cross-area relationships derived from imports and manifest dependencies.
- Structural landmarks such as routes, controllers, components, configuration, schemas, and migrations.
- Syntax-derived symbols and file-to-file import edges.
- LSP-derived symbols, references, and call edges when semantic services are available.

The file watcher updates the active map for `add`, `change`, and `unlink` events. Changed source files are reparsed, stale
symbols and edges are removed, and eligible files are scheduled for semantic enrichment. A full rebuild remains available
through the **Reindex** action and the repository-map refresh API.

Watcher bursts do not create one LSP job per event. Pending files are deduplicated into a bounded queue and processed by
a single semantic worker. This prevents bulk file operations from spawning an unbounded backlog of LSP requests.

Repository size and result counts are bounded to protect desktop responsiveness. A map reports `truncated` when its file
limit is reached; this means the map is partial, not that unlisted files do not exist.

## Context router

The router uses two complementary paths.

### Exact identifiers

When a prompt contains a likely identifier, the router first scores known symbols, files, modules, landmarks, attached
files, and graph relationships. If a semantic provider is available, it performs a bounded on-demand workspace-symbol and
reference lookup. Results are cached briefly, merged with the structural graph, and reduced to a compact context set.

If semantic lookup is unavailable, the structural selection is still sent to the model. An absent LSP match is never
treated as proof that a symbol does not exist.

### Abstract concepts

For a sufficiently descriptive task, the router:

1. Extracts Unicode-aware concept seeds from the prompt.
2. Grounds those seeds in source-code evidence while excluding generated output, dependencies, caches, tests, lockfiles,
   and other noisy paths.
3. Reads nearby source context and discovers repository-specific identifiers and compound terms.
4. Expands that learned vocabulary through several evidence hops.
5. Ranks files that cover multiple requested concepts and selects existing implementations as analogues.
6. Expands the best evidence through observed import, reference, and call edges.
7. Produces a topology slice grouped by the directories and project areas that actually exist in the repository.

Short requests with only a few broad terms skip multi-hop concept expansion and use the structural route. Concept search,
rendered vocabulary, selected files, symbols, evidence hops, and LSP lookups all have explicit time and size budgets.

For example, a request for a new domain screen may lead to an existing feature's navigation definition, data source,
backend handler, and UI component—but only when those relationships are evidenced by the current project. In a different
repository, the same process can ground concepts in Unity/C# source, a Python package, a Go module, or another architecture
without applying web-framework-specific aliases.

## Bounded RAG

After ranking files, the router retrieves at most five small source windows. Symbol and concept-evidence line numbers are
preferred as anchors; otherwise the best lexical match in the selected file is used. A single source file is never read
for retrieval when it exceeds 256 KiB, and each preview is capped at 1,200 characters.

The complete `repository_context` section—not only the snippets—is constrained by a model-aware token budget. The budget
defaults to 1,200 tokens when model capacity is unknown and otherwise uses 8% of the configured context window, clamped
between 512 and 1,600 tokens. Final request fitting and compaction still apply after retrieval, so RAG cannot bypass the
provider's configured context limit.

This is a local hybrid retrieval path, not a remote embedding service. It combines the incremental map, learned project
vocabulary, literal evidence, LSP symbols, and observed graph edges. Retrieved source is treated as untrusted project data
and remains a navigation aid; the agent must inspect current files before editing.

## Durable project memory

Each project has a small local memory file under the OpenCode cache directory. It stores two kinds of entries:

- Successful query-to-file routes, so a related future task can start from previously useful project areas.
- Stable bullets from normalized compaction summaries: objective, important details, completed work, and verified relevant
  files. Transient **Active**, **Blocked**, and **Next Move** sections are not persisted as durable memory.

Recall is lexical and query-specific. At most eight matching memory records contribute file ranking, while at most four
distinct notes and 1,200 note characters can be rendered. The store keeps no more than 96 entries per project and expires
entries after 90 days. Memory never replaces source verification and does not copy the full conversation back into the
model request.

## Desktop Map panel

Open the desktop status popover and select **Map**. The panel shows:

- Index state: **Ready**, **Partial**, or **Unavailable**.
- LSP enrichment state and the participating language servers.
- Indexed file, area, symbol, and link counts.
- The largest inferred project areas.
- A **Reindex** button for a full structural refresh.
- An opt-in **Live diagnostics** switch.

The initial structural map and watcher run automatically. Manual reindexing is mainly useful after a bulk external change
or when validating index behavior.

## Live diagnostics

Diagnostics are disabled by default and can be enabled from the **Map** panel. After enabling them, send a prompt to see
the location-scoped timeline. Entries may include these stages:

| Stage     | Meaning                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `prompt`  | The router received the user request.                                     |
| `map`     | Structural map state and availability.                                    |
| `concept` | Concept grounding, learned vocabulary, evidence hops, and search timing.  |
| `lsp`     | Semantic lookup start, cache use, completion, timeout, or failure.        |
| `context` | Number of selected files and topology areas.                              |
| `rag`     | Bounded snippet count, retrieved characters, and matching memory records. |
| `model`   | Provider request start, finish, or failure.                               |
| `router`  | An unexpected routing failure handled by the fallback path.               |

The timeline keeps only a bounded set of recent entries in memory. Use **Clear** to remove the current entries. Disabling
diagnostics stops new entries from being recorded; it does not change routing behavior.

The `model` start entry also reports history-message count and routed-context character count. A large history with a
local model can still require substantial KV-cache memory even when repository routing is small. OpenCode Customs checks
the complete serialized request before provider execution and records a `model` warning when it compacts an oversized
request.

## Local model resource safeguards

### Local Agent Runtime: LM Studio bridge

The first Local Agent Runtime layer connects configured `lmstudio` providers to LM Studio's native v1 and
OpenAI-compatible APIs. Its capability probe is read-only: it calls the model-list endpoints and never submits a prompt,
loads a model, or allocates an inference KV cache.

The bridge reports:

- `ready`, `degraded`, `offline`, `unauthorized`, or `unconfigured` connectivity state.
- Native API and OpenAI-compatible API availability, including Responses, Chat Completions, and Embeddings routing.
- Downloaded models and loaded instance identifiers.
- The active instance context length and the maximum context supported by the model.
- Native tool-use training, vision input, public reasoning controls, and embedding-model type.

Probe results are cached briefly during provider discovery. Explicit model configuration remains authoritative, while
discovered LM Studio capabilities fill missing model metadata. This prevents the agent from advertising vision,
reasoning, or native tool use merely because a generic OpenAI-compatible provider was selected.

Open the desktop status popover and select **Runtime** to inspect the current snapshot and rerun the probe. The public
JavaScript SDK exposes the same read-only operation as `provider.lmstudio.probe()` at
`GET /provider/lmstudio/probe`.

This bridge is the capability and health contract for the remaining Local Agent Runtime layers.

### Local Agent Runtime: Resource Governor

The Resource Governor protects the desktop and local inference server before work reaches the model. It samples host
memory and the OpenCode server process, classifies pressure as `healthy`, `pressured`, or `critical`, and applies one
process-global admission policy to local providers.

For LM Studio, the configured context is never treated as proof that the loaded model can accept that context. Before
prompt fitting, the governor compares the configured limit with the active instance context reported by the bridge,
uses the smaller value, reserves output capacity, and keeps additional safety headroom. An unloaded or unknown local
model receives a conservative startup budget instead of an unbounded request. Under memory pressure the input budget is
reduced further so normal session compaction happens before inference allocation.

Local model streams are serialized by default. A second request waits in a bounded process-global admission queue rather
than starting another Metal/MLX allocation in parallel. When available RAM or OpenCode RSS reaches the critical policy,
new local inference is rejected with a recoverable resource-pressure error; cloud providers are not throttled by this
local-model queue.

The desktop **Runtime** panel shows available RAM, OpenCode server RSS, active and waiting local requests, and the latest
safe-context decision. The same snapshot is available through the JavaScript SDK as
`provider.runtime.resources()` at `GET /provider/runtime/resources`.

The defaults can be tuned for development with `OPENCODE_LOCAL_AGENT_MAX_MODEL_CONCURRENCY`,
`OPENCODE_LOCAL_AGENT_CONTEXT_PERCENT`, `OPENCODE_LOCAL_AGENT_PRESSURE_PERCENT`,
`OPENCODE_LOCAL_AGENT_CRITICAL_PERCENT`, `OPENCODE_LOCAL_AGENT_MIN_FREE_MB`, and
`OPENCODE_LOCAL_AGENT_CRITICAL_FREE_MB`. Invalid values are clamped to conservative ranges.

### Local Agent Runtime: durable execution and checkpoint recovery

Agent execution now persists a session-scoped checkpoint in SQLite instead of relying only on an in-memory loop. Each
generation records its runtime (`v1` or `v2`), execution identity, owner process, provider step, assistant message, and
the current phase: `preparing`, `streaming`, `settling_tools`, or `continuing`. Completion, interruption, and failure are
terminal states with timestamps and an optional error.

After the OpenCode server process exits unexpectedly, a new process claims only checkpoints whose previous owner is no
longer alive. The V2 runtime discovers these abandoned generations during startup. The legacy desktop runtime discovers
them when the desktop refreshes session status, filters them to the active project, and schedules recovery in the
background. Generation and execution identifiers reject late writes from a stale runner.

Recovery always starts at a fresh provider boundary from persisted session history. Completed tool results stay in the
transcript and are sent back to the model; they are not executed again. Tool calls left in `pending` or `running` state
are closed with an explicit interrupted error before continuation, and an incomplete assistant step is likewise closed
in the V2 event history. This favors at-most-once local side effects over silently replaying a tool after a crash.

A normal provider or local-model failure is recorded as `failed` and is not retried automatically. The user can resume
or send a new prompt after correcting the model or resource issue. This prevents a crashed LM Studio model from entering
an automatic restart loop that repeatedly allocates memory.

The checkpoint is an execution boundary, not a distributed lease. Current ownership is process-local; clustered or
multi-host execution will require a durable lease and fencing design in a later runtime layer.

Custom providers do not always publish model limits. OpenCode Customs treats missing capacity as unknown rather than
unlimited. A custom model without catalog or user-supplied limits receives a conservative 4,096-token context budget and
a 512-token output budget. Explicit positive model limits still take precedence.

Before provider execution, prompt admission estimates the complete serialized request, including system instructions,
conversation history, routed repository context, and tool schemas. Small-context models use a compact, stack-neutral
agent prompt. Oversized requests first reduce optional system sections and select a bounded tool set using required-tool,
recent-use, query-relevance, and general coding-capability signals. If the conversation itself still exceeds the safe
input budget, the session is compacted before any inference work reaches the provider.

Compaction input is itself bounded. If an old session is too large to summarize in one pass, the oldest source turns are
removed from the summary request until it fits while recent turns remain available through the retained tail. This favors
desktop stability over attempting an allocation that can terminate a local Metal/MLX process.

Compaction changes only the model projection. Original user messages, assistant replies, and tool activity remain in the
session database and stay visible when an older chat is reopened. The composer displays a live context percentage; click
it to open the existing context details panel. Preflight estimates appear immediately, including when a provider rejects
the request before returning usage tokens, and successful provider usage replaces the estimate.

Conversation-title generation never runs the active model a second time in parallel. It uses a genuinely smaller model
when one is available; otherwise it derives a short deterministic title from the first user message.

## ChatGPT/Codex plugins and skills

The desktop title bar has a separate **Extensions** menu with **Plugins** and **Skills** tabs. This keeps extension
management out of the server/LSP/Map status panel and makes the active agent capabilities visible without adding their
full instructions to every prompt.

OpenCode Customs supports the current ChatGPT/Codex plugin package format: a plugin root with a required
`.codex-plugin/plugin.json` manifest and optional `skills/`, `.mcp.json`, `.app.json`, and `hooks/` components. It reads
installed packages from the Codex plugin cache and respects the enabled state recorded in `~/.codex/config.toml`. Repo
and personal local marketplaces are also discovered from `.agents/plugins/marketplace.json`; entries marked
`INSTALLED_BY_DEFAULT` are active, while other catalog entries remain visible but inactive.

Enabled plugin skills are added to the same skill registry as native OpenCode skills. Direct skills under
`.agents/skills`, `.claude/skills`, `/etc/codex/skills`, and configured OpenCode skill paths continue to work. Only skill
name, description, and location are advertised to the model; the complete `SKILL.md` body is returned by the skill tool
after the model selects it.

Enabled plugin `.mcp.json` files are translated to OpenCode local or remote MCP configuration. Relative command working
directories resolve from the plugin root, timeouts are converted to milliseconds, and server names are namespaced by
plugin to avoid collisions with project MCP configuration. Project `opencode.json` MCP entries retain precedence.

ChatGPT app mappings and lifecycle hooks are shown as plugin capabilities but are not executed by the local LM Studio
runtime. App mappings require the ChatGPT Apps runtime, while Codex-specific hooks do not have a safe one-to-one OpenCode
host contract. Native OpenCode JavaScript plugins remain supported through the existing `plugin` configuration.

Format references: [Build plugins](https://learn.chatgpt.com/docs/build-plugins) and
[Build skills](https://learn.chatgpt.com/docs/build-skills).

## Repository-map API

The desktop UI uses the location-aware V2 server API:

| Method | Path                              | Purpose                                             |
| ------ | --------------------------------- | --------------------------------------------------- |
| `GET`  | `/api/repository-map`             | Return the current map, building it when necessary. |
| `POST` | `/api/repository-map/refresh`     | Rebuild the structural map.                         |
| `GET`  | `/api/repository-map/diagnostics` | Read live diagnostic state and recent entries.      |
| `POST` | `/api/repository-map/diagnostics` | Enable, disable, or clear diagnostics.              |

All endpoints accept the standard location query used by the V2 API. Generated Promise, Effect, and JavaScript SDK
clients expose the same operations through `repositoryMap`.

## Custom desktop branding

The custom icon source and generated PNG assets live in `packages/desktop/icons/customs`. The `customs` icon channel is
selected independently from the release channel so development behavior can remain enabled while custom branding is
packaged:

```bash
cd packages/desktop
OPENCODE_CHANNEL=dev OPENCODE_ICON_CHANNEL=customs bun run build
OPENCODE_CHANNEL=dev OPENCODE_ICON_CHANNEL=customs CSC_IDENTITY_AUTO_DISCOVERY=false \
  bunx electron-builder --mac --dir --config electron-builder.config.ts --arm64
```

The unpacked macOS application is created at `dist/mac-arm64/OpenCode Customs.app`. The bundle icon and runtime Dock icon
are packaged separately so Finder and the running application use the same branding.

## Current limitations

- Structural indexing is intentionally bounded; very large repositories may produce a partial map.
- Semantic depth depends on installed and healthy language servers.
- Concept routing requires enough prompt evidence to ground terms in the project. Short or highly generic prompts fall
  back to structural ranking.
- Learned vocabulary is lexical and graph-assisted, not an embedding database. It can miss relationships that are only
  implied at runtime or stored outside the repository.
- Durable memory uses query-term similarity rather than vector embeddings. It intentionally favors small, explainable
  recall and may omit a semantically related note that shares no project terminology with the new request.
- If the process dies after an external tool performs a side effect but before its result is committed, recovery marks
  that call interrupted instead of replaying it. The runtime cannot prove whether an arbitrary external system applied
  the operation; the user should inspect that system before retrying the call.
- Generated files, dependencies, tests, documentation, caches, and lockfiles are excluded from concept discovery to
  reduce noise; relevant behavior that exists only in those paths may require a targeted search.

## Practical validation

1. Open a real project and wait for the **Map** panel to report **Ready** or **Partial**.
2. Enable **Live diagnostics**.
3. Ask an exact identifier question and confirm that `lsp` or structural fallback entries appear before `model`.
4. Ask an abstract, multi-concept feature question without naming files.
5. Confirm that `concept` entries show vocabulary learned from that repository and that `context` is ready before the
   model request starts. A `rag` entry appears when source snippets or matching memory were available.
6. Edit, add, and delete a source file, then verify the Map metrics update without manually reindexing.
7. Reopen a long local-model task and confirm that an oversized request produces a `model` compaction warning before the
   provider starts processing it.
