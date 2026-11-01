---
name: Browser fixture seeding
description: Reliable ways to seed master data for authenticated browser journeys that reload and hydrate from the server.
---

Browser initialization scripts must not become recurring writers of recovered
fixture state.

**Why:** Playwright reruns an initialization callback after document reloads and
inside child frames. An unconditional seed can replace acknowledged state,
including its reset boundary, and produce misleading recovery failures.

**How to apply:** Initialize only the owned top-level scenario once per session,
mark completion after its writes succeed, and preserve canonical data on reload.
Do not weaken application reset/conflict fences to accommodate a fixture.

Role fixtures that overwrite a shared built-in role must preserve its full
canonical capability set, not just the capabilities used by their own journey.

**Why:** An incomplete manager fixture removed QC capabilities from the isolated
database's role definition, hiding legitimate surfaces in subsequent cases.
Per-account cleanup does not undo mutations to shared role definitions.

**How to apply:** Compare the full-manager fixture against the current server
capability authority before interpreting downstream authorization failures.
Give restricted-role journeys only their explicitly intended grants; never
change production permissions to compensate for an incorrectly seeded test.

Use the production surface's rendered accessibility tree when selecting
portaled controls; do not assume a standalone component demo's named wrapper
also exists in the operational page.

**Why:** A calendar demo supplied its own named region, while the real Schedule
calendar lived in a separate popover dialog. Reusing the demo's container
selector made valid calendar controls appear missing and obscured diagnosis.

**How to apply:** Confirm the actual container before adapting component-demo
selectors into an operational journey, and bound locator waits so a missing
wrapper fails before fixture cleanup loses its test-time budget.

Calendar tests must deliberately display a month containing past dates before
requiring a disabled past-date control.

**Why:** On the first day of a Sunday-first month, the current month can
legitimately contain no earlier visible dates. Requiring any disabled button
then reports a fixture failure even though the date restriction is correct.

**How to apply:** Visit the previous month, verify past-date rejection, then
restore the original month and check selection. Keep the application's date
limits unchanged and cover month/year boundaries as well as ordinary days.

Full-suite ordering can expose stale fixture epochs that a fresh-database
standalone browser run cannot.

**Why:** Guarded Undo advances a scope-wide master-data epoch. Later tests using
raw API fixture writers can then fail before their journey begins, even under a
different fixture account; restarting on an empty database hides that cause.

**How to apply:** Exercise newly prepared fixture seeds against an advanced
canonical epoch when confirming repairs. Preserve rejection of stale pending
edits: fetching a new epoch must not become automatic replay of a rejected
mutation.

When a manual-counter browser fixture requires fixed totals, disable automatic
tracking in the canonical seeded run as well as matching local recovery data.

**Why:** Legitimate server coordination can otherwise consume staged supply
between UI steps, making a correct live baseline look like a hydration failure.
Browser-only preferences do not disable the server coordinator.

**How to apply:** Set the fixture's canonical `autoTrackDisabled` control, or
derive assertions from an observed canonical baseline when automatic work is
part of the scenario. Keep production defaults and station math unchanged.

Browser tests that reload the app must seed master-data names through the server-backed fixture path or use names already present in the server pool; browser-only localStorage seeds can be replaced during sync hydration.

**Why:** The app reconciles factory master data during startup, so a localStorage-only brand can disappear after reload even though the test wrote it before navigation.

**How to apply:** Prefer API/DB fixtures for saved sheets and master data. If the test only needs an existing mapping, use a stable built-in name and keep unique IDs/labels for the records under test.

After reload, a mounted app shell is not proof that canonical master data has hydrated.

**Why:** Deliberate startup deferral can leave recipe lists temporarily empty even after the fixture write was acknowledged; a default visibility assertion may expire before loading begins.

**How to apply:** Arm a master-data response wait before navigation, verify the expected fixture slice in that response, then assert its rendered controls. Keep real bootstrap reads enabled rather than bypassing deferral or using fixed sleeps.

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

For browser matrices whose projects share one disposable database, reset test-owned operational state between projects instead of relying only on global setup.

**Why:** Global setup runs once for the matrix; an earlier viewport can leave a live run in the shared fixture and make later projects start from the wrong state.

**How to apply:** In each test's setup, remove only the current test's live-day fixture rows from the guarded disposable database, and keep the normal Home hydration path enabled.

Immutable approval/audit fixtures need explicit test-owned record cleanup as
well as account cleanup, even inside a disposable multi-project browser run.

**Why:** Such ledgers intentionally survive actor deletion; one viewport's
retained records can invalidate another viewport's empty-list assumption.
Reusing the lifecycle record for a second fixture can also correctly conflict.

**How to apply:** Give each independently seeded ledger record a unique opaque
reference, track those references, and remove only those records in the guarded
disposable database during cleanup. Do not weaken ledger retention or reset
shared application data to make a fixture pass.

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

For independent-browser and serial-project fixtures, bind assertions to the
rendered form's run identity, not equal settings or the server's current index.

**Why:** Device-local selection can differ from server selection, and earlier
matrix cases can leave another run with identical settings. Matching those values
selected an ended run rather than the paused run actually being tested.

**How to apply:** Read the rendered owner ID, verify canonical values under that
exact key, and explicitly select that same run in the independent browser. Keep
its operational storage empty; copying cached run values would hide hydration
failures.

For error-and-retry UI journeys, keep a mocked outage active until the intended
recovery action rather than failing only the first request.

**Why:** Mount/session refetches can consume a one-shot error and restore the
empty/success state before the error assertion, without any user retry.

**How to apply:** Hold the failure flag through the visible error assertion,
then release it immediately before the explicit Retry action. Do not disable
normal application refetching or change the production retry policy.
