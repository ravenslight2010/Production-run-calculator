---
name: Spec-import chunk merges are union, not replace
description: Why chunk-level profile merges must union applicator/pepperoni lists, and the duplicate-applicator prompt rule
---

**Rule:** When merging parsed spec-import results, the merge semantics depend on the SOURCE of the collision:
- CHUNKS of one workbook → `mergeParsedSpecImports(list, { profileSlots: "union" })` — chunk lists are COMPLEMENTARY (a chunk boundary can split one product's spec block mid-grid), so applicator/pepperoni lists must union or the earlier chunk's weights are silently lost.
- Multiple FILES in one batch → default `"replace"` — a later workbook restating a product is a correction.

Union semantics: identical re-emits (loose type key + same oz) collapse with slot/batchLbs enrichment; a 0-oz entry is dropped when the same type also carries a real weight (partial re-emit); the SAME type at DIFFERENT weights stays as TWO entries — a pizza legitimately runs one topping/blend on two stations at different per-pizza weights.

**Why:** User report "importing doesn't get all the weights right, especially with 2 applicators using the same ingredient/recipe." Two causes: (1) wholesale later-wins array replace at chunk merge dropped split-block applicators; (2) the AI parse prompt never said the same topping can run on two stations, so models deduped same-named applicators — fixed with the pinned DUPLICATE APPLICATORS prompt section (one applicators[] entry per station, own ozPerPizza, never collapse/sum/copy).

**How to apply:** Any new merge path over per-chunk parse results must use union mode; any new merge over per-file results must keep replace. If the parse prompt is rewritten, keep the DUPLICATE APPLICATORS section (prompt-pin test guards it). Accepted residual: a workbook restating one profile differently on two sheets keeps both weight entries (surfaced in review) instead of silently picking one.
