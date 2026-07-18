<p align="center">
  <img src="packages/desktop/icons/customs/icon.png" width="180" alt="OpenCode Customs icon">
</p>
<h1 align="center">OpenCode Customs</h1>
<p align="center">A desktop-focused, repository-aware customization of OpenCode.</p>

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
- A project-learned concept router for abstract tasks. It derives vocabulary from the current codebase instead of using
  a fixed business-term dictionary or assuming a particular framework.
- Context ranking that combines prompt evidence, analogous implementations, attached files, symbols, and graph
  neighborhoods before selecting a compact set of files for the model.
- Bounded RAG that retrieves small source windows around ranked symbols and concept evidence instead of injecting whole
  files into the prompt.
- Durable, project-scoped memory for verified compaction facts and successful file routes. Recall is query-specific and
  contributes only a few matching notes and paths to each request.
- Resource-aware prompt admission for custom models, including conservative fallback limits, full-request preflight,
  budgeted tool/system context, bounded history compaction, a live context-usage indicator, and protection from duplicate
  title-generation requests on the active model.
- Local Agent Runtime layers for LM Studio: a read-only capability bridge, an adaptive Resource Governor, and durable
  execution checkpoints that recover abandoned sessions after an OpenCode process restart without replaying completed
  local tools.
- A desktop **Map** panel with index metrics, manual reindexing, LSP status, and opt-in live routing diagnostics.
- A separate **Extensions** menu that discovers installed ChatGPT/Codex plugin bundles, exposes their skills to the
  agent, and starts enabled bundled MCP servers alongside native OpenCode plugins.
- Custom OpenCode Customs desktop branding and macOS application/Dock icons.

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
