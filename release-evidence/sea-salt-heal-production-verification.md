# Sea Salt Heal Production Verification

- Capture time: 2026-09-15T12:37:48Z
- Environment: production read replica
- Code revision reviewed: `840c149d65743705f0e36b2085b4aa9d03e5de08`
- Procedure: Replit production database read-only queries
- Data handling: bounded counts and recipe names with only Salt/Sea Salt ingredient amounts; no raw recipe payloads, credentials, user data, or unrelated production records retained

## Verification contract

The released `sea-salt-alias-undo-v1` repair:

1. Deletes the exact case-insensitive `Sea Salt` to `Salt` mapping for the three ingredient alias kinds and the mirrored ingredient AI correction.
2. Restores source-approved Salt rows to Sea Salt only for:
   - Modified Malted Barley Dough at 1.3 lb
   - Malted Barley Dough at 0.5, 1, or 1.25 lb
   - Masa dough variants at 2.5 lb
   - Aldo Pizza Sauce at 1 lb
   - Grilled Vegetable Mix at 0.03 per pizza or 1.242
3. Excludes other recipes and amount mismatches. Known legitimate plain-Salt examples in the repair contract are CRB Dough, Lucia Pizza Sauce, and Spinach Mix.

## Production results

| Check | Status | Bounded production evidence |
| --- | --- | --- |
| Marker applied | PASS | `sea-salt-alias-undo-v1` exists with `applied_at` 2026-07-18T03:01:44.586Z. Its result was historically backfilled and explicitly approximate, so it is used only as marker evidence, not as exact change counts. |
| Poisoned spec aliases absent | PASS | Exact `Sea Salt` to `Salt` mappings across dough, sauce, and cheese ingredient kinds: 0. |
| Poisoned AI corrections absent | PASS | Exact ingredient-domain `Sea Salt` to `Salt` corrections: 0. |
| Modified Malted Barley restored | PASS | Live recipe has one Sea Salt row at 1.3 and zero plain Salt rows. |
| Malted Barley restored | PASS | Live recipe has one Sea Salt row at 1 and zero plain Salt rows. |
| Masa variants restored | PASS | Both live Masa recipes each have one Sea Salt row at 2.5 and zero plain Salt rows. |
| Aldo sauce restored | PASS | Live recipe has one Sea Salt row at 1 and zero plain Salt rows. |
| Grilled Vegetable mix restored | PASS | Live recipe has one Sea Salt row at 0.03 and zero plain Salt rows. |
| CRB Dough plain Salt preserved | PASS | Live recipe has one plain Salt row at 1 and zero Sea Salt rows. |
| Spinach Mix plain Salt preserved | PASS | Live recipe has one plain Salt row at 0.06 and zero Sea Salt rows. |
| Lucia Pizza Sauce plain Salt preserved | NOT VERIFIED | No matching production recipe was present in the bounded current-state query. Absence is not treated as preservation proof. |

## Classification

**VERIFIED with one explicit preservation evidence gap.**

The production marker is present, the exact poisoned learned mappings are absent, every currently present named affected recipe contains Sea Salt at a source-approved amount with no plain Salt row, and the currently present known legitimate Salt recipes remain plain Salt. The Lucia Pizza Sauce example cannot be verified because that named recipe was not present in the production result set.

No production mutation was attempted. The Lucia absence does not show a failed heal and does not justify an ad-hoc repair. If Lucia Pizza Sauce is later restored or expected to exist, its plain-Salt preservation should be checked through the same bounded read-only procedure.