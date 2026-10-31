# QC phone and tablet layout repair

## Evidence boundary

This report covers the web/PWA layout repair in an isolated development workspace.
It is not production verification, a release certificate, or a physical-device
after-test. No production records, schema, calculation, sync, tracking, target
policy, permissions, or feedback statuses were changed for this repair.

The original inbox reports remain distinct from the later screenshots:

| Feedback | Original symptom | Additional evidence |
| --- | --- | --- |
| `6514e739-3569-4807-a1bb-e4bb4afb0ce3` (2026-10-22 16:47:53 UTC) | QC content exceeds the phone edge | Three user-supplied Android Chrome screenshots show Run checks and Reviewed targets cards extending beyond the right edge, including required fields and save/clear actions. |
| `2b445d9e-ac8f-437e-ac4a-0a6738f1a748` (2026-10-22 16:51:04 UTC) | Some areas disproportionately large on phones but small on tablets | The supplied forms show unusable split fields. The regression matrix checks usable field widths and card growth between phones, tablets and desktop, rather than requiring identical pixel sizing. |

The screenshots supplied on October 23 are retained, unchanged, under
`attached_assets/Screenshot_20261023_0719{20,28,35}_Chrome_*.jpg`.
Their application revision, CSS viewport, zoom and device settings are unknown.
They are original symptom evidence, not a known-source isolated baseline.
Do not copy the operational ingredient text from them into public fixtures.

## Layout inventory and bounded repairs

| Surface | Finding / existing contract | Repair or verification boundary |
| --- | --- | --- |
| QC Run checks and Reviewed targets | Implicit auto grid tracks and grid-item/native-select minimum widths can widen a whole card beyond its containing phone column. | Explicit single-column default tracks, zero-minimum grid items, bounded form controls; retain the wide-screen two-panel layout. No page-wide overflow clipping or transform scaling. |
| QC weight and Brix settings | A viewport breakpoint still produced 144.5px fields in a narrow desktop side panel. | Use card-width-driven auto-fit tracks with an 11rem readable minimum, falling back to a full-width field in smaller containers. Measure phone, tablet, desktop and enlarged text. |
| QC recording, label/date checks, cleaning, sign-off | At 200% text, implicit label/date form tracks widened native fields to 412.6px and the body to 527px. | Explicit zero-minimum single-column defaults in the child forms and comparison/history grids; cap narrow-card padding and let action content wrap. Preserve capability gates, mutation behavior and readable text. |
| QC history and allergen footprint | Long run references and ingredient names must not disappear behind ellipses or unbroken text. | Wrap required identifiers, ingredient names, event details and errors. Keep intended internal lists/tables bounded. |
| QC/allergen activity reports | Long product/run labels and permission-dependent review controls need phone containment. | Report matrix covers operator and manager, populated review/correction/redaction states, enlarged text and return navigation. |
| Shared header / More navigation | Isolated Chromium reproduced a 32px QC menu item. Existing header buttons use 44px minimum targets. | Give the operational More menu items a 40px minimum height; retain its existing viewport-bounded scrolling and keyboard behavior. |
| Fixed station navigation | At 200% text and a 320px viewport, station labels visibly overlapped and extended beyond their tabs. The same page also contained overflowing QC form tracks. | Allow full labels to wrap within their own tab; use compact internal padding while preserving at least 44px targets, legible text and existing navigation clearance. |
| QC phone spacing | Root and card padding compounded when root text size doubled. | Reuse the app-shell gutter and cap narrow-card spacing by available viewport width, without reducing text size. |
| Run, Dough, Sauce, Front, Packaging | Source inventory found existing responsive rows, single-column production surfaces, metric grids and shared fixed navigation. | Focused rendered checks cover the calculator, primary navigation and shared controls; no independent calculation-department defect was reproduced. Do not alter production behavior or global typography. |
| Warehouse and Inventory | Existing long-content cards, add-item controls and internal tables use shared containment rules. | Reuse populated phone/tablet fixtures; preserve stock destinations, accounting and permission boundaries. |
| Management / Setup dialogs | Existing dialog max-height, short-screen alignment, focus and footer clearance rules apply. | Reuse manager settings, standalone setup and operational-dialog cases; do not redesign the workflows. |

Typography is not globally reduced. Phone/tablet scaling is checked by readable
field widths, full required text, minimum touch sizes and sensible card expansion.
Normal vertical page scrolling remains necessary for this long operational page.
Horizontal scrolling is appropriate only within bounded wide tables/lists, not
for ordinary QC forms.

## Verification matrix

