---
name: Profile auto-fill from saved spec sheets
description: Setup-editor auto-fill/mismatch planner must mirror the spec-import apply loop's field semantics exactly
---

The Setup Profiles editor has an "Auto-Fill From Imports" panel: it fetches saved
spec-sheet snapshots, keeps only the latest snapshot per source file
(latestSourceKeyIds), and compares the selected brand+flavor's profile against
them. Blank/default fields auto-fill into the FORM (never persisted — user must
press Save Setup); differing fields surface as per-field "Use imported" reviews.

**Rule:** any feature that compares or back-fills profiles from imported data
must mirror the import apply loop's field semantics EXACTLY — same slot
resolution pipeline (assignApplicatorSlots → cheese → mix), same loose
recipe-name key, same "name only when no mixed rows" guards, and same
write-whenever-stated behavior (e.g. applicator batchLbs is offered even when
the slot has recipe rows, because the importer writes it as a fallback).

**Why:** a well-intentioned extra guard ("skip batch lbs when the slot has a
recipe, row-sum outranks it anyway") was flagged in review as semantic drift —
fields the importer would write silently vanished from both fill and mismatch
lists, so the planner disagreed with what a re-import would actually do.

**How to apply:** when extending the planner (profileAutofill.ts) or adding
similar compare-against-import features, diff the logic against the
applySpecImport profile loop in web storage.ts first; deviations need explicit
user sign-off, not silent guards. Blank detection quirks: allergen default is
the token "none", and non-zero schema defaults (pep batch 25) count as unset.
