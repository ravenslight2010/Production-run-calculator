---
name: Die-type master-list heal
description: Why imports can leave the Die Type picker blank, and the self-heal both apps run.
---

# Die-type master list must be healed from profiles

Spec/recipe import writes each brand+flavor profile's `dieType` **value**, but the
run-form Die Type picker lists only the separate master list (`DIE_TYPES_KEY`).
The built-in `DEFAULT_DIE_TYPES` is now `[]` (purged in the 2026-07 data reset), so
after a reset the picker can be blank even though profiles still name dies.

**Rule:** both apps self-heal the die-type master list by unioning every profile's
`dieType` back in — case-insensitive, keeping existing spelling, and honoring the
`deletedItems["dieTypes"]` deletion tombstones (never resurrect an explicitly
deleted die type).

- Web: `healDieTypesFromProfiles(extra?)` in `run-calculator/src/storage.ts` scans
  `run-calc-profile-*` **and** `run-calc-crust-profile-*` localStorage keys, uses
  `dropDeleted(..., "dieTypes")`, persists only when there are additions, returns the
  effective list. Wired into home.tsx `dieTypes` initial state **and**
  `reloadMasterData()` (which import calls) — keep both call sites on any import refactor.
- Mobile: pure `healDieTypesFromProfiles(dieTypes, brandProfiles, deletedItems)` in
  `RunContext.tsx`, invoked from `normalizeState` so it heals on every load. Mobile
  also already unions imported die types at commit time (belt-and-suspenders).

**Why:** the picker (master list) and the persisted profile value are two separate
stores; an import only touched the value, so the selectable options silently drifted
empty. This is the standard "master list vs stored value" gap — adding a value is not
the same as registering it as a choosable option.

**How to apply:** any feature that writes a profile field that also has its own
selectable master list must add the value to that list too (or heal from profiles),
respecting deletion tombstones.
