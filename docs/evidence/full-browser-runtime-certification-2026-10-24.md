# Full browser runtime certification attempt — NO-GO

## Scope and authorization

The owner explicitly authorized standard/full release verification on the
isolated Linux runner, required browser/database prerequisites, and read-only
production evidence retrieval. Publishing, production writes, unrelated database
diagnosis, and increased time budgets are not authorized.

Assessment started on 2026-10-24 UTC from Git revision
`df2b972bf819ebbb8694966810f8b450225da6a1`, with a clean worktree.

- Browser-executed revision, before the later dependency repair:
  `test-sha256:add0162508de4dab23e1cf0166676c969d603ca2cb084f1f4afd5cc462bbb850`
- Production source:
  `source-sha256:7defc919019528dec657a107dacb0b689e260fd81eb8ea7395ca51a535507265`
- Verification inputs:
  `2c3ff7087558b3e83c21c9cc36ef0bff43bac0a1d8e73ad2311fcc9b16897761`
- Expected source policy: `production-source-v4`.
- Runner: Linux x86-64, 8 reported CPUs, approximately 15 GiB RAM.
- Runtime: repository wrapper selecting Node 24.21.0 and pinned pnpm.

Documentation and retained evidence do not change source/test identities. No
application, test, contract, dependency, schema or budget change occurred during
the browser executions. A subsequent safe dependency repair and corpus
provenance refresh changed the revision; their separate identity and checks are
recorded below. Private runtime evidence is excluded from deployment uploads.
All timestamps in this report are UTC.

## Primary runtime result

The unchanged default Chromium gate finished with **FAIL**, exit 1.

| Measurement | Actual result |
| --- | --- |
| Gate start / finish | `2026-10-24T01:54:25.720Z` / `2026-10-24T03:16:02.923Z` |
| Gate wall time, including disposable setup and cleanup | **4,897,200 ms — 81 min 37.200 sec** |
| Browser reporter wall time | 4,868,664 ms — 81 min 8.664 sec |
| Approved identities / files | **216 / 54**, exact inventory guard accepted, sole `chromium` project |
| Passed / failed / skipped | **108 / 102 / 6** |
| Reporter completed callbacks / not-run callbacks | 216 / 0 |
| Warning / hard limit | Existing **80 min / 90 min**; warning fired at 4,800 sec; no hard timeout |
| Workers / retries | **1 / 0**, unchanged |

The generated report's `Coverage: COMPLETE` means every enumerated case received
a final reporter callback, including skipped cases. It does **not** mean all
216 journeys executed successfully. Four phone-layout cases and two visual
cases were skipped after earlier failures in serial groups.

This failed run exited within the limit. It does **not** certify that a passing
216-case run fits the limit: failed tests stop before later assertions, and
skipped tests do not exercise their journeys. No budget increase or accepted
exception is proposed.

The [retained generated report](full-browser-runtime-generated-2026-10-24.md)
contains the complete 54-file timing table and all 102 failed/timed-out and
6 skipped identities. It is an unmodified metadata-only copy from the actual
reporter, not a reconstructed or manually edited success report. Its SHA-256 is
`aa08fa4a974a8d27a850496a1e0cb423a6dc6292f1eda11f96ef30ac8950507c`.

## Evidence handling

This document retains bounded metadata only: identities, counts, timings,
statuses, and blocker descriptions. Raw browser traces, fixture payloads,
screenshots, and service logs are not committed or presented as sanitized
evidence. Generated run output stays in ignored test/evidence directories.
Historical reports are not replaced by this independent attempt.

## Safe repairs and post-repair identity

The 23 independent non-database steps finished with **20 PASS / 3 FAIL** on the
browser-executed revision. The failures were the production dependency audit,
WebKit identity contracts, and corpus dependency provenance. Generated-client
freshness, immutable build-source contracts, real API/web build integration,
shared-library and all four consumer typecheck steps, recovery/onboarding
guards, operational evidence checks, calculator tests, and the other selected
package suites passed. These are individual step results, not a standard/full
release PASS.

Two safe failures were repaired after all browser and initial independent steps
finished:

