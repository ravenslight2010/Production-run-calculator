---
name: Multi-day import silent 401 failure
description: Why a schedule import can fail "N of N days" with no reason, and the required 401 handling in raw-fetch loops
---
Raw-fetch write loops (e.g. the multi-day schedule import's per-day `PUT /api/sync/:date`) bypass `api()`'s automatic 401→login bounce, so an expired session (daily midnight auth boundary) makes EVERY iteration fail with an opaque generic toast.

**Why:** the user's "9 of 9 days failed" schedule import reproduced ONLY as a 401 — the file parsed cleanly and realistic authenticated payloads (~21 KB max) all saved fine. Server logs rotate fast, so without client-side status capture the failure is undiagnosable after the fact.

**How to apply:** any raw-fetch loop that writes to `/api` must (1) check for 401, stop immediately, explain "signed out", and call `reportUnauthorized()` (exported from web `inventoryShared.ts`) to reuse the central auth bounce; (2) capture the first non-ok status + server error string into the failure toast. Mirror on mobile when parity resumes (logged in .local/parity-pause-log.md).