The existing authenticated QC and responsive-report fixtures use a fresh disposable
PostgreSQL database and generated accounts, roles, ingredients and runs. They
include long unbroken ingredient/product names and long run references.

Required browser viewports:

- 320×740, 375×812, 390×844, 430×932 phones;
- 768×1024 tablet portrait, 1024×768 tablet landscape;
- 568×320 short phone landscape;
- 1440×900 desktop.

Both Chromium and WebKit apply. Root-font 200% enlargement is an explicit test
style, not proof of operating-system text scaling or a physical software keyboard.
Assertions distinguish document overflow from intended internal scrolling, check
control bounds and full-name wrapping, and scroll/hit-test/focus lower actions.

### Check ledger

| Check | Status | Evidence / next action |
| --- | --- | --- |
| QC workflow, date-code and allergen-footprint component tests | PASS | 3 files: 24 tests before sync, 26 after adopting main's additional QC tests; focused Vitest invocation. |
| Supported web package typecheck | PASS | Rebuilt workspace library declarations, then ran `pnpm --filter @workspace/run-calculator run typecheck`. |
| Focused QC/report/phone/accessibility browser-spec syntax | PASS | Existing `check:e2e:syntax` command with the four explicit spec paths. |
| QC authenticated recording / permissions Chromium+WebKit | PASS | Both full operational journeys passed: recording, references, corrections/redactions, sign-off/reopening, export, reload persistence and scope separation. |
| QC manager/operator layout Chromium+WebKit matrix | PASS | 2 scenarios passed; each engine checks both roles at all eight viewports, plus manager QC at 200% text. Target fields remain at least 170px normally / 150px enlarged; label/date fields at least 150px. Required names wrap, station labels remain visible, and actions receive pointer input and keyboard focus. |
| QC/allergen activity Chromium/WebKit matrix | PASS | 2 scenarios passed; all eight viewports, operator 200% text, long names, manager correction/redaction details and reachable return navigation. |
| Shared phone/tablet departments and dialogs | PASS | 14 selected cases passed in the existing Chromium and WebKit-update-layout projects: calculator, Warehouse/Inventory, settings, setup, operational overlays, update details, short landscape and keyboard-safe sign-in. Earlier skipped cases were not counted as passes; the final selection completed. |
| Development service startup | PASS with separate diagnostic warnings below | Managed API and web workflows running; API initialization reached `ready` on 8080 and web serves on 26038. No replacement workflows were created. |
| Unauthenticated phone preview | PASS | Correct web port 26038 renders the sign-in landing page at 390×844. Does not verify authenticated QC. |
| Whole browser-spec directory syntax | PASS after main sync | Initially failed in `manager-attention.spec.ts:135` and `merge-alias-retarget.spec.ts:645`. Incoming main already contained their independent recovery; the full syntax command now passes. This repair did not delete or weaken those tests. |
| Physical Android Chrome / iOS Safari/PWA after-check | NOT RUN | No authorized device endpoint is available. The user's Android screenshots are before evidence only. |
| Native mobile | NOT APPLICABLE | This objective concerns the existing web/PWA product. |
| Published app after-check / production release | NOT RUN | Publishing and production writes are outside this task. |

## Failure ledger

