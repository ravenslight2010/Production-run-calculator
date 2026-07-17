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

**Multi-source + conflicts.** The panel now gathers candidate values per field
from SEVERAL saved sources — spec sheets, the dough pool, the cheese pool, the
mixes pool, and a durable palletizing/shipping-guide snapshot (server pool
`saved_shipping_guides`, mirror of saved spec sheets: scope-isolated, 2-most-
recent-per-sourceKey prune, saved best-effort on shipping-guide import). When
≥2 sources give DISTINCT values for one field it becomes a `conflict` (user
picks); agreeing sources fill once; spec-vs-current disagreement stays a
`mismatch`. Equality is field-aware (`valuesEqual`): numeric tolerance +
normalized/loose-name string compare, so casing/whitespace/near-float noise
never fabricates a conflict. Backward compat: with no new sources the plan is
byte-for-byte the old spec-only behavior. **Nothing auto-applies** — conflicts
and mismatches are form-only until Save Setup; only `fills` seed the form.

**Relink ties are blank-fill-only for doughball fields.** The import's
`nameRelinked` guard means a dough recipe tied on ONLY by the name re-link
backfills weight/per-tray when blank, never overwrites — a dough mixing sheet
carries many same-named family variant rows, and without the split the LAST
variant row wins (Corner Booth profile offered Lowe's 7 Inch 5.7 oz instead of
its own 8.25). The planner mirrors this: anchored ties write verbatim,
relink-only ties check the effective sequential value. The dough-POOL source is
variant-aware too: die-match/single variant wins; multiple variants with no die
match = ambiguous → offer NO weight (never the recipe-level number).

**The import has TWO dough/sauce paths — mirror both.** Profile-level
doughName/sauceName is only half the story: dough and sauce mostly arrive as
RECIPES in the parsed data, tied to profiles by the import's recipe loop
(recipeApplyTargets: explicit targets, brand anchors, same-brand fan-out over
the apply pool; plus a name re-link against the profile's current recipe
name). That tie also writes doughball weight / batch yield / doughballs per
tray, runs AFTER the profile loop (so it overwrites — recipe-derived fields
outrank profile-level names within a sheet), and the re-link must see the name
the same sheet's profile loop would have just assigned. Missing this path was
the "auto-fill didn't fill dough" bug. Note the relink key is
specImportNameMatchKey directly (no cheese-name cleaning — "X Dough 9oz" does
NOT loose-match "X Dough").

**Pool-union candidates:** the planner's applicator slot resolver must union
its recipe-name candidates from the sheet's OWN recipes PLUS the server cheese
and mixes pools (cheese filtered against mix names), exactly like the import
apply loop does. Sheets often reference blends they don't re-declare (they
live only in the server pool); sheet-only candidates leave the raw type name
as a phantom applicator type in the form.
