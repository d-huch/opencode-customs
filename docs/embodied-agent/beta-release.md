# Embodied Agent SDK 0.4.0-beta.2 release gate

The source tree may build a **Beta development candidate**, but a production Beta is not declared until every external gate
is evidenced. `bun script/check-embodied.ts --beta --unity --quest --build` enforces the machine-readable gate.

Required evidence:

- Developer ID Application and Installer identities plus notarization profile;
- Authenticode-signed Windows Runtime, Replay CLI and MSI validated on Windows x64;
- Ed25519 audit and offline-update signing keys;
- dependency vulnerability report and generated SBOM/license inventory;
- physical Quest 3 20-minute soak report;
- independent clean-machine onboarding in 30 minutes or less;
- at least two paid design partners.

The immutable release commit must produce the macOS installer, Windows MSI, Quest APK and Unity package used by pilots.
No gate may be replaced by a self-authored placeholder report. A failed gate keeps the artifact labelled development.

The supported deployment is one customer-managed workstation with LM Studio or llama-server, Unity Desktop simulation and
one Quest 3 client. Cloud orchestration, multi-station LAN, Unreal, robotics and consumer integrations are out of scope.
