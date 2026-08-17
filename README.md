<p align="center">
  <img src="packages/desktop/icons/customs/icon.png" width="180" alt="OpenCode Customs icon">
</p>
<h1 align="center">OpenCode Customs</h1>
<p align="center">A desktop-focused, repository-aware customization of OpenCode.</p>

OpenCode Customs includes an optional local duplex voice runtime. Its streaming path incrementally recognizes microphone
audio and begins playing bounded raw PCM chunks before the full response is ready. The selected local STT and TTS
models remain explicit: the voice runtime does not silently switch to Apple services or another local model.

> [!NOTE]
> OpenCode Customs is an independent customization built on the open-source
> [OpenCode](https://github.com/anomalyco/opencode) project. It is not an official OpenCode release and is not
> affiliated with the upstream OpenCode team.

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### What OpenCode Customs adds

OpenCode Customs extends the desktop application with repository intelligence that runs before a request reaches the
model:

- An incremental, location-scoped repository map with files, languages, project areas, landmarks, symbols, and links.
- File-watcher updates for added, changed, and removed files without a full reindex after every edit.
- Optional LSP enrichment for definitions, references, calls, and workspace symbols.
- A project-learned concept router for abstract tasks. It derives vocabulary from the current codebase, tolerates
  inflection and likely spelling mistakes through evidence-backed prefix grounding, and does not use a fixed business
  dictionary or assume a particular framework.
- Second-generation repository retrieval that runs exact-identifier, lexical/concept, embedding, LSP/symbol, and graph
  stages before reranking and directory-diverse selection. It searches for analogous existing implementations, labels
  evidence as fact, assumption, or analogy, reports confidence and per-file selection reasons, and extracts only bounded
  source windows. Durable used/irrelevant feedback influences later queries without hard-coded domain vocabulary, while
  the viewer reports Recall@5 and Recall@10. The embedding index updates incrementally through the file watcher and never
  auto-loads a model into LM Studio.
- Managed Memory V2 with global, cross-project, project, expiring session, and reusable-pattern scopes for
  high-confidence user-provided identity details, preferences, standing constraints, decisions, deliberately taught
  facts, verified compaction facts, and successful file routes.
  Automatic admission does not require a “remember” command, uses semantic topics to replace corrected facts, and never
  switches to a hidden fallback model. Records advance through candidate, verified, and durable lifecycle states, or
  remain inspectable as rejected, expired, or archived. Pinned records resist automatic replacement, lower-confidence corrections
  become visible conflicts, and obvious credentials are rejected again at the storage boundary. Recall uses optional
  semantic ranking with lexical fallback, contributes only query-relevant bounded notes and paths, and records why each
  memory matched. A project fact recalled from another repository is explicitly labeled as an analogy and cannot inject
  its paths as evidence for the current repository. The RAG/Memory viewer supports verification, promotion, rejection,
  restoration, pinning, expiration, conflict resolution, usage-history inspection, deletion, and clearing. A
  deterministic preview-before-apply consolidation pass merges duplicates, reviews conflicts, ages stale confidence,
  strengthens independently reconfirmed reusable rules, archives unused records, and never mutates pinned memory.
- A local agent-personalization profile for text and voice requests. Users can set assistant and user names, preferred
  form of address, response language, tone, detail, proactivity, humor, and bounded custom instructions. The profile is
  injected as hidden per-request context, remains out of the visible chat, and cannot override permissions, safety,
  factual accuracy, or verification requirements.
- A dedicated ordinary-chat workspace with an independent per-model context limit. LM Studio chat models default to a
  bounded 32,768-token context (configurable down to 8,192) without reducing the model context used by project and Build
  sessions.
- A local full-duplex voice path with incremental tail-only STT, live partial transcripts, streamed bilingual TTS, and
  gapless `AudioWorklet` PCM playback. Exact playback PCM feeds a residual echo canceller after native WebRTC echo
  cancellation, so barge-in does not depend on volume or recognized-text overlap alone. Adaptive buffering absorbs synthesis jitter, durable diagnostics expose time to
  first sound and underruns, and barge-in cancels playback and the active turn without an Apple or hidden model fallback.
- Resource-aware prompt admission for custom models, including conservative fallback limits, full-request preflight,
  budgeted tool/system context, bounded history compaction, a live context-usage indicator, and protection from duplicate
  title-generation requests on the active model. Interactive turns degrade to a smaller context under critical macOS
  memory pressure while background embedding work pauses, and asynchronous failures remain visible in the timeline.
- Local Agent Runtime layers for LM Studio: a read-only capability bridge, an adaptive Resource Governor, and durable
  execution checkpoints that recover abandoned sessions after an OpenCode process restart without replaying completed
  local tools. Generation-fenced per-request counters bound provider turns, tool calls, repeated compactions, and
  evidence follow-ups without relying on compactable transcript text. Typed event-stream heartbeats keep live desktop
  subscriptions healthy, and reconnect reconciliation reloads pinned or running sessions so persisted assistant output
  cannot remain invisible after a brief transport interruption.
- A durable Request Pipeline Scheduler that advances every genuine user request through prompt admission,
  classification, repository and memory recall, model readiness, context compilation, execution, verification, memory
  admission, and completion. Each phase is generation-fenced and persisted in SQLite. Identical preparation is
  deduplicated, a newer message cancels stale preparation, optional recall has a deadline, and independent memory recall
  overlaps model readiness. Conversation-only turns skip repository RAG and Git analysis; tool continuations reuse
  checkpointed classification and recall instead of repeating them. Classifier, RAG, memory, and main-model calls retain
  separate durable budgets. Local classification runs only on an explicitly configured, distinct utility model and has
  a five-second deadline; OpenCode never runs the selected interactive LM Studio model a second time as hidden preflight.
  Without that utility model, the primary turn selects evidence and tools directly. The interactive model stays pinned
  for the request and is never replaced by a hidden fallback.
- A resource-aware Tool Planner that runs independent read and search calls concurrently, serializes mutations behind
  active reads and earlier writes, and records a small dependency graph for every call. Equivalent safe reads are
  deduplicated and cached per session, every mutation invalidates that cache, and accepted evidence stops unnecessary
  follow-up searches. Unknown and third-party tools are treated as mutations unless they explicitly declare read-only
  behavior. The existing tool-call firewall and generation-fenced execution budgets remain authoritative.
- A deterministic Change Risk Classifier that evaluates every mutation from its target artifacts, workspace scope,
  destructive intent, and trusted tool metadata. Documentation, local UI, backend logic, database, access control,
  build configuration, public contracts, dependencies, and multi-package changes receive explicit risk policies for
  planning, scope, verification, critic review, confirmation, and automatic application. High and critical changes fail
  closed at a separate approval boundary, and each assessment is persisted in the execution checkpoint and session log.
- A capability-based multi-model router that assigns embedding, utility, coding, and vision roles from
  metadata, task shape, context capacity, model size, and live resource pressure without model-name or project-specific
  keyword tables. Interactive requests use a configurable minimum installed-size policy (12 GiB by default), so a
  compact utility model cannot become the primary assistant merely because it is already loaded or exposes more context.
  Utility models are used only for explicit
  background work such as history compaction, without unloading the active coding model. Coding and vision handoffs use
  LM Studio's native model-management API with readiness checks, checkpointed failure state, and guarded cleanup of idle
  runtime-managed instances. Interactive execution fails closed if the selected model cannot be activated; it is never
  handed silently to a smaller fallback model. A per-model Runtime switch can preserve the context configured in LM
  Studio by preventing OpenCode from supplying an automatic context override during model loading. The same panel lists
  every model reported by LM Studio and can exclude individual models from automatic embedding, utility, and vision
  routing without hiding them from explicit model selection or unloading a running instance. Capability probes are
  coalesced into a shared 30-second snapshot, while successful OpenCode-managed load and unload operations invalidate it
  immediately. A provider-wide switch can disable automatic handoffs entirely: foreground requests stay on the model
  selected in the chat, with no automatic load, unload, or substitution. A read-only probe still enforces the primary
  size and capability policy, so an undersized or incompatible manual selection fails visibly rather than receiving the
  interactive turn. Dedicated embedding
  retrieval remains independent.
- A screenshot vision pipeline that keeps durable history file-based, resizes large images against model and live-memory
  limits, selects only a probed vision-capable model, and records preparation, token, activation, and failure metrics in
  checkpoints and the Runtime panel. Base64 is created only transiently for provider APIs that require it, while RAG can
  ground the visual analysis in related project code during the same turn.
- A bounded verification loop that asks the agent for the smallest repository-native checks, reuses normal shell
  permissions, adds changed-file LSP diagnostics, and repairs failed checks without assuming a language or framework.
  Its deterministic Verification Matrix derives the required check types from changed artifacts and risk: formatter,
  typecheck, focused unit/feature/component tests, migration validation, build, lint, API contract generation,
  screenshot comparison, and Git diff inspection. Every selected check is executed or explicitly accounted for, and
  unrelated suites are excluded.
- A single evidence-based Critic Pass after a changed request passes verification. The reviewer receives a fresh compact
  context containing only the original task, request-scoped patch, changed files, verification results, and known
  limitations. It can report concrete defects with file, line, consequence, and direct evidence, but it cannot edit
  files or start another review. The active strong model is reused by default; another reviewer model is used only when
  explicitly configured. Its one-attempt budget and result survive recovery in the generation-fenced checkpoint.
- A bounded evidence loop for read-only repository research. Findings must cite files actually read in the current turn,
  while unresolved searches finish as explicitly blocked instead of becoming guessed conclusions.
- A semantic scope and freshness gate that classifies each genuine request as conversation-only, repository work, or
  external research before RAG runs. External turns expose only live web tools, repository turns expose workspace tools,
  and unavailable verification fails closed without retries or a hidden utility-model fallback. Repeated terse
  follow-ups preserve their original scope across Build/Planning mode changes, and LM Studio can call the built-in live
  search tool directly.
- Response-language binding that keeps the latest active request authoritative after compaction and bounded continuation
  turns, even when summaries, memories, and tool output are written in another language. Repeated invalid tool repairs
  are detected across provider turns and stopped before they can create an unbounded local-model loop. Conservative
  tool-call repair fixes only syntax that preserves every emitted value and never invents truncated paths or patterns.
- A desktop **Map** panel with index metrics, manual reindexing, LSP status, opt-in live routing diagnostics, and a
  bounded RAG/memory viewer for inspecting, searching, pinning, expiring, resolving, deleting, and clearing retrieval
  data.
- Per-session JSONL diagnostics under the standard OpenCode log directory. Each file records prompts, model routing,
  provider requests, compaction, tool calls and bounded results, failures, and checkpoint recovery. The Runtime menu can
  export the complete diagnostic bundle or clear all desktop, server, network, crash, and session logs. The session
  Context tab shows the exact log path, can reveal the file directly in the desktop file manager, and includes a
  privacy-bounded **Turn Inspector** for the latest request. Its Critical Path timeline measures every pipeline phase,
  highlights the main blocker and parallel operations, reports cache state and potential savings, and records the
  selected model, context, and reasoning effort. The same inspector previews the actual deterministically compiled
  prompt by source, token budget, provenance, truncation, deduplication, and included tool schema; credentials and
  binary payloads are redacted. LM Studio prompt-cache telemetry records read/write tokens, reuse percentage, a
  privacy-safe stable-prefix fingerprint, and whether compaction preserved that prefix. A tool-call firewall blocks
  malformed serialized calls, unavailable tools, and repeated identical calls before they can enter an `invalid`
  retry loop.
- A repeatable Evaluation Harness with cross-stack fixture projects, deterministic answer and file checks, RAG
  Recall@5 and Recall@10, provider/tool/compaction budgets, phase timing, loop detection, raw diagnostic artifacts, and
  baseline-versus-candidate reports.
- A separate **Extensions** menu that discovers installed ChatGPT/Codex plugin bundles, exposes their skills to the
  agent, and starts enabled bundled MCP servers alongside native OpenCode plugins.
- A Unity 6/PCVR/Quest Avatar Bridge v2.1 for a local embodied Jarvis. It streams bounded semantic world state,
  exposes typed game capabilities instead of arbitrary Unity methods, maintains a nested goal stack and save-scoped
  provenance-aware memory, routes conversational and planning turns to separate local models, and applies per-game
  trusted autonomy profiles. The Jarvis Lab sample provides a vertical slice with NavMesh, inventory, crafting, a door,
  NPC relationship, quest, training hazard, reconnect, and record/replay diagnostics.
- Custom OpenCode Customs desktop branding and macOS application/Dock icons.
- A desktop voice agent with push-to-talk dictation and a hands-free Jarvis conversation mode. A persistent local
  full-duplex stream uses WebRTC echo cancellation, a 1.5-second pre-roll buffer, VAD, and streaming Whisper STT. Tiny-model
  hypotheses remain hidden previews, and two-stage semantic endpointing distinguishes a finished request from a
  short pause inside an unfinished phrase before submitting it. Endpoint timing follows received audio rather than model
  processing time. Exactly one final decode from the configured main recognizer may enter chat; low-confidence results are
  discarded before history or memory admission. In-chat voice diagnostics expose microphone activity,
  VAD state, STT phase, pre-roll, recognition latency, and the endpoint decision. Completed response sentences are spoken
  while the model is still generating. Speaking over the response
  interrupts both playback and the active model turn, then submits the new utterance through the same durable request
  pipeline as typed input. Speech is generated by a separate Ukrainian/English TTS service in `services/ukrainian-tts`; Apple
  speech recognition or synthesis is never used as a fallback. The Voice Inspector records a bounded per-session JSONL
  timeline of microphone, VAD, STT, agent, synthesis, playback, interruption, and error events. It can replay an explicitly
  selected WAV through the same STT backend, export or reveal the session log, and clear one session or all voice logs.
  It also groups events by voice turn and reports critical-path medians for wake word, STT, model, TTS, first sound, and
  total latency, identifies the bottleneck, and renders bounded microphone-level waveforms. A built-in Voice Regression
  Runner exercises Ukrainian and English TTS-to-STT round trips plus silence and deterministic background-noise cases,
  reports WER/CER, language, punctuation, and latency, compares a saved baseline, and exports JSON or HTML reports. Raw
  microphone audio is not retained automatically. A separate Live Duplex Regression Runner injects deterministic PCM
  through the production VAD, semantic endpointing, pre-roll, streaming STT, wake-word, and client echo/barge-in rules.
  It covers self-echo rejection, interruption, preserved speech starts, internal pauses, wake commands, background noise,
  and the complete wake-to-interruption cycle, with durable diagnostics and baseline comparison.
  A deterministic Voice Session Orchestrator owns every turn from listening through transcription, model work, synthesis,
  playback, interruption, and idle. Duplex events carry a turn ID and generation, assistant output is correlated to the
  exact submitted user message, duplicate final transcripts are admitted once, and late callbacks from cancelled or
  superseded turns are ignored. Turn checkpoints are written to the voice diagnostic log so a renderer restart recovers
  an unfinished voice interaction to idle instead of replaying stale work. A deterministic Voice Turn Recovery Runner
  verifies the complete microphone-to-playback lifecycle plus duplicate finals, stale callbacks, previous-turn responses,
  STT/TTS failures, renderer recovery, duplex reconnects, and spoken interruption. Its JSON and HTML reports preserve the
  exact transition evidence without sending a synthetic prompt to the active project session.
  A Voice Soak & Chaos Runner repeats those production state transitions across 500 deterministic turns. It records stale
  event rejection, duplicate finals, crash recovery, reconnects, interruptions, generation growth, and any state leak in
  bounded batches, while remaining completely isolated from the model, tools, RAG, memory, and active session.
  A separate Voice Reliability Runtime runs bounded real PCM cycles through the Docker TTS, production `DuplexSession`,
  streaming STT, wake-word detection, and echo/barge-in evaluation. It injects deterministic input delay and transport
  reconnect boundaries, records per-cycle failures, and measures backend RSS, thread, and file-descriptor deltas. A live
  watchdog also closes stalled transcription, model, synthesis, playback, or interruption phases with a durable reason
  and returns the composer to idle instead of leaving an endless activity indicator.
  Before a final transcript reaches chat, a deterministic voice-understanding stage applies user-managed vocabulary,
  preserves Ukrainian/English mixed technical speech, adds conservative punctuation, classifies intent, and uses recent
  conversation context to resolve short references. Low-confidence, ambiguous, and destructive requests stay in the
  composer for review and never enter session history or memory. Explicit corrections such as “I said deploy, not
  display” update the personal dictionary without invoking the model. A separate personality stage supports normal,
  work, night, and emergency delivery modes while leaving factual reasoning and complete code work unchanged.
  An optional configurable wake-phrase gate keeps background
  conversation out of the request pipeline, strips the activation phrase from the submitted command, and opens a bounded
  follow-up window for natural conversation. The wake listener can be started automatically only after the user enables
  that setting; no secondary or fallback model is selected for activation.

See [OpenCode Customs features](CUSTOM_FEATURES.md) for architecture, behavior, diagnostics, API endpoints, limitations,
and local build instructions.

### Build the OpenCode Customs desktop app

From `packages/desktop`:

```bash
OPENCODE_CHANNEL=dev OPENCODE_ICON_CHANNEL=customs bun run build
OPENCODE_CHANNEL=dev OPENCODE_ICON_CHANNEL=customs CSC_IDENTITY_AUTO_DISCOVERY=false \
  bunx electron-builder --mac --dir --config electron-builder.config.ts --arm64
```

The unpacked Apple Silicon application is written to `packages/desktop/dist/mac-arm64/OpenCode Customs.app`. This
command does not create a DMG and disables automatic signing-identity discovery.

### Start the local multilingual voice backend

The voice agent uses an independent local streaming STT and OpenAI-compatible TTS service. Start it before enabling
voice input or spoken responses:

```bash
cd services/ukrainian-tts
docker compose up --build -d
docker compose logs -f
```

The first start downloads Silero V5 CIS Extended for Ukrainian, a dedicated Silero English model, the optional Piper
Ukrainian ONNX voice, the contextual Ukrainian accentor, and explicit main/wake faster-whisper models into a persistent Docker volume. OpenCode Customs uses
`http://127.0.0.1:8880/v1/audio/speech` by default. Mixed Ukrainian/English responses preserve both languages, while
configured names and technical terms can receive explicit pronunciation and stress overrides. If the selected mode is
unavailable, the voice loop stops with a visible error and does not switch engines or fall back to Apple speech synthesis. See
[`services/ukrainian-tts/README.md`](services/ukrainian-tts/README.md) for configuration and license details.

As an optional fully local voice, **Settings → General → Voice agent** can use Fish Speech S2 Pro natively on Apple
Silicon through PyTorch MPS. Install and start it from [`services/fish-speech-macos`](services/fish-speech-macos), keep
the loopback `/v1/tts` endpoint, select a reference recording such as OGG, and enter the recording's exact transcript.
OpenCode Customs stores that reference under its local application data and sends it only to the loopback process during
synthesis. There is no Fish Audio API key, Docker CPU inference, cloud request, reference ID, or cloud/Apple fallback.

### Upstream OpenCode installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Upstream Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
