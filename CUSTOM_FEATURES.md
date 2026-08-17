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

## Cross-session and cross-project Memory V2

OpenCode keeps bounded managed-memory files under its cache directory. Memory is shared deliberately through five
explicit scopes:

- `global` stores identity, language, and general preferences.
- `cross-project` stores universal working rules that are valid independently of one repository.
- `project` stores facts and decisions observed in one repository.
- `session` stores temporary work for one session and expires automatically.
- `pattern` stores a verified reusable solution that may be proposed only as an analogy.

Project entries are also copied into a shared project catalogue. Opening an older project lazily migrates its existing
location-scoped memory into that catalogue. In the originating repository, a project entry remains a fact. In any other
repository it is classified and rendered as an analogy, receives a ranking penalty, and cannot contribute source-file
paths to the current repository prompt. A pattern is always an analogy. This preserves useful cross-project experience
without turning one repository's implementation into false evidence about another.

Each record follows the managed lifecycle `candidate -> verified -> durable`, or transitions to `rejected`, `expired`,
or `archived`.
Automatic classifier admissions below the verification threshold remain candidates and are excluded from recall.
Verified entries become durable after repeated successful use with sufficient confidence, or can be promoted manually.
Rejected and expired entries remain visible for a bounded retention period so incorrect admissions can be debugged and
restored instead of disappearing silently.

Every stored record carries its source, origin project, scope, confidence, creation and verification timestamps, TTL,
fact-or-analogy classification, conflict list, last recall reason, and a bounded usage history. The store contains three
kinds of entries:

- Successful query-to-file routes, so a related future task can start from previously useful project areas.
- Stable bullets from normalized compaction summaries: objective, important details, completed work, and verified relevant
  files. Transient **Active**, **Blocked**, and **Next Move** sections are not persisted as durable memory.
- High-confidence user-provided identity details, preferences, standing constraints, decisions, and deliberately taught
  facts selected by the same language-neutral routing pass. The user does not need to write a special “remember”
  command. The classifier receives the immediately preceding assistant message as bounded dialogue context, allowing it
  to understand a terse direct answer without storing arbitrary short replies. Tasks, questions, requests to inspect or
  change code, guesses, secrets, credentials, tool output, assistant inferences, and transient work state are rejected.
  Admission shares the bounded routing pass only when a distinct utility model is explicitly configured. Otherwise it
  does not launch the interactive LM Studio model a second time before the real answer. Classifier failure is fail-open
  to the pinned primary turn's normal tool selection and never activates a hidden fallback model.

Exact lexical and path matches remain authoritative; when the current embedding model matches vectors stored with memory
entries, semantic matches are merged without displacing lexical results. Unrelated recent memories are not injected as a
fallback: every recalled record must match the current query lexically or semantically. At most eight memory records
contribute file ranking, while at most four distinct notes and 1,200 note characters can be rendered. The active bounded
store keeps no more than 96 unpinned entries. Ordinary records stop participating in recall after 90 days without
evidence but remain available for an explicit consolidation preview instead of disappearing silently. Session records
expire after one day by default. Pinned records survive age pruning and cannot be silently replaced by the automatic classifier.
Automatic conversation records include a category, scope, stable semantic topic, confidence, correction flag,
classifier source, source message, origin project, lifecycle, and classification. An explicit high-confidence
correction reuses its semantic topic and replaces an unpinned value. A lower-confidence or pinned-value correction
becomes a visible conflict instead of silently choosing one. Obvious private keys, bearer-like tokens, and credentials
embedded in URLs are rejected again at the storage boundary. Memory never replaces source verification and does not copy
the full conversation back into the model request.

Every successful recall updates bounded provenance metadata: the matching request, timestamp, consuming project,
fact-or-analogy classification, count, and whether the match was lexical or semantic. Maintenance runs opportunistically
during writes, inspection, and recall, transitioning explicitly expired records and removing old lifecycle tombstones
without a resident background worker.

Memory consolidation is an explicit two-phase operation. A deterministic preview identifies equivalent records within
the same memory boundary, conflicts with a safe provenance winner, stale fact confidence, repeatedly confirmed reusable
rules, and old unused records. Ambiguous conflicts remain unresolved. Applying the preview requires its exact
fingerprint and generation time; if any memory changed, the operation fails stale and returns a fresh preview. Duplicate
records are merged, stale facts lose confidence, independently reconfirmed cross-project rules and patterns gain
confidence, and unused records move to `archived`. Pinned records are never modified, archived, or removed by
consolidation. The desktop always shows the complete preview before enabling the apply action.

Embedding RAG and semantic memory can be tuned in `opencode.json` or `opencode.jsonc`:

```jsonc
{
  "rag": {
    "embeddings": true,
    "memory": true,
    // automatic (default), explicit, or off
    "memory_admission": "automatic",
    // Optional. Otherwise the first already-loaded LM Studio embedding model is used.
    "model": "your-embedding-model-id",
    "max_files": 256,
    "max_chunks": 1024,
    "top_k": 6,
  },
}
```

Set `embeddings` to `false` to keep only graph/LSP/lexical RAG, or `memory` to `false` to keep durable memory lexical.
Set `memory_admission` to `explicit` to require a remember request, or `off` to stop adding new conversation memories
without deleting existing records.

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

The global desktop event stream uses a typed heartbeat that refreshes the client watchdog without entering normal UI
reducers. If the stream still reconnects, the desktop force-reloads pinned and non-idle sessions from persisted history.
This reconciles assistant text and terminal state that may have been committed while the live subscription was between
connections, without polling every inactive session.

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
execution state: `preparing`, `streaming`, `settling_tools`, `verifying`, `repairing`, `verified`, `reviewing`,
`reviewed`, or `continuing`.
Completion, interruption, and failure are terminal states with timestamps and an optional error. The checkpoint also
stores the higher-level turn phase: `classify`, `recall`, `execute`, `verify`, `critic`, `complete`, or `failed`.

The same generation-fenced checkpoint owns the per-request execution counters. A request may use at most 12 main
provider turns, 32 tool calls, and 12 context compactions. Classifier, repository RAG, memory recall, and memory admission
each have an independent one-call budget; verification has a three-turn budget and the separate critic has a one-attempt
budget. Compaction is deliberately not limited to one pass: long local-model requests may compact repeatedly, but they
still terminate at the durable total budget.
Counter increments are atomic, survive crash recovery, and reject writes from stale generations.

### Local Agent Runtime: unified Request Pipeline Scheduler

Every genuine user request follows one explicit, durable pipeline:

