---
name: Playwright offline SSE fixtures
description: Deterministic browser modeling of a sleeping client with an already-open EventSource connection
---

A browser context's offline toggle does not reliably close an already-open
EventSource in headless Chromium. To model an asleep stale client, navigate it
to a same-origin inert route before setting the context offline; this preserves
localStorage while removing the live app/SSE connection. Restore connectivity
and navigate back to the app to exercise reconnect and reload adoption.

**Why:** Route interception and `setOffline(true)` alone allowed an existing SSE
stream to deliver peer updates, making the supposed stale-peer assertion
non-deterministic.

**How to apply:** Use the shared two-context harness for offline/wake scenarios,
and keep the inert route same-origin so the fixture can still inspect local
storage. Use the app's real reload/foreground path for recovery.