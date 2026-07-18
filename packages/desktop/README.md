# OpenCode Customs Desktop

The desktop-focused OpenCode Customs app, built with Electron. It adds an incremental repository map, project-learned
context routing, LSP graph enrichment, live routing diagnostics, and custom desktop branding on top of OpenCode.

See the repository-level [OpenCode Customs feature guide](../../CUSTOM_FEATURES.md) for behavior and architecture.

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
OPENCODE_CHANNEL=dev OPENCODE_ICON_CHANNEL=customs bun run build
OPENCODE_CHANNEL=dev OPENCODE_ICON_CHANNEL=customs CSC_IDENTITY_AUTO_DISCOVERY=false \
  bunx electron-builder --mac --dir --config electron-builder.config.ts --arm64
```

The unpacked Apple Silicon application is created at `dist/mac-arm64/OpenCode Customs.app`. This command intentionally
skips DMG creation and signing-identity discovery for local testing.
