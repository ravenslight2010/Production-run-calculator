---
name: Import order + dedup-key asymmetry
description: Why importing a pizza spec BEFORE its cheese/premix/sauce/dough workbooks leaves parallel (near-duplicate) recipes, and which dedup keys actually run.
---

# Cross-file import dedup: order matters, and the keys are NOT uniform

When several related workbooks are imported (pizza spec + cheese workbook + premix + sauce + dough), whether the pizza-spec profiles' applicator/recipe references link to the dedicated workbook entries — instead of creating parallel near-duplicates — depends on **import order** and on **which dedup key each importer uses**.

## The AI match-import pass only helps when the target pool ALREADY exists
`linkParsed` (spec import) runs up to 2 AI match-import passes, but they match spec candidates against the **known** pools loaded at import time. If the pizza spec is imported FIRST into an empty DB, `known` is empty, so the match pass no-ops — the spec's recipes are created with nothing to snap onto. The later cheese/premix imports are **deterministic** (no AI match), so they can only dedupe by name key.

**Consequence:** spec-first is the worst order for dedup. Master-data workbooks imported first would let a later spec import's loose-key linkers snap onto them — but only for dough/sauce (see below), not cheese.

## Dedup keys are asymmetric
- **Cheese** (`addCheeseRecipesIfAbsentByName`): dedupes by **EXACT** case-insensitive full name only. No punctuation/filler folding. So "Lucia's Craft Caribbean Cheese Mix" (spec) and "Lucia's Caribbean Cheese Mix" (workbook) stay as two entries.
- **Mixes/premix** (`addSpecMixesIfAbsent` → `mixNameMatchKey`) and **dough/sauce recipe-name linking** (`linkSpecImportNamedRecipesToExisting`): use the LOOSE key (mirrors `specImportNameMatchKey` — lowercase, strip apostrophes/punct, drop filler tokens `standard`/`regular`/`pizza`). Tolerates case/punct/filler drift but NOT extra distinguishing words ("Craft"), reordering ("Chicken Masala" vs "Masala Chicken"), or misspellings ("Carribean").

**Why it matters:** a spec that drops "Craft", reorders words, or misspells vs the dedicated workbook name will create a parallel entry, not a link — even though a human sees them as the same recipe.

## Real observed example (Lucia Craft spec + its workbooks, spec-first)
- Pizza spec (real AI parse) → 8 profiles, 15 "cheese"-kind recipes (a mix of real cheese blends AND topping mixes the AI labeled cheese).
- 5 real cheese blends name-match the cheese workbook exactly (clean merge): Lucia's Club / Red Hot / Spinach / Cheeseburger / Craft Cheese Mix.
- Topping-mix slots (Caribbean, White Fajita, Masala, Bratwurst, etc.) do NOT match the premix book (spec drops "Craft"/reorders/misspells) → parallel entries.
- Dough: spec references NO dough recipe by name (only die types) → "Malted Barley Dough" imports unlinked to the profiles.
- Sauce: the 8 flavors use named dressings (Ranch/Alfredo/Red Hot/etc.); a generic "Lucia Pizza Sauce" red-sauce workbook matches none → imports unlinked.

## How to apply
When asked whether multi-file imports "line up / no duplicates," the honest answer hinges on exact vs loose keys + order. Verify by parsing the real files through `POST /api/ai/parse-spec-sheet` (read-only, writes nothing) and comparing extracted names with the SAME key each importer uses — not a single uniform key. Don't assume the AI match-assist rescues cross-file near-misses; it usually can't in spec-first order.
