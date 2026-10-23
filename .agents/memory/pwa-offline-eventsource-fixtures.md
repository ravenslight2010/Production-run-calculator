---
name: PWA offline EventSource fixtures
description: Model reconnect reliably when Playwright simulates an offline browser.
---

When a browser test must prove the reconnect behavior of an already-open PWA, close the fixture-owned EventSource response during the simulated outage, then dispatch or await the browser's online signal before asserting recovery.

**Why:** In the isolated PWA fixture, toggling Playwright's offline mode did not reliably close the already-open server-side SSE response. Without an explicit disconnect, the browser had no reason to reconnect and the auth recheck was never exercised.

**How to apply:** Use this in browser tests for session revalidation or sync recovery after a network drop. Keep the service worker, open page, and local run state intact; only the fixture's stream should be closed.

For service-worker update-recovery tests, build genuinely distinct old/new application identities; changing only fixture HTML or worker bytes does not prove that the app recognized a new build.

**Why:** Recovery confirmation compares the application's own build fingerprint, so a visually different document can still be treated as the same build.

**How to apply:** When testing update confirmation, assert both actual application build identities and authenticated startup after the reload, alongside worker lifecycle evidence.

For ordinary API error/retry journeys using Playwright request interception,
block service workers in the fixture context unless their lifecycle is the
behavior under test.

**Why:** After reload, WebKit served report requests through the installed worker
and bypassed `page.route`; an intended synthetic 503 remained a real 200. This
looked like broken error UI even though no failing response reached the app.

**How to apply:** Confirm the injected HTTP status was observed before diagnosing
the UI. Keep workers enabled for actual offline/update lifecycle tests, and label
worker-blocked report evidence so it is not mistaken for PWA lifecycle coverage.
