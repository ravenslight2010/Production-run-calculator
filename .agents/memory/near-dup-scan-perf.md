---
name: Near-dup scan performance
description: In-pool duplicate scans must build ONE name-match matcher (excludeSelf), never rebuild per name — O(n²) rebuilds freeze the page as import pools grow.
---

**Rule:** Any "find duplicates within a pool" scan built on `@workspace/name-match` must construct the matcher ONCE over the whole pool with `{ excludeSelf: true }` and query each member against it. Never loop `buildNearDupNameMatcher(others)` per member — matcher construction does regex key-normalization for every entry, so per-member rebuilds are O(n²) in the expensive part.

**Why:** After a spec import, the auto merge-check runs `nearDupSuggestions` over the full cross-category ingredient universe on the main thread. The per-member-rebuild version measured 8.8s at 2,000 names and 18.7s at 4,000 (server CPU; slower on floor PCs) — a frozen page that scales up with every import. The shared-matcher version is ~35× faster (0.54s at 4,000) with identical grouping (verified by randomized differential trials).

**How to apply:**
- `excludeSelf` skips the query's own entry by trimmed case-insensitive name; pools that are ci-deduped first (as `nearDupSuggestions` does) get exactly the old "matcher over the others" semantics, ambiguity guard included.
- Query phase is still O(n²) with cheap string ops — fine to tens of thousands of names; if pools ever get huge, drop the per-query `pool.filter` allocation before reaching for anything fancier.
- A <5s perf guard test at 3,000 names lives in `lib/merge-suggest` so a regression to per-member rebuilds fails CI.
