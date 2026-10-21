---
name: Safe operational observability
description: Structured production events must carry correlation and timing metadata without copying request or recipe payloads.
---

Operational telemetry should describe the operation, outcome, duration, and bounded counts; payloads, credentials, recipe contents, and user-entered text do not belong in logs. ORM/database exception objects may include SQL text and bound values, so do not pass them raw to structured loggers at write boundaries. Health responses should separate process, database, and optional external dependency state, while reports carry release and recovery evidence.

User-visible incident references should be the same correlation IDs emitted by structured server events. When one request reports another failed request, retain both bounded references so developers can follow the chain without retaining URLs or bodies.

Manager sync diagnostics should expose only a fixed-shape aggregate of exact-snapshot skips and successful partial/complete peer sends, plus the telemetry-window duration; do not forward the full process-capacity snapshot.

**Why:** Production failures need actionable diagnosis without turning logs into a second copy of sensitive operational data; database drivers can attach user-provided values to otherwise ordinary write errors.

**How to apply:** Add telemetry at shared request/startup boundaries and expose only allowlisted machine-readable error codes and counters. For database failures, log safe error metadata and bounded counts rather than `{ err }`, query text, or parameters. For sync health, project only the fixed peer-frame summary required by operators.

Process-local counters are best-effort observations, not fleet-wide evidence. In a multi-instance deployment, each instance may see only part of an overall failure pattern. Any fleet-wide interpretation requires shared aggregation and deduplication, while retaining only bounded result and trigger labels.

**Why:** Keeping low-cost observations process-local can avoid a database write for every failed request, but an individual instance cannot represent fleet-wide state.

**How to apply:** Treat process-local warnings as local degradation signals. If fleet-wide detection is needed, design a bounded shared event path and measure its added database load first.

Public health diagnostics that need to distinguish groups derived from predictable operational values should use process-random keyed fingerprints, not plain hashes; treat those references as process-local, not durable identifiers.

**Why:** Scope and time-bucket candidates are low-entropy and can be recovered from an unkeyed digest by enumeration, even when the raw values are omitted.

**How to apply:** When diagnostics need a within-process grouping reference, use a keyed digest with an ephemeral key and keep the payload bounded. Do not expose a plain hash of guessable scope, date, or bucket values.