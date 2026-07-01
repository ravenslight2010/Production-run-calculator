---
name: Deletion tombstones (master-data)
description: Why plain deletes of master-data lists need a synced per-namespace tombstone, parallel to mergedAway.
---

# Deletion tombstones for master-data lists

Plain deletes of master-data (brands, flavors, pep/die/applicator types,
ingredient + recipe lists) were resurrected by live-sync's additive union from a
stale peer. `mergedAway` only covered merges; plain deletes had no tombstone, and
brands/brandFlavors had none at all.

**Rule:** a delete must write a synced tombstone `deletedItems: Record<namespace,string[]>`
(lowercased names), parallel to `mergedAway`. On delete add to the namespace; on
re-add remove it; on sync-apply union remote+local then strip each list's
namespace from its additive union.

**Why namespaced (not flat):** flavor "Pepperoni" and pep-type "Pepperoni" are
different items — a flat tombstone would strip both. Namespaces are the
SyncPayload list keys; flavors use `flavor:<brandLower>`. The web/mobile
flavor-namespace helpers must produce identical strings or deletions won't
cross-sync.

**Brand-delete gotcha:** deleting a brand removes its flavor map entry, but you
MUST also tombstone each of that brand's flavors under its flavor namespace.
Otherwise re-adding the brand (which clears only the brand tombstone) lets a
stale peer resurrect the old flavors via the additive flavor union. The brand
tombstone alone is not enough.

**Re-add semantics:** clearing a tombstone is NOT gated by the merge-eligible
list set (that gate is only for `mergedAway`) — re-adding any item, including a
brand, clears its deletion tombstone. Re-adding a flavor also clears the brand
tombstone so the brand resurrects alongside it.

**Deleting a brand/flavor must ALSO purge its saved profile(s), not just
tombstone.** The tombstone stops the additive union from resurrecting the *name*,
but the per-profile localStorage/AsyncStorage entries
(`run-calc-profile-<brand>__<flavor>`, `run-calc-crust-profile-*`) are separate.
If left behind they orphan: the push-payload builder re-scans ALL profile keys, so
a deleted brand keeps re-appearing in the DB `brandProfiles`, and the stale
profile data (wrong die/recipes) resurrects the moment a tombstone is cleared by a
re-import. Symptom this caused: two product lines (Basha's Original 12" vs Ultra
Thin 11") looked "merged" after import even though the import code no longer folds
them. Fix = delete the profile entries on brand/flavor removal + a one-time
marker-guarded migration to purge profiles whose brand is no longer in the Brands
list (guard: defer while the Brands list is empty so a transient empty list can't
wipe everything). Sync-receive already skips tombstoned profile keys, so orphans
stranded in the DB blob for a tombstoned brand never return — purging locally just
stops re-pushing them. **Why:** deletion completeness is a separate axis from
tombstoning; a name tombstone without a data purge is a slow resurrection loop.

**How to apply:** keep web and mobile in lockstep across add/remove handlers,
sync-apply union/strip, every payload builder (incl. import builders), and the
shared payload type. Server sync is opaque passthrough — no server change.
