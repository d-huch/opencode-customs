# Changelog

## Unreleased

- Added AI Trainee Guided and Blind profiles for typed scenario execution.
- Added simulation-only critical auto-approval with a game-owned category allowlist.
- Added Scenario Studio and Runtime controls for live and fixture AI tests.
- Raised Avatar Bridge to v2.12 for bounded scenario reset and baseline validation while preserving v2.11 clients.

- Added Teach-by-Demo LOTO recording for Unity Desktop and Quest, including bounded semantic action capture, narration-to-action binding and idempotent Runtime persistence.
- Added the Review Wizard for edit, reorder, split, merge, exclude, Scenario v1 generation and immediate training test.
- Added practical trainee interactions, deterministic order/precondition enforcement, critical-action approval and first-attempt/unsafe-attempt assessment.
- Raised Avatar Bridge to v2.10 while preserving v2.9 clients.

## 0.4.0-beta.2

- Added a localhost-only Live Instructor Console for one supervised Unity Desktop or Quest trainee.
- Added idempotent pause, resume, retry, safe termination, text hints, instructor-owned evidence and approval controls over Avatar Bridge v2.9.
- Preserved step attempts and timeout state, added reconnect-safe command recovery, trainee HUD states and instructor intervention audit records.
- Expanded Replay Lab with supervised-session assertions for duplicate commands, evidence ownership and safe termination.

## 0.4.0-beta.1

- Added safe Runtime crash recovery diagnostics, retention controls and supervised process packaging.
- Added durable idempotent xAPI delivery, manual uncertain-result retry and OS-protected credentials.
- Expanded Replay with ordering, crash, approval-expiry, corrupted-state and result-redelivery assertions plus signature verification.
- Improved Scenario Studio with capability selection, transition targets, reordering, Undo and revision compatibility previews without changing schema v1.
- Beta release remains blocked until production signatures, device/Windows evidence and two paid design-partner pilots are present.

## 0.3.0-alpha.1

- Added the pilot-ready Equipment Isolation workflow, onboarding metrics, support bundle, Quest build validation, and air-gapped distribution.
- Frozen deterministic scenario manifest schema v1 and public training/replay contracts for supervised design-partner pilots.
- Added passwordless one-time localhost Control Center launch and standalone Replay CLI distribution.

## 0.2.0-alpha.1

- Added deterministic Scenario Studio authoring, validation, runtime execution, evidence and training outcomes.
- Added JSON, CSV, hash-chained audit and optional xAPI result sinks.
- Extended Replay Lab, diagnostics and protocol-v2.8 scenario lifecycle compatibility.

## 0.1.0-alpha.1 — 2026-08-28

- Introduced the public `EmbodiedAgent.Unity` namespace and UPM identity.
- Added localhost bootstrap, reconnect, heartbeat, cancellation, idempotency, and protocol-v2.7 compatibility.
- Added bounded semantic world sensing and typed capability manifests with risk, permissions, preconditions,
  postconditions, and side effects.
- Added the Setup Wizard and clean-scene validation.
- Added the Equipment Isolation Safety Instructor sample with critical approval boundaries.
- Added fixture recording/replay compatibility with the standalone Runtime.
