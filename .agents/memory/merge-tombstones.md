---
name: Merge tombstones (mergedAway)
description: Why ingredient merges need a synced tombstone to survive additive live-sync, and the cross-peer re-add tradeoff.
---

# Merge durability via `mergedAway` tombstone

Ingredient/die "merge similar names" removes source names locally, but live-sync
reconciliation is **additive union only** (server is last-write-wins KV; clients
never delete on merge). So a merged-away name gets resurrected from a stale peer
or from the device's own pre-reload server pull. Symptom reported by user: "manual
merge — the box closed and nothing happened" (duplicates reappear).

**Fix:** a synced `mergedAway: string[]` tombstone, at web+mobile parity.
- Recorded when a merge runs: the source names, **excluding any name that is also a
  merge target** (a name mapping to itself is not a real source).
- Carried in the sync payload over the same KV channel.
- On reconcile: union remote+local tombstones, then strip tombstoned names out of
  **every** master-data list union — including the `ingredientTypes` list, which has
  its own bespoke union path separate from the shared `mergeList` helper. (Regression
  caught in review: it's easy to add the tombstone filter to `mergeList` and forget
  the one-off `ingredientTypes` block.)
- Cleared for a name when the user explicitly re-adds it (add* funcs / addListItem),
  so a name can be resurrected later.

**Why:** without this, any merge silently un-does itself on the next sync tick.

## Web reload race (separate, also fixed)
Web merge previously called `window.location.reload()` *before* pushing the merged
payload, so the reload's pull re-fetched the un-merged server state. Merge must
`await` the PUT of the merged payload to `/api/sync/today` **before** reloading.

## Accepted tradeoff: cross-peer re-add resurrection
Tombstones reconcile by **union** (`local ∪ remote`), with no per-name version/clock.
Consequence: if device B re-adds a tombstoned name (clearing B's tombstone), device A
that still holds the tombstone keeps stripping the name and can re-poison the server.
This is a deliberate scope decision for the bug ("merges must stick"); the common case
(merge, then never re-add the exact merged-away spelling) works. A full fix needs a
removal-aware model (tombstone map with timestamps / version vectors / explicit
"resurrected" set with precedence) — not done here.

**How to apply:** any new synced master-data list must run its incoming union through
the same tombstone filter (`dropMergedAway` on web, `dropTomb` on mobile). Mobile sync
paths must stay fail-safe (no throws) — guard with `?? []` / `String()` coercion.
