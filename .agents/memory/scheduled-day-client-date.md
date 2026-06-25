---
name: Scheduled-day filter must use client-local date, not server UTC
description: Why server sync endpoints that gate "future days" must honor a client-supplied date, or scheduled days vanish a day early in production.
---

The web schedule is **server-backed** (mobile schedule is local-only and already
filters by the client's own `todayStr()`). The whole app's day boundary is the
**client's local midnight**, but the API server runs in **UTC in production**.

**Rule:** any server endpoint that decides "is this date in the future / past /
today" for scheduling must compare against a **client-supplied** date, not the
server clock. In `sync.ts` this is the `clientToday(req)` helper (reads `?today=`,
format-validates, falls back to server `todayStr()`); `GET /sync/scheduled`'s
`gt(date, …)` filter and the `DELETE /sync/:date` past-day guard both use it.

**Why:** a user behind UTC sees their local "tomorrow" equal the server's UTC
"today". A strict server-date `gt` filter drops it, so the next day's schedule
"disappears" a day early. Same class of bug blocks deleting/moving a local-future
day. Mobile needs no change → this is a **web-only** fix (parity preserved).

**How to apply:** every web caller must append `?today=${todayStr()}` to these
sync URLs. Endpoints NOT on the scheduled-list filtering path (e.g. `PUT /sync/:date`
same-day SSE broadcast, explicit `/api/sync/${newDate}` rollover fetches) are
date-explicit and do not need the param. `isValidDate` is **format-only**
(`^\d{4}-\d{2}-\d{2}$`) — it accepts calendar-impossible strings like `2030-13-99`;
the fallback only triggers on non-format-matching input.