| Finding | Disposition | Owner / next action |
| --- | --- | --- |
| Original off-edge QC cards and settings | PASS after repair | Both-engine manager/operator matrix passed. Phone/tablet/desktop cropped after-captures inspected; required-field widths and actionable controls verified in the actual viewports. |
| Shared More menu item only 32px high | 40px operational-menu minimum implemented | Layout repair owner: retain hit-test/size assertion. |
| Residual 2–8px QC-root scroll measurement at 320px | Corrected the test's acceptance boundary | An inner-root scroll metric alone was not document overflow. Assertions retain document/body bounds, required-text wrapping, field geometry, and reachable actions; intended internal lists remain scrollable. No page-width tolerance was widened. |
| WebKit long-ingredient allergen fixture absent after the first engine | Fixture identity/loading repaired | Give the synthetic dough recipe a unique name and wait for catalog coverage before inspecting mapped allergen rows. Both engines subsequently reached populated target and ingredient checks. No allergen policy changed. |
| Combined workflow/matrix timed out at 180 seconds | Focused layout scenario separated from mutation journey | Keep the existing timeout. The dedicated layout case uses batched field geometry and covers all eight viewports separately from recording, references, sign-off and export. |
| Desktop weight/Brix fields measured 144.5px | PASS after responsive track repair | Card-width-driven auto-fit replaces the screen-width split. Final matrix passed without lowering the field-width assertion. |
| 200% station-label overflow and compounded phone padding | PASS after targeted repair | Full labels wrap within tabs; target heights remain at least 44px. Redundant QC outer padding removed and phone-card padding capped. Body/label containment passed in both engines. |
| 200% label/date-code form fields widened the body to 527px | PASS after child-grid repair | Explicit zero-minimum default tracks in label/date forms and comparison/history grids. Native-field geometry passed in both roles and all normal viewports, plus enlarged manager QC. |
| Nested label fields remained only 130.4px wide at 200% text | PASS after nested-spacing repair | Viewport-capped insets preserve the 150px readable-field assertion, without reducing text or hiding overflow. |
| WebKit enlarged station tab reached 749.5px in a 740px viewport | PASS after shared-clearance repair | Page and bar share a text-sensitive bottom-space value, retaining the normal 72px phone baseline. Enlarged tab and full-label bounds now pass. |
| Enlarged daily report overflowed its own content width by 21px | PASS after report containment repair | Zero-minimum tracks, bounded native date input, wrapped source text and capped card/date-control padding. No horizontal page clipping added. |
| Extended fixture checklist returned `not-evaluated` instead of `pass` | Fixture observations completed | The synthetic long ingredient added two expected component observations; mark those too. Do not weaken the expected outcome or alter QC evaluation. |
| Workflow attempted to select an ingredient removed by its own substitution fixture | Fixture identity repaired | Assert and select the still-present long ingredient by canonical ID. It owns the reviewed weight override. The replaced ingredient remains correctly absent; do not change production ingredient selection. |
| Facility-history response waiter stalled on a valid cache hit | Fixture transport assumption repaired | Keep the empty-filter UI assertion, then explicitly read facility history through the authenticated browser to verify server scope. No cache policy change or forced application refresh. |
| Report return action was below the fold on 568×320 | Reachability assertion repaired | Scroll the normal document, then assert bounds, pointer hit, enabled state and keyboard focus. Below-fold content is not automatically clipped content. |
| Phone helper reported modal backdrop covering controls | Scope-aware assertion repaired | Retain the dialog's existing action hit-tests, keyboard checks and viewport/font assertions; use the helper's existing modal-coverage option so intentional backdrops are not treated as navigation obstructions. |
| A repeated phone scenario still used the unscoped modal assertion | All affected modal calls corrected | Apply the existing option to the tablet and phone settings, profile and import checks; retain their control bounds, keyboard checks and explicit dialog action hit-tests. |
| Recursive system-pnpm self-bootstrap exhausted process/thread capacity before checks started | Recovered | Confirmed failed development services stopped; exact pnpm 12.8.1 provisioned outside the source graph and its legacy cache entry repaired; bare `pnpm --version` verified; affected workflows restarted. Package pins and TLS/engine guards unchanged. |
| Resumed workspace retained a tool link whose temporary target was missing | Recovered before browser launch | Re-provisioned exact pnpm 12.8.1 outside the source graph and verified the registry SHA-512 integrity. The failed setup attempt is not counted as a browser run. |
| API development starter failed with `spawn ENOEXEC` | Recovered | Its direct child spawn found the package's non-executable fallback text entry. Tool-cache link now resolves to the verified native 12.8.1 binary; direct spawn/version check passed and managed API startup reached ready. No application or package pin change. |
| First web typecheck used stale referenced declarations and reported missing existing QC/live exports | Resolved | `typecheck:libs` then supported web typecheck passed. No generated API contract or business logic edited. |
| First preview capture used default port 5000 | Resolved | Workflow logs identify port 26038; capture succeeded there. No second speculative workflow restart. |
| Browser installer warns about non-Debian host dependency inventory | Runtime verification applies | Use the existing Nix browser wrapper; browser launch, not apt package inventory, determines availability. |
| Two unrelated browser spec files failed whole-directory syntax | Resolved by incoming main, not reconstructed in this repair | Initial safe-recovery recommendation was superseded by main's independent fix. Full post-sync syntax passed; no unrelated assertions were deleted or weakened by this task. |
| Earlier desktop-WebKit activity attempt closed its context before app mount | PASS on subsequent dedicated report matrix | Failed attempt retained, not used as a product diagnosis. Both engines passed the report matrix before and after main sync. |
| Successive isolated suites cleared earlier test-result files | Evidence retention repaired | Copy only named cropped/masked evidence to the ignored generated-artifact directory between suites. Do not retain or share raw session traces as deliverables. |
| Public preview displays existing update-failed status and unauthenticated 401s | Not treated as a layout pass/fail for authenticated QC | Update/status behavior belongs to its existing owner; no update-policy or authentication changes in this repair. |
| Development background diagnostics reported master-data findings and unavailable identity-sequence health | Outside layout repair; not healed | Master-data/DB maintenance owner: inspect the scoped read-only health report before authorizing any repair. API reached ready; this is not a claim that all background diagnostics are healthy. |
| Incidental deployment-log stream included database/background-job errors | NOT ASSESSED as production evidence | Production operations owner: correlate the currently serving build and perform an authorized read-only investigation separately. This task neither diagnoses nor changes production and does not grant release readiness. |