- **Dependency audit:** `GHSA-27r3-jxmh-p828` flags body-parser before 2.4.0 for
  process termination after a compressed request with trailing bytes. The
  existing workspace override pinned 2.3.0. Express 5.3.0 is already the latest
  release and accepts `^2.3.0`; the override was updated to **2.4.0**, within that
  supported range. The lockfile changes only that override, package integrity,
  snapshot version and Express dependency edge. No unrelated dependency was
  updated. Installed resolution confirms Express 5.3.0 → body-parser 2.4.0.
- **Corpus provenance:** the initial corpus run passed 11/12 tests; its only
  difference was a stale dependency-lock SHA in the evaluation manifest.
  Regeneration through the pinned snapshot command changed only
  `dependencies.pnpmLockSha256`. No workbook, importer, expected parse output,
  prompt, model, alias, or stored-data change was made.

The repaired revision is:

- Assessed revision:
  `test-sha256:f6562dfd1b3895fbe661c2b07cf9527c50ab1cccc7f2fd6b44864af40bd642e9`
- Production source:
  `source-sha256:477fbcc306adaf80e0552e7a47a02e9fe62df6e250b3b932cd508f0d2e71f0e4`
- Verification inputs:
  `03982432027f1b69aa8740604d4aca5e1a7b2e66c6c64dd6c163599c27c7f3c6`
- Lock SHA:
  `e18722c2aa6d90a317d2cb93f748d5becf6901e58d4e55dc3b6a1dbf57badfd5`

All six focused post-repair checks passed under Node 24.21.0:

| Post-repair check | Result |
| --- | --- |
| Frozen dependency installation | PASS; lock hash unchanged |
| Existing blocking production dependency audit | PASS; no known vulnerabilities found |
| Real API/web build-source integration | PASS; 7 tests |
| Corpus tests | PASS; 12 tests |
| Spec import tests | PASS; 387 tests across 31 files |
| Focused API JSON/error-parser contracts | PASS; 5 tests; non-listening loopback database URL, no database required |

The [sanitized supporting gate records](full-browser-runtime-supporting-gates-2026-10-24.json)
retain exact identities, timestamps, statuses and elapsed times for both phases
and both WebKit lanes, omitting raw errors and payloads.

**The complete browser suite was not rerun after this dependency change.**
The earlier FAIL is not relabeled with the new revision. The repaired revision
therefore has no passing full-browser or standard/full release certification.
The local dependency repair is not a published production fix.

## Failure ledger and gate matrix