1. **Prompt admission** binds the promoted user message to the current generation.
2. **Classification** determines conversation-only, repository, or external scope and may propose durable memory.
3. **Repository recall** performs at most one bounded retrieval only for repository-scoped work.
4. **Memory recall** retrieves query-relevant durable facts with a bounded deadline.
5. **Model readiness** resolves, activates, and pins the interactive model.
6. **Context compilation** assembles the permitted tools, cached recall, system context, and fitted history.
7. **Execution** performs the provider turn.
8. **Verification** runs only the repository-native checks required by policy.
9. **Memory admission** persists an eligible high-confidence fact once the answer has completed.
10. **Completion** closes the request boundary.

Each phase has `pending`, `running`, `completed`, `skipped`, `timed_out`, `cancelled`, or `failed` state in the
generation-fenced SQLite checkpoint. An exact repeated claim joins the existing preparation instead of duplicating it.
When a newer user message becomes active, its claim aborts the older preparation and stale generation writes are
rejected. Optional memory recall has a 1.5-second deadline and degrades to an empty result without delaying the
interactive turn.

Classifier traffic is isolated from the main provider-response queue. It cannot consume a queued coding response or
silently become the interactive assistant. Conversation-only and external requests skip repository RAG. Git/session
change summarization starts only for repository-scoped work. Classification, repository recall, and memory recall are
stored and reused across tool continuations, compactions, and crash recovery instead of being recomputed on every
provider turn.

LM Studio classification requires an explicitly configured utility model whose identity differs from the pinned
interactive model. Without one, the classification phase is skipped and the primary provider turn selects evidence and
tools directly. This prevents a simple question from paying for two sequential passes through the same large model.
When configured, the optional classifier has a hard five-second deadline; failure or timeout continues on the pinned
primary model without changing models or inventing a routing decision.

The scheduler overlaps independent work without changing its decisions or budgets. Durable memory recall starts while
image preparation and model activation continue; repository routing waits for classification because its necessity
depends on that result. Repository internals still parallelize map loading, learned-concept discovery, and embedding
retrieval. Successful exact classifier decisions use a two-minute, 64-entry cache keyed by model, request, dialogue
context, admission policy, and provider options; conservative or failed classifications are never cached. Memory-use
accounting and compaction-memory persistence remain non-critical background work, while automatic conversation-memory
admission is completed durably before the request boundary closes.

### Local Agent Runtime: deterministic Context Compiler

Every provider turn passes through one deterministic Context Compiler after routing and recall. The compiler separates
the stable provider/agent prefix, alphabetically serialized tool schemas, active user prompt, bounded recent dialogue,
latest checkpoint summary, relevant durable memory, repository evidence, only the current provider turn's tool
results, and a request-specific dynamic system tail. Language binding, freshness, evidence, structured-output rules,
user overrides, and the date needed for external freshness checks live in that tail instead of invalidating the
cacheable prefix. Historical
tool calls and results are structurally removed from dialogue replay, so an old tool cannot become required or be sent
again merely because it appeared earlier in the session. Transient Objective, Active, Blocked, and Next Move sections
are removed from checkpoint summaries before they can steer a newer user request.

Each source has an independent token budget and provenance label. Exact duplicate system fragments are removed, tools
are selected within their budget and then always serialized by name, and the complete outgoing request is estimated
from one canonical serialization with conservative provider headroom. The stable environment no longer contains a
changing timestamp. If the aggregate still exceeds the governed model input limit, the compiler sheds old dialogue,
repository evidence, memory, checkpoint state, and optional tools in a stable order while preserving the active
request and required tool schemas.

The per-session JSONL log records a bounded `context.compiled` event. Turn Inspector renders that same compiler result:
total tokens, safe limit, source budgets, included provenance, deduplication, truncation, the final tool list, cacheable
prefix tokens, dynamic-tail tokens, and a privacy-safe prefix fingerprint.
Preview text is bounded and removes credentials, authorization values, API keys, access tokens, passwords, secrets,
and base64 payloads. The working prompt sent to the provider is not redacted; only the diagnostic preview is.

Every completed provider step stores uncached input and prompt-cache read/write tokens in the existing
`execution.finished` record. Turn Inspector derives total prompt tokens and reuse percentage from those persisted
values, then compares prefix fingerprints across consecutive turns and across compaction inside one request. It
therefore reports both the cache result returned by LM Studio and whether OpenCode preserved the cacheable prefix
before the request reached the provider.

LM Studio capability probes also reuse their existing short-lived cache before model activation. Concurrent forced
refreshes share one one-second refresh window, while post-load verification still performs the required check for the
newly loaded instance. Native LM Studio discovery is authoritative; the OpenAI-compatible model-list endpoint is queried
only when native discovery fails. These changes remove repeated local I/O and provider round trips while
preserving checkpoint fencing, visible activation failures, configured compaction allowances, and the rule that an
interactive request is never redirected to a hidden fallback model.

Chat sessions use LM Studio's provider-side response chain only while the chain fits the configured per-model chat
context. The budget includes uncached input, output, reasoning, prompt-cache reads, and prompt-cache writes. At the
boundary OpenCode creates one durable compact summary, starts a fresh provider chain, and sends that summary with a
bounded recent dialogue instead of replaying the expired chain. Changing the chat context limit invalidates the stored
response identifier immediately, so the next turn is rebased onto a fresh provider chain.

The compatible model selected for the interactive request is pinned in the checkpoint before execution. All provider
continuations for that request use the same provider, catalog model, and native LM Studio instance. If activation or
inference fails, the turn fails visibly; no smaller or utility model receives the request as a hidden fallback.

When a queued or steered user input is promoted while a drain is already active, the checkpoint starts a new request
boundary atomically. Phase, cached retrievals, pinned model, route, assistant identity, and every per-request counter are
reset together. Earlier execution cannot write into the new boundary because generation and request-message fencing are
checked on every update.

`GET /provider/runtime/turn` returns the latest turn phase, pinned model, generation, recovery count, and all consumed
budgets. The desktop **Runtime** panel polls this endpoint and presents the same information without deriving state from
compactable transcript text.

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

Interactive requests apply a provider-level minimum installed-size policy before ranking primary candidates. The default
is 12 GiB and can be changed with `provider.lmstudio.primary_min_size_gb`. The threshold is capability metadata, not a
model-name allowlist: compact models remain eligible for explicit utility work but cannot silently become the primary
assistant merely because they are loaded or advertise a larger context window. If an explicitly selected downloaded model
is missing from an older LM Studio catalog while unloaded, the guarded switcher may load and probe only that candidate;
known undersized candidates never cross the gate. The switcher resolves both the OpenCode catalog identifier and the
native LM Studio instance identifier before routing, so an alias mismatch cannot discard the preference. The request shape
also reflects the tools actually exposed to the agent rather than only per-message tool overrides.

