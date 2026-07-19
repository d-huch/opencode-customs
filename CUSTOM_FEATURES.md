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
   and other noisy paths. A language-independent adaptive prefix lets inflected forms and likely spelling mistakes match
   repository text, but a concept is accepted only when the surrounding source provides enough structural evidence.
3. Reads nearby source context and discovers repository-specific identifiers and compound terms.
4. Expands that learned vocabulary through several evidence hops.
5. Ranks files that cover multiple requested concepts and selects existing implementations as analogues.
6. Expands the best evidence through observed import, reference, and call edges.
7. Produces a topology slice grouped by the directories and project areas that actually exist in the repository.

Short abstract requests with two meaningful terms, or one sufficiently distinctive term, can use concept expansion. The
router shows the observed repository spelling beside the original prompt form when they differ. It never rewrites the
user's request from a dictionary and never treats a fuzzy lexical match as proof by itself. Concept search, rendered
vocabulary, selected files, symbols, evidence hops, and LSP lookups all have explicit time and size budgets.

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

This is a local hybrid retrieval path. It always combines the incremental map, learned project vocabulary, literal
evidence, LSP symbols, and observed graph edges. When the configured LM Studio server already has an embedding model
loaded, it also maintains a location-scoped vector index under the OpenCode cache directory. The index accepts arbitrary
text source rather than a fixed language or framework list, rejects binary and oversized files, and updates changed or
removed paths from the existing file watcher.

The embedding layer is deliberately bounded. By default it retains at most 256 files and 1,024 chunks, embeds no more
than 12 chunks from one file, returns at most six unique file matches, and gives repository lookup three seconds before
falling back to graph and lexical ranking. Background indexing does not hold the search lock while LM Studio computes a
batch, so a partially built index remains queryable. OpenCode Customs never auto-loads an embedding model: if none is
already loaded, the entire vector path stays inactive and consumes no LM Studio model memory.

Retrieved source is treated as untrusted project data and remains a navigation aid; the agent must inspect current files
before editing. Embedding line anchors improve the bounded source windows but do not bypass the Research Evidence Loop.

## Durable project memory

Each project has a small local memory file under the OpenCode cache directory. It stores two kinds of entries:

- Successful query-to-file routes, so a related future task can start from previously useful project areas.
- Stable bullets from normalized compaction summaries: objective, important details, completed work, and verified relevant
  files. Transient **Active**, **Blocked**, and **Next Move** sections are not persisted as durable memory.

Recall is query-specific. Exact lexical and path matches remain authoritative; when the current embedding model matches
vectors stored with memory entries, semantic matches are merged without displacing lexical results. At most eight
matching memory records contribute file ranking, while at most four distinct notes and 1,200 note characters can be
rendered. The store keeps no more than 96 entries per project and expires entries after 90 days. Memory never replaces
source verification and does not copy the full conversation back into the model request.

Embedding RAG and semantic memory can be tuned in `opencode.json` or `opencode.jsonc`:

```jsonc
{
  "rag": {
    "embeddings": true,
    "memory": true,
    // Optional. Otherwise the first already-loaded LM Studio embedding model is used.
    "model": "your-embedding-model-id",
    "max_files": 256,
    "max_chunks": 1024,
    "top_k": 6,
  },
}
```

Set `embeddings` to `false` to keep only graph/LSP/lexical RAG, or `memory` to `false` to keep durable memory lexical.

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

| Stage       | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `prompt`    | The router received the user request.                                     |
| `map`       | Structural map state and availability.                                    |
| `concept`   | Concept grounding, learned vocabulary, evidence hops, and search timing.  |
| `lsp`       | Semantic lookup start, cache use, completion, timeout, or failure.        |
| `embedding` | Loaded model, indexed file/chunk counts, and bounded vector matches.      |
| `context`   | Number of selected files and topology areas.                              |
| `rag`       | Bounded snippet count, retrieved characters, and matching memory records. |
| `model`     | Provider request start, finish, or failure.                               |
| `router`    | An unexpected routing failure handled by the fallback path.               |

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
than starting another Metal/MLX allocation in parallel. Interactive chat remains available at critical pressure with
the minimum safe context budget because macOS raw free-memory counters do not include all reclaimable memory. Background
embedding and indexing requests are pressure-gated instead, so they cannot compete with the user's provider turn.
Local-model crash cooldowns still reject new inference briefly, and cloud providers are not throttled by this queue.

