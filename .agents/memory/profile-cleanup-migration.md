---
name: Profile-cleanup one-time migration
description: How the spec-sheet profile reconciliation cleanup is shipped as a shared-lib data migration across web+mobile.
---

# Profile-cleanup one-time migration

One-time data fix that reconciled brand/flavor profiles against factory spec sheets:
delete duplicate BLANK profiles (empty twin beside a populated one), rebuild profiles
that lost recipe data, and drop brands whose flavor list empties out. Concrete plan
(delete pairs, rebuild overlays, doughball map) + pure guards live in
`@workspace/profile-cleanup` so web and mobile apply the identical fix.

**Why a shared lib:** parity is mandatory and the plan is pure data. `planProfileCleanup`
only deletes when the empty side has no recipe data AND the twin is populated, and only
rebuilds a profile that already exists but has no recipe data — never creates a phantom,
never clobbers a populated profile. `profileHasRecipeData` intentionally IGNORES dough
(blanks/rebuild targets can still carry dough).

**Only differing field:** doughball weight — web `targetDoughballWeight` vs mobile
`doughballWeightOz`. Stripped out of the overlays into `PROFILE_REBUILD_DOUGHBALL_OZ`
so the overlays themselves apply cleanly to both apps.

**How to apply (glue):**
- Web: `applyProfileCleanupIfNeeded()` in `storage.ts`, run at module scope in `home.tsx`
  BEFORE `purgeOrphanedProfilesIfNeeded()` (so purge sees removed brands). Marker-guarded,
  defers while Brands list empty. Deletions tombstoned (flavor namespace + "brands");
  rebuilds clear stale tombstones so the healed profile survives the additive sync union.
- Mobile: bootDone-gated effect in `RunContext.tsx`, marker in its OWN AsyncStorage key.

**Gotcha — mobile clobber race (fixed):** the migration must apply via a FUNCTIONAL
`setAppState(prev => ...)` update that only touches `brands/brandFlavors/brandProfiles/
deletedItems`, NOT a full-object replace built from a stale `appStateRef` snapshot.
Boot-time sync bootstrap runs concurrently; a full-object set from a stale snapshot
reverts runs/day-state that a remote apply just landed. Plan (deleteKeys/rebuildKeys)
may be computed from a snapshot because `brandProfiles` is LOCAL-only, but the synced
lists must be re-derived from `prev`. Web has no such race — it runs synchronously at
module import, before React mounts / any sync.
