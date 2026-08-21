---
name: Offline browser test events
description: Headless Chromium behavior when testing offline fetch failures and lifecycle wake retries
---

For browser tests that need one failed fetch followed by an online or focus retry, do not rely on Chromium emitting `requestfailed` after `BrowserContext.setOffline(true)`. In headless runs, the fetch can be suppressed before Playwright observes a request.

**Why:** An offline-context test can wait indefinitely even though the application correctly attempted recovery.

**How to apply:** Intercept the exact request with a one-shot `route.abort("failed")`, trigger the app's stable focus wake event, remove the route, and dispatch the online event for the real retry. Verify recovered state plus a post-recovery user action so a stuck barrier cannot pass.