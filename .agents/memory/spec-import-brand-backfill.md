---
name: Spec-import brand backfill + placeholder pool entries
description: How unscoped AI parses get customer tags and how profile-only dough/sauce names become visible pool rows
---

Some workbooks express "which product a blend belongs to" ONLY through the profile applicator grid — the recipe block names nobody, so the AI emits recipes with empty brand/targets, and cheese/mix pool rows land unbranded ("no customer").

Rules:
- `fillSpecCheeseTargetsFromProfiles` (lib/spec-import) backfills targets onto unscoped cheese-kind recipes from the import's OWN profiles whose applicator type loose-matches the recipe name. Apply it ONLY to the server-pool collect passes (`scopedParsed` in commitSpecImport), never to the local apply — its slot-matching pass already ties recipes to profiles.
- Already-saved UNBRANDED pool rows are healed on re-import via `fillCheeseRecipeTags` / `fillSpecMixTags`; a row that already has a brand is NEVER re-scoped (curated tags win). Empty flavors on a branded cheese recipe means "All Varieties" — never overwritten.
- Profile dough/sauce names with NO backing recipe anywhere become empty-components placeholder pool entries at commit (so the name shows in Manage Lists instead of living only inside the profile). Double-guarded against duplicating: applySpecImport filters vs import recipes + local presets, commit filters loosely vs the live pool.

**Why:** the Lowe's Caribbean import produced invisible dough/sauce names and unbranded cheese/mix rows; the fix must never clobber manager-curated brand tags.

Prompt side: bare generic applicator types ("Mix") and collapsed named dough variants are prompt bugs — directives NAMED BLENDS ON APPLICATORS and NAMED DOUGH VARIANTS in buildParseSpecSheetPrompt address them; any such prompt change must bump SPEC_PARSE_VERSION or stale saved parses resurrect.
