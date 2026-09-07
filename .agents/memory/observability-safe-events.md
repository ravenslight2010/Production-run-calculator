---
name: Safe operational observability
description: Structured production events must carry correlation and timing metadata without copying request or recipe payloads.
---

Operational telemetry should describe the operation, outcome, duration, and bounded counts; payloads, credentials, recipe contents, and user-entered text do not belong in logs. Health responses should separate process, database, and optional external dependency state, while reports carry release and recovery evidence.

User-visible incident references should be the same correlation IDs emitted by structured server events. When one request reports another failed request, retain both bounded references so developers can follow the chain without retaining URLs or bodies.

**Why:** Production failures need actionable diagnosis without turning logs into a second copy of sensitive operational data.

**How to apply:** Add telemetry at shared request/startup boundaries and expose only allowlisted machine-readable error codes and counters.