Failures that happen after an asynchronous prompt has been accepted are persisted on the corresponding assistant turn
and return the session to `idle`. The desktop therefore shows the error in the timeline instead of leaving a blank
assistant record that looks like an ignored message.

The latest active user request is also bound directly to the provider turn after compaction. When the original message
has left the fitted projection, only runtime-authored continuation records for compaction, research evidence, or
verification may supply that binding; arbitrary synthetic text is ignored. The exact active request is reused for RAG,
model routing, progress narration, and the final answer, preventing English summaries, memories, or tool output from
changing the response language or restarting an older objective.

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
the current phase: `preparing`, `streaming`, `settling_tools`, `verifying`, `repairing`, `verified`, or `continuing`.
Completion, interruption, and failure are terminal states with timestamps and an optional error.

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

### Local Agent Runtime: capability-based multi-model routing

The Capability Router evaluates models available in LM Studio and assigns them to four independent roles:
`embedding`, `utility`, `coding`, and `vision`. It does not inspect model names, business vocabulary,
programming languages, frameworks, or project layouts. Inputs are limited to discovered model type and capabilities,
active or supported context, reported model size, the structured request shape, the preferred session model, and the
Resource Governor pressure state.

Request complexity is derived from bounded structural signals: text size, attachment count, image count, and available
tool count. Under memory pressure, utility scoring favors smaller loaded candidates. Coding scoring favors
tool capability, reasoning controls, sufficient context, and the model already selected for the session. Vision is a
required role only when the current request includes image input. An unavailable required role is reported explicitly
instead of silently selecting an incompatible model.

The composer selection is authoritative for the primary coding role when LM Studio reports that candidate as compatible
and eligible under the current resource state. The switcher resolves both the OpenCode catalog identifier and the native
LM Studio instance identifier before routing, so an alias mismatch cannot discard the preference. Context capacity still
ranks utility and embedding roles, but a small utility model with a larger context window cannot silently take
over an ordinary tool-bearing coding turn. The request shape also reflects the tools actually exposed to the agent rather
than only per-message tool overrides.

Every provider-turn route is stored in the durable execution checkpoint with its generation. The recorded plan contains
the selected model for each role, score, context, size, capability snapshot, resource pressure, and stable reason codes.
Checkpoint fencing prevents an obsolete process from replacing a newer generation's decision. The desktop **Runtime**
panel localizes those reason codes and displays the selected roles, model names, scores, context limits, reported model
sizes, candidate count, and current Resource Governor state. The latest route is also available through the JavaScript
SDK as `provider.runtime.router()` at `GET /provider/runtime/router`.

The embedding role is used immediately by the bounded RAG index when a compatible model is already loaded. Embedding
indexing remains background-only and never auto-loads a model. Coding and vision provider turns can also consider
downloaded but unloaded candidates while host pressure is healthy or pressured; critical pressure limits the route to
models that are already loaded.

The utility role is applied only to explicit background turns such as automatic history compaction. The selected coding
model remains authoritative for interactive analysis and tool execution even when a smaller utility model reports a
larger context window. A utility handoff preserves the active coding instance, preventing compaction and coding turns
from repeatedly unloading and reloading each other.

Before a provider turn, the Local Agent Runtime serializes model handoffs per LM Studio server. A handoff first loads the
selected model with the governor's conservative context budget and probes the native model list again. The session is
given the new instance identifier only after LM Studio reports that exact instance as loaded. Interactive provider turns
are fail-closed: when the selected coding or vision model is incompatible, cannot fit in memory, fails to load, or fails
its readiness probe, the request stops with a visible error. It is never handed to another model automatically. A
previous instance may remain loaded as rollback state, but it does not receive the failed request.

