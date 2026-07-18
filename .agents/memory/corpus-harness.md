---
name: Corpus regression harness
description: Deterministic no-AI importer regression bench over the real customer workbook corpus, plus the mix-word-beats-cheesy-components routing decision.
---

# Corpus regression harness

`lib/corpus-harness` parses the whole `attached_assets/source-library` corpus deterministically and compares against checked-in JSON snapshots (`snapshots/*.json`), with invariant tripwires (grid sanity, dropped rows, mix-vs-cheese routing, near-dup pressure). Run via the `test:corpus` workflow; regenerate snapshots with the package's `snapshots` script after INTENTIONAL importer changes and review the diff.

**Routing decision (do not flip):** in `specImportCheeseRecipeIsMix`, the mix/blend name-word rule deliberately beats the cheesy-component check.
**Why:** real premixes often contain cheese ("White Fajita Mix" carries Monterey Jack) yet belong on the Mixes screen; cheese-workbook blends named "... Mix" ("Aldo's Parmesan / Oregano Mix") are safe because the cheese WORKBOOK importer never consults this spec-import heuristic. An attempt to reorder (components first) regressed the White Fajita cases and was reverted.
**How to apply:** if the harness routing invariant flags a cheese-workbook name leaking to Mixes, check it has a mix/blend word — that leak is the accepted boundary; only a leak WITHOUT the word is a real regression.

Other gotchas baked into the harness:
- Schedule workbook is exempt from the dropped-rows gate (imports via its own day-block path, not the spec prompt chunker).
- Single-component "premixes" (prep steps like drained pineapple) and nameless blocks can't route by the ≥2-component rule — exempt.
- Snapshot builders must `JSON.parse(JSON.stringify(actual))` before `toEqual` (undefined-vs-missing) and use `c.ingredient` (components have no `name` field).
