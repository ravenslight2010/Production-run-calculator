---
name: Sync reset boundary hardening
description: Two integrity/availability fixes on /api/sync's reset-epoch guard and resetAt→resetBoundaryAt fencing; read before touching reset/epoch/boundary logic in sync.ts.
---

Two related trust boundaries in `artifacts/api-server/src/routes/sync.ts` must stay fail-closed:

1. **Epoch guard (`isStaleResetPush`)** must reject once a scope has ever been reset (serverEpoch > 0), even when `?epoch=` is missing/malformed. Only scopes that have *never* been reset (serverEpoch === 0) may accept epoch-less pushes. A "missing param = accept" default lets anyone skip the query string entirely to replay stale pre-reset data seconds after a manager wipes it.

**Why:** the epoch guard's whole purpose is to stop replay right after `POST /sync/reset`; treating absence as "no opinion" silently disabled it for exactly that window.

2. **`resetAt` → `resetBoundaryAt` (session fence)** must never be adopted verbatim from the client payload. `requireAuth` treats `resetBoundaryAt` as "reject every token issued at/before this instant," so an unbounded attacker-supplied future value locks out the whole live deployment indefinitely. Clamp to `min(resetAt, Date.now() + 5min)`, NOT a hard clamp to exactly `Date.now()` — legitimate same-day rollovers intentionally nudge `resetAt` a little ahead of `Date.now()` so it clears a token's second-truncated `iat` in requireAuth's `(iat+1)*1000 <= boundaryMs` check; clamping to exactly now breaks that margin and fails the session-boundary integration tests.

**How to apply:** any future change to reset/epoch/boundary logic in sync.ts should re-verify both integration test files (`syncReset.integration.test.ts`, `sessionBoundary.integration.test.ts`) still pass, since the two behaviors are easy to accidentally re-couple.
