# GitHub main reconciliation report

**Captured:** 2026-10-20  
**Target branch:** `Replit`  
**Replit revision at comparison start:** `2470e95e9c1dc2d72b1cd2b970e5081c821506c8`  
**GitHub `origin/main`:** `5d647cc7df45e2fbb4b1607a9856fcc59894127b`  
**Refreshed GitHub `origin/Replit` (read-only):** `0277dfbc441f7d1c53f7a449e0da5a664e37c206`  
**Merge base:** `af42381b3cc845d0aad0614bb21497b8cb15dda8`  
**Named Replit baseline:** branch and tag `recovery-baseline-main-reconcile-20261020`, both pointing to the comparison-start revision above.

## Scope and method

The target began on the workspace `Replit` branch at `2470e95e` with a clean
worktree. The authorized `origin/main` ref was refreshed and verified against
`git ls-remote`, which returned `5d647cc7…`; no cached planning-time SHA was
used as the source comparison. The task board later marked importer task 3326
merged; inspection confirmed the importer recovery contract was already present
in this working target.

A final read of GitHub's separate `origin/Replit` branch returned `0277dfbc`.
After refreshing its tracking ref, the workspace target is 11 commits ahead and
6 behind that remote ref. All six remote-only commits are ancestors of
`origin/main`; the remote tree also removes the current importer recovery code
and many attached source files. The task target remains the workspace branch,
so no changes from `origin/Replit` were merged or copied.

Both ref fetches reported that `.git/packed-refs.new` already existed. The file
was left untouched, and both refs were independently verified against live
`git ls-remote` results.

The comparison found **93 main-only commits** (56 non-merge commits and 37
merge commits) and **11 Replit-only commits**. From the merge base, main changes
174 paths (+11,467/-1,834), while Replit changes 99 (+1,358/-129). The tip-to-tip
comparison differs in 268 paths: 46 added, 67 deleted, and 155 modified. These
counts describe divergence, not the number of changes to replay.

The named baseline was preserved before integration. No branch reset, wholesale
merge, cherry-pick, force push, or protected-main update was made. The
application-source change is limited to two badge color classes in `home.tsx`.
Two client tests were corrected, and a focused accessibility contract test was
added. Importer, server, database, workflow, and generated API source files were
not replaced.

## Candidate classifications

