---
name: Safe operational observability
description: Structured production events must carry correlation and timing metadata without copying request or recipe payloads.
---

Operational telemetry should describe the operation, outcome, duration, and bounded counts; payloads, credentials, recipe contents, and user-entered text do not belong in logs. ORM/database exception objects may include SQL text and bound values, so do not pass them raw to structured loggers at write boundaries. Health responses should separate process, database, and optional external dependency state, while reports carry release and recovery evidence.

User-visible incident references should be the same correlation IDs emitted by structured server events. When one request reports another failed request, retain both bounded references so developers can follow the chain without retaining URLs or bodies.

Manager sync diagnostics should expose only a fixed-shape aggregate of exact-snapshot skips and successful partial/complete peer sends, plus the telemetry-window duration; do not forward the full process-capacity snapshot.

**Why:** Production failures need actionable diagnosis without turning logs into a second copy of sensitive operational data; database drivers can attach user-provided values to otherwise ordinary write errors.

**How to apply:** Add telemetry at shared request/startup boundaries and expose only allowlisted machine-readable error codes and counters. For database failures, log safe error metadata and bounded counts rather than `{ err }`, query text, or parameters. For sync health, project only the fixed peer-frame summary required by operators.