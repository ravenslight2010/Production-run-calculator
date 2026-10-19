# Export integrity audit — 2026-10-18

## Scope and evidence boundary

The five named 2026-10-17 workbooks were read from XLSX files and left
unchanged. Their SHA-256 hashes are recorded below. They are generated outputs,
not independent authority for recipe quantities. The owner later supplied two
2026-10-08 source workbooks; these were also read locally and left unchanged.
No production records were written, deleted, or healed.
Other same-date copies are present under `attached_assets`; they were not
substituted for the five task-listed originals. Attachment filename suffixes are
not part of the app's generated export filename and do not establish a shared
data snapshot.

Evidence used:

- Real XLSX readback of the five attached workbooks and controlled synthetic
  export/import fixtures.
- The two owner-supplied 2026-10-08 source workbooks, parsed locally with the
  supported Cheese and Premix parsers. No workbook contents were sent to an
  external provider.
- Repository history and the existing approved Tikka Masala source-resolution
  record.
- Aggregate `SELECT` queries against the read-only production replica on
  2026-10-18. These are not observations of the published runtime and cannot
  establish what data each workbook download read.

| Workbook | SHA-256 |
| --- | --- |
| Dough | `d39f9e778fbb5bba0fd0363e99ce8ee4e717b4323745a9077fa1b0a04a3e728e` |
| Sauce | `f7e5098f27f6aa84d77241167ad5db8dc86a30e9a2e8ed9953e6d094d68f7061` |
| Cheese | `3529d147b1d48a03d4dc489b858862a3bb6a332a5af0cae5a6905ae160ca1ae` |
| Mixes | `a17660a14683abb88546b5623295c0107f8956809bf4feb9e2f1e3320ccb6845` |
| Specs | `931504faa3f045ad51c28cc51535e5fd5576c4a7aee89be2b11c30900ff519e7` |

| Owner-supplied source workbook | SHA-256 | Parser accounting |
| --- | --- | --- |
| `0_Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_10.08.26_1792375594591.xlsx` | `b34b4a17ade6cc9045ee77bf60ef9d5771bb780bfc405616415f640e0220a533` | 130 parsed recipes; 0/36 exact overlap names |
| `0_Updated_Pre_Mix_Sheets_1792375580804.xlsx` | `0c16b0f27bb44ef447299b5dd61a3eb7e0b24efef40ea28902627b5b02d54715` | 64 parsed recipes; 10/36 exact overlap names |

## Findings and failure ledger