Raw traces and failure captures can contain synthetic session material and are not
deliverables. Only cropped/masked screenshots and minimized outcome summaries may
be shared. Successful checks must not be relabeled as physical or production proof.

## Source and after-evidence binding

Final layout/report/shared-phone checks ran on 2026-10-23, approximately
17:13–17:18 UTC, against the isolated Vite application and disposable database.
The two full operational journeys passed earlier at approximately 17:07–17:09 UTC.
Subsequent edits were scoped phone spacing/report/native-input/nav-clearance
styles, not changes to their recording, authorization, persistence or sign-off logic.

Source base: `df27c17c127ee008ebd403a68efd103491270dd2` plus the task working tree.
The following SHA-256 values bind the final rendered-layout evidence to the
actual source, rather than treating an unknown local build label as a revision.
Paths below are relative to `artifacts/run-calculator/`; measured at
2026-10-23T17:17:51Z.

```text
57bbff66fa21e7142f727b251160a6e4ed6f73da75b9bc2c4b43ef540fe7eea3  src/components/QcWorkflowTab.tsx
6ef000fa0d2d1b1c00f8327f1ad8e7c6b11967e082d19f310a158091a8cb892e  src/components/QcDateCodeVerification.tsx
dba46464a0037fa76e507d482b7093630623933feedfe27533b42179ce4a7542  src/components/QcLabelVerification.tsx
43282b157968f10f69df4127f5c5d4ac6028c99033633f263b1cc2354e60aa53  src/components/qcDateCodeShared.tsx
1e7e17ec8f7708c44e6c099d79c603aee13d44d046e63b8a525506d602f00bb8  src/components/QcAllergenActivityReport.tsx
6876c5b8a043eac1ac7da61bee7d5538e9dab7654bbe9cea5fd28862433b7a9e  src/index.css
502f44b1da896577c90e1a6fe58e7a48e36809f350a739f4eb1f228132c6afae  src/pages/home.tsx
a718a2ba0dde2d57bac2c8a7692596ecccfea75aeee333073c8741a15ca7c155  e2e/qc-workflows-authenticated.spec.ts
80fb9ddb98a43565385ad6b0311faf9c49f4664a323ec9f23376fbf1cf69bbbf  e2e/qc-allergen-activity-responsive.spec.ts
8225fa4b247434cf4a6eab822cccc2c872451f179e3f7eb72779071a33f06818  e2e/phone-layout.spec.ts
```

Retained cropped/masked target and checklist captures are in
`artifacts/run-calculator/generated-artifacts/qc-responsive/layouts/`, grouped by
Chromium/WebKit scenario, for phone-320, tablet-landscape and desktop. This
directory is ignored by Git and deployment packaging. These are tall component
crops: a fixed navigation bar can appear at the capture viewport's position
inside the tall image. They illustrate containment, not navigation reachability;
actual viewport hit-tests/focus and full-label bounds supply that proof.
Magenta blocks are privacy masks, not missing application content.

Before evidence consists of the unchanged user screenshots (unknown source
revision) and minimized isolated failure measurements retained in the ledger.
After evidence uses only generated fixture names and masked identifiers; it is
not a capture of production recipes. Report-only screenshots were transient test
attachments; the retained report evidence is the successful two-engine rendered
matrix and its bounded outcome record, not a claim that those PNGs survived the
next suite's cleanup.

Reproduction uses the existing isolated runner:

- `--playwright-config=playwright.qc-workflows.config.ts` (the operational and
  focused responsive scenarios were selected separately);
- `--playwright-config=playwright.qc-activity-compatibility.config.ts`;
- `--playwright-config=playwright.phone.config.ts` with the 14 focused
  calculator/tablet/settings/update/landscape/setup/dialog/sign-in cases.

The pre-sync selected checks returned zero, including the supported web typecheck,
24 component tests, four-spec syntax check and `git diff --check`. The
post-sync record below supersedes the earlier whole-directory syntax failure.
Neither record supplies the unavailable hardware checks or production proof.

