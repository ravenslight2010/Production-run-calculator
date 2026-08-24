# Final Post-Merge Release Readiness

Release: `b2107694a42b9462a90ae20f34c3afcd1a23064b`  
Date: 2026-08-24  
Environment: development database and artifact-managed local preview; disposable E2E approval flags were used where destructive setup was required. No production writes or destructive production tests were performed.

## Required gates

- Generated client: **PASS** — `pnpm run check:api-generated`; OpenAPI-generated outputs were fresh.
- Typecheck: **PASS** — shared libraries, API server, run calculator, mockup sandbox, and scripts all passed.
- Recovery evidence: **PASS** — `pnpm run audit:recovery`; 4 pass, 0 intentional differences, 0 missing.
- Unit/integration: **PARTIAL / NO-GO** — run calculator passed 214 files / 2,272 tests; production-rules 17, inventory-math 59, spec-reconcile 33, scheduled-recipe-check 17, spec-export 36, corpus 11; model-bump and operational-evidence checks passed. API server tests did not reach a terminal summary within 5 minutes and were interrupted while an SSE request remained open.
- Clean start: **PASS** — API, web, and mockup clean-start smoke passed on ports 18081/18082/18180.
- Security: **PASS** — dependency audit 0 vulnerabilities, SAST 0 findings, HoundDog 0 findings.
- Workflow/preview: **PASS** — API, web, and mockup workflows restarted successfully. API health returned `status=ok`, with process/database/dependencies all `ok`. Saved evidence: `api-health.jpg`, `web-preview.jpg`, `mockup-preview.jpg`.

## Conditional gates

- Browser smoke: **PASS** — desktop and 390×844 phone projects passed (2/2).
- Accessibility: **FAIL** — after rerunning with approved isolation flags, 6/9 failed across desktop, phone, and tablet. Keyboard traversal reported no visible focus indicator at step 6; authenticated workflow checks could not find the expected close control.
- Phone/mobile: **FAIL** — 2/9 passed; authenticated calculator at 375×812 could not find `button-start-run`. The slow-network case was initially refused without isolation flags and was not accepted as evidence.
- Visual: **N/A** — no visual baseline change was being validated.
- PWA: **N/A** — no PWA handoff change was in scope.
- Sync convergence: **FAIL** — 3/4 passed; desktop wake/reset case failed with a navigation race (`Execution context was destroyed`), while phone cases passed.
- Mix Plan: **INCOMPLETE / NO-GO** — targeted run exceeded the 5-minute command ceiling without a terminal result.
- Full destructive E2E/isolation: **INCOMPLETE / NO-GO** — the full release runner did not reach this step because the API test gate timed out. Disposable-test approval flags were supplied for attempted destructive suites.

## Operational review

- Data heal: **Applied at API startup**. The development database is reachable. Existing one-time markers include non-zero corrections such as 8 cheese recipe weight rows, 5 profile corrections, 8 sauce additions, 119 tunnel-default profile updates, and 12 applicator contamination profile cleanups. These heals can correct live stored data on the first production boot after publish; the publish owner must review the complete marker/result set before release.
- Schema: **Changed on the merged revision** across the DB schema package. Development startup/health is healthy, but publish-time schema diff and any rename/additive review remain required; no destructive schema operation was run during validation.
- Sync: **Specialist review applied**. API/client-date, epoch, LWW, blank-over-populated, body-limit, and wake-handoff paths are release-sensitive. The desktop wake convergence failure and incomplete API integration suite are unresolved.
- Destructive setup: **Isolated for attempted browser smoke/a11y/phone/sync runs** using the explicit E2E approval variables. No production database was used. The full suite did not complete, so final disposable cleanup evidence is incomplete.
- Rollback and post-merge plan: **Do not publish this revision.** Fix the accessibility focus/dialog failures, reproduce and fix the 375px authenticated-flow failure, investigate the desktop sync wake race, and make the API suite terminate cleanly. Then rerun the full release checklist, including Mix Plan and full E2E, against disposable data. If remediation regresses startup or schema behavior, roll back to the last approved checkpoint and have the release owner re-run post-merge schema/workflow checks.

## Decision

**NO-GO**

Owners and next actions:

1. **Frontend/accessibility owner** — restore visible keyboard focus indicators and stable close-dialog semantics across desktop, phone, and tablet; rerun `test:e2e:a11y`.
2. **Run-calculator E2E owner** — diagnose the 375×812 authenticated start-run failure and rerun `test:e2e:phone`.
3. **Sync/API owner** — investigate the desktop wake navigation race and API SSE test hang; rerun sync convergence plus the focused API sync/reset integration tests.
4. **Release owner** — after the above pass, rerun Mix Plan and full destructive E2E, review startup heal impacts and publish-time schema diff, then issue the next GO/NO-GO decision.