| Upstream candidate | Classification | Evidence and decision |
|---|---|---|
| 37 main-only merge commits and upstream history already represented by prior reconciliations | **Aggregate / already covered** | Merge commits were not replayed as independent patches. `docs/branch-map-2026-09-21.md` and `docs/reconciliation-report-2026-09-21.md` remain evidence for earlier route/heartbeat and research decisions. In particular, `860d99ea`'s older route/heartbeat work is superseded by the current route composition and sync contracts; it is not a safe cherry-pick. |
| Refreshed GitHub `origin/Replit` tip | **Not the task target; not adopted** | Direct `ls-remote` verified `0277dfbc`; it is 11 commits behind and 6 ahead of the workspace `Replit` target. All six remote-only commits are in `origin/main`, while the remote tree removes the current importer recovery contract and source files. The workspace branch remains the target and was not reset or merged to this ref. |
| PWA update lifecycle changes | **Already present / remaining preload deferred** | The tip-to-tip PWA path comparison has no changes outside `artifacts/run-calculator/src/App.tsx`; the update lifecycle code itself is already in the current tree. The remaining App change preloads workbook-import chunks after authentication and offers recovery on chunk-load failure (`0a99498d`). It remains separate because it changes the importer startup/chunk path, while source-retention and real-reload follow-ups are now proposed; no importer or PWA code was changed here. |
| Current importer recovery versus main's importer edits | **Intentionally different; preserve Replit** | The current `2470e95e` target contains operation-ID recovery and prevents starting a new import while a prior spec operation is unresolved; the code and tests were re-read after task 3326 was marked merged. `home.tsx` and `importOperations.ts` differ materially from main. The refreshed GitHub `origin/Replit` tree also lacks this current recovery contract. No importer files were edited here; the current recovery behavior remains intact. |
| Local-first AI adapter, Gemini model routing, local-model readiness and smoke workflows (`7a4ee6cb`, `30cd567d`, `30b05678`, `ebf0cf41`, `b39d7a58`, related research) | **Deferred** | The Replit branch is calibrated to its existing Gemini path; model/prompt changes require the real-AI and large-spec corpus checks described in `.agents/memory/spec-import-scale-harness.md`. Local-model policy and evaluation are also documented separately. No current production-host or model-evaluation evidence was established in this task. The direct `GOOGLE_API_KEY` readiness case from `c90043ba` is already covered in the current `health.test.ts`; that behavior was not duplicated. |
| Serial-to-identity schema and migration (`60a1c780`) | **Deferred pending isolated database rehearsal** | Main changes 36 serial primary keys plus the audit sequence and adds an idempotent migration/runner. The change affects persistent schema and push ordering. This task did not have an isolated Postgres rehearsal or authorization for any production migration, so it was not copied or run. A database/schema owner should verify the migration against a disposable pre-existing serial schema and its rerun behavior before adoption; production application remains a separate approval. |
| Capacity telemetry heartbeat (`c427de8a`) | **Deferred to the capacity-evidence owner** | Replit already installs pool telemetry through `artifacts/api-server/src/lib/observability.ts`; main adds a periodic report heartbeat so event-driven telemetry does not go quiet during idle periods. The existing capacity-evidence task explicitly limits code changes absent an evidence-backed finding. This branch comparison did not add sampler/reporting behavior; the capacity-evidence owner should decide whether the heartbeat is needed and validate its production evidence boundary. |
| Background job, sync-outbox, web-push and queue diagnostic changes | **Intentionally different; preserve Replit** | The main-side diffs remove bounded failure reasons, durations, query-stage timings and slow/unavailable queue diagnostics from `backgroundOperations.ts`, `serverJobs.ts`, `syncOutbox.ts` and `webPush.ts`. Current Replit code retains those bounded signals and server-job failure fields. The current implementation is more diagnostic, not a missing older patch; replacing it would reduce operational evidence. |
| Applicator and stale-sauce audit changes in `brandProfiles.ts` | **Intentionally different; preserve Replit** | Main broadens orphaned-type reports to direct ingredient types and removes the check that a generic sauce label does not resolve to an existing recipe. Replit's code and tests distinguish direct ingredients from recipe-linked cheese applicators and filter existing sauce recipes. Broadly adopting main would create false-positive audit findings. |
| Expected authentication-cancellation handling (`5b314ab3`) | **Replit-only behavior; preserve** | Replit filters known sign-in/sign-out/account-switch cancellations from field-check performance observations and has regression coverage. Main removes that filter. This is an intentional operational distinction, not a missing main change. |
| Terminal sync-write and Audit PDF tests (`735623d4`, `7522f3a8`) | **Missing test coverage incorporated** | `homeSyncBoundary.test.ts` now asserts the permanent-rejection terminal section as well as the existing terminal write paths. `AuditLogCard.test.tsx` now reads the component's rolling date inputs, avoiding a timezone-dependent fixed expected date while retaining the PDF export, download, URL-revocation and no-toast assertions. No production sync or export behavior changed. |
| Factory-data and API failure-taxonomy expectation updates | **Intentionally different; preserve Replit** | Main's factory-data test changes the 503 classification to `transport_failure`; current Replit classifies HTTP 5xx as `http_server_error`. The existing client diagnostics taxonomy is more specific for an HTTP response, so the upstream expectation was not copied. |
| Manager-attention badge contrast (`38a9575c`) | **Missing change incorporated** | Upstream evidence reports white text on `bg-amber-700` at 4.37:1 and on `bg-amber-500` at roughly 2.2:1. After task 3326 was marked merged and the current Home/import code was rechecked, only these two badge classes were changed to `bg-amber-800`. `homeAccessibilityContracts.test.ts` guards both classes. The test is a source contract, not a computed-style browser contrast test. |
| Test-harness, action, release and dependency updates | **Deferred for dedicated review** | Main changes 12 workflow files, adds local-AI and Dependabot evidence workflows, changes major Action versions, and updates a broad lockfile. Current Replit's `check:workflows` passes, but it does not validate the new upstream workflows or their trust boundaries. No workflow or repository setting was changed and no workflow was triggered. A read-only CI security review and fresh compatible-runner validation should precede adoption. Main's Vitest and Orval patch bumps are also left for a bounded dependency update; some dependency versions in Replit are already newer (for example `@google/genai` and `@testing-library/dom`). |
| Battery and broader AI/import research documents | **Already incorporated, superseded or not authoritative** | The corrected battery audit was recorded in the prior reconciliation report and `docs/battery-performance-research.md`; the earlier battery audit was superseded. The additional upstream research pack is not copied over current project plans or operational memories. |
| OpenAPI source contract | **No source-contract delta** | `lib/api-spec/openapi.yaml` is unchanged between the compared tips. The generated Zod/client output differs, and the current generated outputs were checked from the current source contract rather than hand-edited. |

## Conflict and preservation record

`git merge-tree --write-tree HEAD origin/main` was used only as a dry preview. It
reported content conflicts in:

