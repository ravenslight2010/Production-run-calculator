# Import lifecycle integrity audit

Date: 2026-09-06

## Result

The supported spec, dough, sauce, cheese, premix, and shipping import paths were
reviewed from source parsing through saved-source retention, review/apply,
merge/rename aliases, server persistence, re-import, and reload.

Two deterministic lifecycle defects were confirmed and fixed:

1. Mix and cheese reconciliation used last-row-wins maps for repeated ingredient
   names. That could hide a quantity mismatch or copy an aggregate manager value
   onto every repeated row. Reconciliation now compares aggregate ingredient
   totals while preserving the exact row structure in saved suggestions and
   stale-write signatures.
2. Saved spec, premix, cheese, and shipping snapshot POSTs inserted and pruned
   in separate operations. Insert plus per-source retention pruning now runs in
   one scope-isolated, advisory-locked transaction, with one bounded stale-row
   delete.

No parse prompt, sanitizer output, chunking rule, or pipeline ordering changed,
so the saved-parse version does not need to change. No production data was read
or modified.

## Lifecycle matrix

| Source | Parse / normalize | Replacement vs union | Merge, rename, and re-import | Persistence / reload | Audit result |
| --- | --- | --- | --- | --- | --- |
| Spec profiles | AI parse is sanitized and canonicalized; saved hashes reuse only the same source bytes and parse version | Chunks of one workbook union station lists; later files replace explicitly stated station lists; profile scalars overlay only when stated | Tombstone partitioning, recipe-name aliases, ingredient aliases, brand/flavor aliases, and snapshot remapping keep merged-away names from being recreated | Full unpruned source snapshot is retained; apply uses the pruned change set; API snapshot insert/prune is transactional | Pass |
| Dough recipes | Parsed as batch-pound rows; same named recipes collapse by recipe identity while customer variants remain distinct | Later file recipe rows replace earlier rows; brand/flavor ties union; doughball variants use explicit additive or replacement mode | Name-link suggestions are reviewable beyond loose-key equality; confirmed recipe aliases redirect later imports; merge backfill keeps the target formula and fills only blanks | Named-recipe API integration coverage proves pool write/read; re-import regressions cover deleted-pool promotion and family variants | Pass |
| Sauce recipes | Parsed as batch-pound rows and stored in the sauce/frontline pool | Recipe rows are source-authoritative on re-import; a later same-name file replaces rows | Recipe-name aliases redirect merged-away names; target-first blank-fill preserves the survivor formula | Named-recipe API and spec re-import coverage exercise save/reload boundaries | Pass |
| Cheese recipes | Deterministic cheese workbook parser plus spec embedded-blend extraction | Workbook/source components replace source-owned formula fields; manager notes/enabled state remain operational | Real-workbook merge/re-import tests prove links land on the survivor; brand rename tests prove old customer groups do not reappear | Cheese pool API coverage plus transactional saved-cheese snapshot retention | Pass; aggregate reconciliation defect fixed |
| Premix / mixes | Deterministic premix parser; values retain per-pizza versus per-batch units | Imported source fields replace; operational enabled/already-made values survive; omitted cellulose and notes follow their explicit preservation rules | Real-workbook redirects and learned aliases land merged names on the survivor, including renamed survivors | Mix pool coverage plus transactional saved-premix snapshot retention | Pass; aggregate reconciliation defect fixed |
| Shipping | Deterministic guide parser emits only mapped packaging fields | Candidate patches omit unknown fields rather than clearing manager values | Brand matching uses the current profile universe; no recipe or ingredient alias boundary exists | Advisory-locked saved-guide retention and profile save paths own durability | Pass |

## Doubled-row incident boundary

Recipe-name merge backfill is the first source-of-truth layer for merging two
formulas. Dough, sauce, cheese, and mix backfill:

- keeps the selected target's populated values;
- fills only blank target values from merged-away sources;
- appends only source ingredients not already represented by the target;
- canonicalizes legacy equivalent target rows before another merge; and
- becomes a no-op when repeated.

Focused library tests cover overlapping target/source rows, equivalent spelling
and word order, repeated source rows, repeat application, and preservation of
target quantities. Real-workbook tests cover merge, alias learning, re-import,
and non-resurrection. Valid repeated applicator stations remain arrays and are
not deduplicated: the same topping at different station weights is preserved.

The reconciliation fix deliberately does not collapse stored row structure.
Repeated same-name recipe rows can be intentional, and a total mismatch does not
prove how a corrected total should be distributed. The system reports the
aggregate discrepancy and only performs an automatic single-row replacement
when distribution is unambiguous.

## Persisted damage assessment

A read-only development query expanded the `components` arrays in
`dough_recipes`, `sauce_recipes`, `cheese_recipes`, and `mixes`, grouped by
scope, recipe, and trimmed case-insensitive ingredient name, and searched for
groups with more than one row.

Result: **zero exact duplicate-name component groups** in the current
development pools.