Every provider-turn route is stored in the durable execution checkpoint with its generation. The recorded plan contains
the selected model for each role, score, context, size, capability snapshot, resource pressure, and stable reason codes.
Checkpoint fencing prevents an obsolete process from replacing a newer generation's decision. The desktop **Runtime**
panel localizes those reason codes and displays the selected roles, model names, scores, context limits, reported model
sizes, candidate count, and current Resource Governor state. The latest route is also available through the JavaScript
SDK as `provider.runtime.router()` at `GET /provider/runtime/router`.

LM Studio capability discovery is coalesced into one shared snapshot for 30 seconds. Parallel consumers such as the
Runtime panel, provider catalog, Resource Governor, embedding discovery, and model router reuse the same in-flight
request instead of independently polling both LM Studio model-list APIs. An OpenCode-managed model load or unload
invalidates the matching snapshot immediately, and readiness verification after a load remains explicitly uncached.

The **Runtime** panel lists every model returned by LM Studio, including models that are available but not currently
loaded. **Automatically switch models** is enabled by default and can be disabled for the entire LM Studio provider.
When disabled, foreground requests remain on the model explicitly selected in the chat and the runtime never loads,
unloads, or substitutes another model. A read-only capability probe still validates that the selected instance is loaded,
meets the configured primary-size policy, and supports the tools or vision required by the turn. An incompatible manual
selection fails visibly instead of bypassing the primary guard or falling back to a utility model. Dedicated embedding
retrieval remains independent because it never becomes the interactive assistant.

**Allow automatic routing** can also be disabled per model while provider-wide routing is enabled. A blocked model is
excluded from automatic `embedding`, `utility`, and `vision` role selection and from automatic embedding discovery.
Blocking does not unload the model, interrupt an active request, hide it from the composer, or replace an explicitly
selected coding model. This keeps routing policy visible and deterministic while preserving manual control.

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

Each loaded model in the desktop **Runtime** panel has a **Do not adjust context automatically** switch. When enabled,
OpenCode omits `context_length` from future LM Studio load requests for that model and accepts the context reported by
the newly loaded instance. The setting is stored per native model identifier in OpenCode configuration, survives app
restarts, and does not disable prompt fitting or the Resource Governor's protection against oversized requests.

Each LM Studio model also has an independent **Chat context** setting in model settings and the **Runtime** panel. It
applies only to sessions opened from the dedicated **Chat** workspace; project and Build sessions continue to use the
model's normal context setting. Ordinary chats default to 32,768 tokens and can be configured from 8,192 up to the
model's reported maximum. The cap is reapplied after checkpoint recovery and is passed to future OpenCode-managed model
loads, so a catalog maximum such as 91,648 is not used automatically for a small conversational turn.

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

The default budget is the initial investigation plus two bounded follow-ups. The attempt counter is stored in the
durable execution checkpoint rather than inferred from compactable transcript text, so crash recovery or any number of
bounded compactions cannot reset the evidence loop. Continuations repeat the exact latest active user text instead of
an English control message. This keeps local models anchored to both the current objective and the user's language after
automatic compaction. Historical `Objective` and `Next Move` sections remain background context and cannot replace the
current request.

Request fitting treats only tools required by the current route as mandatory. Historical tool calls do not keep old
schemas in the next provider request. If a model calls a tool that was not advertised for that turn, execution fails
closed with the available-tool list; the missing name is never rewritten into an endlessly repeatable `invalid` call.

The evidence loop complements change verification rather than replacing it. Turns that modify files are checked by the
`verification` tool; read-only investigations are grounded by the `evidence` tool. Simple conversation without routed
repository context remains ungated.

### Freshness and external fact verification

General conversation is allowed, but concrete external facts are no longer trusted solely because the selected model
can produce a fluent answer. When an explicit distinct utility model is configured, it performs a bounded scope
classification before repository RAG. Otherwise the classification phase is skipped and the pinned primary turn chooses
the relevant evidence and tools itself. It routes the latest genuine request to conversation-only work, repository work,
or external research. Up to three recent genuine user requests are supplied only to resolve repeated terse follow-ups
and mode changes, so “then search” can still inherit the original external subject without reviving a stale project task.
The policy is domain-, language-, framework-, and product-neutral; it does not use a dictionary of brand names or
translated trigger words. Lexical similarity to a project symbol cannot activate repository RAG by itself.

The decision is persisted on the genuine user message so tool continuation, compaction, and crash recovery do not
classify the same request repeatedly. Conversation-only turns receive no workspace or web tools. Repository turns may
use RAG and workspace tools. External turns are restricted to `websearch` until evidence exists and remain restricted to
`websearch` and `webfetch` afterward, so an external comparison cannot drift into unrelated repository searches. If
search is unavailable, denied, or fails, the gate exposes no tools, permits no automatic retry, and instructs the model
to report that verification is unavailable rather than fill exact facts from memory. The classifier uses only an
explicitly configured distinct utility model and never switches the primary response model or activates an automatic
fallback. The built-in web-search tool is available to LM Studio sessions in both Build and Planning modes; changing the
agent mode does not change the request scope.

External search is offered to the model without forcing provider-level `tool_choice=required`. This avoids incompatible
LM Studio templates emitting raw JSON or silently dropping the call. An invalid or unparseable classifier response is
fail-local: it cannot activate hidden web or workspace tools, and the bounded provider turn finishes without an automatic
search loop.

The response-language contract remains a system instruction. It is not appended to user content, preventing a local
model from quoting an internal language reminder as though the user had written it.

A provider turn that reports a tool-call finish reason without emitting an executable tool call is terminated as an
error immediately. This prevents empty native-tool responses from entering evidence, compaction, or invalid-tool loops.

The per-session JSONL log records `freshness.routed` with the selected interactive model, scope, reason, and whether the
conservative failure policy was used. The visible web-search tool call provides the corresponding source evidence inside
the session timeline.

Custom providers do not always publish model limits. OpenCode Customs treats missing capacity as unknown rather than
unlimited. A custom model without catalog or user-supplied limits receives a conservative 4,096-token context budget and
a 512-token output budget. Explicit positive model limits still take precedence.

