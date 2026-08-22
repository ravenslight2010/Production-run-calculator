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

## Three-bug fix (re-import customer survival)

Three bugs caused "Applies to (Brand / Flavor)" entries to be wiped on re-import:

**Bug 1 — replace mode wipes customers** (`lib/named-recipes/src/index.ts`, `mergeNamedRecipeDoughballVariants` replace branch):  
`unionVariantCustomers(existing, incoming)` returns `null` when `incoming` is undefined/empty — using it in the replace enrichment loop meant no-customers incoming left the existing customers unpreserved. Fix: inline the union manually: collect existing customers not already in the incoming list and spread them in.

**Bug 2 — key mismatch in addNamedRecipesToServerIfAbsent** (`artifacts/run-calculator/src/namedRecipes.ts`):  
Family-collapse rekeyed candidate variants under the family key, but the caller still passed the candidate (variant-label) key to `mergeNamedRecipeDoughballVariants`. Fix: collect a `variantKeyRemap` Map during family-collapse; build `effectiveVariants` from it before calling the merge.

**Bug 3a — digit-start regex false positive** (`parseDoughCustomerSection`):  
`/^\d/` matched "4Hand's CRB Heavy" (brand starting with a digit), discarding it as a section-end sentinel. Fix: change to `/^\d[^a-zA-Z]/i` so only pure numeric prefixes (die numbers like "7", "13.8") fire the sentinel.

**Bug 3b — "&"-joined multi-brand entries not split**:  
"Lowe's & Lucia's Craft CRB Heavy Plus: Caribbean" was emitted as a single brand string. Fix: after `doughVariantStripQualifier`, split by ` & ` and emit one customer entry per brand.

**Bug 3c — "&" in single brand name creates phantom parts**:  
"Lucia's New & Improved: All" is ONE brand, but the `&` split produced phantom brands "Lucia's New" and "Improved". `matchDoughballVariant` searched for exact brand name "Lucia's New & Improved" and found nothing. Fix: when `brandParts.length > 1`, also push the full pre-split compound brand as an additional assignment so the exact-name lookup in Priority 1b succeeds.

**Bug 4b — Priority 1b size-tier/base-tier tiebreaker uses wrong signal**:  
When a profile has no `dieType` but a SPECIFIC FLAVOR that is NOT listed in the base-tier's customers for its brand, the old code always returned the base-tier variant. E.g. a "Lowe's / Seven Cheese" profile (not in base customer list) would get 7.6 oz instead of 5.7 oz. Fix: in the `DOUGH_SIZE_QUALIFIERS && vQual !== profileQual` branch, check if the profile's flavor appears in the base variant's customers for this brand. If the flavor is absent (and the profile has a specific flavor), prefer the size-tier catch-all. If no specific flavor, keep the base as safe default.

## Bug 4 — Lowe's 7" weight picks the wrong variant (wrong qualifier key)

**Symptom:** "Lowe's 7\"" customer entry in a dough sheet was assigned the same `qualifierKey: ""` as the base Lowe's variant, so `matchDoughballVariant` picked the base-tier weight (7.6 oz) instead of the 5.7 oz die-size variant, or fell back to the initials path.

**Root cause:** `doughVariantQualifierKey` used `/\b7\s*["""'']+.../` which relies on curly-quote chars (U+201C/D, U+2018/9). Workbook cells use U+0022 (straight double quote), which wasn't in the class, so the regex matched zero quote chars and only stripped the digit "7" — leaving the "seveninch" sentinel never written. `doughVariantStripQualifier` had the same char-class gap, leaving a trailing `"` in the brand name ("Lowe's \"" instead of "Lowe's").

**Fix (lib/named-recipes/src/index.ts):**
1. `DOUGH_VARIANT_QUALIFIERS` — added `"seveninch"` sentinel.
2. `DOUGH_SIZE_QUALIFIERS = new Set(["seveninch"])` — distinguishes die-size tiers from recipe-weight tiers in Priority 1b catch-all logic.
3. `doughVariantQualifierKey` — two-step normalization:
   - `/\b7\s*inch(?:es)?\b/gi` → `" seveninch "`
   - `/\b7\s*[^\w\s]+(?!\d)/g` → `" seveninch "` (any punctuation after 7 that isn't followed by a digit; covers `"`, `''`, curly quotes; `(?!\d)` guards against decimal weights like "7.6")
4. `doughVariantStripQualifier` — same two-step replaces the old char-class strip so trailing `"` doesn't survive.
5. `matchDoughballVariant` Priority 1b — when the sole catch-all variant is a `DOUGH_SIZE_QUALIFIERS` tier but the profile has no die context, fall back to the base-tier brand match.

**Why `\b` at end failed:** after a non-word char like `"` at end-of-string, `\b` requires the last char to be `\w` — it isn't, so the match silently zero-quantified the quote group and matched only "7". The fix uses `(?!\d)` lookahead (not a trailing `\b`) to exclude decimal weights.

## Bug 5 — SMD not matching Show Me Dough (initials mismatch)

**Symptom:** `{brand: "SMD"}` (initials abbreviation) in the customers array failed to match the pool entry "Show Me Dough", so the profile was left blank instead of getting the correct weight.

**Fix:** `matchDoughballVariant` Priority 1.5 — initials-based catch-all. Compute initials of each pool variant's label (e.g. "Show Me Dough" → "smd"); if the normalized customer brand equals those initials, treat it as a match.

## Sharp edges

- Customer tagging must evaluate the complete current family, including
  yield-table variants merged beside AI rows; duplicate matching weights are
  ambiguous. Generic fallback counts variants within that family, never across
  all imported families.
  **Why:** A flattened import-wide universe can suppress valid singleton
  fallbacks, while checking only AI rows can choose a row when a table sibling
  has the same weight.
  **How to apply:** Keep family grouping intact through both assignment
  enrichment and profile-weight tagging; require exactly one candidate.

- `unionVariantCustomers(base, incoming)` is directional — `incoming` is the NEW set, `base` is what already exists. When you want to PRESERVE existing and optional-ADD incoming, you must not use this helper with incoming=existing; write the filter manually.
- Profiles for Lucia's Craft are localStorage-only (no rows in `brand_profiles` DB table) — server heals that operate on `brand_profiles` never touched them. The customers fix + import override is the only path to correct wrong weights on these profiles.
- Other label-named variants (Hannaford, Lowe's, Nob Hill Craft) still have no customers arrays — they rely on the die-number fallback. Add customers for those too if those brands start showing wrong weights.
- The "never clobber" rule still applies when `wMatchedViaCustomers=false` (die fallback or no match) — only high-confidence customers matches may override.
- Regex character class `["""'']` in JS source files may silently exclude U+0022/U+0027 depending on how the editor encoded the curly quotes. Prefer `[^\w\s]+(?!\d)` for "any punctuation after a digit, excluding decimal weights".
