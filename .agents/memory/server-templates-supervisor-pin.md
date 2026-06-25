---
name: Server run-templates + supervisor PIN
description: Facility-wide server source of truth for run templates and the supervisor PIN, and the empty-PIN "no gate" parity model.
---

Run templates and the supervisor PIN are facility-wide server settings (one per
scope), not per-device storage, so they follow the facility across web+mobile.
Reading the PIN is open to any signed-in user (both clients do a local compare to
gate supervisor actions); changing it is manager-gated (`manage-staff` → 403).
Clients keep a local cache as an offline fallback and write-through then reconcile
with the server's canonical response.

## Empty PIN = "no gate" (the key parity decision)
**Rule:** an empty PIN (`""`) is a *valid* facility value meaning "no gate /
unlocked everywhere". The server route ALLOWS empty (do not re-add an
empty-rejection). It is the result of the mobile "Remove PIN lock" action and web's
mirrored "Remove PIN lock" button.

**Why:** the PIN is a low-security convenience gate, not a secret. Mobile already
supported empty=unlocked; web historically had no unlocked concept (operator→PIN→
supervisor). Allowing empty server-side unifies both: a facility with no PIN is
unlocked on every device → true behavioral parity.

**How to apply:**
- A *fresh* facility seeds the default `"1234"` (non-empty), so `""` only ever
  appears after an explicit clear — never confuse "loading/undefined" with `""`.
- Resolve the PIN as `live-server-value ?? offline-cache ?? default`, then treat a
  resolved `""` as unlock. Web must persist `""` to its local cache too (don't gate
  the cache write on truthiness) or a stale non-empty cache wrongly re-locks the
  device offline after another device cleared it.
- Both web `isSupervisor`/`checkPin` and mobile gating must honor the resolved-empty
  case, and the mobile reconciliation fetch must APPLY `""` (only bail on a
  non-string), or a cleared PIN won't propagate.

## Mobile setSupervisorPin must be last-write-wins
The mobile setter is async: optimistic local apply → push → reconcile with the
server's canonical value; on failure re-FETCH the canonical value (do NOT revert to
a captured local snapshot — a reconciliation poll may have moved it) and rethrow so
the caller can surface a 403 ("Only a manager can change the supervisor PIN").
Guard every state write behind a monotonic op token so a slow/stale request or its
failure handler can't clobber a newer value. Callers must handle the returned
promise (signature is `Promise<void>`).