Configured LM Studio chat models without an explicit output limit reserve one quarter of their effective context, capped
at 4,096 tokens, so reasoning cannot silently consume the entire visible-answer budget. Native LM Studio reasoning
options such as `on` and `off` replace incompatible generic effort presets. A length-limited turn that produces only
hidden reasoning now ends with a visible session error, and an exact retry does not resend the orphaned failed request.

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

### Second-generation RAG and memory viewer

The desktop **Map** panel opens a dedicated **RAG & Memory** viewer for the current project location. The viewer queries
the real embedding index and durable repository-memory stores rather than maintaining a second UI-only database. Search
is performed server-side and each request returns at most 200 matching records. Embedding vectors are never serialized
to the desktop UI; RAG rows expose source paths, line anchors, hashes, timestamps, model metadata, and vector dimensions,
while memory rows expose their text, terms, source files, kind, admission category, scope, origin project, semantic
topic, confidence, source message, lifecycle state, fact-or-analogy classification, conflicts, TTL, creation and
verification timestamps, recall provenance, bounded usage history, and embedding metadata.

Repository retrieval is a deterministic multi-stage pipeline: exact identifier search, project-learned lexical and
concept search, embedding recall, LSP/symbol lookup, graph expansion, reranking, directory-diverse selection, and bounded
source extraction. It can also find existing analogous implementations. Every selected file records its score,
confidence, stage-specific reasons, and an explicit `fact`, `assumption`, or `analogy` classification. Diversity penalties
prevent one directory or repository area from consuming the entire context budget.

The **Retrieval** tab exposes the durable history and aggregate Recall@5 and Recall@10. A user can mark an entry as
actually used or irrelevant; future similar queries receive a positive or negative path hint. Feedback changes ranking
only after ordinary repository evidence has produced candidates, so it cannot invent a file or replace current source
inspection. Clearing retrieval history removes these learned ranking hints without deleting the structural map,
embedding index, or conversation memory.

Conversation memories can be verified, promoted to durable, rejected, restored, pinned, unpinned, given a 30-day
expiration, restored to no expiration, or selected to resolve a recorded conflict. Individual records can be deleted
after confirmation. Each store can also be cleared independently after a second confirmation that includes the current
record count. RAG remains location-scoped. Global and cross-project memory are intentionally shared, while project
memory from other locations is visible and recallable only through the analogy boundary described above. Clearing the
RAG store does not silently start new background work; use **Reindex** in the Map panel when a fresh semantic index is
wanted.

The **Memory** tab also provides **Preview consolidation**. The preview lists every proposed merge, conflict decision,
confidence change, archival action, pinned record count, and unresolved conflict before any mutation occurs. Applying a
stale preview is rejected rather than replayed against newer memory.

The desktop UI uses the location-aware V2 server API:

