---
name: Browser peer startup ordering
description: Cross-device browser tests must isolate snapshot no-op assertions from peer hydration writes.
---

When a browser journey compares an unchanged sync snapshot, make that assertion before opening the second authenticated context. A peer that is still hydrating can issue a legitimate background merge, so the canonical snapshot may change even though the server is behaving correctly.

**Why:** Viewport and timing differences made the desktop project race a peer startup write while the phone project did not, producing a false convergence failure.

**How to apply:** Establish the canonical snapshot and test the unchanged response first; only then boot/offline the stale peer for reset, wake, adoption, and reload assertions.