---
name: Profile clobbered by blank-form autosave (web)
description: Web run-calculator brand+flavor profiles can be zeroed by an autosave firing before the profile loads; how the guard + self-heal works.
---

# Web brand+flavor profiles get clobbered to blank by autosave

Web stores one localStorage profile per brand+flavor (shared across runs). An
autosave effect (and other `saveProfile` call sites) write `saveProfile(brand,
flavor, form values)`. On mount the form is still default/empty while the
**current run is taken from the synced server day-state** — so it overwrites the
seeded profile for whatever brand+flavor happens to be selected with blanks.
Because the day-state is shared, this reproduces in ANY browser whose current
run is that combo. Once blank, one-time skip-if-exists seed markers never repair.

**Fix shape (web only):**
- `saveProfile` refuses to overwrite a profile that already has real data when
  the incoming form is blank (`profileObjHasRealData`). Central guard covers all
  call sites.
- Seed self-heal: spec seed recreates profiles that are missing/blank/unparseable
  (not just absent), and all 5 seed markers were bumped one version so the repair
  runs once for existing users. dough/sauce/cheese seeds already fill-empty-only.

**Why mobile is NOT affected:** mobile `brandProfiles` are written only by an
explicit Save action, never by autosave — so they are never clobbered. This is a
web-only bug fix restoring behavior mobile already had; no parity change needed.

**Sharp edge — do NOT use a blanket numeric scan for "has real data":**
DEFAULT_VALUES is now all-zero for quantity fields (only `speedAdjustment`
defaults to 1.0), but LEGACY stored blanks may still carry the old non-zero
defaults (the four pep batch-lbs fields at 25). A clobbered profile equals a
default shape, so any "any non-zero number = real" check would classify it as
real and BREAK the self-heal. Use `isAllDefaultRunValue` in web `storage.ts`
(recognizes both the all-zero shape and the legacy pep-25 blank shape) or rely
on string fields that default to "" (app/pep types, dieType, recipe names) and
non-empty recipe arrays as signals of real data.

**Morning Melts has no sauce:** Morning Melts (breakfast) has no `SAUCE_BRAND_SPECS`
entry, so an empty frontline/sauce recipe is correct, not a repair miss.