| Method   | Path                                                 | Purpose                                                           |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/api/repository-map`                                | Return the current map, building it when necessary.               |
| `POST`   | `/api/repository-map/refresh`                        | Rebuild the structural map.                                       |
| `GET`    | `/api/repository-map/diagnostics`                    | Read live diagnostic state and recent entries.                    |
| `POST`   | `/api/repository-map/diagnostics`                    | Enable, disable, or clear diagnostics.                            |
| `GET`    | `/api/repository-map/knowledge`                      | Search bounded RAG and memory metadata.                           |
| `DELETE` | `/api/repository-map/knowledge/{scope}/{id}`         | Delete one `rag` or `memory` record.                              |
| `PATCH`  | `/api/repository-map/knowledge/memory/{id}`          | Verify, promote, reject, restore, pin, expire, or resolve memory. |
| `GET`    | `/api/repository-map/knowledge/memory/consolidation` | Preview deterministic memory consolidation.                       |
| `POST`   | `/api/repository-map/knowledge/memory/consolidation` | Apply the preview if its fingerprint remains current.             |
| `PATCH`  | `/api/repository-map/knowledge/retrieval/{id}`       | Mark one selected path used, irrelevant, or clear.                |
| `DELETE` | `/api/repository-map/knowledge/{scope}`              | Clear one location-scoped knowledge store.                        |

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

The same tab includes **Turn Inspector**, which reads at most the latest 200 JSONL events beginning with the newest
genuine user prompt. Its Latency and Critical Path view measures admission, classification, repository RAG, memory
recall, LM Studio capability probing, model activation, context compilation, prompt processing, generation, tool
execution, verification, and non-blocking bookkeeping. A wall-clock timeline identifies the longest blocking phase,
operations that overlapped, time already saved through parallelism, cache hits and misses, and an upper-bound estimate
for avoidable cache-miss latency. It also shows the selected model, context limit, reasoning effort, and provider prompt
cache state. Prompt-cache diagnostics include read/write token counts, reuse percentage, stable-prefix preservation,
and compaction preservation. Nested tool execution is not counted twice when it overlaps a model generation interval.

LM Studio requests that remain silent before their first streamed output now expose a dedicated live **prompt cache
restore** state with an elapsed timer in the chat. Because the OpenAI-compatible LM Studio endpoint does not emit a
cache-restore lifecycle event, this state is explicitly treated as an inference from the request boundary to the first
provider output. The completed interval is persisted in the session JSONL log and reported as a separate Turn Inspector
phase instead of being hidden inside prompt-processing latency.

The inspector exposes only bounded summaries plus the redacted Context Compiler preview; unrestricted prompts,
repository context, tool arguments, and tool output are never returned by this endpoint. Phase state comes from the
generation-fenced SQLite checkpoint and timestamped JSONL events, so a running, failed, recovered, or completed turn
can be inspected with the same schema. The typed
`GET /session/{sessionID}/inspect` endpoint returns the same latest-turn view for external diagnostics.

Before a tool reaches execution, a firewall verifies that its name exists in the current request and that its input is a
complete JSON object. Conservative syntax repair may preserve an already-emitted value, but it never invents missing
content. A malformed serialized tool envelope now fails the provider turn instead of being rendered as chat text, and
invalid input is never redirected through a hidden `invalid` tool. Three identical calls are terminated as a visible
tool error without a permission prompt or automatic retry.

### Tool Planner and bounded parallel execution

Every executable tool is scheduled through a process-global, workspace-scoped planner only after input validation and
durable tool-call budget admission accept the call. The existing processor call is idempotent, so provider event replay
cannot consume the budget twice. Built-in tools declare one of three access modes: read, write, or control.
Independent read and search calls may run concurrently, while writes wait for active reads and the previous write.
Reads submitted after a write wait for its completion. Unknown plugin and MCP tools default to write access so an
undeclared side effect cannot be parallelized accidentally.

The planner assigns a monotonically increasing node to every call and records its dependency nodes, chosen concurrency,
cache state, and early-stop reason in the per-session JSONL log as `tool.plan`. Read concurrency adapts to live Resource
Governor pressure and available CPU capacity: healthy machines allow a small bounded fan-out, pressure reduces it, and
critical pressure serializes reads.

Safe read-only results are cached for 60 seconds within the originating session. Equivalent arguments are serialized
deterministically, concurrent duplicates share one in-flight execution, and later provider turns can reuse the bounded
result. Results with attachments are not cached. Every write attempt advances the workspace generation and clears
cached and in-flight reads, including a write that fails after a possible partial side effect. External filesystem
changes remain bounded by the short TTL.

When the evidence tool accepts a complete finding, the request-level planner state survives provider continuations and
turn compaction. Later search calls for that same genuine request complete as explicitly skipped instead of consuming
another tool execution. A new user request receives a fresh evidence state. This optimization does not replace or
weaken durable provider-turn, tool-call, compaction, or evidence-attempt budgets.

### Change Risk Classifier

Every mutation admitted by the V1 desktop agent passes through a deterministic risk classifier after durable tool-call
budget and firewall admission but before the Tool Planner executes it. Classification uses the affected artifact paths,
workspace scope, file count, destructive intent, and whether the tool supplied trusted mutation metadata. It does not
depend on user-language keywords, model names, frameworks, or project-specific vocabulary.

The classifier recognizes documentation, local UI, backend logic, database, permissions and authentication, build and
runtime configuration, public API and protocol contracts, dependency resolution, and changes that cross independently
deployable workspace packages. Unknown plugin or MCP mutations fail closed as high risk when they do not declare trusted
capabilities.

| Risk       | Plan        | Scope budget | Verification | Critic | Extra confirmation | Automatic apply |
| ---------- | ----------- | ------------ | ------------ | ------ | ------------------ | --------------- |
| `low`      | Optional    | 3 files      | Focused      | No     | No                 | Yes             |
| `medium`   | Recommended | 6 files      | Focused      | No     | No                 | Yes             |
| `high`     | Required    | 10 files     | Extended     | Yes    | Yes                | No              |
| `critical` | Required    | 20 files     | Full         | Yes    | Yes                | No              |

The extra high/critical approval uses the dedicated `change_risk` permission and cannot be bypassed by a generic
wildcard allow rule. Existing explicit deny rules remain authoritative. The approval describes the detected categories,
target files, score, reasons, required plan, verification depth, and critic requirement so the user sees the actual
boundary before any mutation begins.

The highest assessment for the current request is stored in the generation-fenced SQLite execution checkpoint, attached
to tool-planner metadata, and written to the per-session JSONL log as `change.risk`. A stale process cannot overwrite a
newer generation. Verification reads the completed mutation metadata and requests the policy's required depth. The
separate post-verification Critic Pass described below owns review execution; the risk policy records when that review
is additionally required by the change boundary.

### Verification Matrix

The V1 desktop verification loop converts the changed artifact set and highest Change Risk assessment into a
deterministic minimum verification plan. The matrix chooses check types rather than hard-coded commands, languages, or
frameworks. The agent maps only those types to focused repository-native commands:

| Change signal    | Minimum selected verification                             |
| ---------------- | --------------------------------------------------------- |
| Every mutation   | Git diff inspection                                       |
| Documentation    | Focused formatter when available                          |
| Local UI         | Component test and conditional screenshot comparison      |
| Backend logic    | Focused unit test and conditional typecheck               |
| Database         | Migration validation and focused feature test             |
| Permissions/auth | Focused allow/deny unit and feature tests                 |
| Build/config     | Affected build target and conditional config lint         |
| Public API       | Contract generation/validation and typecheck              |
| Dependencies     | Affected build target and conditional manifest lint       |
| Multi-package    | Cross-boundary typecheck and the smallest composing build |

Overlapping categories are deduplicated, so a single command may cover multiple selected types. Required checks that
cannot run leave the change explicitly unverified. Conditional checks may be omitted only with a concrete availability
reason. The verification tool rejects unrelated check types, records the reason for every selected type, and includes
the executed commands, omissions, missing checks, LSP diagnostics, and result in its bounded metadata and output. The
agent is instructed to summarize which checks ran and why in the final response.

The complete plan is written to the generation-fenced SQLite checkpoint as `verification_plan`, emitted to the
per-session JSONL log as `verification.matrix`, and attached to the synthetic verification continuation. Recovery and
compaction therefore preserve the same verification boundary instead of allowing a later provider turn to broaden or
weaken it. A new genuine user request clears the previous plan.

### Evidence-based Critic Pass

After a request changes files and the Verification Matrix passes, OpenCode Customs runs one separate evidence-based
review by default. This is not another execution loop. The reviewer receives a new compact context containing only:

- the original genuine user task;
- the request-scoped patch and changed-file allowlist;
- compact verification results;
- known omissions, truncation, and other explicit limitations.

Conversation history, old tool calls, repository RAG, cross-session memory, plans from older requests, MCP tools, and
editing tools are excluded from this context. The only available control tool accepts either a clean result or concrete
findings. Every finding must identify a changed file, the best available line number, a specific consequence, and direct
evidence from the supplied patch or verification output. Findings outside the current request's changed-file allowlist
are rejected.

The request's already selected strong model is reused by default. An alternate model is used only when
`verification.reviewer_agent` explicitly names an agent configured for the reviewer role; no hidden utility or fallback
model is selected. The reviewer cannot write files, run commands, request more repository context, or recursively start
another review.

The single attempt is consumed through the durable `critic_turns` budget. Its pending or completed `critic_pass` record,
model identity, changed files, findings, error, and `critic_review` pipeline phase are stored in the generation-fenced
SQLite checkpoint. Recovery preserves the consumed attempt and never repeats a completed review. A stale process cannot
replace a newer result, and a new genuine user request clears the previous critic boundary. If the reviewer does not
submit a valid result, the pass ends visibly as failed without an automatic retry or self-review loop.

## Evaluation Harness

OpenCode Customs includes a repeatable agent Evaluation Harness under `evals/`. The standard
`evals/agent-reliability.json` suite covers natural conversation, memory across sessions and projects, exact-symbol and
abstract feature search, unfamiliar Laravel/Vue, Unity/C#, Node, and Python repositories, local and cross-module edits,
screenshot-to-code analysis, malformed or repeated tool calls, durable recovery, resource pressure, and unavailable
models. Small checked-in fixture projects provide known files and dependency flows, so repository search quality is
measured against stable ground truth instead of whichever application happens to be open.

Each run records deterministic answer assertions, expected-file discovery, RAG Recall@5 and Recall@10 from the actual
ordered files selected for repository context, provider turns, tool calls, compactions, token usage, per-phase time,
verification status, process errors, repeated output, and repeated-tool loops. Raw JSON output, stderr, and per-session
JSONL diagnostics are kept beside the report for later debugging.

Run one scenario repeatedly while tuning the agent:

```bash
cd packages/opencode
bun src/index.ts eval run ../../evals/agent-reliability.json \
  --revision baseline \
  --scenario exact-symbol \
  --output ../../eval-results/baseline.json
