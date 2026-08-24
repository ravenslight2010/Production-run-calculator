---
name: Sync reset boundary hardening
description: Two integrity/availability fixes on /api/sync's reset-epoch guard and resetAt→resetBoundaryAt fencing; read before touching reset/epoch/boundary logic in sync.ts.
---

Two related trust boundaries in `artifacts/api-server/src/routes/sync.ts` must stay fail-closed:

1. **Epoch guard (`isStaleResetPush`)** must reject once a scope has ever been reset (serverEpoch > 0), even when `?epoch=` is missing/malformed. Only scopes that have *never* been reset (serverEpoch === 0) may accept epoch-less pushes. A "missing param = accept" default lets anyone skip the query string entirely to replay stale pre-reset data seconds after a manager wipes it.

**Why:** the epoch guard's whole purpose is to stop replay right after `POST /sync/reset`; treating absence as "no opinion" silently disabled it for exactly that window.

2. **`resetAt` → `resetBoundaryAt` (session fence)** must never be adopted verbatim from the client payload. `requireAuth` treats `resetBoundaryAt` as "reject every token issued at/before this instant," so an unbounded attacker-supplied future value locks out the whole live deployment indefinitely. Clamp to `min(resetAt, Date.now() + 5min)`, NOT a hard clamp to exactly `Date.now()` — legitimate same-day rollovers intentionally nudge `resetAt` a little ahead of `Date.now()` so it clears a token's second-truncated `iat` in requireAuth's `(iat+1)*1000 <= boundaryMs` check; clamping to exactly now breaks that margin and fails the session-boundary integration tests.

**How to apply:** any future change to reset/epoch/boundary logic in sync.ts should re-verify both integration test files (`syncReset.integration.test.ts`, `sessionBoundary.integration.test.ts`) still pass, since the two behaviors are easy to accidentally re-couple.

3. **Every CLIENT sync write must carry `epoch=` and handle `{ok, stale:true}`.** When the epoch guard went fail-closed, the web client's main live push (and the raw scheduled-day/move/import PUTs) still omitted the param — so in a scope that had ever been reset, EVERY push returned 200 `{ok:true, stale:true}` and was silently dropped while the client recorded success. Prod symptom: "hit Start Run, looked started, next time it wasn't."

**Why:** making a server guard fail-closed is only half the change — every writer must be audited to supply the credential, and a 200-with-stale body means clients must parse the body, never trust `res.ok` alone. The web client now has one `handleStaleSyncWrite` helper (adopt reset via `applyResetWipe` + reload); any NEW sync write path must append `epoch=${getStoredResetEpoch()}` and route its response through it. Mobile does not yet send epoch — must be fixed when mobile work resumes.

**Verification lesson:** a browser e2e that checks persistence by reloading the SAME browser is fooled by localStorage — server sync must be verified against the `daily_sync` DB row (dev scope epoch is >0, so dev reproduces the drop).

4. **A newer `resetAt` is not a deletion authorization.** Current-day run lists remain additive unless a run carries an explicit tombstone; schedule replacement is only valid in its distinct future-day context.

**Why:** a new or stale device can create a newer local marker before reading the shared day, so treating it as a destructive reset erases real schedules.

**How to apply:** establish the server snapshot as a client baseline before background upload and keep destructive intent explicit.

5. **Browser fixtures must not invent a same-day `resetAt` boundary.** A test
   seed that sets `resetAt` to a near-future value can be persisted by the
   normal sync path and eventually fence the test session, especially in the
   slower phone project. Use the app's normal reset scheduler or an unset/zero
   value unless the test is specifically exercising rollover.

**Why:** the department navigation journey intermittently logged its phone
   session out before the final navigation checks when its seed used a
   60-second reset marker.

**How to apply:** keep reset-boundary fixtures separate from pending-run
   lifecycle fixtures, and give any intentional rollover test its own isolated
   boundary setup.

