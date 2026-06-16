---
name: Spec-import seed pattern (dough / sauce / cheese)
description: Convention for importing Excel recipe specs into the Run Calculator as one-time additive seeds, kept at web+mobile parity.
---

# Spec-import seed pattern

Recipe imports from customer Excel sheets (dough, sauce, cheese, …) all follow the
same two-tier, one-time, additive seed convention. Future imports should copy it
rather than invent a new shape.

**The pattern:**
- Generate two exports appended to BOTH `specSeed.ts` files (web
  `artifacts/run-calculator/src/specSeed.ts` and mobile
  `artifacts/run-calculator-mobile/data/specSeed.ts`), 2-space indent:
  `<THING>_RECIPES: Record<string,{ingredient;lbs}[]>` and
  `<THING>_BRAND_SPECS: {brand;flavor?;recipe; ...}[]`. Cheese additionally carries
  an `app` field (1-4) selecting which applicator slot the tie writes to.
- **Tier 1** = add every recipe to that category's preset library + names list +
  ingredient list (merge, never replace).
- **Tier 2** = tie a brand+flavor to its specific recipe on the stored profile,
  **only if that target field is still empty** — never clobber user edits.
- Each seed is guarded by its own one-time marker key
  (`run-calc-<thing>-specs-v1` web, `run-calc-mobile-<thing>-v1` mobile).
- WEB: a `apply<Thing>SpecsSeedIfNeeded()` in `storage.ts`, called in `home.tsx`
  right after the previous category's seed call.
- MOBILE: a `apply<Thing>Seed(state)` in `RunContext.tsx`, wired into the SINGLE
  ordered boot seed effect (`spec → dough → sauce → cheese`) — order matters so an
  earlier seed's "only if absent" profile guard isn't tripped by a later one
  creating the profile key first.

**Why:** keeps imports idempotent and safe to re-run, preserves user
customizations, and the strict ordering on mobile prevents one seed from making
another seed skip its fields. Parity between web/mobile is a hard project rule
(see replit.md User preferences).

**How to apply:** for a new category, write a generator that emits the two
exports, append to both specSeed files, add the two seed functions mirroring an
existing one (cheese is the most complete example, incl. the `app` slot routing),
add markers, wire calls, then typecheck both apps.

**Name-collision handling:** the generator prefixes recipe names with their
brand/customer when the same human name maps to different ingredient lists across
tabs (e.g. "Corner Booth Whole Mozzarella Cheese Mix" vs "Lucia Craft Whole
Mozzarella Cheese Mix"), while keeping a single shared entry when the recipe is
genuinely identical. Some flavors legitimately have no matching mix and are left
as library-only (no Tier-2 tie) — that's expected, not a bug.
