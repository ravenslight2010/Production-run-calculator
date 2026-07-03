---
name: One-time full data purge
description: How to purge all factory data without it resurrecting through the additive sync union; accounts kept.
---

# One-time full data purge (done 2026-07-03)

A DB purge alone is NOT enough: every device keeps a full local copy (web
localStorage `run-calc*`, mobile AsyncStorage `run-calc*`) and the additive
/api/sync union re-uploads it, resurrecting everything.

**The working recipe:**
1. Ship a marker-guarded local wipe in BOTH apps that removes every `run-calc*`
   storage key except its own marker: web `applyOneTimeLocalWipeIfNeeded()` in
   storage.ts, called FIRST in home.tsx's module-scope migration chain; mobile
   at the top of the RunContext boot effect (seed effect is gated on `bootDone`,
   so ordering stays safe).
2. Stop the API server, TRUNCATE all public tables EXCEPT `users`/`roles`/
   `user_roles` (accounts kept), restart.
3. Bump the wipe marker (e.g. `-b` suffix) AFTER the DB purge — a device that
   wiped early may have re-pulled old server data before the truncate; the bump
   forces one more wipe against the now-empty DB.
4. Every device must refresh/reopen once so the final wipe runs.

**Why:** sync merges are additive with empty-over-populated guards, so a clean
client can never "push emptiness" over old server rows — the rows must be gone
server-side while no old-data client is running.

**Notes:** wiping the seed/migration markers on purpose makes apps behave like
a fresh install (built-in seeds re-run — that IS the "clean state"). Auth is
untouched (web httpOnly cookie, mobile SecureStore). The wipe code can be
retired in a later cleanup once all devices have run it.
