# ADR 0001: Embodied Agent SDK Alpha

- Status: Accepted
- Date: 2026-08-28

## Decision

OpenCode Customs remains an internal reference application. The product boundary is a public Unity 6 package named
`com.embodiedagent.sdk` and a separately distributed local runtime named `Embodied Agent Runtime`.

The Alpha targets macOS arm64, Windows x64, Unity 6, and Meta Quest 3. It qualifies LM Studio and llama-server only.
Cloud providers remain behind the provider interface and are not supported in Alpha.

The public Unity package contains protocol contracts, world sensing, typed capability adapters, presentation hooks,
secure pairing, reconnect, interruption, and fixture replay. The closed runtime owns model access, memory, goals,
permissions, audit, media coordination, and replay evaluation.

The existing `com.opencode.customs.avatar-bridge` package and wire protocol v2.7 remain supported as a compatibility
surface while OpenCode Customs migrates to the new package.

Protocol v2.8 adds optional scenario lifecycle, evidence and training-outcome messages without removing v2.7 turn or
typed-action behavior.

## Product gate

The next release is `Embodied Agent SDK Alpha`. Work outside this milestone is frozen until two external teams agree
to paid design-partner pilots.

Frozen work includes new consumer integrations, coding-agent features already supplied by upstream OpenCode,
embedded hardware runtimes, smart-home support, Unreal, Godot, ROS, Jetson, and general-purpose robotics control.

## Alpha acceptance

- A clean Unity project reaches its first verified scenario in less than 30 minutes.
- The Equipment Isolation sample runs on Quest 3 with voice, interruption, memory, typed actions, and reconnect.
- Switching between LM Studio and llama-server does not change gameplay code.
- Replay catches duplicate delivery, reconnect state loss, permission bypass, stuck barge-in and memory-scope leakage.
- A 20-minute session completes without duplicate replies or lost state.
- Two paid design-partner pilots are signed before the product scope expands.

## Commercial boundary

The Unity SDK is source-available under its published license. Runtime binaries and the hosted Replay implementation
are private pilot deliverables. Alpha does not add online license enforcement; access is controlled by distribution
and the design-partner agreement.