No broad data heal was added. A same-name or loose-equivalent pair alone cannot
distinguish a bad duplicate from an approved repeated formula row, and summing
or deleting those rows would guess at approved formulas. Existing merge
backfill safely normalizes a survivor only when a manager performs a confirmed
recipe merge. Any future production candidates should be reported with minimal
recipe identifiers and aggregate counts for manager review; they must not be
automatically changed without a stronger deterministic predicate.

## Production master-data verification

Date: 2026-09-07
Mode: read-only production database queries, scope `live`
Audit window: 2025-09-07 through 2026-10-07
No production row was inserted, updated, or deleted.

The bounded application report now enforces:

- an allow-listed `live`/`sandbox` scope;
- a maximum of 2,000 rows per source table and 2,000 findings;
- a maximum of 500 component/embedded rows per recipe;
- a 256 KiB JSON document limit with explicit truncation metadata;
- a bounded date window covering the prior 365 days and next 30 days; and
- retained import-history coverage, including whether its row limit was reached.

The report classifies exact/canonical resolutions, ambiguous duplicate names,
and orphaned or stale references. It does not apply a repair. Any repair
proposal carries an owner, deterministic fingerprint, before/after preview,
and the existing data-health repair-batch undo contract.

### Live findings

The production scope contained 156 profiles, 18 dough recipes, 26 sauce
recipes, 126 cheese recipes, 50 mixes, 528 ingredients, 26 import aliases,
739 spec-import aliases, 217 merge aliases, and 40 daily-sync documents.

- **Pool duplicate names:** zero duplicate-name groups in dough, sauce, cheese,
  or mix pools.
- **Profile-to-pool links:** 0 missing dough links, 17 missing sauce links, and
  0 ambiguous dough or sauce links. These remain manager-review findings.
- **Orphaned recipe components:** 3 dough, 3 sauce, and 6 mix component rows
  reference no current ingredient name. Cheese had no matching finding in the
  bounded query. These are protected review-only references; no ingredient
  replacement was inferred.
- **Run/profile references:** 145 runs were present in the audit window; 9 did
  not resolve to a current setup profile. They remain protected operational
  history and are not cleanup candidates.
- **Alias checks:** import aliases had 0 stale rows, 0 ambiguous groups, and
  merge aliases had 0 stale ingredient rows and 0 ambiguous groups. The
  spec-import alias namespace had 6 stale rows (1 brand and 5 recipe-name
  mappings) plus 2 ambiguous external/context groups. Those remain
  review-only and are not fuzzy-resolved.
- **Protected import history:** 2 retained import-history rows were available
  for the scope. The production schema did not expose a
  `completed_run_history` table during this read-only check, so immutable
  completed-run history could not be independently audited and is explicitly
  recorded as a coverage gap rather than guessed at.

This is an audit result, not approval to heal data. A later repair must be
separately owned, previewed from a fresh fingerprint, applied through the
existing repair batch, and verified through its undo path. Publishing remains
a separate release decision.

## Evidence

| Invariant | Evidence |
| --- | --- |
| Chunk union versus multi-file replacement | `lib/spec-import/src/mergeParsedSpecImports.test.ts` and spec-import package tests |
| Snapshot prune keeps full source and applies source-authoritative recipe rows | `artifacts/run-calculator/src/specImportReimportPrune.test.ts` |
| Cheese/mix merge then real-workbook re-import lands on survivor | `artifacts/run-calculator/src/mergeReimportRealWorkbooks.test.ts` |
| Dough/sauce merge then workbook re-import lands on survivor | `artifacts/run-calculator/src/mergeReimportDoughSauceWorkbooks.test.ts` |
| Brand rename does not resurrect the old group | `artifacts/run-calculator/src/brandRenameReimportRealWorkbooks.test.ts` |
| Embedded cheese blend and named dough/sauce recipes do not split by weight/profile | `specImportCheeseDuplication.test.ts`, `specImportDoughSauceDuplication.test.ts` |
| Overlapping recipe merge rows remain single and repeat-safe | `lib/cheese-recipes/src/mergeBackfill.test.ts`, `lib/mixes/src/mergeBackfill.test.ts`, `lib/named-recipes/src/mergeBackfill.test.ts` |
| Repeated ingredient rows reconcile by aggregate without doubling or guessed redistribution | `lib/mix-reconcile/src/index.test.ts`, `lib/cheese-reconcile/src/index.test.ts` |
| Saved source retention is scope-isolated, concurrency-bounded, and survives API round trips | saved spec, premix, cheese, and shipping route integration suites |

## Remaining manual and release requirements

- Production duplicate-row prevalence is unknown until an approved read-only
  production verification is run.
- Real-AI round-trip harnesses were not required because the prompt and model
  routing did not change.
- No browser run is required: this task changes pure reconciliation and API
  transaction boundaries, not visible import-review interaction.
- Standard publish/release gates remain required before any later deployment.