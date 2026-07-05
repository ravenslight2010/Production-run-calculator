---
name: Die-type master list — heal + variant consolidation
description: Why the Die Type picker can go blank or list duplicate spellings, and how both apps recover.
---

# Die-type master list: heal from profiles + fold variant spellings

Two related quirks, both because the Die Type **picker** reads a separate master
list (`DIE_TYPES_KEY` / `state.dieTypes`) while each brand+flavor profile stores its
own `dieType` **value**:

1. **Blank picker after a reset.** Import writes each profile's `dieType` value but
   never adds it to the master list, and `DEFAULT_DIE_TYPES` is `[]` (2026-07 purge),
   so a reset leaves the picker empty. Fix: both apps self-heal the list by unioning
   every profile's `dieType` back in on load — case-insensitive, keeping existing
   spelling, honoring the `deletedItems["dieTypes"]` deletion tombstones (never
   resurrect a deleted die). Web `healDieTypesFromProfiles` also scans crust-profile
   keys and persists the effective list; mobile mirrors it purely in `normalizeState`.

2. **Duplicate spellings of the same die.** Import can create several names for one
   physical die (e.g. `11`, `11"`, `11" dies`). Die types are deliberately excluded
   from the in-app Merge feature (see `die-types-merge-exclusion.md`), so the user
   can't merge them. Instead consolidate with a `DIE_TYPE_RENAMES` map — the same
   pattern as `PEP_TYPE_RENAMES` / `INGREDIENT_RENAMES` — mirrored web+mobile.
   Applied everywhere die names surface on load/sync: the master-list heal, the
   per-run/profile `dieType` field normalizer (web `normalizePepFields` / mobile
   `renamePepSettings`), and sync-receive of the remote die list.

**Sync rule (easy to miss):** on receive, map the incoming die list through
`DIE_TYPE_RENAMES` and do NOT apply the global merged-away tombstone to die types
(web passes `applyMergedAway=false`; mobile omits `dropTomb`). Applying merged-away
to die types would let an ingredient merge whose source name collides with a die
delete that die.

**Why:** the picker's master list and the stored profile value are two separate
stores. Writing a value (import) is not the same as registering it as a choosable
option, and a value can drift into several spellings the picker shows as duplicates.

**How to apply:** any field that has both a stored value and its own selectable
master list must add/heal the value into that list; to consolidate variant spellings
of an unmergeable list, add a rename map and apply it on every load + sync path,
honoring deletion tombstones.

**Known remaining mobile gap (deferred):** the ingredient-merge *apply* path in
mobile `RunContext` still rewrites `dieTypes` via the merge map; web excludes die
types from that rewrite. Unrelated to variant consolidation (that uses the rename
map, not the merge feature) — mirror when the mobile merge-exclusion parity is done.