| Finding | Severity | Evidence and first divergent layer | Outcome and verification |
| --- | --- | --- | --- |
| Dough/Sauce targets did not all appear in the attached Specs workbook. | Medium; historical cause unresolved | Fresh readback counted Dough 201 target tokens / 108 case-folded product keys, of which 189 / 96 keys are present in Specs. Sauce counted 244 / 135, of which 221 / 112 are present. This exactly reproduces the assignment-count leads when restricted to Specs keys; 12 Dough and 23 Sauce target keys are absent. The workbook payloads contain no shared export ID or data revision. | **BLOCKED for historical root cause.** The new multi-selection path uses fresh server reads and one gathered input, with no browser-cache fallback. The full run-calculator suite and fresh-source export tests pass. No old target was silently deleted or reassigned. |
| Stale client data could reach exports. | High; stale recipe/profile output | The export gatherer previously read cached client profiles/recipe pools. The attached Tikka Masala Sauce block still contains the pre-resolution Garlic Powder rows, while an existing approved source-resolution record and the read-only replica reflect the corrected source. Exact download-time cache contents are unavailable. | **REPAIRED at export input gathering.** Fresh no-store server reads are required; failures are reported rather than replaced with cached data. The targeted run-calculator tests pass. No production repair was made. |
| Dough recipe-level doughball/tray metadata was absent. | Not a defect | In the attached Specs workbook, Brand Dough has 4 profiles with 2 distinct weights and 2 tray values; CRB Dough has 123 profiles with 6 distinct weights and 3 tray values. No single recipe-wide value is supported. The profile-level values remain in Specs. | **Intentional omission.** Export emits recipe-wide metadata only when all tied profiles agree and have it. Verified by spec-export grid and real-XLSX tests. |
| Cheese workbook repeated blocks and rows could be mistaken for duplicates. | Medium; destructive merge risk | 41 sheets, 1,894 nonblank rows, 236 recipe blocks, 114 case-insensitive recipe names, and 19 case-only sheet pairs. Shared recipes recur across brands. The named positive-plus-zero Whole Mozzarella rows, repeated Blanched Red Pepper Strips, and repeated Red Onion Strips were retained. Existing review evidence for Lowe’s California Mix remains a no-repair approval. | **No quantity repair authorized or inferred.** Builders coalesce only identical case-insensitive records; repeated ingredient rows, zeros, shared recipes, and conflicting formulas remain. Sheet-name collisions are deterministic. Verified by builder and real-XLSX tests. |
| Specs had case-only repeated profile rows and sheets. | Medium; export identity | 40 sheets, 265 nonblank rows, 225 profile rows, 114 normalized product keys, and 111 repeated rows. Full-row comparison found no conflicting profile values. There are 19 case-only sheet pairs; one duplicate-sheet group contains an additional distinct profile record. | **Representation defect repaired in builder.** Identical case-only profile rows and sheet groups collapse; conflicting values and the extra distinct profile remain. Verified by builder and real-XLSX tests. |
| Mix export did not expose per-component batch weights or prep status. | High; recipe metadata loss | 50 mix blocks, 402 nonblank rows, 148 component rows, 148 numeric per-pizza cells, zero component per-batch cells, and all 50 batch totals populated. The read-only replica has 50 mixes, 3 prep mixes, 140 positive per-batch component values among 148 components. All three prep records have zero batch size and blank product assignment. | **Repaired in workbook representation and importer.** Units and prep markers round-trip; no values are synthesized from totals. Verified by 51 spec-export tests, the full run-calculator suite, and API save/reload integration. |
| Older Mixes workbooks could erase newer saved fields on re-import. | High; persisted value loss | The legacy layout leaves per-batch cells blank and has no prep marker. The prior importer could drop saved per-batch values or prep status when replacing a mix. | **Repaired at importer merge.** Preserve per-batch values only for the same ingredient and exact per-pizza occurrence; missing prep marker preserves saved `true`; explicit Yes/No is authoritative. Verified by 76 premix-import tests and the targeted client suite. |
| Mix-only profile recipe links were exported as Cheese targets and inline Cheese rows. | High; wrong recipe category and unit-basis risk | The 2026-10-17 files contain 36 same-name overlaps; 29 ordered ingredient-name/raw-number sequences match under headings `Lbs` and `Per Pizza`, while 7 differ. The owner supplied 2026-10-08 source books and states none of the 36 are cheese. Their supported parsers found 130 Cheese recipes with 0/36 exact overlap names and 64 Premix recipes with 10/36 exact names. Sequence comparison—not identity—found a match in the Premix source for 22/36 exported Mix blocks and 18/36 exported Cheese blocks; 18/29 identical cross-file sequences match some Premix record. Of the 7 differing sequences, 4 match some Premix record and 3 do not; some sequences match multiple records. The read-only production replica has all 36 names in Mixes and 35 absent from Cheese. The export glue previously passed the shared profile recipe-name fields into Cheese targets and inline rows regardless of pool membership or applicator type. | **REPAIRED for 35 Mix-only names.** Export now gathers a fresh Mix pool with the other current pools, suppresses Mix-only names from Cheese targets and profile-inline Cheese rows, and preserves the recipe names in Specs. Explicit `Mix` slots stay out of Cheese targets even if the name also exists in both pools. Real-XLSX and web-export tests cover this. No quantities were converted or copied into production. The dual-pool Bobo's App1 intent is confirmed as Mix, but the owner explicitly requested no production change; its stored Cheese type remains until a safe, approved write path is available. |
| Bobo's / Deluxe has a dual-pool Cheese row and a Cheese-typed profile link. | High; stored-data and historical-reference risk | The read-only replica has one Cheese row with the same name as a Mix; the current profile's App1 type is `cheese`. Two saved import parses from 2026-08-19 carried `forcedCategory=mix` for a one-row recipe, but do not prove commit. The Cheese row is referenced by 48 daily-sync documents and 5 completed-run snapshots; the first writer remains unknown. | **BLOCKED / OWNER-DIRECTED NO WRITE.** Owner confirms current App1 should keep the existing Bobo's Deluxe Meat Mix and be typed `Mix`, but explicitly requests no production change. No mutation was made; the available replica is read-only. Do not special-case export output against the canonical profile or delete the Cheese row; history-safe retirement and an approved write path remain future owner-controlled actions. |
| Spec import could route a one-row known Mix through stale local category data. | High; a profile or recipe could be saved under the wrong pool | `commitSpecImport` applied profiles before fetching the server Mix pool; `applySpecImport` and the review display relied on the local Mix-name list. A failed fetch was replaced with an empty list later in the commit. A one-row recipe is intentionally not inferred to be a Mix by name alone, so a known server Mix was vulnerable when local cache state was stale or absent. | **REPAIRED at the import boundary.** The live Mix pool is fetched once before projection/apply; failure stops the import before local writes. The same snapshot drives review classification, profile link correction, and pool collection. Explicit `forcedCategory` and `userNamed` rules remain intact. Verified by single-row/stale-cache routing, visible review category, and preflight-failure tests. |
| Sauce Tikka/Tika Masala has older repeated Garlic Powder rows. | Medium; historical output mismatch | The 2026-10-17 workbook contains the older representation. An existing approved historical source repair and read-only replica evidence show the resolved source; the workbook files have no common snapshot identifier. | **Previously resolved in canonical source; historical export remains unchanged.** Future exports read current server data. Verified by existing source-resolution evidence and fresh-source export tests. No production mutation was performed. |
| Strict typecheck found an optional metadata access and an incomplete synthetic export fixture. | Low; build-time failure | `CI=true pnpm run typecheck` identified `cheeseRecipeNames` as optional and required all `SpecExportInput` recipe arrays in the real-XLSX test fixture. | **Repaired.** The signature preserves `undefined` separately from an empty list, and the fixture supplies all recipe arrays. Full workspace typecheck passes. |

