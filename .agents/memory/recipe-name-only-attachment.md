---
name: Recipe name-only attachment (brand/flavor targeting retired)
description: Recipes (dough/sauce/cheese/mix) attach to products by NAME only; the brand/flavor "who it goes to" apply-target fan is retired everywhere.
---

**Rule:** Recipes never fan out to profiles by brand/flavor targeting. Attachment paths:
- Dough/sauce: a profile's stored `doughRecipeName`/`frontlineRecipeName` link (loose name re-link on import), plus the SAME-SHEET tie — a recipe parsed from a pizza spec sheet whose own `r.brand`/`r.flavor` matches a profile in the SAME parsed file ties onto that one profile verbatim.
- Cheese/mix: applicator-slot name matching only (pick-only cards / slot-name scan).
- `recipeApplyTargets` in lib/spec-import is a permanent no-op (`[]`); `targets:`/bare `brand:` on parsed recipes are inert. The profile-autofill planner mirrors this exactly (relink + same-sheet, no fan).

**Why:** Brand-fan targeting repeatedly cross-linked recipes onto wrong products (prod incidents); the user chose name-only attachment as the mental model.

**How to apply:** Never reintroduce a "which brand/flavor does this recipe go to" editor or fan logic. Stored brand/flavor DB fields on recipes stay inert (not dropped) — keep them for brand-scoped matching hygiene, brand grouping/rename in CheeseRecipesManager, and the same-sheet tie. The same-sheet tie is the ONLY surviving explicit brand/flavor path and only within one parsed file.

**Prod audit (2026-07-21): no dead remnants — do NOT prune pool tags.** A full audit of stored brand/flavor values on dough/sauce/cheese/mix pool rows (dev + read-only prod) found nothing truly dead: prod dough rows are all untagged, only 3 sauce rows carry display tags, and every cheese/mix tag feeds a kept use (Manage Lists badges + grouping/rename, brand-scoped cheese/premix import linking, cheese pick-card flavor assignment, autofill reach fallback). "Orphan" flavor entries that match no profile are workbook-verbatim assignment lines for customers/flavors not yet profiled — they re-heal on re-import and NEVER prune them: emptying a `flavors` list flips the row to the "All Varieties" catch-all and it would suddenly match every flavor of the brand. `targets[]` inside `saved_spec_sheets` parses are also live (tag derivation + same-sheet tie on snapshot reuse). No `applyTargets`-style keys exist in `brand_profiles` or `daily_sync`. Known cosmetic drift left as-is: one prod sauce tagged brand "Aldo" (canonical "Aldo's") — display-only; fix via customer rename flow if it ever matters, not a heal.
