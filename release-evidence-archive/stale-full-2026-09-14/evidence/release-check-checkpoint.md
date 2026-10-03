# Release Check Checkpoint — INCOMPLETE / NO-GO

Generated: 2026-09-24T04:10:10.033Z
Revision: 63cfd77eef883cba583636e6fc4c72fa37cc24a6
Mode: full
Report status: INCOMPLETE CHECKPOINT
Retained evidence: NOT UPDATED
Environment: disposable CI gate test (not production reconciliation evidence)
Source-library evidence environment: release
Source-library evidence revision: 63cfd77eef883cba583636e6fc4c72fa37cc24a6
Deployed revision: 63cfd77eef883cba583636e6fc4c72fa37cc24a6
Readiness evidence: not produced
Commands: listed in the gate results table below
Evidence paths: release-evidence-full/ and retained files linked below
TypeScript 7 trend history is missing: no valid prior samples were available.

## Gate results

| Gate | Result | Elapsed | Command |
| --- | --- | ---: | --- |
| audit protection publish configuration | PASS | 2s | `pnpm run check:audit-protection-config` |
| operational report signing-key rotation preflight | PASS | 3s | `pnpm --filter @workspace/scripts run audit:report-key-rotation` |
| blocking release security audit (high severity; registry required) | PASS | 3s | `pnpm run audit:prod:release` |
| source-library reconciliation verifier fixture tests | PASS | 8s | `pnpm --filter @workspace/scripts run test:source-heal-verify` |
| shell lint inventory | PASS | 1s | `pnpm run check:shell-inventory` |
| generated API client freshness | PASS | 18s | `pnpm run check:api-generated` |
| shared library typechecks | PASS | 1s | `pnpm run typecheck:libs` |
| API server typecheck | PASS | 25s | `pnpm --filter @workspace/api-server run typecheck` |
| run calculator typecheck | PASS | 61s | `pnpm --filter @workspace/run-calculator run typecheck` |
| mockup sandbox typecheck | PASS | 12s | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| scripts typecheck | PASS | 9s | `pnpm --filter @workspace/scripts run typecheck` |
| TypeScript 7 advisory comparison | FAIL | 240s | `pnpm --filter @workspace/scripts run check:typescript-7` |
| recovery evidence audit | PASS | 1s | `pnpm run audit:recovery` |
| clean-start smoke | PASS | 48s | `pnpm run check:clean-start` |
| Render image smoke | FAIL | 429s | `pnpm run check:render-image` |
| API unit tests (release shard 1/7) | PASS | 133s | `pnpm --filter @workspace/api-server run test:release:unit` |
| API integration tests (release shard 2/7) | PASS | 319s | `pnpm --filter @workspace/api-server run test:release:integration:1` |
| API integration tests (release shard 3/7) | FAIL | 238s | `pnpm --filter @workspace/api-server run test:release:integration:2` |
| API integration tests (release shard 4/7) | PASS | 301s | `pnpm --filter @workspace/api-server run test:release:integration:3` |
| API role/capability tests (release shard 5/7) | PASS | 104s | `pnpm --filter @workspace/api-server run test:release:roles` |
| API sync tests (release shard 6/7) | FAIL | 117s | `pnpm --filter @workspace/api-server run test:release:sync` |
| API sync SSE tests (release shard 7/7) | PASS | 26s | `pnpm --filter @workspace/api-server run test:release:sync-sse` |
| run calculator tests | FAIL | 153s | `pnpm --filter @workspace/run-calculator run test:budget` |
| production rules tests | PASS | 11s | `pnpm --filter @workspace/production-rules run test` |
| inventory math tests | PASS | 2s | `pnpm --filter @workspace/inventory-math run test` |
| spec reconcile tests | PASS | 2s | `pnpm --filter @workspace/spec-reconcile run test` |
| spec import tests | PASS | 4s | `pnpm --filter @workspace/spec-import run test` |
| scheduled recipe check tests | PASS | 2s | `pnpm --filter @workspace/scheduled-recipe-check run test` |
| spec export tests | PASS | 2s | `pnpm --filter @workspace/spec-export run test` |
| corpus tests | FAIL | 10s | `pnpm --filter @workspace/corpus-harness run test` |
| model-bump check | FAIL | 149s | `pnpm --filter @workspace/scripts run check-model-bump` |
| operational evidence check | PASS | 1s | `pnpm --filter @workspace/scripts run check-operational-skill-evidence` |
| onboarding bypass guard | PASS | 4s | `pnpm --filter @workspace/run-calculator run check:e2e:onboarding` |
| browser smoke tests | PASS | 73s | `pnpm --filter @workspace/run-calculator run test:e2e:smoke` |
| browser calendar tests | PASS | 8s | `pnpm --filter @workspace/run-calculator run test:e2e:calendar` |
| browser accessibility tests | FAIL | 464s | `pnpm --filter @workspace/run-calculator run test:e2e:a11y` |
| browser WebKit smoke | FAIL | 33s | `pnpm --filter @workspace/run-calculator run test:e2e:webkit` |
| full browser E2E suite | INFRASTRUCTURE TIMEOUT | 2700s | `pnpm --filter @workspace/run-calculator run test:e2e` |

