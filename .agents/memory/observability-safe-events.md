---
name: Safe operational observability
description: Structured production events must carry correlation and timing metadata without copying request or recipe payloads.
---

Operational telemetry should describe the operation, outcome, duration, and bounded counts; payloads, credentials, recipe contents, and user-entered text do not belong in logs. Health responses should separate process, database, and optional external dependency state, while reports carry release and recovery evidence.

**Why:** Production failures need actionable diagnosis without turning logs into a second copy of sensitive operational data.

**How to apply:** Add telemetry at shared request/startup boundaries and expose only allowlisted machine-readable error codes and counters.