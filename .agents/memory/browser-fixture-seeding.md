---
name: Browser fixture seeding
description: Reliable ways to seed master data for authenticated browser journeys that reload and hydrate from the server.
---

Browser tests that reload the app must seed master-data names through the server-backed fixture path or use names already present in the server pool; browser-only localStorage seeds can be replaced during sync hydration.

**Why:** The app reconciles factory master data during startup, so a localStorage-only brand can disappear after reload even though the test wrote it before navigation.

**How to apply:** Prefer API/DB fixtures for saved sheets and master data. If the test only needs an existing mapping, use a stable built-in name and keep unique IDs/labels for the records under test.

For recipe snapshot tests, do not treat an exact live remaining-quantity value as immutable after Start. The quantity legitimately changes with production progress even when the recipe rows are frozen.

**Why:** A fast seeded line can consume enough demand during navigation and reload to make a correct frozen recipe appear to have changed.

**How to apply:** Use a slow deterministic line fixture, pause progress, or assert the frozen recipe inputs separately; keep pending-run quantity assertions exact.