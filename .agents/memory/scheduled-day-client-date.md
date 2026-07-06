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
day.

**The LIVE row has the same bug (and it's worse — it clobbers).** `GET/PUT
/sync/today` and the `/sync/events` initial-row select originally used server UTC
`todayStr()`. In the evening a client behind UTC pushed its live state under the
server-UTC date = the client's **local tomorrow**, overwriting that scheduled-day
row and its case counts. So `/sync/today` (GET + PUT), the SSE initial-row select,
and the `PUT /sync/:date` same-day broadcast condition **all** now use
`clientToday(req)` too. This makes it a **web AND mobile** change: every live
caller threads `?today=${todayStr()}` (web `home.tsx`, mobile
`context/sync/client.ts` `fetchToday`/`putToday`/`openSyncStream`).

**SSE broadcasts must be date-scoped, not just scope-scoped.** Keying the row by
client date isn't enough: `broadcast()` fanned out to all same-`scope` clients
regardless of date, so a peer on a different local day still received another day's
payload into its live view. `SseClient` now stores a `watchDate` (= `clientToday`
at connect) and `broadcast(…, date)` only delivers to matching `scope + watchDate`.

**How to apply:** every client caller (web + mobile) appends `?today=${todayStr()}`
(SSE uses `&today=`) to ALL sync URLs — scheduled-list, delete, AND the live
today/events/rollover paths. All are backward-compatible: missing/malformed
`?today=` falls back to server UTC. `isValidDate` is **format-only**
(`^\d{4}-\d{2}-\d{2}$`) — it accepts calendar-impossible strings like `2030-13-99`;
the fallback only triggers on non-format-matching input. Receivers also keep a
`remoteDateOk` guard (`!remoteDate || remoteDate===todayStr()`); the `!remoteDate`
leg is legacy tolerance — server date-scoping is the real defense.

**Easy-to-miss caller: the schedule-import PUTs.** The web Excel import commit paths
(`commitMultiDayImport` + single-day `commitExcelImport` in `home.tsx`) write each
day via `PUT /sync/${date}` and were originally missing `?today=`. Symptom: after a
multi-day import, future/scheduled days appeared but **today's** runs never showed in
the live view — the today-row write was stored but its same-day SSE broadcast never
fired (server fell back to UTC, which ≠ operator's local date on a US evening). Fix =
append `?today=${todayStr()}` to those PUTs too. Lesson: ANY new dated sync write must
thread the client `?today=`, not just the obvious live today/events paths.

**Known gap (left intentionally):** neither client rotates its SSE stream date at
local midnight — the EventSource/stream is opened once with a single `todayStr()`.
A device left open across midnight keeps the prior day's `watchDate` until reload/
remount. The daily-reset flow generally remounts, so this is a narrow edge.
