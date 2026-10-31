---
name: WebKit stale-review test timing
description: Keep optimistic-concurrency browser tests deterministic across engine timing differences.
---

For stale local-copy review tests, attach the synthetic storage mutation to the already-rendered control's capture-phase click event, then use a normal browser click. Separate automation steps can allow ordinary app rerenders to refresh the captured review snapshot before the click; this timing may differ between Chromium and WebKit.

**Why:** A WebKit tablet run refreshed the reviewed evidence between two Playwright commands, making a deliberately stale item appear current and causing its removal instead of the expected stale-evidence rejection.

**How to apply:** Use a capture-phase test hook for the stale mutation and a trusted click for the concurrency check; keep the helper-level exact-byte test as the deterministic source-of-truth assertion. Do not weaken the production version check to accommodate timing.
