# Typed capability contract

Unity registers a bounded manifest for every action. The model sees only the manifest and never a Unity hierarchy,
reflection API, filesystem, shell, or arbitrary method name.

Every capability declares:

- stable action ID and JSON argument schema;
- risk class: `ambient`, `interaction`, or `critical`;
- permission category;
- preconditions and expected postconditions;
- side effects, cooldown, timeout, and cancellation support.

The Runtime validates arguments, applies policy, obtains approval when required, and sends a sequence/idempotency
key. Unity validates preconditions again at execution time. After a meaningful action it sends the result and a fresh
world observation so the Runtime can verify postconditions before proceeding.

The Safety Instructor sample demonstrates this contract with six specific actions. `safety.apply_lockout` and
`safety.complete_exercise` are critical and can never be auto-approved by the model.
