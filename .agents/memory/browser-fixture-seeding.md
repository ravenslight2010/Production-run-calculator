---
name: Browser fixture seeding
description: Reliable ways to seed master data for authenticated browser journeys that reload and hydrate from the server.
---

Browser tests that reload the app must seed master-data names through the server-backed fixture path or use names already present in the server pool; browser-only localStorage seeds can be replaced during sync hydration.

**Why:** The app reconciles factory master data during startup, so a localStorage-only brand can disappear after reload even though the test wrote it before navigation.

**How to apply:** Prefer API/DB fixtures for saved sheets and master data. If the test only needs an existing mapping, use a stable built-in name and keep unique IDs/labels for the records under test.

For authenticated accessibility journeys that intentionally seed local day-state, intercept the canonical today-state GET during the reload and clear the isolated fixture row between viewport projects; otherwise startup hydration or prior projects can replace or duplicate the rows under test.

**Why:** The live sync path reconciles local state and writes it back during a multi-viewport run, so a local-only fixture can disappear on the first reload or accumulate across projects even when each page has a fresh browser context.

**How to apply:** Keep the interception limited to the test’s canonical GET, preserve normal writes, and only clear today’s row in the explicitly isolated browser-test database.

For recipe snapshot tests, do not treat an exact live remaining-quantity value as immutable after Start. The quantity legitimately changes with production progress even when the recipe rows are frozen.

**Why:** A fast seeded line can consume enough demand during navigation and reload to make a correct frozen recipe appear to have changed.

**How to apply:** Use a slow deterministic line fixture, pause progress, or assert the frozen recipe inputs separately; keep pending-run quantity assertions exact.

For fresh isolated databases, seed an explicit complete empty today document before mounting Home when the browser will immediately send partial sync deltas.

**Why:** The server treats a partial payload without an existing canonical row as a fallback, not as the initial daily document, so Start Run state can remain local-only and browser evidence fails before the recovery journey.

**How to apply:** Use the authorized fixture API to create the empty complete row, then let the real Home bootstrap and write path run normally; do not bypass the sync protocol with direct browser storage.

For sequential same-date station scenarios, remove the disposable today snapshot and close the prior page/SSE stream before reseeding the next scenario.

**Why:** Today-state sync is additive, and an open live stream can reapply the previous scenario after the database row is cleared, leaving stale runs selected during the next reload.

**How to apply:** Clear browser storage, navigate away from the app, remove the isolated date row, seed the replacement document, then navigate back to the app.

For cold-reload journey tests, finish and canonically confirm lifecycle setup before reloading, then make the tested destination the first post-reload navigation.

**Why:** Starting another run after reload exercises a separate hydration and adoption path, which can obscure whether the cold destination itself restored the expected state.

**How to apply:** Complete the relevant lifecycle transitions before reload, wait for canonical start/end fields for each target run, reload once, then navigate directly to the surface under test.