## Workbook accounting

Counts below use nonblank rows, case-folded trimmed brand/flavor keys, and
recipe-block anchors in the actual XLSX readback. For target assignments, a
second count matches each target key against the product keys in the attached
Specs workbook. Repeated rows and shared recipe blocks are not treated as
duplicates by quantity alone.

| Workbook | Readback |
| --- | --- |
| Dough | 12 sheets; 201 target tokens; 108 case-folded target keys; 189 tokens / 96 keys match Specs. |
| Sauce | 23 sheets; 244 target tokens; 135 case-folded target keys; 221 tokens / 112 keys match Specs. |
| Cheese | 41 sheets; 1,894 nonblank rows; 236 recipe blocks; 114 case-insensitive recipe names; 19 case-only sheet pairs. |
| Mixes | 14 sheets; 402 nonblank rows; 50 blocks; 148 component rows; 148 per-pizza numeric cells; 0 per-component per-batch values; 50/50 batch totals. |
| Specs | 40 sheets; 265 nonblank rows; 225 profile rows; 114 normalized product keys; 111 repeated rows; no full-row conflicts after case folding; 19 case-only sheet pairs. |

The production-replica profile count on 2026-10-18 was 157, versus 114
normalized product keys in the attached Specs workbook. This confirms the
attached files are not a reliable single-snapshot image of the later replica;
it does not identify which profile set was correct at each download time.

## Implemented repairs

- Export gathers current server-acknowledged profiles, recipe pools, and mixes
  with no-store requests and no stale-cache fallback. Selected profile/recipe
  workbook kinds share one gathered input. A fresh Mix-pool snapshot identifies
  Mix-only profile links so Specs retains them while Cheese targets and inline
  Cheese rows exclude them. Literal Mix slots are excluded even when names exist
  in both pools; other cross-pool conflicts stay visible.
- Builders sort deterministically, group case-insensitively, prevent
  case-only sheet collisions, and coalesce only identical case-folded records.
  Conflicting recipes/profiles and repeated component rows remain visible.
- The controlled real-XLSX fixture starts with 11 profile rows and 5 recipe
  records. Readback verifies 10 profile rows after removing one exact
  case-only duplicate, and 4 recipe sheets after removing one identical
  case-only recipe; the conflicting same-name formula and both sheet-name
  collision recipes remain. A separate Mixes fixture groups two case-only
  brand spellings to one sheet while retaining both mix blocks.
- Mix workbook output carries separate per-pizza ounces, per-batch pounds,
  explicit prep status, and component reference values.
- Premix parsing preserves units and prep metadata. Legacy absent markers do not
  clear saved values. Same-key formula conflicts stop before writes; the retained
  real-workbook fixture now verifies this pre-write rejection and unchanged pool.
