---
name: Cheese blend mirrored across applicators
description: Why a single cheese blend must fill every cheese applicator slot on spec import, and the shared helper that does it.
---

# Single cheese blend → multiple cheese applicators

A product can run TWO (or more) "Cheese" applicators on the SAME blend at
different per-pizza weights (the weight lives on the applicator, not the recipe).
On spec import this used to leave the second cheese applicator BLANK.

**Why:** In `applySpecImport` (web `storage.ts`, mobile `RunContext.tsx`),
applicator TYPES are assigned by array position (`app${i+1}Type`, so both slots
correctly become `"cheese"`), but the cheese recipe NAME/rows are tied by the
parsed recipe's `r.app` field, which defaults to slot 1. `dedupeSpecImportCheeseRecipes`
also collapses same-name blends. So one distinct blend only ever writes slot 1 →
slot 2 stays blank.

**Fix:** shared pure helper `mirrorSingleCheeseAcrossApplicators(slots)` +
`CheeseApplicatorSlot` type in `lib/spec-import/src/index.ts`. Both apps call it
as a POST-LOOP pass over each touched profile (build 4 slots → mirror → save only
if changed). It fills blank cheese-type slots from the lone distinct blend.

**How to apply / invariants (keep web+mobile identical):**
- Fires only when EXACTLY ONE distinct cheese blend is present across cheese
  slots (case-insensitive by name). 0 or 2+ distinct blends → no-op (user
  resolves multi-blend ambiguity).
- A valid mirror source must have real component rows (at least one row with a
  non-blank ingredient). Never propagate a named-but-empty recipe — that would
  amplify malformed imports instead of containing them to one slot.
- Never touches non-cheese slots or already-filled cheese slots; copies rows
  (fresh arrays, not shared refs); returns the SAME array ref on no-op so callers
  can `if (mirrored === slots) continue;`.
- Both apps track a `touchedKeys`/`touchedProfiles` set across the profile loop
  AND the recipe-tie loop, then run the mirror pass only over touched profiles.
