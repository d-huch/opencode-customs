# Self-Service Alpha release gate

The Alpha is releasable to external Unity teams only when every automated gate passes and a clean-machine observer can
complete import, Runtime configuration, SDK root creation, scenario authoring, one verified run and Replay evaluation in
under 30 minutes without developer help.

## Reliability SLO

- One final input creates exactly one model turn and one final response.
- One typed action request executes at most once for its idempotency key.
- Reconnect preserves canonical session and current scenario revision.
- Interruption returns presentation and cancellable action state to neutral within 150 ms.
- A model can never lower game-owned capability risk or bypass a critical permission.
- Training results never contain raw audio or model prompts.

## CI gates

`bun run check:embodied --unity --quest --build` checks the Runtime, v2.9 bridge parser, package identity, clean Unity import,
EditMode and PlayMode scenario tests, sample generation, five intentional Replay regressions, macOS/Windows binaries,
Quest development APK, signed Replay audit output, checksums and the SBOM. External distributions additionally require
Developer ID/notarization, Authenticode and the pilot audit signing key.

## Commercial gate

Give the closed Alpha to five qualified Unity teams. Do not expand authoring, platforms or consumer features until two
teams pay for Alpha access or an annual SDK license. If 20 qualified contacts produce fewer than two paid users, revisit
the segment and offer rather than expanding the feature surface.
