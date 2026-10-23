---
name: QC and allergen Phase 1
description: Owner-approved boundaries for the first durable QC and allergen workflow.
---

## Rule

Phase 1 is non-blocking and adds run-linked lot and weight records, a non-blocking allergen pre-run checklist, and cleaning records requiring a second authenticated verifier. Use approved spec targets with reviewed QC overrides; default to ±0.1 in the target unit unless an approved limit or reviewed override takes precedence. Missing targets are not evaluated. QC managers and app managers edit settings and export full history; QC staff record and view; a manager signs off once per run, and later entries reopen review. Records are append-only, survive reset and purge, and use audited privacy redaction. Keep the manual run-allergen field and photo-quality history separate.

**Why:** The owner approved a record-first release and explicitly deferred run/shipping blocks and label claims so the app does not silently alter production or make unsupported safety assertions.

**How to apply:** Use these choices when planning or implementing QC Phase 1. Run blocking, shipping holds, label declarations, and other deferred workflows require separate owner approval.

## Separately approved component-check slice

The owner separately approved a run-component checklist limited to identity and presence, using canonical per-run settings and same-day substitutions as its expected-value source. Completed runs must use their immutable snapshot; client-provided expected values are never authoritative. This does not approve sensory, weight, label, allergen, safety-claim, production-hold, or shipping-hold checks, and it does not approve broader QC Phase 2.

**Why:** The approval was explicitly bounded to confirming what configured components are present and correctly identified, without adding safety or release authority.

**How to apply:** Keep this approval limited to the component-check workflow. Treat all other Phase 2 or safety-related criteria as deferred until separately approved.

## Separately approved date-code boundary

The owner approved recording literal date-code observations without evaluation
until an applicable owner-approved exact-text reference exists. No approved
finished-product shelf-life, date decoder or production-date policy was supplied.
An approved text match must not be described as calendar validity, expiry
enforcement, safety certification or release approval.

**Why:** Date-like text is evidence of what was printed, not authority to invent a
date policy or derive best-by values from today or ingredient expiration.

**How to apply:** Preserve observation-only / not-evaluated when reference authority
is missing. Require separate owner policy before expanding to date generation,
interpretation, enforcement or holds.

## Reference confidentiality is separate from comparison outcome

A not-evaluated outcome does not authorize exposing a selected draft, withdrawn,
stale or inapplicable reference. Keep manager-only reference administration out of
ordinary QC history, and snapshot reference contents only for an applicable
approved comparison. Historical snapshots that were legitimately approved at
recording time remain evidence after later withdrawal.

**Why:** An observation endpoint can otherwise become a guessed-ID read path for
protected settings even when its reference-list endpoint correctly hides them.

**How to apply:** Verify both save responses and run/facility history, not just the
reference picker/list. Unavailable selections should carry a generic reason, not
protected source/review metadata.
