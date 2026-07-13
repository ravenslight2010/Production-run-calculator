---
name: Brand-profile server pool
description: Setup profiles moved to a factory-wide server pool with per-profile LWW stamps; migration/reconcile gotchas.
---

Brand+flavor setup profiles live in a factory-wide server pool (`/api/brand-profiles`, requireAuth-only) with per-profile last-write-wins stamps — no longer part of the day-state sync payload (the old unstamped map let a stale device clobber fresh edits). Client glue is `profileServerSync.ts`: persisted op queue, marker-guarded one-time migration (floor stamp 1), boot + 60s reconcile poll in home.tsx; localStorage blobs stay the app's read path.

**Prefix collision:** any localStorage key starting with `run-calc-profile-` is swept up as a "profile" by prefix scans — the spec-cleanup marker `run-calc-profile-cleanup-v1` got migrated to the server as a junk pool row. Canonical profile keys always contain `__`; both the client sweep and the server sanitizer now reject separator-less keys. **How to apply:** never mint new marker keys under a data-blob prefix, and any prefix-scan of profile keys must filter on `__`.

**saveProfile snapshot guard:** the stale-form skip must (a) only apply while the stored blob still exists — otherwise a wiped localStorage plus a matching in-memory snapshot silently drops the write — and (b) compare against EVERY blob loadProfile handed out this page load, not just the latest. **Why:** a latest-only snapshot gets refreshed by any other reader after a newer server copy is adopted, letting the stale open form republish old values with a fresh stamp. Regression: `profileSnapshotGuard.test.ts`.

**Client must chunk pool writes to the server batch cap:** the server silently truncates request items past its MAX_BATCH; an unchunked flush marks the unsent tail as done and drops it.

**E2E gotcha:** seeding a legacy profile blob on a device without also registering its brand in `run-calc-brands` gets it deleted by `purgeOrphanedProfilesIfNeeded` before migration runs — seed the brand/flavor registries too.

Backfill on profile load is generalized (`backfillFromProfile`): sauce backfill first, then blank-fill any field still at DEFAULT_VALUES where the profile differs; skips per-run/progress/boolean/identity fields.
