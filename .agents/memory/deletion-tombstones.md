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

**How to apply:** keep web and mobile in lockstep across add/remove handlers,
sync-apply union/strip, every payload builder (incl. import builders), and the
shared payload type. Server sync is opaque passthrough — no server change.
