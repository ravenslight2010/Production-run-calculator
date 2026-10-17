# Per-pizza advisory review — development evidence

Verification captured 2026-10-05T02:49Z against base revision
`a22d3d8db32c7bac8ec1df20733e518f4f24e150` plus this task's working-tree changes.
This is synthetic component/library and development startup evidence, not
production, physical-device, or release-readiness evidence. No credentials,
raw source workbook, production record, authenticated capture, or request
payload is retained here.

Final scoped follow-up verification after completion checks: 2026-10-05T03:09Z.
The failed completion attempt committed the first implementation and synced
cleanly with the same main-workspace baseline; the follow-up working changes
separate the review helper from the parser entry. Formal task completion remains
blocked by the project-wide failures below.

Post-fix local verification captured 2026-10-05T10:01Z. The working-tree build
identity had no verified Git revision; these are isolated development results,
not deployment or release evidence.

## Manager decision and result

The manager approved a 16 oz per pizza advisory upper threshold independently
for sauce, each applicator, and each pepperoni entry: dough is the heaviest
component and its largest observed amount has been 16 oz. A proposed 32 oz
applicator threshold was rejected. Equality is allowed; only strictly greater
finite values warn.

- Both steps of the import review show a separate, labeled advisory callout on
  affected rows, including original values, ounce units, station/entry identity,
  and the threshold. The included-profile summary counts affected amounts,
  not distinct products.
- Warnings derive from current review values, including inherited sauce and
  reopened cached imports; they are not added to persisted sanitizer warnings
  or lost in the existing grounding-warning overflow cap.
- Managers retain the existing inclusion/exclusion and Apply controls.
  Advisory warnings do not add a blocking acknowledgement or disable Apply.
- Native numeric values, recipe unit provenance, stick counts, dough weights,
  recipe row weights, and batch weights remain unchanged. There is no new
  conversion, aggregate-station rule, clamp, schema/API change, or stored-data
  repair.
- Parse version remains 42: sanitizer output, prompt/model, cache shape,
  and parse pipeline behavior did not change.
- The review helper is exported through the separate package entry
  `@workspace/spec-import/per-pizza-review`; the parser entry is identical to the
  main-workspace baseline. The cache-version safeguard remains intact.

## Verification results

All Node commands use `bash scripts/src/run-release-node.sh`.

