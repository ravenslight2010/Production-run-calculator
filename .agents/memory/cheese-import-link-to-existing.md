---
name: Cheese workbook link-to-existing
description: Why the cheese workbook importer links shorthand blends onto existing pool recipes instead of adding a new alias kind, and the one-to-one guard.
---

# Cheese workbook "link to existing" matching

The cheese workbook importer keys each blend by a brand+name slug, so a blend
written in shorthand ("Whole Mozz Cheese Mix") used to fork a DUPLICATE of the
canonical recipe a spec-sheet import already created ("Whole Mozzarella Cheese
Mix"). Fix: a conservative loose-match pass proposes linking an imported blend
onto an existing pool recipe of the SAME brand; the review dialog lets the
manager accept ("Update it instead of adding new") or reject per recipe.

**Decision: do NOT add a "cheese blend name" alias kind.** SpecAliasKind covers
ingredient names, not blend names. Since spec sheets create the canonical blend
FIRST, link-detection-against-the-existing-pool covers the dominant case without
new server/codegen surface. Persistence of confirmed blend-name links is a
possible future follow-up, not shipped.

**Why the matching is safe:** brand-scoped key, abbreviation-expanded (matchKey)
with only generic filler tokens dropped (standard/regular/pizza), NO
edit-distance fuzz, and an ambiguity guard that drops a loose key shared by two
different existing recipes.

**One-to-one guard (data-loss prevention):** mergeCheeseRecipes merges by id with
last-write-wins. If two accepted links — or a link plus an exact-id update —
resolve to the SAME existing id, one blend's data is silently lost. So
`withCheeseLinks` tallies claims per target id and drops any link whose target
would be written by more than one candidate; the blend stays NEW instead.

**How to apply:** any future importer that relabels an import onto an existing
record by a fuzzy/loose key must add the same per-target one-to-one guard before
a last-write-wins merge, or accept silent overwrites.