- Spec import now uses one required fresh Mix-pool snapshot before local profile
  projection. Known one-row mixes are displayed and applied as Mixes despite a
  stale local name cache; an unavailable server pool causes an explicit
  pre-apply error.
- API integration coverage proves per-batch values persist through save/reload.
  No schema change was needed.

## Verification matrix

| Check | Status | Evidence |
| --- | --- | --- |
| Original-file preservation | **PASS** | SHA-256 values above rechecked for all five target files and both owner-supplied source files. |
| XLSX export/readback and builder regression suite | **PASS** | `@workspace/spec-export`: 5 files, 51 tests. Includes real XLSX write/read, Mix-only and explicit-Mix target classification, shared cross-pool names, case-only identities, formula conflicts, repeated/zero rows, sheet collisions, units, and prep metadata. |
| Premix parser/merge tests | **PASS** | `@workspace/premix-import`: 76 tests. |
| Run-calculator client tests | **PASS** | Full package: 349 files, 3,204 passed, 1 skipped; includes real workbook import/export, Mix-only export filtering, server-aware one-row Mix classification, review display, and conflict rejection before writes. One existing jsdom navigation warning was printed; no test failed. |
| Shared spec-import tests | **PASS** | `@workspace/spec-import`: 30 files, 370 tests. |
| Corpus harness | **PASS** | 12 tests. Regenerated the pinned evaluation manifest after confirming the checked-in dependency-lock and evaluator hashes were stale; only those two hashes changed, and the retained corpus/evidence hashes stayed the same. |
| Mix persistence integration | **PASS** | Disposable database: `mixes.integration.test.ts`, 21 tests, including per-batch save/reload. No production database write. |
| Diff whitespace check | **PASS** | `git diff --check` completed after the final code, report, and memory changes with no errors. |
| Changed-code typecheck | **PASS** | `CI=true pnpm run typecheck`; complete workspace typecheck passed, including run-calculator, API routes, and shared libraries. |
| API route typecheck | **PASS** | No API route implementation changed; the workspace typecheck also completed `@workspace/api-server` and `typecheck:routes`. |
| Review-category UI behavior | **PASS** | Component interaction test verifies a server-known one-row Mix displays as `mix`; no responsive layout or styling changed. |
| Preview startup | **PASS** | Restarted the configured web workflow; Vite became ready and the public sign-in page rendered. The screenshot remained at the sign-in gate; authenticated UI was not visually captured. |
| Responsive/cross-browser visual checks | **NOT REACHED** | The change alters category classification, not layout or styling; component tests establish the changed behavior. No signed-in Chrome or WebKit screenshot, nor physical phone/tablet result, is claimed. |
| Production data repair | **BLOCKED** | Read-only replica evidence confirms one wrong-pool Cheese row and an inconsistent current profile link. No production write was authorized; current API deletion has no tombstone/stale-replay protection. |

## Unresolved decisions and limits

1. The owner-supplied source workbooks establish that none of the 36 overlaps
   belongs in Cheese, but only 10 exact names and partial formula sequences map
   to the supplied Premix workbook. Identical raw values beneath `Lbs` and `Per
   Pizza` are not unit equivalence. The remaining recipe identity/value
   disagreements are unresolved; no formula was guessed or overwritten.
2. The owner confirms the current `Bobo's` / `Deluxe` App1 should keep
   `Bobo's Deluxe Meat Mix` and be typed `Mix`, but explicitly requested no
   production change. The current stored profile therefore remains Cheese-typed.
   The available replica is read-only; the owner is the accountable decision
   maker and the current next action is to leave data unchanged. If the owner
   later requests the correction, apply only the App1 type change through an
   approved writable manager path. Do not delete the dual-pool Cheese row: a
   hard delete would affect historical lookups, and the current API has no
   deletion tombstone or stale-writer protection.
3. Historical target keys absent from the attached Specs file cannot be traced
   to a specific export invocation because these workbooks have no common
   generation identifier or data revision. Attachment filenames do not prove
   when app exports read their source. The new multi-selection path uses one
   fresh input; separate export actions can still reflect different legitimate
   snapshots.
4. The separate legacy premix source workbook remains blocked from re-import
   until its conflicting same-key formula is reviewed. The importer now rejects
   it without writing.
5. Internal consistency and a read-only production replica do not establish
   external recipe-source accuracy. No source values were copied into
   production from these workbook outputs.
