# Source Workbooks vs Retained Production Snapshot — 2026-08-26

This is a read-only comparison of the retained production master-data snapshot
against the retained source-library workbooks. It supersedes the July 18 audit
only as the current evidence record; the comparison itself does not change
production data. The approved Tikka Masala correction made after this snapshot
is recorded separately in
[`audits/tikka-masala-resolution-2026-08-26.json`](audits/tikka-masala-resolution-2026-08-26.json).

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

The deterministic comparator parses all retained cheese, premix, shipping,
dough, and sauce layouts. Dough and sauce names are mapped from an explicit
retained-file map (not inferred from a filename heuristic). Formula components
are normalized by case, whitespace, punctuation, apostrophes, and `&`; amounts
are compared in pounds with a 0.005 lb tolerance. Doughball labels use the same
normalization and their ounce/per-tray values are compared separately.

Two source-layout rules are explicit in the parser: the Malted Barley
multi-batch dough table uses its 4-bag column, and the two French-fry dough
tables take the 18 lb fries amount from the numbered procedure because the
materials row has no numeric cell. Tikka Masala uses its per-batch calculated
amount column. The Four Hands Red Hot workbook uses its tested right-hand
formula table. No database connection or write is used.

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

- All 13 dough source recipes and all 15 sauce source recipes have a matching
  live recipe name. The live-only counts are 5 dough rows and 11 sauce rows;
  these are retained master-data rows outside the workbook set (for example,
  purchased crusts and ready-made sauces), not source recipes missing from
  the snapshot.
- Dough amounts have no numeric changes. Five component findings are
  name-only drift: `YEAST` vs `FRESH COMPRESSED YEAST` in three procedures,
  `COMPRESSED YEAST` vs `FRESH COMPRESSED YEAST`, and `SPENT GRAIN (CHOPPED
  FINE)` vs `MALTED BARLEY`. The full source/live component lists are in the
  machine-readable comparison.
- All doughball numeric values match for every source variant. Seven
  variant findings are label-only drift, including the Aldo, CRB Heavy Plus,
  Malted Barley, Masa, Modified Barley, and Sriracha labels. No source variant
  is absent by normalized recipe matching.
- Sauce has four name-only component drifts (Bobo's Buffalo, Brand Marriott,
  Red Hot, and Mystic), with matching amounts. The source Red Hot table also
  contains spelling/name variants such as `Franks Hot Sauce`, `Galrlic Sauce`,
  and `Riplets Seanoning`; these are retained as findings rather than silently
  aliased.
- Tikka Masala is the substantive sauce formula finding: the source has
  `Garlic Puree=3.65`, `Chili Powder=1`, and `Black Pepper Powder=0.24`,
  while the live snapshot has `Garlic Powder=4.65` in their place. This needs
  review before any production edit.
- The snapshot's 156 profile rows, 18 dough rows, 26 sauce rows, and 528
  ingredient rows remain preserved for independent follow-up comparisons.

### Tikka Masala resolution — 2026-08-26

- **Authority:** The retained
  [`sauce/Tikka_Masala_Process_1784339520201.xlsx`](sauce/Tikka_Masala_Process_1784339520201.xlsx)
  is authoritative for this formula. It is the only detailed formula source
  retained for this recipe. No separate current operating workbook or signed
  formula revision was found in the source library. The July 18 operating
  audit independently records the same Garlic Puree and Chili Powder naming
  corruption, so the live snapshot was treated as the known-bad state rather
  than a newer formula revision.
- **Decision:** The retained workbook wins. With explicit approval, the
  existing manager-controlled `POST /api/sauce-recipes` path updated
  `sauce:maria-son-s-tikka-masala` without changing its recipe name or any
  unaffected component.
- **Correction:** `Garlic Powder=3.65` became `Garlic Puree=3.65`,
  `Garlic Powder=1` became `Chili Powder=1`, and
  `Black Pepper Powder=0.24` was restored.
- **Verification:** An authenticated production readback contains 21
  components and matches the workbook-parsed formula exactly. The canonical
  formula digest changed from
  `5c87427ffddf48b19149b18f35e7715eec3eb51003faae16b14bae4c623930de` to
  `16385e2047c1a6379c0c1377e61a6c5abd66be24b0526ac17f089bfaba9428c7`,
  which equals the retained source formula digest. No audit script performed
  a database write.

## Result

The comparison is **complete and rerunnable**, with both inputs retained and
hash-linked. It confirmed the broad known review areas (cheese
naming/component drift, premix naming/component drift, conservative
shipping-field gaps, dough label/name drift, and one substantive Tikka Masala
formula mismatch). The Tikka Masala mismatch is now resolved through the
manager-controlled recipe path; the machine-readable comparison remains the
authoritative pre-change finding set, and the dated resolution record contains
the post-change evidence.