## Timing

Total wall-clock: 4704s

| Stage | Wall-clock |
| --- | ---: |
| prerequisites | 20s |
| shared-output | 1s |
| consumer-typechecks | 61s |
| typescript-7-advisory | 240s |
| clean-start | 48s |
| container-smoke | 430s |
| release-tests | 621s |
| browser-guard | 4s |
| browser-smoke | 73s |
| browser-calendar | 8s |
| browser-accessibility | 465s |
| browser-webkit | 33s |
| browser-full | 2700s |

## Source-library preflight diagnostics

Database shape: unverified
Expected pool rows: 0; observed: 0
Expected aliases: 0; exact: 0; missing: 0; mismatched: 0
Heal marker: not present
Failure names: not-run (1)
Diagnostic only: full source-library reconciliation verification remains required for retained evidence.

## Preview evidence

- Clean-start: **PASS**
- [Clean-start evidence](clean-start/clean-start-evidence.json)
- [Proxied browser result](clean-start/browser-result.json)
- [Preview screenshot](clean-start/preview-home.png)
- [API startup log](clean-start/startup-api.log)
- [Web startup log](clean-start/startup-web.log)
- [Mockup startup log](clean-start/startup-mockup.log)
- [WebKit browser smoke evidence](browser-smoke/webkit-result.json)
- [Full browser report](browser-full/FINAL-REPORT.md)
- [Source-library reconciliation evidence](source-library-reconciliation.json)

## Retained evaluations

- No retained evaluation manifests were discovered.

## Browser duration review

Not evaluated in this release mode.

The browser result contains the retained web HTML response and the API health response observed through the web preview proxy.

## Operational review

Operational warnings: none
Failures or accepted exceptions: TypeScript 7 advisory comparison (FAIL); Render image smoke (FAIL); API integration tests (release shard 3/7) (FAIL); API sync tests (release shard 6/7) (FAIL); run calculator tests (FAIL); corpus tests (FAIL); model-bump check (FAIL); browser accessibility tests (FAIL); browser WebKit smoke (FAIL)
Interrupted gates: full browser E2E suite (INFRASTRUCTURE TIMEOUT)
Not-reached gates: none
Root blockers: TypeScript 7 advisory comparison (FAIL); Render image smoke (FAIL); API integration tests (release shard 3/7) (FAIL); API sync tests (release shard 6/7) (FAIL); run calculator tests (FAIL); corpus tests (FAIL); model-bump check (FAIL); browser accessibility tests (FAIL); browser WebKit smoke (FAIL); full browser E2E suite (INFRASTRUCTURE TIMEOUT)
Blocked gates: none
Accepted exceptions: none

## Checkpoint recovery

This is an incomplete checkpoint, not a current retained release report.
Gates not reached: none
Resume: pnpm run release:check:full -- --resume
Regenerate: pnpm run release:check:full
Retained report: release-check-report.md (left unchanged by this checkpoint).

Decision: NO-GO