OpenCode tracks model-request ownership in the Resource Governor. It never unloads an instance that another local
request is using, and it never automatically unloads an instance that was loaded outside OpenCode. Once a replacement
passes its readiness check, an idle previous instance created by this runtime may be unloaded through LM Studio's native
API. Cleanup failure is diagnostic and does not invalidate the already-ready replacement.

The activation result is added to the generation-fenced model-route checkpoint: active and previous model identifiers,
instance identifiers, role, attempt count, rollback state, status, and stable reason codes. Legacy failover fields remain
decodable for old checkpoints but are always `false` for new executions. The desktop
**Runtime** panel refreshes this state while open and shows the latest handoff beside the role recommendations. A model
process crash during inference remains a failed provider turn; it is not silently retried forever.

### Local Agent Runtime: screenshot vision pipeline

Screenshot input is normalized before model execution. Images chosen from disk remain file references, while clipboard
images are decoded once and written as durable artifacts under the standard OpenCode data directory. The persisted
session history, execution checkpoint, and JSONL diagnostics contain only the local `file://` reference and bounded
metadata—not an expanding base64 copy. A base64 data URL is materialized transiently only at the provider boundary when
an OpenAI-compatible LM Studio endpoint requires it.

The image pipeline reads the configured attachment limits and current Resource Governor state. Photon decodes each
image, preserves it when it already fits, and otherwise reduces dimensions and encoding size with bounded quality and
scale steps. Pressured and critical hosts receive progressively smaller pixel and byte budgets. A sidecar records the
original and prepared dimensions, byte counts, compression decision, estimated image tokens, MIME type, and stable
reason codes. Unsupported or undecodable input fails before a text-only provider turn can silently ignore it.

LM Studio capability probing recognizes native VLM model types, explicit vision flags, and structured image-input
metadata. A screenshot makes `vision` a required route. The Capability Router selects only a compatible candidate and
the model switcher performs the normal readiness check. If that model cannot be activated, the turn reports the failure
without sending the image to the coding, utility, or another vision model. Successful, failed, and rollback states are
generation-fenced in the execution checkpoint.

The repository router and bounded RAG run in the same provider turn as screenshot analysis. This allows the model to
connect visible UI evidence to observed project files and return a source-grounded recommendation without placing whole
files or duplicate image payloads in history. The desktop **Runtime** panel shows the selected vision model, preparation
status, image count, dimensions, original and prepared size, estimated and actual request tokens, selection reasons, and
rollback state.

HTTP integration tests use isolated loopback listeners with reserved concrete ports. This avoids the platform-specific
`EADDRINUSE` behavior previously seen when several test layers independently interpreted port `0`, while dedicated
server tests still cover OpenCode's preferred-port and explicit ephemeral-port semantics.

Tool-loop protection spans recent assistant messages rather than only one provider response. Calls are compared with a
stable argument fingerprint, and repaired invalid calls are grouped by their intended tool even when validation error
text changes. A second malformed call for the same intended tool is settled as an error and stops the provider turn,
preventing schema failures from growing context until a local model or the host runs out of memory. Deterministic repair
accepts only complete object arguments and lossless syntax fixes such as fenced JSON, trailing commas, or literal control
characters; it deliberately refuses to guess the missing end of a truncated search pattern or path.

### Verification loop and bounded repair

The desktop agent now treats verification as an execution phase instead of relying only on a sentence in the system
prompt. When a turn changes project files, completion is gated until the agent calls the `verification` tool or the
bounded attempt budget is exhausted. Ordinary questions without repository routing or repository tool activity are not
gated; read-only repository investigations use the separate evidence loop described below.

The verifier is stack-independent. The model selects the smallest checks from repository instructions, existing focused
test patterns, or an optional project registry. Commands run through the existing Shell tool, so normal permissions,
timeouts, cancellation, output truncation, and external-directory protection still apply. The verifier also requests
diagnostics from active language servers for at most 20 supplied changed files. It does not contain Laravel, Node,
Unity, C#, or business-domain keyword tables.

