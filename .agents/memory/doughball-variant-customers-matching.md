---
name: Doughball variant customers matching
description: Why CRB Dough variants had no customers arrays, how pKey root weight overwrote variant matches, and the three-part fix applied.
---

## The rule

Doughball variants need a `customers` array to be matched via `matchDoughballVariant` Priority 1. Without it, the function falls through to the die-number label fallback, which fails for labels like "Lucia's Craft CRB Thick" (no number). The local preset root weight (`pKey`) then overrides with the family weight (wrong for multi-variant recipes).

**Why:** CRB Dough has 18 variants with descriptive labels but NO customers arrays. matchDoughballVariant returned null → poolWeight=0 → pKey preset root (13 oz) fired instead of variant weight (13.8 oz for Lucia's Craft BBQ). "Never clobber" then locked in the wrong value on re-imports.

## How to apply

1. **When adding a new multi-variant recipe**: populate `customers` arrays on each variant (either via the dough workbook importer or a targeted data heal).

2. **matchDoughballVariant** (lib/named-recipes): Priority 1a = specific brand+flavor, Priority 1b = brand+catch-all. This ensures `{flavor: "BBQ Chicken"}` entry always beats a `{flavor: ""}` catch-all regardless of array order in the DB.

3. **applySpecImport** (storage.ts weight hydration):
   - `poolMatched.weightOz` wins over `pKey` (local preset root) — variant is per-customer authoritative, preset is ambiguous family weight.
   - When `wMatchedViaCustomers=true` AND existing weight doesn't match the variant's weight, the import IS allowed to override (corrects prior poisoning by a wrong variant).

4. **Data heal** `crb-dough-lucia-variant-customers-v1` populated customers on:
   - "Lucia's Craft CRB Thick" (13.8 oz) → specific flavors: BBQ Chicken, Four Cheese Meltdown, House DLUX, Sweet Chili Garden
   - "Lucia's Craft CRB Heavy Plus" (12 oz) → catch-all `{flavor: ""}` for remaining Lucia's Craft flavors

## Sharp edges

- Profiles for Lucia's Craft are localStorage-only (no rows in `brand_profiles` DB table) — server heals that operate on `brand_profiles` never touched them. The customers fix + import override is the only path to correct wrong weights on these profiles.
- Other label-named variants (Hannaford, Lowe's, Nob Hill Craft) still have no customers arrays — they rely on the die-number fallback. Add customers for those too if those brands start showing wrong weights.
- The "never clobber" rule still applies when `wMatchedViaCustomers=false` (die fallback or no match) — only high-confidence customers matches may override.
