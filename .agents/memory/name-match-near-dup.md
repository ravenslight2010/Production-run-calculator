---
name: Shared near-dup name matcher
description: "@workspace/name-match layered near-duplicate matcher for importer link/dedup passes — layer semantics, guards, and the extra-word opt-in rule"
---

# Shared near-dup name matcher (@workspace/name-match)

All importer "does this imported name mean an entry we already keep?" passes go
through `buildNearDupNameMatcher(existingNames, { keyOf?, allowExtraToken? })`
instead of per-lib exact loose-key maps. It returns the EXACT existing name or
null. Layers, most-confident first:

1. loose key equality (`looseNameKey`: lowercase, punctuation folded, filler
   tokens standard/regular/pizza dropped)
2. token-sorted key equality (word reorder)
3. single typo (edit distance exactly 1, both keys ≥5 chars, digits equal)
4. OPT-IN `allowExtraToken`: one extra non-digit word (shared part ≥4 chars)

Every layer has an AMBIGUITY GUARD: 2+ distinct qualifying saved names → null,
with NO fall-through to weaker layers. Digit changes never match ("Pepperoni 2"
≠ "Pepperoni 3"). Duplicate same-name saved entries collapse to one candidate
(not a false ambiguity).

**The extra-word layer must stay OFF in silent auto-link paths.**
**Why:** an extra word is often a meaningful qualifier — "Spicy Cheese Mix" is a
different product than "Cheese Mix"; product tests in mixes/spec-import lock
this in. Enabling it silently caused those regressions during development.
**How to apply:** default matcher for anything that renames/skips without user
review (spec-import link passes, mixes `addSpecMixesIfAbsent`, named-recipes
`addNamedRecipesIfAbsentByName`). Enable `allowExtraToken: true` ONLY where the
match is a reviewable proposal a human can decline (cheese-import's `linkTo`
suggestions, which also stay behind the one-to-one claim guard). Die types
intentionally keep the conservative exact-key map only.

Cheese wiring detail worth keeping: the cheese fallback is brand-scoped (matcher
built per brand key) and uses `cheeseLinkKey` (abbreviation-expanded) as `keyOf`,
so "Mozz"/"Mozzarella" style drift still folds before the layers run.

## Layer-1-only auto-rename in spec-import link passes (2026-07-19)
- Spec-import's snap-to-existing passes (cheese + dough/sauce) auto-rename ONLY
  on layer-1 loose-key equality. Reorder/typo layers and beyond-exact family
  folds surface as declinable review suggestions (`buildNearDupNameMatcherDetailed`
  exposes which layer matched).
- **Why:** silent layer-2/3 links cross-linked different customers' recipes in
  prod (Basha's Ultra Thin 5-cheese mix saved as "Lowe's/Hannaford 5Cheese Mix").
  Similar ≠ same when brands differ by a word.
- **How to apply:** any new importer link pass that renames without user review
  must use the detailed matcher and treat non-layer-1 matches as suggestions.
  Learned aliases, userNamed guard, hint/exact-anchored sibling collapse stay
  auto. Fixing a silent-link bug also needs SPEC_PARSE_VERSION bump (saved
  parses embed the bad names) + a heal purging poisoned saved parses.

## Neutral-descriptor fold for TYPE names (2026-07-18)
- Applicator/pep TYPE names get one more layer in spec-import `canonicalize` (appType/pepType kinds only): tokens in `NEUTRAL_TYPE_EXTRA_TOKENS` ({"milk"}) are dropped from the loose key (`specImportTypeNameFoldKey`), so "Whole Milk Mozzarella" snaps to a known "Whole Mozzarella" (unique-target guard; counted as exact so the alias is learned). Auto-Fill's mismatch compare uses the same fold key.
- **Why:** "milk" is a dairy spec, not a different product; but "cheese" must NEVER fold (cheese sticks ≠ pepperoni sticks, "Cheese Mix" ≠ "Mix").
- **How to apply:** expand the set only for descriptors that can't distinguish products; keep the fold out of brand/flavor/ingredient kinds.
