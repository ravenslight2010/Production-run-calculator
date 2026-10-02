# Release-speed analysis

## Run identity and scope

- **Captured:** 2026-10-02 UTC
- **Revision:** `1111ac3e56d146c85f82696aab9a8d6d0a633976`
- **Mode:** Standard release-check gates, run as isolated test validation
- **Command:** `pnpm --filter @workspace/db run push-force`, then `pnpm run release:check`
- **Database:** Temporary local PostgreSQL with a dedicated `browser_e2e` database
- **Test safeguards:** `CI=true`, `NODE_ENV=test`, `E2E_TEST_DB=1`, and `E2E_APPROVED_DESTRUCTIVE_MODE=1`
- **Production boundary:** Production source-library reconciliation was intentionally skipped. This run is not production evidence and cannot establish production readiness.

The complete run reached all 37 gates in **1,260.854 seconds (21m 00.854s)**. **31 passed and 6 failed.** The release checker wrote an `INCOMPLETE / NO-GO` checkpoint; it did not update retained release evidence. Its `release-check-state.json`, `release-check.log`, and checkpoint are in this directory.

The temporary PostgreSQL cluster was stopped and removed by the run's cleanup handler. The disposable API-unit database was also removed. No production database was used.

## Stage timings

| Stage | Time | Share of total |
| --- | ---: | ---: |
| Prerequisites | 40.5s | 3.2% |
| Shared output | 2.1s | 0.2% |
| Consumer typechecks | 61.3s | 4.9% |
| TypeScript 7 advisory | 36.9s | 2.9% |
| Clean-start smoke | 37.0s | 2.9% |
| Render image smoke | 160.5s | 12.7% |
| Release tests | 282.4s | 22.4% |
| Browser guard | 3.4s | 0.3% |
| Browser smoke | 68.4s | 5.4% |
| Browser calendar | 15.4s | 1.2% |
| Browser accessibility | 430.7s | 34.2% |
| Browser WebKit | 122.3s | 9.7% |

The four browser stages together took **636.8s (10m 36.8s), 50.5% of the run**. The accessibility gate ran 36 desktop, phone, and tablet cases with one worker, and all passed. WebKit ran three smoke cases; all passed.

## Failed gates and classification

| Gate | Time | Evidence and classification |
| --- | ---: | --- |
| TypeScript 7 advisory comparison | 36.9s | The TypeScript 6 `recipe-guide-import` prerequisite build failed inside the comparison checkout. The error did not retain compiler diagnostics. The normal TypeScript 6 package typechecks, including the recipe-guide-import prerequisite, passed. Root cause remains undetermined. |
| API unit tests (shard 1/7) | 123.2s | 94 files and 875 tests passed, but Vitest reported four unhandled worker-fork errors with `spawn ... EAGAIN`. This is worker/process resource exhaustion, not a failed assertion; the gate remains failed because worker errors can leave coverage incomplete. |
| API integration tests (shard 2/7) | 168.9s | 18 suites and 214 tests passed, with 24 skipped. `cheeseRecipes.integration.test.ts` failed during setup when the audit-protection child process hit `pthread_create: Resource temporarily unavailable` (exit 134). This is consistent with host thread/process pressure, not a product assertion failure. |
| Run calculator tests | 157.7s | All 311 files and 2,911 tests passed. The suite took 157.4s against a 150.0s budget, exceeding it by 7.4s. This is a budget failure, not a test assertion failure. |
| Spec import tests | 60.9s | 24 files and 283 tests passed, but Vitest reported three worker-start errors: two worker-response timeouts and one worker `SIGABRT`. No assertion failure was reported; the gate is incomplete because workers failed to start. |
| Corpus tests | 41.8s | One of 12 tests failed because the deterministic evaluation manifest expects lockfile SHA-256 `2c47ed8787daf1e167b691e433979db9d1b4e88445b17c2d069022f96c821f41`, while the committed `pnpm-lock.yaml` hashes to `e29910caa790a82c2af21c5e7c1d1ad986cb9151462eb66d34b7ad6fc2b6241e`. The committed file and workspace file match; this is a reproducible stale-manifest mismatch, not a runner-pressure failure. Do not regenerate the snapshot as part of this timing run. |

The release-test scheduler reported up to four gates at once, with API/database work capped at two. The worker-fork and thread-creation errors occurred during that concurrent test stage. The evidence supports resource pressure as the likely cause, but this run did not sample the host's process-limit counters, so it does not prove a particular cgroup limit.

The remaining 31 gates passed, including clean-start, Render image smoke, API integration shards 3 and 4, API role/capability and sync shards, production rules, inventory math, spec reconcile, scheduled recipe check, spec export, browser smoke, calendar, accessibility, and WebKit.

## Timing comparison

- An earlier standard report at revision `e6194c8dd7ecaa4e3218de6a04303548c903c6a2` recorded **781s (13m 01s)** with all listed gates passing. The current run is about **480s (8m) or 61% longer**, but the revisions and gate inventories differ. The current run includes expanded accessibility coverage plus calendar and WebKit gates, so this is not an apples-to-apples regression measurement.
- The Render image smoke took **160.5s** in this run. An earlier aborted attempt on the same revision took **223.2s** for that gate, a **62.7s (28%)** reduction consistent with warmed build layers. The aborted attempt is not an overall timing baseline.
- A separate full-browser report at revision `b625f6769bc78ee2ba04d9104dd555b2c9879890` took **2,975.7s** and completed all 169 cases: 164 passed and 5 failed. That suite is not comparable to this standard run.
- Exact reports for Task #2587 were not present in the merged workspace. None of the retained historical reports above are attributed to that task.

## Recommendation

Keep the complete gate and browser-case inventory. Do not address the observed timing by skipping tests, extending budgets to hide slow runs, or weakening revision-bound evidence.

For constrained local runs, use the release check's supported `RELEASE_CHECK_MAX_CONCURRENCY=1` setting with a fresh disposable database to distinguish test failures from aggregate worker pressure. This favors reliable diagnosis over minimum wall time. For faster CI, run resource-heavy groups on appropriately sized, isolated workers, give database-backed shards disposable databases, and aggregate results only when every artifact names the same exact revision. Preserve the full gate inventory and revision-bound handoff.

Prioritize the measured browser cost next: the 36-case accessibility stage alone consumed 34.2% of this run. Investigate reuse of server/fixture setup or safe per-device sharding, with isolated state and all 36 cases retained. Keep Docker layer caching; the same-revision Render comparison suggests it can save about a minute on that gate.

Review the corpus manifest's lockfile fingerprint separately through its canonical generation and review process. Keep the TypeScript 7 prerequisite failure visible until its child diagnostics are retained and the cause is known.

## Evidence handling

This report records aggregate outcomes, durations, revision identity, and bounded error categories. It does not include credentials, request payloads, production records, or test correlation identifiers. The detailed test output is retained in `release-check.log`; it is isolated test evidence, not production proof.