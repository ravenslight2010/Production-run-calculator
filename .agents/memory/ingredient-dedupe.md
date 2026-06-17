---
name: Ingredient near-dup merges
description: How/where duplicate ingredient names get collapsed, and which distinctions are kept vs merged.
---

# Ingredient near-duplicate de-duplication

Near-duplicate applicator/cheese-ingredient names are collapsed via a single
`INGREDIENT_RENAMES` map that is mirrored in BOTH apps (web `types.ts`, mobile
`RunContext.tsx`). Adding a merge means: add the map entry in both, replace the
quoted tokens in both `specSeed.ts` files (list arrays + profile app*Type/recipe
refs), and remove any list entry that becomes a duplicate of an existing one.

**Why:** users repeatedly report the same ingredient showing twice (word-order,
plural, redundant "Cheese"/"Mix" suffix, or cut/prep prefix). They surface side
by side in the Warehouse "Total Ingredient Needs" aggregation, which keys by exact
`label__unit`, so any spelling variant shows as a separate row.

**Carve-outs (kept SEPARATE — do not merge):** all `FR` (fire-roasted) variants,
the three Parmesan forms (Grated / Shredded / plain), mozzarella fat levels
(Part Skim / Skim / Whole), Extra Large Cut, and IQF forms.

**NOT a hard carve-out:** the "Diced" cut prefix. The user explicitly opted to
merge `Diced Chicken→Chicken` and `Diced Tomatoes→Tomatoes` (while `FR Diced
Tomatoes` stays separate under the FR rule). So treat cut/prep prefixes as
merge-by-default unless the user says otherwise; FR always wins.

**Migration mechanism:** existing web users only re-clean their saved option
lists when the one-time marker `run-calc-ingredient-dedupe-vN` is bumped — bump
it whenever you add map entries. Saved profiles/runs are renamed on read; mobile
self-heals every load via normalizeSettings/normalizeState.