| Gate / finding | Status | Evidence, owner, next action |
| --- | --- | --- |
| Current deployment metadata | PASS | Supported deployment lookup returned deployed, successful build, public visibility, Autoscale, and an official primary URL. This does not establish matching source. |
| Published source/readiness/reconciliation preparation | BLOCKED | `pnpm run release:check -- --prepare-published-evidence --published-url <official primary URL>` exited 1: `Invalid sealed build identity.` Read-only `/api/build-info` reports `production-source-v3`, source fingerprint `bd319653b852c242f755bd44fd6116d35088052d13930627830e847363875442`, completed `2026-10-22T20:35:36.890Z`. Current expected record uses v4 and the different source above. Release/deployment owner must resolve this through a separately authorized publishing decision; do not rewrite either identity or treat the live response as the independent expectation. |
| Standard release | BLOCKED | After the initial queued invocation was lost in a workspace restart, the actual `pnpm run release:check` retry exited 1 and wrote its standard-mode checkpoint: missing readiness deployment ID and deployed source revision. No gates ran. A deliberately non-listening loopback test database URL prevented fallback to shared operational data. |
| Full release | BLOCKED | `pnpm run release:check:full` exited 1 and wrote its full-mode checkpoint with the same missing production evidence. No gates ran; no full-release PASS may be inferred from a standalone browser result. |
| Independent full browser gate, first attempt | BLOCKED | Actual startup reached `Running 216 tests using 1 worker`. The workspace restarted before completion; both background commands and their temporary output logs were reported lost. No result JSON or final browser report survived. The attempt is interrupted, not a timeout, pass, or completed suite. Eight failure traces survived and were preserved separately. |
| Independent full browser gate, retry | FAIL | Completed at `2026-10-24T03:16:02.923Z` within 90 minutes, with 108 passed, 102 failed, 6 skipped. Same source/test identity, exact existing step, no source/test edits. See the complete generated report and primary timing table above. |
| Accessibility authenticated workflow fixture | FAIL | Case `authenticated staff workflows expose accessible controls and dialogs` stops in `seedPendingRun`: canonical `/sync/today` fixture PUT returns HTTP 409. The fixture is still writing operational stoppages through a snapshot; diagnose against the current server-owned mutation contract after the unchanged run finishes. Owner: this release objective. No raw rejection payload is retained here. |
| Accessibility break-plan workflow | FAIL | Case `manager break plans persist and operators can view placements without edit controls` cannot find the expected deleted-run warning in the schedule editor. Direct-DB break seeding and canonical normalization need investigation; this is not yet classified as an app or fixture defect. Owner: this release objective. |
| Accessibility phone/PWA and operator workflows | FAIL | Two retained traces record the existing 120,000 ms per-case timeout. These are Chromium-emulated workflows, not physical Android evidence. Owner: this release objective; locate the blocked action before any repair or rerun. |
| Cross-device, department navigation, paired-run lifecycle workflows | FAIL | Three retained traces cannot find the expected Pause Run control after setup/start. The cross-device failure snapshot shows a blank selected run and a provisional baseline; do not assume this is a proven production lifecycle defect or weaken the Start assertion. Owner: this release objective; establish fixture run identity and confirmed canonical baseline. |
| Dough correction/resume workflow | FAIL | Retained trace records a false result from a predicate after 15,000 ms. Owner: this release objective; inspect the actual correction acknowledgment and run ownership before changing coverage. |
| Independent WebKit smoke | FAIL | 2 passed / 1 failed; 121,299 ms including isolated setup/cleanup. Failed lifecycle case could not reach Pause Run. |
| Independent phone/tablet WebKit compatibility | FAIL | 6 passed / 2 failed; 179,886 ms including isolated setup/cleanup. Same lifecycle failure on both portrait-sized projects; no skips. |
| Independent non-database release checks | 20 PASS / 3 FAIL, pre-repair | Exact results are retained separately. Audit and corpus failures were safely repaired and rechecked on the new revision; the WebKit identity guard remains failed. |
| WebKit identity contracts | FAIL, unresolved | Guard rejects extra `desktop-webkit` and `tablet-landscape-webkit` projects. Inspection also finds only 4 reviewed compatibility identities versus 8 cases in the selected runtime projects. No identity list, assertion, project scope or budget was changed to hide this drift; runtime completion is not reviewed-inventory certification. Owner: this release objective; obtain an explicit inventory decision before any contract change. |
| Database-backed/API shards, clean-start, container, remaining release lanes | NOT REACHED | Official standard/full runners stopped at their required published-evidence prerequisite. Standalone browser startup does not satisfy all of these gate contracts. No production/shared database or unsupported container work was started to bypass that boundary. |

The independent browser command imports `RELEASE_CHECK_STEPS` with `--full`,
selects `full browser E2E suite`, verifies its 4,800,000 ms warning and 5,400,000 ms
hard budget, and calls the exported `runStep`. Its only step-environment changes
are test environment labels and a separate report destination. It invokes
`scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.config.ts`
through the pinned release runner. No grep/project selection, retries, parallel
workers, case exclusions, or budget changes are added.

The final failed-case ledger is the linked generated report. Bounded inspection
of all **102** retained failure traces found **26** with fixture/HTTP-409 conflict
messages, **1** with a guarded cleanup ownership refusal, and **75** other
assertion, timeout or exception failures not root-cause-classified. These are
observations, not 102 confirmed product bugs. No broad fixture rewrite,
assertion weakening, skipped-case removal, ownership-guard removal or blind
retry was used to turn the run green.

All failed and skipped identities remain unresolved required release work owned
by this release objective. The next safe repair step is to establish a valid
canonical fixture for each failing flow, then reproduce its first failed
assertion and distinguish fixture failure from product failure. Passing old
standalone authority selections cannot close these failures.

