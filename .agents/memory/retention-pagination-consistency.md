---
name: Retention pagination consistency
description: Why reminder traversals restart on scoped register revisions rather than deduplicating shifted offsets.
---

Treat a changed retention register as an invalid traversal: discard partial counts and restart, with bounded retries that surface failure instead of reporting partial totals.

**Why:** Deduplicating shifted offset pages can remove repeated rows but cannot recover a newly inserted earlier deadline. A keyset cursor alone would also miss inserts behind its cursor. The approved task accepts explicit restart rather than requiring a persisted snapshot.

**How to apply:** Keep the metadata revision and page on one database snapshot, scoped to the authenticated register and selected filter. Filtered membership must participate because clock-driven threshold changes can shift filtered offsets without a write. Protect every multi-page caller, including reminder counts and manual Load more. Preserve optional revision input for compatibility with older single-page callers, while updated traversals must carry and validate it.
