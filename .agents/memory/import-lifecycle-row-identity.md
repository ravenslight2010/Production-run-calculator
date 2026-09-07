---
name: Import lifecycle row identity
description: Safety rules for repeated recipe rows and concurrent saved-import retention.
---

Repeated ingredient rows should be aggregated only for discrepancy comparison.
Do not collapse their persisted structure or redistribute manager-entered values
unless each row has a deterministic identity match. When duplicate row counts or
weights change, the repair must remain review-only.

**Why:** Same-name rows can represent legitimate formula structure. Summing,
deleting, or proportionally redistributing ambiguous rows can silently alter an
approved recipe even when it prevents a visible duplicate.

**How to apply:** Use aggregate totals to detect drift, preserve exact rows in
stale-write signatures, and require a bijective identity match before carrying
row-owned manager values into a source-authoritative replacement.

Saved-import retention must serialize the insert/read/prune decision, not merely
wrap it in an ordinary transaction.

**Why:** Concurrent default-isolation transactions can each observe a valid
pre-prune set and commit an over-limit history.

**How to apply:** Lock per source family and scope (or use an equivalent
serializable retry contract) before enforcing a bounded snapshot history, then
exercise concurrent saves in integration coverage.