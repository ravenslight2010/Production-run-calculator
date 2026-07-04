---
name: One-time full data purge
description: How to purge all factory data without it resurrecting through the additive sync union; accounts kept; built-in seeds removed entirely.
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

**Round 2 — built-in seeds ARE data too:** after the wipe the user still "saw
all data" because the factory seed blobs (spec/mix/dough/sauce/cheese seeds +
DEFAULT_* master-data lists) re-installed themselves like a fresh install and
re-pushed a populated daily_sync row. The user chose a completely EMPTY app, so
the built-ins were removed for good (marker bumped to `-c`, daily_sync deleted
again with the server stopped):
- Web home.tsx no longer calls any factory seed; only data-hygiene migrations
  remain (no-ops on empty data). Seed helpers in storage.ts are now dead code.
- Seed blobs emptied but export shapes kept: web `src/specSeed.ts`,
  `src/mixSeed.ts`, `src/mixPresets.ts`; mobile `data/specSeed.ts`,
  `data/mixSeed.ts`, `data/mixPresets.ts`.
- Factory-specific DEFAULT_* lists emptied in web types.ts and mobile
  RunContext (pep types, die types, ingredient/cheese/dough/frontline lists,
  applicator types). Generic plumbing (stop reasons, packaging fields) kept.
- Consequence: with DEFAULT_PEP_TYPES empty, the premade-stick pep path never
  triggers — all pep types take the batch-lbs path until the user adds types
  (consistent web+mobile). Fill-missing's "spec" source is permanently empty.

**Round 3 — sneaky survivors:** after removing seeds, two names still came
back: inline non-empty fallbacks (`loadList(BRANDS_KEY, ["Lucia's"])` in
home.tsx) and a "hygiene" migration that unconditionally ADDED a retired pep
name to the applicator list. Lesson: for a true-empty app, audit (1) every
inline list fallback, not just the DEFAULT_* constants, and (2) migrations that
add names — make adds conditional on the name having existed. Marker ended at
`-d`; each resurrection round needs marker bump + daily_sync delete with the
server stopped.

**Round 4 — a LIVE tab re-adopts synced master-data after its wipe (brands/
flavors survived, 2026-07-04):** brands/flavors (and other master-data lists) are
part of the /api/sync day-state, NOT purely local. Sequence that resurrects them:
the open tab runs the marker wipe → clears local → immediately GETs the still-
populated server row → re-adopts the lists → pushes them back, re-filling
daily_sync. The marker is now already set, so a plain refresh won't re-wipe, and
the re-populated tab keeps pushing. Fix each round: (1) BUMP the marker again
(g→h) so the tab wipes once more, (2) TRUNCATE daily_sync, (3) restart the API
workflows AND the Web/mobile workflows — restarting the Vite dev server forces
the open tab to full-reload (HMR ws reconnect → location.reload()), which is what
actually loads the new marker; a Vite HMR patch alone does NOT re-run the module-
scope wipe. The reloaded (now-empty) tab must find daily_sync empty on its first
GET or it re-adopts again — so keep the marker bump + daily_sync truncate tight
together, right before the Web restart. Marker now at `h`.

Auth untouched (web httpOnly cookie, mobile SecureStore). The wipe code and the
dead seed helpers can be retired in a later cleanup once all devices have run
the final wipe.
