---
name: Owner-selected SSE topology
description: Owner's single-process SSE decision and limits on related work.
---

The owner-provided SSE brief dated 2026-10-03 selects Option A: one always-on
API process/instance. Do not implement shared fanout or claim multi-instance
live peer updates without a new owner decision.

**Why:** The owner explicitly chose the simpler single-process operating model
instead of authorizing a shared broker.

**How to apply:** Document this requirement and separately verify the actual
deployment constraint. The owner's choice is not proof that a published
deployment already enforces it. Preserve soft readiness for optional AI/workers.