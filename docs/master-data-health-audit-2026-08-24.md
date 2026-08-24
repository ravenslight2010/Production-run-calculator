# Master-data health audit — 2026-08-24

## Scope and evidence

This audit owns the pre-existing development scan recorded on 2026-08-23
(89 findings: 83 errors and 6 warnings) and compares it with a fresh scan of
the current development database. Queries used only grouped counts, stable
pool/profile identifiers, and the affected field; no full profile documents or
request data were exported.

The published production snapshot was also queried read-only. It is not a
like-for-like baseline: it contains an older schema/data state and its latest
stored scan reported 317 findings (43 errors, 274 warnings), predominantly
duplicate ingredient names. Production was not mutated and cannot be declared
verified against the corrected detector until the next publish runs the current
code.

## Disposition

| Original finding pattern | Classification | Owner/action |
| --- | --- | --- |
| Empty enabled sauce rows | Valid data | Master-data owner; these are documented buy-as-is sauces and remain unchanged. |
| Cheese rows with zero batch pounds and positive share percentages | Valid data | Master-data owner; regular spec imports store blend ratios in `sharePct` and intentionally keep batch pounds at zero. |
| Repeated duplicate-name warnings for one ingredient/recipe name | Detector defect | Master-data owner; report now emits one stable finding per duplicate-name group. No rows were merged or deleted. |
| Profile links to names absent from the current recipe pool | Stale data / import review | Import-review owner; preserve manager values and resolve only from a confirmed source or explicit manager action. |
| Enabled recipes with neither formula nor documented valid representation | Integrity defect requiring review | Master-data owner; no automatic replacement is safe without source evidence. |
| Duplicate ingredient-name groups | Integrity defect requiring review | Master-data owner; IDs, categories, and references must be reconciled before any merge. |

## Results

The fresh development report, built at `2026-08-24T00:00:00.000Z`, contains:

- 62 findings total: 13 errors and 49 warnings.
- 5 stale/import-review profile-link findings.
- 57 master-data review findings.
- 0 safe automatic repairs selected.
- Valid buy-as-is and ratio-based rows are no longer reported as errors.
- Duplicate-name warnings are grouped by normalized name, avoiding repeated
  findings with the same stable ID.

The scan is intentionally review-first. No manager-entered profile values,
recipe formulas, ingredient rows, aliases, or deleted records were changed by
this audit. Existing boot heals remain marker-guarded and were not broadened.

## Verification

- API typecheck: passed.
- Focused existing cheese/heal tests: 15 passed.
- API workflow restart: completed successfully; `/api/healthz` returned 200.
- Development scan: rerun with the current detector; result retained above.
- Production scan: read-only historical result retained above; current-code
  production verification is **not verified** until publish.

## Release disposition

The detector inflation is corrected, valid exceptions are documented, and
remaining records have explicit owners and safe review boundaries. Publishing
is still required before the current detector and remaining review findings can
be verified against production.