# Historical import discrepancy review — 2026-10-13

## Authorization and result

The product owner authorized a separate, read-only production comparison in
chat. This authorization covers only the comparison described here; it does
not authorize edits, imports, deletion, or a data heal.

The July 18 findings were compared against the Replit production database
read-only replica on 2026-10-14 at 00:18 UTC (2026-10-13, 19:18
America/Chicago). The comparison used focused `SELECT` queries against live
cheese, mix, dough, sauce, and profile rows. No production records were
changed. A query that combined sauce and mix results returned only transaction
wrapper text and was discarded; separate, table-specific `SELECT` queries
provided the results below.

The production SQL replica is not independently bound to the deployed app's
database connection or revision. The separate October 12 published-app
capture provides a recent, build-bound cheese-pool check, but does not cover
every recipe/profile item in this report. Therefore this report describes the
production replica as queried and does not claim a full deployed-build
reconciliation.

## Evidence and scope

| Evidence | Use |
| --- | --- |
| `attached_assets/source-library/AUDIT-REPORT-2026-07-18.md` (SHA-256 `7d2913f7b6a14aff33927f26c50d0fab5d0bcc7218b55794f4feea05eb2948bc`) | Historical claims being checked |
| `.local/evidence/workbook-import-audit/failure-ledger.json` | Original status was `HISTORICAL_UNVERIFIED`; updated with this review |
| `.local/evidence/workbook-import-audit/audit-report.md` | Workbook import evidence and retained source expectations |
| `attached_assets/source-library/AUDIT-REPORT-2026-08-26.md` | Later source comparison and formula findings |
| `attached_assets/source-library/audits/production-snapshot-2026-08-26.json` (SHA-256 `4bff312e8176dc5333a2a5982798ea9f9bb951bb50409bb9affbd89c3407e9b6`) | Historical snapshot baseline, not treated as current |
| `attached_assets/source-library/audits/source-comparison-2026-08-26.json` (SHA-256 `0d2b1665c92ef3f2067a1639cc608a97a04eceeee3387d912395f3d92352219d`) | Deterministic source-to-snapshot comparison |
| `docs/evidence/source-library-pool-diagnostics-2026-10-12-v2.json` (SHA-256 `a1bac011c00e010e03ec33486d35091981c1aa88dcf0ff4a28d9b3e9508c65c5`) and `docs/evidence/source-library-pool-live-capture-2026-10-12-v2.json` (SHA-256 `1632929f70b8412b149662b11d3ed11539c5f800add6727833c4f4fe0387172b`) | Recent published-app cheese-pool diagnostics and capture |
| `docs/evidence/source-library-pool-owner-review-2026-10-12-v2.md` | Owner decision to keep the ten exact cheese-pool differences; no repair or deletion approved |

The comparison was limited to the historical cheese, premix, dough, sauce,
and product-profile findings. Shipping/palletizing and schedule findings,
other workbooks, the full recipe library, and importer-cause diagnosis were
not part of this pass. Queries selected only relevant names/IDs, component
counts and narrowly needed fields; no full profile JSON or user/account data
was retained.

## Findings

