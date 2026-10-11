---
name: Per-pizza advisory limits
description: Owner-approved plausibility review boundary for spec-import ounce amounts.
---

Use 16 oz per pizza as the advisory upper threshold for sauce, each applicator,
and each pepperoni entry. Exactly 16 is allowed; higher values warn only.

**Why:** The owner stated that dough is the heaviest component and its largest
observed amount has been 16 oz, so everything else cannot be higher than 16 oz.
The owner rejected a proposed 32 oz applicator threshold.

**How to apply:** Preserve the parsed amounts and unit provenance and the
manager's ability to Apply unchanged. Do not turn this review rule into a clamp,
conversion, batch-weight rule, dough limit, automatic repair, or hard block
without a new product decision.

Keep this review-only API separate from the parser entry rather than invalidating
saved parses to introduce advisory messages.

**Why:** The parser-version guard deliberately treats any substantive change to
the parser entry as requiring a cache-version bump, even a review-only re-export.
Current review-derived advisories must also cover existing cached parses, so
invalidating them would incur needless AI re-parsing without improving evidence.

**How to apply:** Keep review-only helpers on their own package entry. Do not
weaken the parser-version guard to accommodate advisory-only UI changes.