| Check | Result |
| --- | --- |
| `pnpm --filter @workspace/spec-import run test` | PASS: 29 files, 360 tests |
| `pnpm --filter @workspace/spec-import exec vitest run src/perPizzaReview.test.ts` after library-test compatibility correction | PASS: 17 tests |
| Six `SpecImportDialog` component suites: amounts, warnings, steps, reuse, mergedAway, newMixIngredients | PASS: 62 tests, including 8 new rendered amount cases |
| `pnpm --filter @workspace/corpus-harness run test` after measured hash refresh | PASS: 12 tests; semantic snapshots and retained corpus/evidence hashes unchanged |
| API server test suite in the earlier follow-up verification | PASS: 156 files, 1,791 tests; this later profile-sync change touched only the web client |
| `pnpm run typecheck` | PASS on 2026-10-05T10:01Z: root shell/API checks, shared libraries, API server, artifacts, and scripts completed. This supersedes the earlier failed attempt below. |
| Shared library compilation within root typecheck | PASS after replacing a DOM-only test clone API with JSON fixture cloning |
| `pnpm --filter @workspace/run-calculator exec node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | PASS, independently of interrupted recursive checks |
| Root shell inventory, TypeScript API boundary, recovery audit, generated API checks, API Zod tests, scripts typecheck | PASS during the root typecheck attempt |
| `pnpm --filter @workspace/run-calculator run test:budget` | PASS on 2026-10-05: 321 files, 2,986 tests |
| `pnpm --filter @workspace/run-calculator exec vitest run src/runValueStampGuard.test.ts` | PASS: 12 tests; also included in the full client test budget |
| Previously failing pepperoni profile-sync browser case | PASS after the selected-pending-run correction: 1 case at 390×844 Chromium, 41.9 seconds |
| Recipe-refresh browser group after the correction | PASS: 11 passed, 2 `@focused-only` cases skipped (13 enumerated) |
| Managed web/API restart and development logs | PASS: Vite serving and API initialization ready |
| Public desktop screenshot at actual web workflow port | PASS: expected sign-in landing; unauthenticated 401s, no rendering crash |
| `git diff --check` | PASS |
| Shared-library suite after separate-entry fix | PASS: 29 files, 360 tests |
| Rendered amount suite after separate-entry fix | PASS: 8 tests |
| Shared-library and client direct typechecks after separate-entry fix | PASS |
| `check-model-version-bump.sh` against the actual final parser-entry tree and main baseline | PASS: parser/model/prompt unchanged, no parse-version bump required |

Pure tests cover 0, normal fractional quantities, 9, just below 16, exactly 16,
just above 16, 17, 1,000,000, and the largest finite JavaScript number.
They check each field independently, repeated stations/pepperonis, unnamed
stations, absent legacy fields, and preservation of inputs and recipe provenance.
Nonfinite validity handling stays with the existing sanitizer.

Rendered assertions verify warnings on both steps, absence at/below the limit,
old saved-review JSON without persisted warnings, unchanged Apply values and
recipe units, same-brand sauce cross-fill, Back/exclude/Next recomputation,
and warning attachment after manager name edits.

## Failure closure

- Initial corpus failure was evaluator/lockfile identity drift only; source
  corpus and semantic evidence stayed unchanged. The current lockfile was
  already different from retained evidence before this task; no dependency
  install or lockfile modification was performed here. Only measured
  evaluator and current lockfile hashes were updated. A subsequent fixture
  compatibility edit changed the evaluator hash again because test sources
  participate in that digest; the final corpus test passes.
- Initial library compilation rejected `structuredClone` in the library's
  ES-only type environment. JSON cloning suffices for these finite fixtures;
  the scoped tests and shared library compilation now pass.
- An earlier full-project typecheck attempt reported syntax errors in an API
  integration test. The later root typecheck passed all configured checks; this
  task did not edit the API test source.
- The first screenshot targeted default port 5000 and could not connect.
  The workflow uses port 26038 in this workspace; the corrected capture passes.
- Previously recorded published background-job acquisition failures remain
  outside this task, owned by the existing background-database investigation.
  No production diagnosis, repair, or publishing was performed here.
- Initial formal completion preparation could not finish fetching Git LFS
  objects. The supported completion retry requested continuation; the merge
  continuation then completed cleanly without conflicting files or manual
  branch replacement. Subsequent completion validation ran and failed.
- Completion's model-bump guard initially flagged the review-only re-export in
  the parser entry. CLOSED: the separate package entry preserves the exact
  parser entry and parse caches. Its direct guard and scoped regression checks
  now pass without weakening the safeguard or bumping parse version.

## Formal completion failure ledger

The first configured completion run failed and did not mark the task complete.
The separate-entry correction above closes the feature-specific guard finding.
The historical outcomes below are retained alongside the later follow-up
results; they are not a current production release decision.

All command labels below include the `bash scripts/src/run-release-node.sh`
prefix when reproduced.

| Configured command | Observed outcome |
| --- | --- |
| `pnpm --filter @workspace/api-server run test` | Initial completion attempt failed: 154 files and 1,777 tests passed before an API test parse error and sync-convergence startup timeout. A later pre-sync-fix run passed 156 files and 1,791 tests; this follow-up changed no API code. |
| `pnpm --filter @workspace/run-calculator run test:budget` | PASS |
| `pnpm --filter @workspace/production-rules run test` | PASS |
| `pnpm --filter @workspace/inventory-math run test` | PASS |
| `pnpm --filter @workspace/scheduled-recipe-check run test` | PASS |
| `pnpm --filter @workspace/spec-export run test` | PASS |
| `pnpm --filter @workspace/scripts run check-model-bump` | FAIL during the first completion run; review-only export trigger subsequently corrected as documented above. The compound command also includes broad scripts checks; no final compound pass is claimed. |
| `pnpm run typecheck` | Initial run reported API test syntax errors; the later complete root typecheck passed, as recorded above. |
| `pnpm --filter @workspace/scripts run check:release-evidence` | FAIL: retained release checkpoint incomplete. |
| `pnpm run release:check` | BLOCKED/exit 1: configured command omits required `--readiness-deployment-id` and `--deployed-revision`. |
| `pnpm run release:check:full` | BLOCKED/exit 1: same missing required deployment/revision inputs. |
| `bash scripts/src/run-isolated-browser-suite.sh` | FAIL before browser cases ran: stale/incomplete web build identity, followed by 0 discovered cases against the expected 170-case contract. No browser pass or authenticated journey evidence. |
| Full browser report generated 2026-10-05T05:26Z | FAIL: all 170 cases completed, 169 passed and 1 failed in `remembered non-default pepperoni batch weights rehydrate in a peer without changing default sticks`. The exact case and its recipe-refresh group passed after the fix, but the full 170-case inventory was not rerun. |

The retained 169/170 report is not a post-fix full-suite pass. Release evidence
still lacks required deployment identity and the retained release checkpoint
is incomplete. No publishing or production mutation was performed.

## Latest configured completion-validation attempt

The automatic completion validation started at 2026-10-05T10:06:49Z and was
stopped at 10:37:16Z, after roughly 30 minutes; Task 2661 was not marked
complete. `check:release-evidence` failed because the release checkpoint was
incomplete and not retained evidence. `release:check:full` stopped before GO
because it requires an actual readiness deployment ID and deployed revision.
Neither was supplied, and no publish was authorized.

The full browser suite log had reached its 109th test when the validation run
stopped; it produced no final 170-case result. The API test, production-rules
test, model-bump check, typecheck, and standard release check were also stopped
before that automatic run reached terminal results. Their separately completed
checks are recorded above; the partial browser log is not counted as a pass.

## Approved selected-run profile-sync follow-up

During browser verification, a separate pending-run defect was isolated and the
manager approved its targeted correction. After an acknowledged setup/profile
save, the selected run is still updated only while it remains the same eligible
pending run. The client persists only changed profile-owned fields, advances
that run's value stamp, and uses the existing canonical today-sync path with
its reset epoch and stale-response handling. Started, paused, and ended runs
remain ineligible; per-run progress and unrelated form edits are not included.

The existing 390×844 Chromium journey now verifies the selected pending-run
snapshot survives a peer reload and that the started run remains unchanged.
The broader recipe-refresh group passed 11 cases; its two `@focused-only`
cases were skipped. This follow-up does not change the per-pizza warning policy
or persist any warning. Browser fixtures were disposable development data; no
successful-run screenshot, trace, cookie, or request payload was retained.
The local test stack started successfully. Its logs included Vite dynamic-import
and chunk-size warnings plus a PostgreSQL client-query deprecation warning; no
test failed in the post-fix browser runs. These warnings were not investigated
as part of this task.

## Compatibility applicability and limits

| Surface | Evidence and outcome |
| --- | --- |
| Desktop | Per-pizza warning components: PASS in rendered tests; public 1280×720 capture shows only the unauthenticated landing page. The selected-run sync journey was not run at a desktop viewport. |
| Phone | Responsive web applies. The selected-run profile-sync flow passed in Chromium at 390×844. Per-pizza warnings passed component tests; no separate phone-layout screenshot/assertion was retained. |
| Tablet portrait | Applicable; component assertions cover warning behavior, but no tablet-portrait browser run was performed. |
| Tablet landscape | Applicable; component assertions cover warning behavior, but no tablet-landscape browser run was performed. |
| Chromium/Chrome | The selected-run flow passed in a 390×844 Chromium context. The prior full 170-case Chromium report remains 169/170 and was not rerun after the fix. |
| WebKit/Safari | Applicable; NOT RUN. Chromium and component results are not WebKit evidence. |
| Physical Android Chrome | NOT RUN: the 390×844 browser context is emulation, not physical Android evidence. |
| Physical iOS Safari/PWA | NOT RUN: no physical-device service was used; no physical iOS or installed-PWA evidence is claimed. |
| Native mobile | NOT APPLICABLE: web-only product. |

The per-pizza advisory itself changes no persistence behavior or stored data;
pure and rendered checks verify it without clamping or blocking Apply. The
separately approved profile-sync correction was tested with synthetic
authenticated browser fixtures and server/peer persistence. No production
records or real mobile devices were used.

## Task prerequisites and follow-ups

The complete live unfinished-accepted inventory was untruncated (five records);
all ten persisted prerequisites were merged. The owner explicitly attested
that this task was accepted before the other four unfinished tasks. This
resolves the startup acceptance-order advisory blocker without changing task
dependencies or authorizing an ordering exception. No claim of automatic
platform scheduling enforcement is made.

The follow-up guidance was read. Two separate test-gap proposals cover the
unrun responsive/WebKit warning review and the intentionally focused rapid
run-switch case. Existing Apply-source, retention, background-database,
dependency, and QLoRA tasks were not duplicated.