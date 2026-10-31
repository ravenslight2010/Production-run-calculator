---
name: Playwright 304 responses
description: Treat cached 304 responses as successful script fetches in browser smoke assertions.
---

An HTTP 304 is a valid `Not Modified` cache response, but Playwright's `response.ok()` evaluates false because it is outside the 200–299 range. Do not classify a 304 as a failed script request. Check HTTP errors with `status >= 400`, while continuing to fail on `requestfailed` and `pageerror`.

**Why:** In an isolated WebKit panel smoke, cached JavaScript returned 304 for each viewport; treating `!response.ok()` as failure created false positives even though the pages loaded and their journeys completed.

**How to apply:** In browser response checks, distinguish HTTP error statuses from cache revalidation. Keep network failures and uncaught application errors covered through their separate browser events.
