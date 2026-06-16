---
name: Sync body-parser limit
description: Why the API server raises the Express body limit, and the day-state payload growth risk behind it.
---

The Express API (`artifacts/api-server`) sets `express.json`/`express.urlencoded` limits to `10mb` instead of the default ~100kb.

**Why:** day-state sync payloads (`PUT /api/sync/today` and `PUT /api/sync/:date`) embed full per-run recipe `FormValues` for every run. Real-world days exceed 100kb, so the default limit returned `413 PayloadTooLargeError` on every write — silently breaking live sync AND scheduled-day saves (`saveScheduledDay`). The user perceived a failed scheduled-run save as a crash.

**How to apply:** if sync 413s reappear, the payload outgrew the limit again. Prefer trimming non-essential fields from the synced payload over endlessly raising the limit. The day-state shape (per-run full recipe) is the growth driver — adding more per-run fields amplifies payload size on both web and mobile (they share this server).
