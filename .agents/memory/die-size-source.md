---
name: Die size source for brand/flavor profiles
description: Where the run-calculator dieType value comes from when regenerating the spec-sheet die map.
---

# Die size comes from the CRUST row, not the pizza-size header

When mapping a brand+flavor to its `dieType`, the die is parsed from the spec
sheet's **crust line** (the cell containing "crust" but not "pizza"), NOT the
pizza-size header.

**Why:** the two frequently disagree. Several Four Hands / Craft products have an
11" header but their crust line specifies an Argus die. Trusting the header
would assign the wrong die.

**PURCHASED crusts are the exception (user-confirmed 2026-07-18):** products on
bought pre-made crusts (Bonici/Pedone parbake & pinsa) have NO die at all — the
crust arrives formed. A die may only come from an EXPLICIT die mention ('12"
Dies', 'Argus Dies'), never from the size inside a crust name ("Pinsa 12" Crust"
must NOT become a 12in die — an earlier version of this note said otherwise).
`stripPurchasedCrustDie` in @workspace/spec-import enforces this: crust-named
dieType → moved to doughName + cleared; doughName containing "crust" without
"dough"/"recipe"/"die(s)" → dieType cleared (all in-house dough names carry
Dough/Recipe, validated against the full prod pool). Same rule applied to stored
profiles by the `purchased-crust-die-heal-v1` data heal.

**How to apply:** if the `SPEC_DIE_TYPES` maps in `artifacts/run-calculator/src/specSeed.ts`
and `artifacts/run-calculator-mobile/data/specSeed.ts` ever need regenerating from
`attached_assets/*.xlsx`:
- die parse precedence: /argus/→Argus, /mystic/→Mystic, else `(\d{1,2})(?:"|inch|in)`→Nin.
- 7 profiles are intentionally blank: Brand×2 (sheet crust = "Brand Recipe", no die)
  and SMD×5 (no spec sheet exists). Do not invent dies for these.
- brands whose sheet uses one die for every flavor (Aldo's, Corner Booth = 12in)
  can fill naming-variant/multiline flavors via that brand-uniform die.