A failed check moves the durable checkpoint to `repairing` and returns compact evidence to the model. The agent repairs
the relevant cause and reruns verification. The default budget is one initial verification plus two repair attempts;
after that, the agent must report the failed or unavailable checks instead of claiming success. A successful result is
accepted only when it covers every file changed in the current real user turn and no later assistant turn edited files.
This prevents a stale successful test result from validating a subsequent repair.

The UI exposes **Verifying changes**, **Repairing failed checks**, and **Verification passed** session states. Completed
verification tool output remains in session history as the evidence report, including command, exit status, changed
files, LSP coverage, and whether no executable check was available.

Project-specific checks are optional and declarative:

```jsonc
{
  "verification": {
    "auto": true,
    "evidence": true,
    "repair_attempts": 2,
    "evidence_attempts": 2,
    "checks": [
      {
        "name": "focused project check",
        "command": "your repository-native command",
        "when": "Describe which changed files or subsystem make this check relevant",
        "timeout": 120000,
      },
    ],
  },
}
```

The configured list is guidance, not a hard-coded command matrix. The agent selects only relevant entries and may use a
narrower repository-native command when the project already documents one.

### Research evidence loop

Read-only repository analysis now has its own bounded completion gate. It activates when the repository router provides
query-grounded project context or when the current real user turn uses repository discovery and read tools. Generic
fallback landmarks do not activate the gate. Activation depends on
structural runtime evidence, not on business words, programming languages, frameworks, or translated keyword tables.

Before the final answer, the agent submits an `evidence` report. A completed finding is accepted only when every cited
path was successfully read during the current user turn. A search that cannot establish the requested relationship can
submit a blocked report with concrete unresolved points. This allows honest negative results without converting a guess
into a verified fact. Evidence becomes stale when additional repository research runs after submission, so the agent
must submit it again before completion.

Repository guidance requires the agent to inspect bounded router evidence before launching another search, forbids
inventing paths or relationships from framework conventions, and allows at most one targeted lookup for a specifically
missing relationship. This keeps abstract investigations on the strongest observed implementation path instead of
restarting equivalent grep, glob, and shell discovery loops.

The default budget is the initial investigation plus two bounded follow-ups. Continuations repeat the exact latest
active user text instead of an English control message. This keeps local models anchored to both the current objective
and the user's language after automatic compaction. Historical `Objective` and `Next Move` sections remain background
context and cannot replace the current request.

The evidence loop complements change verification rather than replacing it. Turns that modify files are checked by the
`verification` tool; read-only investigations are grounded by the `evidence` tool. Simple conversation without routed
repository context remains ungated.

### Freshness and external fact verification

General conversation is allowed, but concrete external facts are no longer trusted solely because the selected model
can produce a fluent answer. When no project context grounds the request, the same interactive model selected in the
composer performs a short epistemic classification. The classifier distinguishes requests answerable from supplied
context, calculation, transformation, or creative work from requests whose exact answer depends on current or
potentially post-training external information. The policy is domain-, language-, framework-, and product-neutral; it
does not use a dictionary of brand names or translated trigger words.

The decision is persisted on the genuine user message so tool continuation, compaction, and crash recovery do not
classify the same request repeatedly. A turn that requires fresh evidence is temporarily restricted to the `websearch`
tool with required tool choice. After a successful search, the normal tool set is restored and the answer must prefer
primary or authoritative sources, link them directly, and disclose unverified claims. If search is unavailable, denied,
or fails, the gate permits no automatic retry and instructs the model to report that verification is unavailable rather
than fill exact facts from memory. The classifier never switches to a utility model or an automatic fallback model.

The per-session JSONL log records `freshness.routed` with the selected interactive model, decision, reason, and whether
the conservative failure policy was used. The visible web-search tool call provides the corresponding source evidence
inside the session timeline.

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

### RAG and memory viewer

