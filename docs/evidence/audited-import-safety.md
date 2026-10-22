# Audited import safety — support and verification

Date: 2026-10-22. Environment: isolated development/disposable synthetic databases.
This is feature evidence, **not a release approval or production-readiness claim**.

## Revision binding

- Base revision: `13f80b639831637df2806b0cf9251817f87e719f`.
- Changed source bundle: **56 files**, SHA-256
  `654db6c512e5495338ed93820ae7d0c9bbd6405aaaec452c1ab4904eb0db3486`.
- Algorithm: union of `git diff --name-only HEAD` and untracked non-ignored files under
  `artifacts/api-server`, `artifacts/run-calculator`, `lib/spec-import`, `lib/api-spec`,
  `lib/api-client-react`, `lib/api-zod`, `lib/corpus-harness`; retain
  `.ts/.tsx/.json/.yaml/.mjs`, sort paths, concatenate
  `path + NUL + sha256(file bytes) + LF`, then SHA-256 the concatenation.
  Documentation/memory/evidence are excluded to avoid a self-referential digest.
- The October 21 research audit was source inspection, not runtime evidence.
  Its historical revision does not establish the behavior of this implementation.

## Delivered support

See [the plan's seven-importer matrix](../import-system-plan.md#importer-support--recovery-matrix).

1. **Actual reviewed proposals:** spec/premix/cheese use a read-only preview of the
   same server normalization and affected-state identity as atomic Apply. Changes
   follow the reviewed inclusion, matching and explicit delete instructions, not
   an independent raw-parse interpretation. An unconfirmed operation retries its
   original stored request; it does not acquire a new state hash silently.
2. **Local guide proposals:** shipping/sauce/dough compare exact target profile
   patches, recheck local raw profiles/flavor scope after human review, and verify
   locally stored values afterward. This does **not** establish remote delivery,
   server-current comparison, atomicity or guarded Undo.
3. **Schedule proposals:** show actual per-day additions/replacements/tombstones
   and retained protected runs; existing snapshot fencing remains. Editor-only
   changes are identified as requiring a later Save. Cancelling a later day
   reports earlier confirmed/unconfirmed outcomes as partial rather than implying
   rollback. It never replays earlier writes automatically.
4. **Shared presentation:** searchable field-level old/new values, native units,
   explicit unknowns, create/change/link/remove groups, and a separate successful
   source comparison. Repeated ingredient/run rows retain identity. Workbook
   absence is source coverage, never an inferred factory deletion.
5. **Shared preflight:** bounds bytes, sheets, rows, columns and cells before
   expensive provider work; recognized canonical formats additionally check
   required identity columns and non-negative finite numeric fields. Blank values
   remain review-required unknowns. Unrecognized layouts retain existing
   format-specific fallback/review rather than assumed canonical rejection.
6. **Scoped read-only health:** existing manager Data health/reconciliation
   facilities include explicit applicator-name links, unreferenced pool evidence,
   and seven-source history coverage. Shared recipes, direct ingredients and
   cataloged ready-made sauces remain valid. Missing/truncated evidence is visible,
   not automatic repair/deletion authority. Reads do not Apply, learn aliases,
   modify recipes or write stock.
7. **Source baseline:** atomic imports select the latest successful, non-undone
   operation for the same scoped type/source key. Guides/schedule use bounded,
   allowlisted successful applied-value receipts in existing history. The newest
   successful legacy record without comparable values is explicitly unavailable;
   an older comparable record is not substituted silently. Failed/partial imports
   are not successful baselines.

## Retained boundaries

- Source identity is the existing normalized filename-set key, not content
  identity. Renamed files have a different identity; equal filenames do not
  independently prove document identity.
- Prior-success comparison describes retained **applied business facts**, not a
  reconstructed original workbook or unselected/source-only rows.
- New history receipts allow at most 500 rows / 100 KB and scalar approved
  business fields. No workbook bytes, raw grids, formula expressions/results as
  source evidence, citations or complete profile snapshots are added.
- File preflight caps 25 MB/file; 100 sheets, 20,000 rows/sheet, 300 columns/sheet,
  500,000 cells/workbook. Spec multi-file sets cap 100 files / 50 MB total.
  Sauce DOCX bounds expanded document XML at 5 MB.
- Health reads cap each existing detector's tables/payloads and inspect up to
  200 recent history records; truncation/coverage limits are displayed.
- No schema change, production repair/publish, automatic Apply/repair, mixed-type
  batch Apply, stock writer or multi-profile inventory projection was introduced.
  Existing human Apply, atomic original-ID recovery/guarded Undo and selected-run
  read-only inventory impact remain distinct and intact.
- Gold Lab capture/scoring, its approval/browser follow-ups, advisory Import QC
  Review Queue and learned-name propagation retain their existing separate owners.
  Their completion or integration is not claimed here.

## Deterministic / API checks

All commands ran without paid provider evaluation. API integration suites create
and clean their own disposable PostgreSQL databases.

| Command | Result / measured scope |
|---|---|
| `pnpm --filter @workspace/spec-import exec vitest run` | PASS — 31 files / 385 tests, including structured changes, native units, canonical/unknown formats and receipt allowlists |
| `pnpm --filter @workspace/corpus-harness run snapshots` then `run test`, through pinned Node 24.21.0 release runner | PASS — 12 tests; evaluator identity refreshed, deterministic business snapshots unchanged |
| `pnpm run check:api-generated` | PASS; OpenAPI/client/validator generation and declaration checks |
| `pnpm --workspace-concurrency=1 run typecheck`, through pinned release runner | PASS — entire configured workspace check, including generated contracts, libraries, API routes, calculator and scripts |
| `pnpm --filter @workspace/api-server exec vitest run src/routes/importOperations.integration.test.ts src/lib/profileNameLinkHeal.integration.test.ts` | PASS — 2 files / 35 tests; preview/current-state conflict, Apply/Undo/retry, source scope and successful/undone selection, health non-mutation/direct/shared/ready-made links |
| `pnpm --filter @workspace/run-calculator exec vitest run src/importOperations.test.ts src/importProfileReview.test.ts src/importSourceBaseline.test.ts src/recipeGuideImport.test.ts src/shippingImport.test.ts src/importHistory.test.ts src/utils/runExcel.test.ts src/components/DataHealthWorkspace.syncHealth.test.tsx` | PASS — **6 matching files / 29 tests**; unmatched requested patterns are not claimed as additional files |
| `pnpm --filter @workspace/spec-import exec vitest run src/importSafety.test.ts` | PASS — 15 tests against final shared safety code |
| `git diff --check` | PASS |

Final coherent typecheck/API/client/safety batch: local log
`/tmp/replit-background-tasks/6061a7f6-9cda-4be9-9f2b-2a39f09f1e44.log`.
Pinned corpus log:
`/tmp/replit-background-tasks/c54acf1f-6adf-445b-9be9-7489e0f42e83.log`.
These are environment-local references, not durable downloadable artifacts.

## Signed-in browser evidence — exact limits

One existing tester ran the changed journey, with a narrow follow-up for the
subtle cancellation/recovery defect. No fresh independent end-to-end pass followed.
The disposable database was cleaned. Manager was synthetic, with no AI capability;
provider domains were blocked and package-manager offline mode was enabled.
WebKit used the existing Nix wrapper/GIO TLS support without disabling trust.

The following **component/broker** matrix passed for all seven synthetic importer
labels, 25 entity rows per review, old/new/unknown values, search/filter, focus
containment, visible actions, horizontal overflow, Cancel → immediate new review →
Confirm. It is 56 viewport/engine/label cases, **not seven real importer journeys**.

| Viewport | Chromium | WebKit |
|---|---|---|
| Desktop 1440 × 900 | PASS — shared component | PASS — shared component |
| Phone 390 × 844 | PASS — shared component | PASS — shared component |
| Tablet portrait 768 × 1024 | PASS — shared component | PASS — shared component |
| Tablet landscape 1024 × 768 | PASS — shared component | PASS — shared component |

Real desktop Chromium spec journey:
- PASS: authorized manager sign-in; deterministic workbook review; preview HTTP
  200; Escape sends no Apply, leaves no pending operation/failed history, keeps
  original Apply enabled; immediate second preview/review.
- FAIL in captured browser tree: nested original importer intercepted pointer
  Confirm (original z80 above final-review z70).
- **Subsequently fixed**, not browser-rerun: final review now z100 above original
  importer z80. Static class ordering, changed-code typecheck and client regression
  checks support the correction; they are not labeled a browser commit PASS.
- NOT REACHED: successful real Apply/history/reload, available-source re-import
  UI, and the other six real parser/commit journeys.
- MISSING: browser health navigation/read-only and non-manager denial evidence;
  API/unit evidence above is not substituted for those browser journeys.
- NOT APPLICABLE / not claimed: native mobile, physical Android Chrome, physical
  iOS Safari/PWA, release/publish checks.

Sanitized environment-local browser detail and screenshots:
`.local/tasks/evidence/complete-audited-import-safety/browser/RESULTS.md`.
The full owning failure ledger and initial-to-final coverage record remain in
that task evidence directory; neither contains credentials or customer records.

## Failure ledger summary

| Failure / issue | Repair or explicit boundary |
|---|---|
| Stale plan statuses and inconsistent inventory status | Reconciled owning import plan; inventory plans untouched |
| New response/fixture types, host identity field, row-path expectation | Corrected explicit types/fixtures; full workspace check passed |
| Blank canonical numeric cell lacked review diagnostic | Added unknown/review diagnostic without zero inference |
| Shell Node/evaluator fingerprint differed from corpus provenance | Used installed pinned Node and normal manifest regeneration; no weakening/provider calls |
| Synthetic operation IDs too short / wrong stale-error assertion | Fixed fixtures to existing ID/HTTP contracts, not server validation |
| Concurrent compilers killed in earlier root check | Sequential workspace check passed |
| Browser cwd/build identity/engine launch/auth/output setup defects | Test-only setup corrected; no setup attempt counted as product PASS |
| Cancel mislabeled possible committed save and locked original review | Distinct cancellation outcome; deterministic and signed-in regression passed |
| Nested Confirm pointer interception | Final z100 above importer z80; final static/typecheck proof, no repeated browser pass |
| Later schedule Cancel hid prior per-day outcomes | Partial history/counts, explicit acknowledgment limits and planner refresh; no rollback/replay claim |
| Partial summary initially used unsupported keys | Reused existing `counts` contract; final typecheck passed |
| New test's implicit mock return registered teardown | Void-returning hook; 8 guide/baseline tests passed |
| Cataloged ready-made sauce incorrectly looked like missing recipe | Existing catalog evidence reused for current/historical links; integration case passed |
| **Unchanged baseline full-browser syntax failure** | Default `playwright test --list` stops before DB setup at `manager-attention.spec.ts:135` (“Declaration or statement expected”). HEAD contains broad duplicate/unfinished fragments, not an import change. A speculative whole-file replacement is unsafe; existing manager-attention test maintainer must identify a known-good baseline and recover/review it before a full suite. Focused importer config and its syntax inventory run independently. Full-suite health is not claimed. |
| Automatically drained pre-existing production stall/job warnings | Existing server-stall owner/production diagnostics process; no production investigation/repair performed by this work |
| Local signed-out app-update status cannot confirm a published version | Development screenshot rendered; expected auth 401s and unavailable official publish target are not production update evidence |

No failing current import-safety assertion is being hidden by a release claim.
Browser coverage gaps and the unchanged broad-suite syntax blocker remain explicit;
this note does not declare the unexecuted journeys verified.