| Historical finding | Current evidence | Status and accountable next action |
| --- | --- | --- |
| 16 cheese blends with all-zero component pounds | The live cheese-pool query found **0** recipes with zero positive component pounds. Previously named Lucia's, Lowe's, Mauro, and SMD blend matches returned populated components. | **Resolved for the zero-pound condition.** No action on those historical zero values. |
| SMD Pepperoni missing; SMD Supreme empty/missing | Both are now present in the live cheese pool with populated component rows. | **Resolved.** No action on the missing/empty condition. |
| Roughly 31 extra cheese rows, including empty stubs and Italian Beef & Gravy misfiled as cheese | Current live cheese and mix queries found **0** all-zero cheese recipes and **0** mixes with zero total per-pizza amount. Italian Beef & Gravy is absent from the cheese pool; a populated “Mauros Pinsa Italian Beef and Gravy Mix” exists in the mix pool. The October 12 published-app diagnostic reported 0 missing source pools and 10 field mismatches; the owner explicitly chose to keep those exact differences, with no deletions approved. | **Older count not directly reusable; no current all-zero stub confirmed.** Do not delete or reclassify based on the July list. The ten reviewed differences remain intentionally preserved under the October 12 owner decision. |
| Four cheese flavor-list under-coverage claims | Current records show Lowe's Skim Mozzarella includes “Meat Lovers” and “Supreme” (matching the historical source note). Lowe's Five Cheese Mix has an empty flavor list, which means all varieties; Hannaford Five Cheese Mix lists only “five cheese.” Hawaiian/Tikka Masala occur on separate brand-scoped Whole Mozzarella records. Lucia's Craft Cheeseburger Cheese Mix currently lists “BACON BURGER SUPREME,” not the historical exact label “Bacon Cheeseburger.” | **Partly resolved; remaining associations need source-to-brand confirmation.** The product/data owner should confirm the intended workbook tab and flavor mapping for Whole Mozzarella, Five Cheese, and Lucia's Cheeseburger before any write. Empty means all-varieties and should not be filled speculatively. |
| Lowe's California Mix uses green pepper instead of source red pepper, 1.25 oz | The current mix has three components; the historical source evidence expects `FR Red Pepper Strips=1.25`, but the production row instead has two `FR Red Onion Strips` entries, one at 1.25 and one at 0.60, and no red-pepper component. | **Confirmed current mismatch; not repaired.** The production manager/data owner must confirm the intended formula. The next technical step is import-bug investigation against the saved premix parse and landed history; only if the stored value is proven poisoned should a separately approved data-heal plan be prepared. |
| 22 empty duplicate premix stubs | Current live query found **0** mixes with zero total per-pizza amount. | **No current empty stub confirmed.** No cleanup action based on the historical list. |
| Naan doughball weights/variants missing | Current Naan recipe has two populated variants: 12 oz/16 per tray and 11.5 oz/16 per tray. | **Resolved.** No action on the historical omission. |
| Microwavable Lucia's second 7-inch variant missing | Current recipe has a `7'' FSD` variant at 5.5 oz/24 per tray. | **Resolved.** No action on the historical omission. |
| Masa Dough has duplicate “Masa Dough Natural” variant | Current `Masa Dough` and `Masa Dough - Natural` rows each have a separate, non-duplicate variant. | **Resolved.** No action on the historical duplicate. |
| Four empty dough rows | The live pool still has three empty rows: `BONiCi 9"`, `Bonici 12"`, and `Pinsa 12" Crust - Pedone (WBF-1200-R)`. The historical Lowe's French Fry row now has eight component rows and a populated variant. | **Three rows remain unresolved, not proven erroneous.** The production manager/data owner should confirm whether the empty rows are still needed. Before any cleanup, an investigator must inspect references and history and preserve valid manager-entered data. |
| Tikka Masala sauce ingredient names | Current `Tika Masala Sauce` has 21 component rows and contains Garlic Puree 3.65 lb, Chili Powder 1 lb, and Black Pepper Powder 0.24 lb. | **Resolved in the current read.** No action on the July name errors. |
| Empty sauce stubs/possible duplicate candidates | The four historical labels were not found as live sauce rows. Similar current candidates—Asiago Sauce, BRAND CONCESSIONS MARRIOTT SAUCE, Gravy Sauce, and Legacy Sweet & Sour sauce—have component rows; this bounded query did not establish whether any broader recipe pair is duplicative. | **No historical empty row confirmed; duplicate relationship not concluded.** No deletion is justified. A broader comparison is only warranted if the owner still sees duplicate choices in use. |
| Aldo's SAUSAGE profile empty/incomplete | Live profile `aldo's__sausage` now has a 12-inch die, Aldo's Dough, Aldo's Pizza Sauce, 7.7 oz doughball weight, and 4 oz sauce. However, it currently has Italian sausage at 3.0 oz (the July source expected 2.25 oz), cheese at 2.9 oz in each of two applicators (source expected 2.75 oz each), no bacon applicator (source expected 1.2 oz), and zero pepperoni sticks/oz (source expected 13 sticks/1.1 oz). | **Profile is no longer empty, but the source-vs-live discrepancy remains.** The product/data owner must confirm whether the retained July spec is still authoritative or whether these are intentional later changes. Then compare saved parse and landed profile before considering any data heal; do not overwrite current manager values based only on the old report. |

## Safeguards and next actions

- No production writes, import apply, deletions, or data heals were performed.
- The confirmed Lowe's California mismatch, Aldo's SAUSAGE source-vs-live
  difference, unresolved cheese flavor mappings, and three empty dough rows
  have the next actions listed above.
- Any later repair must first classify the import layer using
  `.agents/skills/import-bug-investigation/SKILL.md`. If incorrect data is
  proven persisted, follow `.agents/skills/data-heal-playbook/SKILL.md`:
  identify exact rows, protect manager values, define a one-time marker,
  rollback posture, and verification. The historical report is not repair
  authority.
- The October 12 cheese-pool approval is limited to its fingerprint-bound
  differences and means “keep these exact differences; no repairs.” It does
  not authorize edits to other rows or future differences.
