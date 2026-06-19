---
name: Web auth identity react-query cache
description: How the web app's ["me"] react-query identity must be updated on sign-in/up/out to avoid auth-state races.
---

# Web auth identity (`["me"]`) cache handling

The web app (`artifacts/run-calculator`) drives `isAuthenticated` from a react-query
`["me"]` query (fetched via `fetchMe` → `GET /api/me`, httpOnly `rc_auth` cookie).

**Rule:** on every identity change (sign-in, sign-up, sign-out) set `["me"]`
**directly** with `setQueryData(["me"], user|null)`, and clear cross-user data by
removing only the OTHER queries: `qc.removeQueries({ predicate: q => q.queryKey[0] !== "me" })`.
Never `qc.clear()` the whole cache for this.

**Why:** `qc.clear()` destroys the `["me"]` query, which makes its mounted observer
fire a competing `fetchMe()` refetch that races with the value you just set. The
race is intermittent — it would sometimes bounce a just-authenticated user back to
the login screen, and on sign-out sometimes strand them in the authenticated shell.
Symptom seen in prod: account creation works, sign-in returns 200 but the user is
bounced to login, with no `/me` call landing the new identity.

**How to apply:** keep the single `resetCacheTo(identity)` helper in `AuthContext.tsx`
as the only place that mutates `["me"]` on identity change. This mirrors mobile's
`setMe(user|null)` (`context/auth.tsx`) — same state model, different transport
(web cookie vs mobile Bearer). The cookie transport itself is fine through the
Replit proxy (proxy rewrites the dev cookie to `SameSite=None; Secure`); don't chase
trust-proxy/cookie theories for this bounce — it was always client-side cache races.