- `artifacts/run-calculator/src/factoryDataSync.test.ts` — retained the
  Replit-specific HTTP 5xx failure classification.
- `artifacts/run-calculator/src/homeSyncBoundary.test.ts` — retained the
  current test structure and added the permanent-rejection terminal section
  selectively.

The preview did not modify the worktree, and no actual merge was attempted. The
latest Replit importer work, cancellation classification, operational
diagnostics, current customer/source assets, and existing recovery manifest
remain intact.

## Validation

| Check | Result | Evidence |
|---|---|---|
| `pnpm run audit:recovery` | PASS | 9 PASS, 0 MISSING, 1 intentional difference. |
| `pnpm --filter @workspace/scripts run audit:recovery -- --json` | PASS | Same manifest result; `calculator-ui-memo-boundaries` is the one intentional difference because current Home wiring is not expressed as the manifest's stale exact string. |
| Focused client tests | PASS | `homeAccessibilityContracts.test.ts`, `homeSyncBoundary.test.ts` and `AuditLogCard.test.tsx`: 3 files, 7 tests. |
| `pnpm run check:workflows` | PASS | Current branch's 9 GitHub Actions workflow files passed syntax/expression checks and configured timeout checks. This does not validate upstream-only workflow files. |
| `pnpm run check:api-generated` | PASS | Current OpenAPI source and generated clients checked; API Zod tests passed. |
| `pnpm run check:typescript-7-codegen-bridge` | PASS | Stable-worktree retry passed in a disposable checkout; the first attempt detected the reconciliation report being created during the check. |
| `pnpm run check:typescript-api-v6` | PASS | 12 checks passed; zero direct-import boundary bypasses. Also passed inside the full typecheck. |
| `CI=true pnpm run typecheck` | PASS | Shell inventory, recovery audit, generated API checks, library builds, and API/server/calculator/scripts typechecks passed using the installed pinned Node 24.21.0. |
| Replit preview `/` on port 26038 | PASS WITH LIMITATION | Vite served the page and rendered the staff sign-in screen. The capture was unauthenticated; the manager badge UI was not visible. The existing app-update control showed “Update failed”; browser logs included unauthenticated API 401s and navigation-budget warnings. No sign-in or update action was attempted. |
| `git diff --check` | PASS | No whitespace errors after the final report and source edits. |
| Full release/browser suites, database migration, production data, deployment, GitHub Actions execution | NOT RUN | Outside this reconciliation's authorized scope; no production mutation or publication occurred. |

## Failure and deferral ledger

| Item | Status / risk | Owner and next action |
|---|---|---|
| Fetch reported a pre-existing `.git/packed-refs.new` write warning | Refreshed ref was independently verified against live `origin/main`; the file was not removed. No stale-source ambiguity remains. | If a later fetch cannot update the ref, investigate through the supported repository route without deleting or bypassing protected locks. |
| Initial read-only package-script query disconnected unexpectedly | The relevant check commands were run directly in the task environment and their actual statuses are recorded above; no implementation decision relied on the interrupted query. | None. |
| Initial TypeScript 7 bridge attempt detected a changing worktree | The check itself passed in its disposable checkout, but the report file appeared between its before/after status snapshots. A stable-worktree retry passed. | No further action. |
| Initial full typecheck was waiting on pinned Node provisioning | The exact Node 24.21.0 runtime was already installed in Nix. The first attempt was stopped without bypassing the runner; rerunning with that installed runtime passed. | Use the installed pinned runtime when this runner would otherwise provision it from npm. |
| Preview was unauthenticated and showed the app-update control in a failed state | The staff sign-in page loaded, but neither the manager badge UI nor an authenticated update handoff was visible. No application update failure was introduced by this badge-only patch. | Authenticated visual verification remains unavailable in this task; keep PWA update diagnostics with the existing update-recovery work. |
| Serial-to-identity migration | Deferred; schema conversion has not been rehearsed against an isolated database. | Database/schema owner: run the migration and push-order checks against a disposable existing serial schema; do not apply to production without explicit approval. |
| Upstream Actions/workflow changes | Deferred; current workflow checks passed, but upstream workflow security was not reviewed or executed. | CI/security owner: inspect permissions, triggers, secrets, action pinning, artifacts and caches, then validate on the intended runner without changing repository settings. |
| Capacity telemetry heartbeat | Main adds periodic emission; Replit already installs pool instrumentation. No code added outside the capacity-evidence task's scope. | Capacity-evidence owner: determine whether idle-window reporting is required and validate it using the existing evidence boundary. |

## Boundary

The target remains the Replit branch. Protected GitHub `main`, production data,
production schema, deployment configuration and published application state
were not changed.
