---
name: Playwright offline EventSource behavior
description: Deterministic browser tests for connectivity transitions when Chromium keeps existing SSE streams open
---

Headless Chromium's browser-context offline flag may update `navigator.onLine`
without closing an established EventSource. Adding a page route after that
stream opens does not terminate it, and buffered frames can still update the
screen while its status is stale. For deterministic outage tests, block sync
traffic before opening or recreating the stream; alternatively, navigate to a
same-origin inert route before setting the context offline to model a sleeping
client. Only assert the display keeps its old value while the route proves sync
traffic is blocked.

**Why:** An existing SSE stream can deliver a buffered peer update even after
`navigator.onLine` becomes false, so connectivity state alone does not prove
that the screen is isolated from sync.

**How to apply:** Use the shared two-context harness's sync-traffic blocker
before recreating the stream, then release it before wake recovery and verify
both the canonical read and the adopted stream baseline. If using an inert
route, keep it same-origin so the fixture can still inspect local storage.

When a browser test injects a sync failure with Playwright request routing,
block service workers so they cannot satisfy the request first. To test
recovery driven by the browser's `online` event, toggle the browser context
offline and online; dispatching a synthetic `focus` event does not exercise
that listener.

**Why:** A service worker can bypass the page route, and a synthetic focus
event can make a recovery test pass or fail without covering the production
connectivity path.

**How to apply:** Set `serviceWorkers: "block"` for the test context, install
the failing route before the outage, observe the rejected request, remove the
route, and use real connectivity transitions before asserting the recovered
request and connected state.