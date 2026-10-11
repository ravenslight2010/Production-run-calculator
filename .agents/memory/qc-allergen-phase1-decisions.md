---
name: QC and allergen Phase 1
description: Owner-approved boundaries for the first durable QC and allergen workflow.
---

## Rule

Phase 1 is non-blocking and adds run-linked lot and weight records, a non-blocking allergen pre-run checklist, and cleaning records requiring a second authenticated verifier. Use approved spec targets with reviewed QC overrides; default to ±0.1 in the target unit unless an approved limit or reviewed override takes precedence. Missing targets are not evaluated. QC managers and app managers edit settings and export full history; QC staff record and view; a manager signs off once per run, and later entries reopen review. Records are append-only, survive reset and purge, and use audited privacy redaction. Keep the manual run-allergen field and photo-quality history separate.

**Why:** The owner approved a record-first release and explicitly deferred run/shipping blocks and label claims so the app does not silently alter production or make unsupported safety assertions.

**How to apply:** Use these choices when planning or implementing QC Phase 1. Run blocking, shipping holds, label declarations, and other deferred workflows require separate owner approval.
