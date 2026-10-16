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
