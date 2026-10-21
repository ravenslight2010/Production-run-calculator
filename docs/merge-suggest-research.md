# Merge-Suggest (Dedup System) — Research & Improvement Opportunities

## Current State — Solid Design, One Real Correctness Gap

`lib/merge-suggest/src/index.ts` (457 lines) is the shared logic behind ingredient/
recipe/brand/flavor deduplication across web and mobile. Like auto-track and incidents,
it's careful, well-designed code:

- **Learned memory**: every confirmed merge persists a `source → canonical` alias
  (`collectMergeAliases`); future imports/edits re-propose the same consolidation
  automatically (`suggestionsFromAliases`) — the same "teach it once" pattern the import
  redesign plan's Layer 6 (correction overlay) builds on
- **Existence guard**: a remembered alias is only re-proposed when BOTH the source and
  target names still currently exist — mirrors the `photoAliases` stale-item guard, so a
  deleted name is never resurrected
- **Category scoping**: merge suggestions/aliases/denials are scoped per tab
  (ingredient/mixes/dough/sauce/cheese/brand/flavor) so a denial in one context never
  leaks into another — `flavor` additionally scopes to a single brand, since the same
  flavor name can legitimately repeat across brands
- **Deterministic near-dup matching, transitively clustered**: uses `@workspace/name-match`
  (word-order + single-typo layers), explicitly tested for transitive clustering via
  union-find ("clusters transitively when a middle name pairs with both ends") — so A~B
  and B~C correctly group into one {A,B,C} cluster at *suggestion* time
- **Algorithm choice validated by outside research**: token-based/word-order matching
  plus edit-distance-for-typos is exactly what current fuzzy-matching literature
  recommends for this data shape (short product/ingredient names, word-order variance as
  the dominant noise source) — Jaro-Winkler's prefix-bonus advantage is aimed at personal
  names/addresses where the start of the string is most reliable, which doesn't
  particularly apply here. No algorithm-swap recommended.

---

## The Gap: Alias Chains Don't Retarget

The transitive clustering above applies to **near-dup suggestions computed fresh each
time**. It does NOT apply to **already-learned aliases** stored from past confirmed
merges, and that's where a real correctness gap shows up:

**Scenario**: a manager merges "Mozzarella Shredded" into "Mozzarella" (alias: `Mozzarella
Shredded → Mozzarella` is stored). Weeks later, "Mozzarella" itself gets merged into
"Mozz - Shredded LTO" for a naming-convention cleanup (alias: `Mozzarella → Mozz -
Shredded LTO` is stored). The next time "Mozzarella Shredded" appears in an import:

- `suggestionsFromAliases`'s existence guard checks: does the alias's *target*
  ("Mozzarella") still exist among current names? **No** — it was itself merged away.
- The guard correctly refuses to resurrect it (working as designed for THIS case) — but
  the practical effect is the old alias silently stops firing, with no error, no
  indication, nothing. The manager who already decided "Mozzarella Shredded should merge
  into whatever Mozzarella becomes" has to notice the duplicate again and manually
  re-approve a decision they already made once.

**Why this matters**: this is exactly the kind of silent, hard-to-notice gap that
`.agents/memory/autotrack-*.md`'s entire collection of hard-won lessons is about — not a
crash, not an error, just a previously-solved problem quietly becoming unsolved again
with no signal to anyone. The existing `mergedAway` tombstone table (checked directly —
it only prevents *resurrection* of merged-away source names; it has no lineage/chain
tracking) doesn't help here either.

**Recommendation**: when a merge target itself later becomes a merge *source* (i.e., B
in an existing `X → B` alias is now being merged into C), retarget the existing alias
rows pointing at B to point at C instead, rather than leaving them to silently fail their
existence guard. This is a small, targeted fix — a rewrite step at merge-confirmation
time, not a redesign of the matching/suggestion logic. Worth writing as an explicit test
case first (`nearDupSuggestions.test.ts` already has the pattern for transitive
clustering — a `learnedAliasChain.test.ts`-style case would be the natural place) since
this is precisely the kind of interaction bug that's easy to introduce a regression in
later without one.

---

## Code References
| File | Purpose |
|------|---------|
| `lib/merge-suggest/src/index.ts` | Core pure logic — `collectMergeAliases`, `suggestionsFromAliases`, category scoping |
| `lib/merge-suggest/src/nearDupSuggestions.test.ts` | Existing transitive-clustering test — model for a new chain-retarget test |
| `lib/db/src/schema/mergeAliases.ts` | Learned alias storage — where a retarget-on-chain write would apply |
| `lib/db/src/schema/mergedAway.ts` | Tombstone against resurrection — confirmed NOT a lineage/chain tracker, doesn't solve this |
| `@workspace/name-match` | The near-dup matcher itself — validated as an appropriate choice for this data shape, no change recommended |
