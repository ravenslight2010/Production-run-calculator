---
name: Field verification boundary
description: Durable design rule for passive in-app field evidence and its relationship to production state.
---

Field verification is an advisory observation layer: it may watch naturally occurring lifecycle, sync, and performance signals, but it must never drive production state, simulate staff actions, or block persistence.

**Why:** Field evidence is useful across real devices only when it cannot change the behavior it is measuring; coupling it to live run state would turn diagnostics into an operational risk.

**How to apply:** Keep collection best-effort, privacy-bounded, facility-scoped, and separately persisted. Treat browser-observed results and hardware-only confirmations as distinct claims, and keep actionable issue rollups separate from successful evidence summaries.

Telemetry delivery must never feed its own failures back into the same telemetry stream.

**Why:** If a rejected or unavailable observation endpoint emits a new observation about that rejection, retries become a self-sustaining request flood and fresh clients can immediately exhaust their rate limit.

**How to apply:** Exclude telemetry-ingest transport failures at the shared instrumentation boundary while continuing to observe unrelated API failures. Regression checks should prove both the exclusion and normal API-failure visibility.