The desktop **Map** panel opens a dedicated **RAG & Memory** viewer for the current project location. The viewer queries
the real embedding index and durable repository-memory stores rather than maintaining a second UI-only database. Search
is performed server-side and each request returns at most 200 matching records. Embedding vectors are never serialized
to the desktop UI; RAG rows expose source paths, line anchors, hashes, timestamps, model metadata, and vector dimensions,
while memory rows expose their verified text, terms, source files, kind, timestamp, and embedding metadata.

Individual records can be deleted after confirmation. Each store can also be cleared independently after a second
confirmation that includes the current record count. Every operation remains location-scoped, so it affects only the
project currently selected in the desktop client. Clearing the RAG store does not silently start new background work;
use **Reindex** in the Map panel when a fresh semantic index is wanted.

The desktop UI uses the location-aware V2 server API:

| Method   | Path                                         | Purpose                                             |
| -------- | -------------------------------------------- | --------------------------------------------------- |
| `GET`    | `/api/repository-map`                        | Return the current map, building it when necessary. |
| `POST`   | `/api/repository-map/refresh`                | Rebuild the structural map.                         |
| `GET`    | `/api/repository-map/diagnostics`            | Read live diagnostic state and recent entries.      |
| `POST`   | `/api/repository-map/diagnostics`            | Enable, disable, or clear diagnostics.              |
| `GET`    | `/api/repository-map/knowledge`              | Search bounded RAG and memory metadata.             |
| `DELETE` | `/api/repository-map/knowledge/{scope}/{id}` | Delete one `rag` or `memory` record.                |
| `DELETE` | `/api/repository-map/knowledge/{scope}`      | Clear one location-scoped knowledge store.          |

All endpoints accept the standard location query used by the V2 API. Generated Promise, Effect, and JavaScript SDK
clients expose the same operations through `repositoryMap`.

## Per-session diagnostic logs

OpenCode Customs writes one append-only JSONL diagnostic file per active session under
`~/.local/share/opencode/log/sessions/<session-id>.jsonl` by default. Each line is an independently parseable event with
an ISO timestamp, session ID, event type, optional message and execution IDs, and bounded structured data. Events cover
the original user prompt, selected and requested models, provider requests, tool calls and results, compaction,
execution completion or failure, and checkpoint recovery. Tool output and other large strings are capped so diagnostics
cannot reproduce the unbounded-memory problem they are intended to investigate. Provider credentials and request
headers are never recorded.

The desktop **Runtime** menu includes **Export logs** and **Clear all logs** actions. Export uses the existing debug ZIP
and includes per-session JSONL files alongside desktop, server, network, and crash diagnostics. Clear requires explicit
confirmation, truncates every collected log file, and lets active processes continue writing fresh events without a
restart. New events can therefore appear immediately after clearing when a session is still running.

For a local desktop session, the **Context** tab shows the resolved JSONL path and a **Show session log** button. The
button refreshes the file state before revealing it in Finder or the platform file manager, so a cleared or not-yet-created
log produces an explicit message instead of a silent failure. Remote server sessions do not expose a host filesystem
link in the desktop UI.

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
- Vector recall requires an embedding model that is already loaded in the configured LM Studio server. Without one,
  routing remains lexical, graph-assisted, and LSP-aware. OpenCode Customs will not load an additional model automatically.
- Embedding coverage is intentionally bounded and incremental. A file outside the retained index can still be found by
  the structural, concept, literal, or LSP paths, but it will not contribute a vector match until indexed.
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
5. With an LM Studio embedding model already loaded, confirm that an `embedding` entry reports bounded matches and index
   counts. Unload that model and confirm the same request still completes through the graph/lexical fallback.
6. Confirm that `concept` entries show vocabulary learned from that repository and that `context` is ready before the
   model request starts. A `rag` entry appears when source snippets or matching memory were available.
7. Edit, add, and delete a source file, then verify the Map metrics update without manually reindexing.
8. Reopen a long local-model task and confirm that an oversized request produces a `model` compaction warning before the
   provider starts processing it.
