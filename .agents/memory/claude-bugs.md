---
name: Claude bug tracker
description: Running log of bugs Claude has found while auditing this repo, split into Bugs Found (Open) and Bugs Fixed. Check the Open section before starting a fresh bug sweep to avoid re-discovering the same issue, and check Fixed before re-applying a fix that's already landed.
---

# Claude Bug Tracker

This file tracks bugs found during Claude-led code reviews of this repository. It has two sections:

- **Bugs Found (Open)** — confirmed, reproduced bugs that have not been fixed yet.
- **Bugs Fixed** — bugs that started in the Open section and were later fixed. When a bug is fixed, move its entry down into this section and add a **Fix** field describing exactly what changed.

Each entry includes:
- **Date found** / **Date fixed**
- **File(s)**: paths involved
- **Problem**: what's wrong, in concrete terms
- **How confirmed**: what reproduction/evidence was used (not just "looks wrong")
- **Fix** (Bugs Fixed only): what was changed and why it resolves it

---

## Bugs Found (Open)

_(none currently — see Bugs Fixed below)_

---

## Bugs Fixed

### 2026-09-10 — Username uniqueness was case-sensitive at the DB level, case-insensitive in app logic

**File(s):** `lib/db/src/schema/users.ts`

**Problem:** The `users` table enforced uniqueness on `username` via a plain `.unique()` constraint — case-**sensitive**. But every piece of application logic that reads or checks usernames (`findUserByUsername`, `isUsernameAvailable`, sign-in) compares with `lower(username) = lower(handle)` — case-**insensitive**. The app's own duplicate-key race guard only catches Postgres's `23505` unique-violation error, which only fires on an *exact-case* collision. Two concurrent sign-ups for case-variant names (e.g. `"Alice"` and `"alice"`) could both pass the app's case-insensitive pre-insert availability check and land as two distinct DB rows, since the DB constraint itself never noticed the collision.

**How confirmed:** Fired 5 concurrent `POST /api/auth/sign-up` requests for `RaceUser2` / `raceuser2` / `RACEUSER2` / `RaceUSER2` / `raceUSER2` against a live server + Postgres instance. Before the fix: 2 separate rows landed in `users` for the same lowercase identity. After the fix: only 1 row landed, the other 4 requests were correctly rejected with `409`.

**Fix:** Replaced the case-sensitive `.unique()` constraint with a functional case-insensitive unique index: `uniqueIndex("users_username_lower_idx").on(sql\`lower(${t.username})\`)`. This makes the database itself the source of truth for the invariant the app already assumed. Followed `.agents/memory/additive-push-force-schema.md`'s guidance to use `uniqueIndex` rather than `.unique()` when changing a constraint on a populated table via `push-force`. Verified the schema push applies cleanly (no interactive prompt) and re-ran the same concurrent-request repro post-fix to confirm only one row is ever created.

---

### 2026-09-10 — Daily-reset session-boundary fence could be silently bypassed when `?today=` was omitted

**File(s):** `artifacts/api-server/src/routes/sync.ts` (`clientToday()`)

**Problem:** `clientToday(req)` — used to key the `PUT /api/sync/today` write — preferred the client-supplied `?today=` query param, but fell back to `todayStr()` (the server process's raw OS-local date, i.e. UTC on a typical container) when the param was missing or malformed. Meanwhile the daily-reset session-boundary fence (`sessionBoundary.ts`'s `getSessionBoundaryMs`) always reads the row keyed by `facilityDate()` — the facility's configured timezone (America/Chicago). On a server whose OS clock is UTC serving a Chicago facility, these two dates disagree for roughly 5–6 hours every single day (whenever UTC's calendar date has already advanced past the facility's). During that window, a same-day live-scope reset (`resetAt`) written without `?today=` would set `resetBoundaryAt` on a row the fence never looks at — silently defeating the "every session is force-signed-out on reset" security guarantee documented in `.agents/memory/daily-reset-auth-boundary.md`.

Real web/mobile clients always send `?today=` (confirmed by checking every call site in `artifacts/run-calculator/src`), so this specific fallback path isn't hit by normal traffic — but the fence is meant to hold even without client cooperation, which is exactly what the pre-existing integration test (`sandboxIsolation.integration.test.ts`, "a live-scope reset boundary fences every session, including the sandbox one") was already asserting, and failing.

**How confirmed:** Reproduced live end-to-end: signed up a manager, `PUT /api/sync/today` with a future `resetAt` and no `?today=`, then queried `daily_sync` directly. The write landed on `date = 2026-09-10` (server-UTC `todayStr()`) while `getSessionBoundaryMs` was reading `date = 2026-09-09` (facility/Chicago) — confirmed via `date -u` vs `TZ=America/Chicago date` showing the two disagreeing at the time of the test. Also confirmed by running the existing (already red) integration test before and after the fix.

**Fix:** Changed `clientToday()`'s fallback from `todayStr()` to `facilityDate()` (already available via the existing `../lib/facilityTime` import in this file), so the write path's default always agrees with the same timezone anchor the security fence reads, regardless of whether `?today=` is present. Left the unrelated `todayStr()` usage at the "cannot delete today or past days" check untouched — different concern, out of scope for this fix.

**Note:** `sandboxIsolation.integration.test.ts` also had its own local `todayStr()` helper (same server-local-vs-facility mismatch) used in one follow-up sanity-check query. Removed that local helper, imported `facilityDate` directly from `../lib/facilityTime` (already a DB-free, statically-importable module — safe under this file's dynamic-import constraints, see `.agents/memory/integration-test-db-binding.md`), and pointed the query at it instead. Full file re-run: 7/7 tests passing.

---

### 2026-09-10 — `LineMapDashboard.tsx` missing from the `useLiveRun()` allowlist after the Replit merge

**File(s):** `artifacts/run-calculator/src/contexts/__tests__/useLiveRun-allowed-callers.test.ts`

**Problem:** `useLiveRun-allowed-callers.test.ts` is an architectural guard test that fails the build if any file outside an explicit `ALLOWED_FILES` list calls `useLiveRun()` (a per-second-ticking subscription — calling it anywhere unintentional causes silent, expensive re-renders). `src/components/LineMapDashboard.tsx` calls `useLiveRun()` at line 57 to drive its zone-status countdowns and next-batch timers, but wasn't on the allowlist. Git history shows a recent `feat: re-apply LineMapDashboard after Replit merge` commit — the file was correctly restored during merge conflict resolution, but the corresponding allowlist entry was missed.

**How confirmed:** Ran the failing test, read its own diagnostic output (which names the exact file/line), then read `LineMapDashboard.tsx` directly — it genuinely needs the live clock (zone status badges, depletion countdowns, and next-batch timers all derive from `nowTime`/`elapsedBatchSec`/`secUntilNextBatch`), so this is a real, intentional live subscription, not an accidental one.

**Fix:** Added `"components/LineMapDashboard.tsx"` to `ALLOWED_FILES` with an explanatory comment, following the exact style of the existing entries (`GlanceOverlay.tsx`, `CompactRunStrip.tsx`, `ScreenModeView.tsx`). Re-ran the test file: 3/3 passing.