```

Run the same scenario after a change and compare the reports:

```bash
bun src/index.ts eval run ../../evals/agent-reliability.json \
  --revision candidate \
  --scenario exact-symbol \
  --output ../../eval-results/candidate.json

bun src/index.ts eval compare \
  ../../eval-results/baseline.json \
  ../../eval-results/candidate.json \
  --fail-on-regression
```

Omit `--scenario` to run every scenario whose required environment is available. Recovery and resource-pressure cases
use `OPENCODE_EVAL_RECOVERY_REPO` and `OPENCODE_EVAL_RESOURCE_REPO`, so fault experiments do not run against an arbitrary
working repository. `--binary`, `--model`, and `--agent` can pin the executable and runtime being compared. The report
schema is versioned, and `eval score` can score a recorded trial without contacting a model.

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

## Desktop voice agent

OpenCode Customs can turn the desktop composer into a push-to-talk or hands-free voice interface. The microphone control
is available in both composer generations. Final recognition results are inserted as ordinary prompt text and, when
automatic submission is enabled, are sent through the same request scheduler used by typed input. The voice layer does
not bypass admission, memory, repository retrieval, model selection, tools, durable checkpoints, or verification, and it
does not select a hidden fallback model.

The renderer keeps a persistent 16 kHz PCM stream to the local Docker backend. A bounded client buffer and a 700 ms server
ring buffer preserve speech that starts immediately before an interruption, WebRTC echo cancellation uses renderer
playback as its reference, and an RMS noise gate plus aggressive WebRTC VAD detect speech. The connection
stays open between turns instead of launching an Apple or Swift recognizer for every utterance. Final recognition results
still enter the normal durable request pipeline.

Endpointing is deliberately two-stage. The first silence window requests a candidate transcript without closing the
utterance. A language-aware completion check can finalize a stable, complete phrase; an unfinished phrase keeps listening
through a bounded semantic grace window, and resumed speech cancels the pending endpoint. This prevents short pauses such
as `Tell me about ...` from being submitted as truncated prompts without turning endpointing into project-specific keyword
routing. Every streaming event carries bounded diagnostics for microphone level, VAD state, captured speech and silence,
pre-roll duration, transcript stability, recognition latency, and the final endpoint reason. The chat status renders these
signals while listening so audio and endpoint failures can be diagnosed without opening Docker logs.

Partial cadence, maximum utterance length, and endpoint boundaries use received PCM frame time rather than wall-clock
time, so slow local decoding cannot make an utterance expire early. At most two previews are decoded by the dedicated
tiny recognizer; they are diagnostic-only, are not rendered as user messages, and cannot enter session history, memory,
or the LLM. Exactly one final result per voice turn generation is decoded from the complete utterance by the configured
main recognizer, without using a previous hypothesis as a prompt. Final average log probability, no-speech probability,
and detected-language probability produce a bounded confidence signal. A result below the configured admission threshold
is discarded before durable prompt admission. Final transcripts that end in discourse noise or an incomplete dependent
clause are rejected as semantically incomplete instead of being sent to the model. Stale previews, repeated sentence or
phrase blocks, and sub-360 ms noise bursts are also discarded. Resumed speech invalidates the candidate, and the desktop rejects an exact replay of the
previous accepted microphone transcript across adjacent turns.

As assistant text streams, the first complete sentence or a bounded clause is sent over a local WebSocket to the
independent OpenAI-compatible backend in `services/ukrainian-tts`. Quality mode uses Silero V5 CIS Extended for
Ukrainian, a contextual `stress-uk` accentor, a pronunciation dictionary, and a dedicated Silero English model. Complete
English passages use that English model. Short Latin fragments inside predominantly Ukrainian text are first resolved by
the pronunciation dictionary and then adapted to Ukrainian phonetics when no explicit pronunciation exists. Fast mode
applies the same short-fragment adaptation before Ukrainian Piper ONNX synthesis. Preparing the next clause while the
current one plays reduces time to first audio. New assistant replies are spoken for typed prompts as well as voice-submitted
prompts. Repeated synthesis and accent results are cached without placing WAV or base64 data in model context. Markdown
presentation and fenced code are removed from the spoken form without modifying the stored response. The renderer decodes
the returned raw mono PCM16 chunks into one persistent `AudioWorklet` queue instead of decoding a WAV container or
creating one media element per clause.
The next synthesis request runs while buffered audio is playing, a short adaptive jitter buffer grows only after an
underrun, and barge-in clears the socket, PCM queue, active model turn, and playback generation together.

Hands-free mode continues streaming recognition while a synthesized sentence is playing. Native WebRTC acoustic
echo cancellation runs first. A renderer `AudioWorklet` then receives the exact TTS playback PCM on a separate reference
input, estimates acoustic delay and correlation, and removes residual echo before VAD and streaming STT. Transcripts that still overlap text already spoken in the
current response are treated as residual semantic echo, and short incidental fragments are ignored. A stable, distinct utterance cancels the active audio request and
playback, interrupts an unfinished model turn, and immediately becomes the next user prompt. The recognizer then resumes
after the response without another button press. Browser/macOS speech synthesis is not part of this path and is never used
as a fallback.

An optional acoustic wake-phrase gate sits before the main STT model and durable prompt admission. Up to eight configured
phrases are matched by an explicit low-latency wake recognizer using generic word similarity and timestamp boundaries;
there are no hard-coded phrase, language, or project aliases. While the gate is armed, unmatched background speech is
recorded as `wake_ignored` in Voice Inspector but never invokes the main STT model or reaches the scheduler, RAG, memory,
tools, or an LLM. After a match, only audio following the wake-word timestamp is sent to the main recognizer. Saying only
the activation phrase opens a bounded command window; completing a response opens a configurable follow-up window so a
natural clarification does not require the phrase again. Automatic listener startup is explicit and disabled by default.
The wake recognizer is never used to answer a request and is not a fallback; if it is unavailable, the voice loop stops
with a visible error.

The synthetic **Default Project** workspace is conversation-only. Its session header and tab set omit the Git review panel
instead of offering to initialize a repository for a workspace that is not a source project.

The **Settings → General → Voice agent** section controls:

- whether the microphone control is visible;
- whether final dictation is submitted automatically;
- whether response sentences are spoken as soon as they are complete;
- the TTS provider: the existing local Docker backend or native Fish Speech S2 Pro through PyTorch MPS on Apple Silicon;
- for local TTS, the endpoint, explicit quality or fast mode, and the voice (`kateryna`, `lada`, `mykyta`, `oleksa`,
  `tetiana`, or the Piper voice);
- for Fish Audio Local, a loopback-only `/v1/tts` endpoint, visible MPS-server health, latency mode, a local reference
  recording, and its required exact transcript. OGG, WAV, MP3, M4A, MP4, FLAC, and AAC references up to 25 MB can be
  selected and tested in place;
- a test phrase with backend, synthesis, cache, and time-to-first-sound metrics;
- whether adaptive hands-free listening, automatic resume, and voice interruption are enabled.
- whether a configurable wake phrase is required, how long follow-up turns remain active, and whether the listener starts
  automatically when the composer mounts.
- a deterministic contextual-correction gate, destructive-command confirmation, and a managed personal
  pronunciation/recognition dictionary. Each entry stores the intended form, pronunciation variants, language, confidence,
  confirmation state, and a global, project, or session scope. Only confirmed entries can rewrite a transcript. Legacy
  `heard => intended` settings migrate to confirmed global entries;
- normal, work, night, and emergency personality modes. Personality is applied after transcript admission and intent
  classification, so it changes delivery without rewriting facts, tool instructions, or code.

Fish Audio Local never crosses the local-machine boundary. The Electron main process accepts only loopback endpoints,
encodes the official Fish Speech `/v1/tts` request as MessagePack, and supplies the locally stored reference audio plus
its exact transcript for each synthesis request. The reference remains in the application data directory. There is no
API key, cloud model creation, cloud reference ID, cloud request, or silent fallback to another voice path.

The native macOS service in `services/fish-speech-macos` creates an isolated Python 3.12 environment, downloads the
official S2 Pro checkpoint, and starts the official API server with PyTorch MPS. It explicitly disables PyTorch CPU
fallback and does not enable `torch.compile`, which Fish Speech does not support on macOS. The Voice settings health
check calls the official `/v1/health` route and reports an offline server before a reference is sent.

Final recognition is admitted through a dedicated voice-understanding boundary before it becomes a user message. The
boundary preserves mixed Ukrainian/English technical terms, performs only explicit dictionary replacements and
punctuation repair, classifies conversation, code, navigation, action, and destructive intent, and uses recent dialogue
to resolve short references. It can consider ranked STT alternatives, but only replaces the primary transcript when an
alternative has materially higher confidence. Low-confidence, unresolved referential, and destructive requests are
returned to the composer for explicit review; they do not enter chat history, RAG, memory, or model execution. Spoken
corrections such as `I said deploy, not display` create reviewable session-scoped candidates and are not submitted as
requests. A correction saved explicitly in Voice Inspector is treated as user confirmation and becomes active for that
session immediately. The dictionary manager can confirm, edit, rescope, or remove every entry.

The **Voice Inspector** in the same settings section provides a durable, bounded timeline for the current session. Each
entry records its source (`ui`, `stt`, `agent`, `tts`, or `replay`), state transition, timestamp, duration, bounded text,
error, and numeric diagnostics. Its per-turn view shows the hidden tiny preview, final transcript, confidence, endpoint
and admission reasons, VAD timing, and applied contextual corrections. The timeline is persisted as one JSONL file per
session under the desktop application data directory, survives a restart, and can be refreshed, revealed in Finder, or
exported to Downloads. One session or every voice diagnostics file can be cleared from the inspector.

Every hands-free interaction receives a stable voice turn ID. The inspector groups durable events by that ID and evaluates
the complete critical path: wake-word recognition, final STT, model time to first response, TTS synthesis, time to first
sound, and total turn duration. It reports median phase latency, the current bottleneck, completed, failed, interrupted,
and background-ignored turns. Closed microphone utterances retain both a bounded normalized level trace and a local PCM16
WAV recording keyed by the durable turn ID. Audio stays outside JSONL and is limited to the newest 200 recordings per
session. The turn card can play the exact recording, append a non-destructive manual correction, or run the same audio
through final STT again. Re-decoding and correction add diagnostic events to the existing turn and never create another
chat message. These deterministic summaries make two builds directly comparable while the JSONL timeline remains the
source of truth.

The **Voice Session Orchestrator** is the single owner of the live lifecycle: `idle → listening → transcribing → thinking
→ synthesizing → speaking`, with explicit interruption edges. Each async STT event carries the originating turn ID and
generation, and each model response must reference the exact user message created by that voice turn. A newer turn
invalidates older callbacks, duplicate final transcripts are admitted only once, and illegal state transitions are
rejected. Durable `turn_checkpoint` entries make the lifecycle debuggable and allow an unfinished renderer turn to be
closed as recovered-to-idle after restart without replaying tools, model work, or speech.

The **Voice Turn Recovery Runner** exercises that orchestration boundary as a deterministic end-to-end state test. It
simulates a normal microphone → STT → submission → model response → TTS → playback turn, duplicate final transcripts,
late STT events, responses belonging to an earlier user message, STT and TTS failures, renderer restart, duplex reconnect,
and spoken barge-in. Every scenario records the actual transition trace, writes a pass or failure event to the durable
voice timeline, and can be exported as JSON or standalone HTML. The runner never sends its synthetic transcript to the
active project session and therefore cannot accidentally invoke a model, tool, RAG, or memory admission.

The **Voice Soak & Chaos Runner** extends that same production orchestration boundary across 500 deterministic turns.
It repeatedly interleaves completed turns, duplicate finals, superseded STT callbacks, unrelated assistant responses,
STT and TTS failures, renderer recovery, duplex reconnects, and spoken interruption. The report verifies that every batch
returns to `idle`, no turn token leaks, old generations remain rejected, and the long-lived generation counter continues
to advance safely. Only one bounded aggregate event is appended to the durable voice log; no synthetic transcript reaches
the active session, model, tools, RAG, or memory. Batch evidence can be exported as JSON or standalone HTML.

The **Voice Reliability Runtime** adds a bounded production-audio soak above the deterministic state runner. Five cycles
are synthesized by the selected Docker voice, decoded to PCM, and replayed through the real duplex VAD, pre-roll,
semantic endpointing, STT, wake-word, echo, and barge-in path. A deterministic schedule adds input delay and a transport
reconnect boundary without selecting a fallback engine. The report preserves every raw duplex result and records total
time plus process RSS, peak RSS, active thread, and open file-descriptor deltas. Individual cycle results are also written
to the durable voice JSONL timeline and the full report can be exported as JSON.

The live renderer includes a **voice phase watchdog**. Listening is intentionally unbounded, while transcription,
provider thinking, synthesis, playback, and interrupted states have conservative phase-specific deadlines. A missed
deadline stops the active audio and model work, records `watchdog_timeout` with the phase and elapsed time, invalidates
the turn generation, and returns the UI to `idle`. The watchdog never retries the request and never chooses a fallback
model or voice.

The inspector also includes a deterministic **Voice Regression Runner**. It uses the currently selected local TTS model
and voice to synthesize fixed Ukrainian and English phrases, passes the resulting WAV through the same replay STT endpoint,
and runs negative silence and low-level background-noise cases. Each result records the transcript, language and
punctuation checks, word error rate (WER), character error rate (CER), TTS time, STT time, and end-to-end latency. A report
can be saved as the baseline for that exact endpoint/model/voice tuple and compared with later runs. JSON and standalone
HTML exports make results suitable for CI artifacts or manual comparison. These replay scenarios deliberately do not claim
to validate live echo cancellation or barge-in; those remain observable through real duplex turns in the durable timeline.

The separate **Live Duplex Regression Runner** exercises that duplex boundary without requiring a physical microphone.
It synthesizes deterministic speech, injects mono PCM through the production `DuplexSession`, and evaluates the resulting
events with the same client echo and deliberate-interruption rules used by the active voice loop. Its bounded suite covers
self-echo rejection, user barge-in, the 1.5-second pre-roll, an internal semantic pause, wake phrase plus command, background
noise, and a complete wake → response → interruption cycle. The report records transcripts, raw endpoint events, wake
decisions, recognition latency, false and missed barge-ins, and false and missed wake detections. A baseline is scoped to
the exact endpoint, synthesis mode, and voice; JSON and standalone HTML exports preserve both the evaluated result and raw
backend evidence. The runner never selects a fallback voice, recognizer, or model: an unavailable component is a visible
failed scenario or request error.

Wake matching compares both spaced and collapsed normalized token windows, so recognizer boundaries such as `Джар віс`
can match a configured single-token phrase without maintaining phrase-specific aliases. Semantic endpointing first requests
a transcript after the short-silence threshold, but does not commit a completed utterance until the configurable endpoint
commit threshold (1,000 ms by default). Speech that resumes before that boundary cancels the candidate and remains in the
same utterance; genuinely incomplete text may continue to the longer semantic grace boundary.

For deterministic STT debugging, the inspector can send an explicitly selected mono or stereo PCM16 WAV file to
`POST /v1/audio/transcriptions/replay`. The backend converts it to mono 16 kHz PCM, runs the same recognizer used by the
duplex stream, and returns the transcript plus source format and timing diagnostics. OpenCode Customs does not retain raw
microphone audio automatically; replay always requires an explicit file selection.

On macOS the desktop bundle declares microphone usage and Electron grants media permission only to the trusted internal
renderer origin. Recognition requires the configured local Docker voice backend; Apple Speech is not used. If the local
streaming STT model is unavailable, microphone access fails, or the selected TTS mode is not ready, the composer returns
to idle and shows a concrete error instead of silently hanging or selecting a hidden fallback.

Start the default local backend with:

```bash
cd services/ukrainian-tts
docker compose up --build -d
```

The first start downloads the selected Silero, Piper, and accentor artifacts into a persistent Docker volume. Silero V5
CIS Extended is distributed under CC-NC-BY; Piper is GPL-3.0 and individual voices may have additional model-card terms.
The backend accepts `POST /v1/audio/speech`, `WS /v1/audio/speech/stream`, and
`WS /v1/audio/transcriptions/stream`, reports TTS and STT independently through `GET /health`, and binds port 8880 to
localhost only. Streaming TTS emits bounded raw PCM16 chunks with explicit sample-rate, channel, and frame metadata, allowing playback to begin before the
complete answer has been synthesized. Streaming STT bounds preview work to two tiny-model decodes and performs one accurate
final decode over the complete utterance. The chat status renders the current
partial transcript and the durable voice timeline exposes first-chunk, first-sound, buffered-audio, underrun,
incremental-decode, committed-audio, cache, playback-reference level, residual level, echo coherence, suppression in dB,
and estimated acoustic-delay diagnostics. The runtime never
switches from quality to fast mode automatically.

## Agent personalization

The desktop **Settings → General → Agent personalization** dialog stores a local, user-controlled communication
profile. It supports an assistant name, user name, preferred form of address, automatic or explicit response language,
tone, detail level, proactivity, humor, and bounded custom instructions. The dialog previews the exact generated profile
instruction before it is saved and can disable the feature without deleting the configured values.

Every normal text or voice submission captures one snapshot of the profile and carries it through queued or steered
follow-ups. The snapshot is attached as a synthetic request part, so it reaches the selected model without appearing as
a user-authored chat message. Automatic language mode follows the latest user request and requires standard grammar
without unrequested language mixing. Personalization affects presentation and collaboration behavior only: it cannot
override system or developer instructions, permissions, safety constraints, factual accuracy, or verification.

## Local Jarvis and Unity/VR Avatar Bridge

The Desktop main process hosts a loopback PCVR bridge and an optional pinned-WSS Quest bridge. Protocol v2.1 preserves
v1/v2 compatibility while adding capability permission categories, postconditions, declared side effects, structured
action outcomes, nested goals, repeated-failure replanning, and trusted critical categories scoped to a game. Unity owns
NavMesh, physics, animation, preconditions, and persistent game effects; the model receives bounded semantic snapshots
and can invoke only registered typed capabilities.

Jarvis uses a configured fast dialogue model for conversation and single actions. Multi-step goals, explicit planning,
story decisions, or repeated failures escalate to an optional planner model unless the Local Agent Runtime reports
critical memory pressure. Game memory is isolated by game, save slot, and character, records provenance, confidence,
importance, scope, pinning, and conflicts, and never stores raw audio. The imported Jarvis Lab sample is the reference
vertical slice for PCVR, autonomy, voice interruption, reconnect, save recovery, and Quest readiness.

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