The WebKit reporter classifies the missing Pause Run control as `test-setup`.
That is a reporter classification, not a confirmed root cause or proof of
product health. The lifecycle assertion remains failed in all three projects.

Attempt artifacts (ignored, local only):

- First attempt: no final result/report was produced. Its surviving private
  traces and screenshots were moved to
  `release-evidence-full/runtime-certification/interrupted-test-results/`
  before the retry.
- Retry: `release-evidence-full/runtime-certification/retry/attempt.json`,
  `private-runtime.log`, `result.json` and `browser-full/FINAL-REPORT.md`.
  The private log is mode 0600 inside a private evidence directory; it is not
  sanitized for publication or committed.
- Standard/full pre-gate checkpoints remain separate from retained release
  reports and are never promoted to passing evidence.

## Compatibility applicability

| Surface | Status / evidence boundary |
| --- | --- |
| Desktop Chromium | FAIL; default 216-case contract completed its callbacks, with 102 failures and 6 skips across desktop and explicitly resized test contexts. |
| Phone portrait Chromium emulation | PARTIAL / NOT CERTIFIED; several phone checks passed, but Sauce/Dough and other operational journeys failed. |
| Phone landscape Chromium emulation | FAIL / SKIPPED; the operational-dialog case at 568×320 timed out; narrow-landscape sign-in was subsequently skipped. |
| Tablet portrait Chromium emulation | PARTIAL / NOT CERTIFIED; touch-picker and visual coverage was skipped after earlier serial failures. |
| Tablet landscape Chromium emulation | PARTIAL / NOT CERTIFIED; the combined portrait/landscape visual case was skipped. Other responsive fixtures do not certify this missing coverage. |
| Desktop Playwright WebKit | FAIL; 2/3 smoke cases passed; start/pause/resume/reload could not reach Pause Run. |
| Phone portrait Playwright WebKit | FAIL; 3/4 cases passed at 390×844; same lifecycle failure. |
| Tablet portrait Playwright WebKit | FAIL; 3/4 cases passed at 810×1080; same lifecycle failure. |
| Phone/tablet landscape Playwright WebKit | NOT RUN in these selected existing release steps; no landscape certification is claimed. |
| Physical Android Chrome | NOT RUN; no physical device service or physical evidence was used. |
| Physical iOS Safari/PWA | NOT RUN; no physical device service or physical evidence was used. |
| Published operational behavior / capacity | NOT RUN; deployment metadata and a read-only build-info response do not certify operational authority, reliability, or capacity. |
| Previously passing standalone authority selections | NOT RUN; deliberately not repeated as substitute full-suite evidence. |

Playwright WebKit on Linux and Chromium with phone/tablet-sized contexts are
emulated checks, not physical Android Chrome, native iOS Safari/PWA, or device
capacity evidence. WebKit phone/tablet projects resize Desktop Safari contexts;
they do not establish native iOS behavior.

## Current bounded release status

App health: NOT CERTIFIED — the browser-executed revision failed; the repaired
revision has only focused checks, not a new full browser result. API/web managed
workflows were restarted once after the dependency batch and are serving.
Startup reported ready, with development identity-sequence/master-data diagnostic
warnings that were not cleared or investigated here. The signed-out development
landing page rendered in preview with its existing “App updates · Update failed”
notice and expected anonymous 401 responses; this is not authenticated or
published health proof.

Release evidence: BLOCKED — current production-bound evidence cannot be prepared;
both official standard/full preflights stopped, and the independent full browser
result is FAIL. No successful standard/full certification exists for this revision.

Security readiness: PARTIAL — the repaired local revision passed the blocking
production dependency audit with no known vulnerabilities. This does not
establish full security readiness or assess the unmatched published build.

Operational readiness: BLOCKED — published source identity is incompatible with
the current expectation. Destructive work is confined to disposable PostgreSQL.

Accepted exceptions: none.

Decision: **NO-GO** for this assessed revision and scope.

Publish recommendation: none. No publication or production write was performed.
This is a completed, bounded verification-attempt record with unresolved
certification blockers, not successful release certification. Required failed,
skipped and missing checks have not been waived, moved to unrelated tasks or
presented as passing. Both the browser-executed and repaired revisions are NO-GO.
