---
name: Browser fixture seeding
description: Reliable ways to seed master data for authenticated browser journeys that reload and hydrate from the server.
---

Browser tests that reload the app must seed master-data names through the server-backed fixture path or use names already present in the server pool; browser-only localStorage seeds can be replaced during sync hydration.

**Why:** The app reconciles factory master data during startup, so a localStorage-only brand can disappear after reload even though the test wrote it before navigation.

**How to apply:** Prefer API/DB fixtures for saved sheets and master data. If the test only needs an existing mapping, use a stable built-in name and keep unique IDs/labels for the records under test.

For authenticated accessibility journeys that intentionally seed local day-state, use the browser-local date and write a complete canonical today document through authenticated `/api/sync/today` with the current reset epoch. Leave the real GET/bootstrap and normal sync-write paths enabled; do not intercept the canonical GET or broadly delete `daily_sync` rows.

**Why:** Intercepting canonical reads or deleting shared day rows bypasses reset-epoch and sync reconciliation behavior, so a fixture can appear stable while the real hydration path is broken.

**How to apply:** Seed through the authenticated fixture API before mounting the page, then let the app hydrate and sync normally. Keep test runs isolated with the disposable database and assert the browser-local day that was seeded.

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

For multi-context tests that seed a brand profile directly, also seed its brand and flavor in the canonical master-data snapshot consumed by each fresh context; keep orphan-profile cleanup enabled.

**Why:** A fresh browser context has independent localStorage, and startup cleanup tombstones profiles whose brands are absent from the hydrated master list.

**How to apply:** Include the brand and its flavor in the canonical sync fixture before opening the secondary context. Do not bypass cleanup with a marker or weaken profile persistence assertions.

For browser actions over seeded live-day runs, wait for the explicit confirmed
server baseline before changing values whose fan-out depends on the canonical
run snapshot; a mounted Run tab or visible run count is not sufficient.

**Why:** Under the full serial browser workload, the run list can render before
server run values are adopted. A manager weight write can be acknowledged and
update its shared profile while a pending-run snapshot remains stale.

**How to apply:** After mounting the Run tab, assert the operational state badge
shows `Confirmed server baseline` before the first edit, then separately assert
the fixture run selection/count. Avoid fixed sleeps.
