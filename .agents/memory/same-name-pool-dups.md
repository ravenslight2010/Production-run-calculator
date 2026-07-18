---
name: Same-name pool duplicates are invisible to the merge screen
description: Why a duplicated mix/recipe with an identical name can't be merged away, and how it gets fixed.
---

# Same-name pool duplicates

The Merge screen is NAME-keyed: two server-pool rows with the exact same
(name, brand, flavor) collapse into one name in the universe, so the user can
never merge one into the other — the duplicate looks "missing" from the merge
picker but shows twice in Manage Lists.

**Why:** imports mint client-side ids from the name at import time; if a row
is later renamed (or a second import derives the id from a fuller name), two
ids end up carrying the same name and the name-based merge has nothing to
offer.

**How to apply:** fix by DEDUPING THE POOL ROWS (one-time heal, keep the row
with real data — see `pickMixDuplicateLosers` pattern in dataHeals), not by
changing the merge UI. Rank: has-amounts > has-batch > component count >
NEWEST createdAt (raw timestamp with a descending sort — negating the
timestamp under a descending comparator silently prefers OLDEST; this bug was
caught in review).

**Limitation:** `/mixes` POST upserts by (id, scope) with no name-uniqueness,
so a stale open client can re-save a deleted duplicate id and resurrect it;
the heal is one-time. If dups recur, add a write-path guard, not a v2 marker.
