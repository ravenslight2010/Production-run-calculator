# Source Workbooks vs Retained Production Snapshot — 2026-08-26

This is a read-only comparison of the retained production master-data snapshot
against the retained source-library workbooks. It supersedes the July 18 audit
only as the current evidence record; it does not change production data.

## Evidence and rerun contract

- Production input: [`audits/production-snapshot-2026-08-26.json`](audits/production-snapshot-2026-08-26.json)
- Machine-readable comparison: [`audits/source-comparison-2026-08-26.json`](audits/source-comparison-2026-08-26.json)
- Source corpus: [`./`](./)
- Snapshot SHA-256: `4bff312e8176dc5333a2a5982798ea9f9bb951bb50409bb9affbd89c3407e9b6`
- Source manifest SHA-256: `c4241480ebf3ccda8a03ce3565fea78f68063f2531a9d20902619a8e3140cf8f`

The snapshot was captured at `2026-08-26T00:21:27.339Z` in one PostgreSQL
read-only transaction. It contains the six bounded live master-data tables:
brand profiles, cheese recipes, dough recipes, sauce recipes, mixes, and
ingredients. The source manifest retains 51 Excel workbooks and the comparison
records every source file's size and SHA-256.

Rerun from the repository root:

```sh
pnpm --filter @workspace/scripts run audit:source-compare -- \
  --snapshot attached_assets/source-library/audits/production-snapshot-2026-08-26.json \
  --out attached_assets/source-library/audits/source-comparison-2026-08-26.json
```

The rerun is file-only and does not need `DATABASE_URL`; it reads the retained
snapshot and workbook bytes and rewrites the comparison output.

## Scope counts

| Source area | Retained source evidence | Live snapshot rows |
|---|---:|---:|
| Pizza specs | 19 workbooks | 156 brand-profile rows |
| Dough procedures | 13 workbooks | 18 dough recipes |
| Sauce procedures | 15 workbooks | 26 sauce recipes |
| Cheese workbook | 114 parsed recipe blocks | 129 cheese recipes |
| Premix workbook | 60 parsed mix blocks | 50 mixes |
| Shipping guide | 20 parsed rows | represented in profile values |
| Ingredient catalog | source components referenced by workbooks | 528 ingredients |

The deterministic comparator parses cheese, premix, and shipping layouts. Dough
and sauce workbook counts are retained and linked, but their workbook layouts
do not have a shared deterministic parser in the comparison command; no
filename heuristic is reported as a recipe mismatch.

## Findings

### Cheese — needs review

- 32 distinct source recipe names do not have a case-insensitive exact name in
  the live cheese pool. Several are expected shorthand/brand-prefix variants,
  so this is a reconciliation queue rather than proof that 32 recipes are
  absent.
- 74 live cheese names are not exact names emitted by the cheese workbook.
  This includes brand-prefixed rows and likely spec-import stubs; review before
  deleting anything.
- 7 exact-name recipes have source component names that are absent from the
  live component list: Edwardo's Parmesan Oregano, Edwardo's Bacon Spinach,
  Edwardo's Mozzarella, Mystic 50/50, PriceSmart Color, Vita Red Pepper, and
  Vocelli's Garlic Spinaci.
- No amount changes were detected for components whose normalized ingredient
  names matched. The component report is fully enumerated in the JSON output.

### Premix — needs review

- 35 live mix names are not exact names emitted by the deterministic premix
  parse. These are candidates for duplicate/stub or naming-drift review, not
  automatic deletion.
- 9 exact-name mixes have source component names absent from the live component
  list. The list includes Lowe's California Mix; its source row is `FR Red
  Pepper Strips=1.25`, preserving the known red-vs-green discrepancy as an
  actionable finding.
- No amount changes were detected for components whose normalized ingredient
  names matched. Zero-per-pizza source rows are retained in the report because
  the app intentionally treats some of them as prep-only/reference rows.

### Shipping and packaging — needs review

- 9 guide rows did not match a live brand with the comparator's conservative
  matcher: Basha's Ultra Thin, Brand MR07CH24, Brand MR12CH14, Costco
  (Lucia's), FSD 7'', Lucia's w Cartons, Lucia's w Labels, Nob Hill, and
  PriceSmart Member's Selection.
- 16 guide rows contain unmapped fields. These are primarily `X` or
  `x+cardboard` grip-sheet values, which the importer intentionally does not
  guess. The full row/field list is in the JSON output.
- The retained comparison therefore confirms the historical grip-sheet and
  PriceSmart review items without silently applying packaging changes.

### Profiles, dough, sauces, and ingredients

- The retained evidence contains all 19 spec, 13 dough, and 15 sauce source
  workbooks and the corresponding live master-data tables. This comparison
  does not re-run the AI spec parser or infer dough/sauce formulas from
  filenames; those would require a separate parser-backed audit.
- The snapshot's 156 profile rows, 18 dough rows, 26 sauce rows, and 528
  ingredient rows are preserved for independent follow-up comparisons.

## Result

The comparison is **complete and rerunnable**, with both inputs retained and
hash-linked. It confirms the broad known review areas (cheese naming/component
drift, premix naming/component drift, and conservative shipping-field gaps)
without making production writes. The machine-readable output is the
authoritative detailed finding set; this report records the dated scope,
limitations, and review conclusions.