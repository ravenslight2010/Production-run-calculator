# Ingredient Allergen Foundation — Design

**Date:** 2026-10-05  
**Status:** Approved design; implementation pending  
**Scope:** First ingredient-mapping and run-footprint increment only

## Purpose

Add maintained ingredient-to-allergen mappings and a read-only, ingredient-derived
allergen footprint for the active run. Unknown coverage must remain visibly
unknown. This work does not create production controls, cleaning clearance, or
regulatory label claims.

## Owner-approved decisions

- Ingredient mappings support exactly these nine allergens: egg, soy, milk,
  wheat, peanuts, tree nuts, fish, shellfish, and sesame.
- Mapping edits require a dedicated `manage-allergens` capability.
- Managers and the `qc-manager` role receive that capability. The `qc-operator`
  role does not receive it by default. Managers can assign the capability to
  other roles through role administration.
- An ingredient without an explicit review is unknown, including existing
  ingredients after the change. An explicitly reviewed ingredient with no
  selected allergens means “none of these nine.”
- Existing manually entered run allergen labels remain supported and unchanged.

## Data and API

Extend each ingredient record with:

- a list of mapped allergens, limited to the approved nine; and
- a review flag, separate from the list so an empty list can mean either
  “unreviewed” or “reviewed with none of these nine.”

New and existing rows default to an empty list and unreviewed. Do not backfill
historical ingredients as reviewed or allergen-free.

Keep updates behind an allergen-specific API operation protected by
`manage-allergens`; do not allow the general ingredient-catalog save path to
change allergen mappings. Read the mapping with the authenticated ingredient
catalog. Validate allergen values on the server and write only within the
request's current facility scope. Reuse existing ingredient IDs; do not create
new identities for mappings.

Add `manage-allergens` to the data-driven capability catalog. Managers receive
all capabilities. Grant it to the existing `qc-manager` role without replacing
any of that role's other saved capabilities. Do not grant it to `qc-operator`
by default.

## Run footprint

Compute the footprint from the active run's configured dough, frontline
(Sauce), cheese-applicator recipe rows, and selected pepperoni types. Resolve
ingredient references by stable ID, using the existing case-insensitive name
fallback for legacy recipe rows.

If a configured recipe component has no ingredient rows, or a recipe row cannot
be resolved, mark coverage incomplete. If no recipe ingredient data is available
for the run, show that the footprint cannot be computed; do not treat an empty
input as evidence of no allergens.

Show:

- each mapped allergen and the contributing ingredient names; and
- every contributing ingredient that is missing from the catalog or has not
  been explicitly reviewed.

An ingredient with a reviewed empty list contributes no mapped allergen, but
the UI must say that the footprint is incomplete if any other contributing
ingredient is unknown. Do not infer “allergen-free” from missing recipe rows,
missing catalog identities, or unreviewed mappings. The computation is
read-only and must not write the result to the run.

Keep the footprint visibly separate from the existing manually entered run
allergen label. Do not change sequence-warning inputs or behavior: sequencing
continues to use the existing manual field in this increment.

## User interface

Add an ingredient-mapping editor to the existing ingredient-management
settings surface. Only users with `manage-allergens` may edit. The editor must
make the distinction between unreviewed and reviewed-with-none explicit, and
show the saved state after persistence.

Add a read-only footprint panel to the active run view. It must present both
contributing ingredients and incomplete coverage in clear text; color or badge
alone is insufficient.

## Safety boundaries

This is mapping and visibility only. It does not block a run, verify or clear
cleaning, release QC holds, create food-label declarations, or certify food
safety. The current mapping is not an append-only QC audit record and must not
be presented as regulatory evidence.

## Verification

Focused checks must cover:

- server validation and persistence of reviewed allergen mappings;
- authorized reads and capability enforcement for mapping writes, including
  manager and `qc-manager` access and rejection of unauthorized edits;
- old ingredient rows remaining unreviewed and explicit empty review remaining
  distinguishable from unknown;
- recipe-derived allergen results, contributing ingredient names, missing
  catalog entries, and unreviewed mappings;
- no mutation of existing manually entered run labels or sequence-warning
  behavior; and
- display of incomplete coverage in the run view.
