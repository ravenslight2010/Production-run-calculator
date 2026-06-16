---
name: Die size source for brand/flavor profiles
description: Where the run-calculator dieType value comes from when regenerating the spec-sheet die map.
---

# Die size comes from the CRUST row, not the pizza-size header

When mapping a brand+flavor to its `dieType`, the die is parsed from the spec
sheet's **crust line** (the cell containing "crust" but not "pizza"), NOT the
pizza-size header.

**Why:** the two frequently disagree. Several Four Hands / Craft products have an
11" header but their crust line specifies an Argus die; "Pinsa 12" Crust" → 12in.
Trusting the header would assign the wrong die.

**How to apply:** if the `SPEC_DIE_TYPES` maps in `artifacts/run-calculator/src/specSeed.ts`
and `artifacts/run-calculator-mobile/data/specSeed.ts` ever need regenerating from
`attached_assets/*.xlsx`:
- die parse precedence: /argus/→Argus, /mystic/→Mystic, else `(\d{1,2})(?:"|inch|in)`→Nin.
- 7 profiles are intentionally blank: Brand×2 (sheet crust = "Brand Recipe", no die)
  and SMD×5 (no spec sheet exists). Do not invent dies for these.
- brands whose sheet uses one die for every flavor (Aldo's, Corner Booth = 12in)
  can fill naming-variant/multiline flavors via that brand-uniform die.
