---
name: Password-reset nav badge
description: How the manager nav badge for pending password reset requests is wired across web + mobile.
---

The nav badge that alerts managers to pending password reset requests is driven
by a small shared hook `usePendingResetCount` (web: `src/hooks/`, mobile:
`hooks/`).

**Rule:** the hook reuses the `["passwordResetRequests"]` React Query cache key
(same key the Staff & Roles card polls), and is gated `enabled: isManager`.

**Why:**
- Sharing the cache key means approving/handling a request in the card
  invalidates the same key, so the badge clears with no extra plumbing.
- The `/password-reset-requests` endpoint is manager-only; without
  `enabled: isManager` operators would poll a 403 every 20s.

**How to apply:** any new surface that needs the pending-reset count should call
this hook, not add another query. Keep web + mobile at parity (badge lives on
the header overflow menu icon + the Stock nav entry on both).