## Main-sync integration record

The first completion attempt refreshed the task onto main and encountered a
browser-config conflict and a memory-note conflict. Both were resolved without
discarding main's QC planning/intelligence scenarios, four initial viewports per
engine, or foreign-locale/timezone settings. The task's internal eight-viewport
responsive scenarios remain intact. Source base for the combined application:
`c487df6c544a10bd9c7b5066507b3f4bed0e832d`.

Main added QC source-review fields. Thus earlier browser results were not
silently promoted to proof for the new tree: the two-engine layout/report
checks, 14 shared-phone cases, component tests, syntax and typecheck were
rechecked. Post-sync reports passed in `desktop-chromium` and `desktop-webkit`,
with their internal eight-viewport matrix and enlarged operator text. All 14
selected shared-phone cases passed again; all 26 selected component tests and
the whole-directory syntax check passed.

Additional integration failures retained in the ledger:

| Finding | Disposition / verification |
| --- | --- |
| Old ignored build-stage identity record incompatible with main's updated fingerprint policy | Preserved under `generated-artifacts/qc-responsive/pre-sync-build-metadata/` and removed from the active local stage-cache location. No identity validation was weakened and no publish preparation was performed. Config loading then passed. |
| Post-sync web typecheck referenced older API-client/live-calc declarations | PASS after rebuilding libraries with the supported `typecheck:libs` command, then running the supported web typecheck. The apparent missing QC source-review exports and line-phase fields were stale declarations; no production math, API contract or casts were changed to hide them. |
| Chromium QC remained on a separately preserved local blank run | PASS on the Chromium-only retry after explicit fixture selection. The 25-second wait alone also failed and is retained as a failed attempt. Sanitized trace inspection confirmed the seed acknowledgement and browser GET contained the exact fixture run; later writes retained that run plus a separate selected blank. The fixture selects its seeded first run through the existing Run UI, then requires the exact seeded identity. No sleeps, global timeout increase, accepted substitute run, API stub, storage rewrite or sync-source change. |
| Cold-start run-selection behavior observed while integrating incoming live-state work | Existing live-state authority owner: determine whether preserving/selecting the extra blank during canonical bootstrap is intended and verify that behavior in its owning sync fixtures. This is an isolated fixture observation, not a production incident diagnosis; it is not repaired by changing sync in this layout task. |
| One readiness-assertion patch did not match the operator viewport line | Corrected the patch context; the viewport and all existing assertions were retained. Final focused syntax passed. |
| Auxiliary memory-file lookup used an obsolete path | Read failed without changing the application; the actual lesson was already available from the indexed workspace-link/declaration guidance. Library declarations were rebuilt instead of modifying valid source to match stale types. |
| Final shell invocation could not attach to its process | One unchanged retry succeeded: all ten final evidence hashes matched and `git diff --check` passed. No application or verification assertion was changed. |

The application-source deltas from the earlier hash table are:

```text
78a6fb04430f13a861bf1421e3b7a945606b15859c096ef85bb9e872817c9bfa  src/components/QcWorkflowTab.tsx
127c311e2f544cf24e2e471ca63ac0889fffa29cb6de00673a7d1f5cd657a4df  src/pages/home.tsx
4ea283883fc9f22448304fc5c242809a7c9d884dcff93f5a50fab9fbdcfcf4c0  e2e/qc-workflows-authenticated.spec.ts
```

Other listed source/test hashes are unchanged. The original retained images
belong to the earlier explicitly bound tree, not the main-sync revision.

Combined-tree verification completed approximately 17:28–17:45 UTC on
2026-10-23. Final results: supported library rebuild and web typecheck PASS;
26 component tests PASS; whole-directory syntax PASS, followed by final
modified-spec syntax PASS; both report engines PASS; 14 shared-layout cases
PASS; WebKit layout matrix PASS and Chromium layout retry PASS. WebKit's
layout pass preceded the fixture-selection helper; its seeded run was already
selected correctly. The helper changed fixture readiness/selection only, not
the application or geometry assertions. No repeated full operational journey
is claimed after the refresh.

Final Chromium phone/tablet/desktop target and checklist captures are retained
under `artifacts/run-calculator/generated-artifacts/qc-responsive/post-sync/`.
Phone and tablet crops were inspected after the retry. These use the same
masking/crop caveats described above, are synthetic isolated evidence, and bind
to the combined application hashes plus the final fixture hash above.
The public 390×844 preview still renders the sign-in page; its existing update
status and unauthenticated 401s remain separately disclosed, not silently fixed
by changing authentication or update policy.
