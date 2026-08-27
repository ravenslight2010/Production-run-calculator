# Release Check Report

Generated: 2026-08-27T15:55:10.342Z
Revision: d1444ef243e9882c6f609cf26778e929c64b2cab
Mode: full
Environment: local release validation
Commands: listed in the gate results table below
Evidence paths: release-evidence-full/ and retained files linked below

## Gate results

| Gate | Result | Elapsed | Command |
| --- | --- | ---: | --- |
| production dependency audit | PASS | 1s | `pnpm run audit:prod` |
| generated API client freshness | PASS | 13s | `pnpm run check:api-generated` |
| shared library typechecks | PASS | 2s | `pnpm run typecheck:libs` |
| API server typecheck | PASS | 17s | `pnpm --filter @workspace/api-server run typecheck` |
| run calculator typecheck | PASS | 41s | `pnpm --filter @workspace/run-calculator run typecheck` |
| mockup sandbox typecheck | PASS | 5s | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| scripts typecheck | PASS | 3s | `pnpm --filter @workspace/scripts run typecheck` |
| recovery evidence audit | PASS | 1s | `pnpm run audit:recovery` |
| clean-start smoke | PASS | 22s | `pnpm run check:clean-start` |
| API unit tests (release shard 1/6) | PASS | 43s | `pnpm --filter @workspace/api-server run test:release:unit` |
| API integration tests (release shard 2/6) | PASS | 141s | `pnpm --filter @workspace/api-server run test:release:integration:1` |
| API integration tests (release shard 3/6) | PASS | 86s | `pnpm --filter @workspace/api-server run test:release:integration:2` |
| API integration tests (release shard 4/6) | PASS | 222s | `pnpm --filter @workspace/api-server run test:release:integration:3` |
| API sync tests (release shard 5/6) | PASS | 21s | `pnpm --filter @workspace/api-server run test:release:sync` |
| API sync SSE tests (release shard 6/6) | PASS | 13s | `pnpm --filter @workspace/api-server run test:release:sync-sse` |
| run calculator tests | PASS | 214s | `pnpm --filter @workspace/run-calculator run test` |
| production rules tests | PASS | 3s | `pnpm --filter @workspace/production-rules run test` |
| inventory math tests | PASS | 1s | `pnpm --filter @workspace/inventory-math run test` |
| spec reconcile tests | PASS | 1s | `pnpm --filter @workspace/spec-reconcile run test` |
| scheduled recipe check tests | PASS | 1s | `pnpm --filter @workspace/scheduled-recipe-check run test` |
| spec export tests | PASS | 1s | `pnpm --filter @workspace/spec-export run test` |
| corpus tests | PASS | 5s | `pnpm --filter @workspace/corpus-harness run test` |
| model-bump check | PASS | 3s | `pnpm --filter @workspace/scripts run check-model-bump` |
| operational evidence check | PASS | 1s | `pnpm --filter @workspace/scripts run check-operational-skill-evidence` |
| browser smoke tests | PASS | 30s | `pnpm --filter @workspace/run-calculator run test:e2e:smoke` |
| browser accessibility tests | FAIL | 48s | `pnpm --filter @workspace/run-calculator run test:e2e:a11y` |
| full browser E2E suite | FAIL | 1215s | `pnpm --filter @workspace/run-calculator run test:e2e` |

## Preview evidence

- Clean-start: **PASS**
- [Clean-start evidence](clean-start/clean-start-evidence.json)
- [Proxied browser result](clean-start/browser-result.json)
- [Preview screenshot](clean-start/preview-home.png)
- [API startup log](clean-start/startup-api.log)
- [Web startup log](clean-start/startup-web.log)
- [Mockup startup log](clean-start/startup-mockup.log)
- [Full browser report](browser-full/FINAL-REPORT.md)

## Browser duration review

No meaningful per-file duration regressions detected.

The browser result contains the retained web HTML response and the API health response observed through the web preview proxy.

## Operational review

Operational warnings: none
Accepted exceptions: none

Decision: NO-GO
Failures or accepted exceptions: browser accessibility tests failed on insufficient .text-destructive contrast (1.7:1 vs 4.5:1); full browser E2E also failed five manager queue-history cases and two Run Insights cases; see browser-full/FINAL-REPORT.md.

