---
name: Field verification boundary
description: Durable design rule for passive in-app field evidence and its relationship to production state.
---

Field verification is an advisory observation layer: it may watch naturally occurring lifecycle, sync, and performance signals, but it must never drive production state, simulate staff actions, or block persistence.

**Why:** Field evidence is useful across real devices only when it cannot change the behavior it is measuring; coupling it to live run state would turn diagnostics into an operational risk.

**How to apply:** Keep collection best-effort, privacy-bounded, facility-scoped, and separately persisted. Treat browser-observed results and hardware-only confirmations as distinct claims, and keep actionable issue rollups separate from successful evidence summaries.