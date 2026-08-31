# Release Check Report

Generated: 2026-08-31T17:18:35.598Z
Revision: dc1cbb8b9b8029d689a904be14af1e81d5f22466
Mode: full
Environment: local release validation
Commands: listed in the gate results table below
Evidence paths: release-evidence-full/ and retained files linked below

## Gate results

| Gate | Result | Elapsed | Command |
| --- | --- | ---: | --- |
| production dependency audit | PASS | 1s | `pnpm run audit:prod` |
| generated API client freshness | PASS | 18s | `pnpm run check:api-generated` |
| shared library typechecks | PASS | 1s | `pnpm run typecheck:libs` |
| API server typecheck | PASS | 19s | `pnpm --filter @workspace/api-server run typecheck` |
| run calculator typecheck | PASS | 38s | `pnpm --filter @workspace/run-calculator run typecheck` |
| mockup sandbox typecheck | PASS | 10s | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| scripts typecheck | PASS | 3s | `pnpm --filter @workspace/scripts run typecheck` |
| recovery evidence audit | PASS | 1s | `pnpm run audit:recovery` |
| clean-start smoke | PASS | 20s | `pnpm run check:clean-start` |
| API unit tests (release shard 1/6) | PASS | 52s | `pnpm --filter @workspace/api-server run test:release:unit` |
| API integration tests (release shard 2/6) | PASS | 123s | `pnpm --filter @workspace/api-server run test:release:integration:1` |
| API integration tests (release shard 3/6) | PASS | 89s | `pnpm --filter @workspace/api-server run test:release:integration:2` |
| API integration tests (release shard 4/6) | PASS | 226s | `pnpm --filter @workspace/api-server run test:release:integration:3` |
| API sync tests (release shard 5/6) | PASS | 24s | `pnpm --filter @workspace/api-server run test:release:sync` |
| API sync SSE tests (release shard 6/6) | PASS | 19s | `pnpm --filter @workspace/api-server run test:release:sync-sse` |
| run calculator tests | PASS | 261s | `pnpm --filter @workspace/run-calculator run test` |
| production rules tests | PASS | 4s | `pnpm --filter @workspace/production-rules run test` |
| inventory math tests | PASS | 1s | `pnpm --filter @workspace/inventory-math run test` |
| spec reconcile tests | PASS | 1s | `pnpm --filter @workspace/spec-reconcile run test` |
| scheduled recipe check tests | PASS | 1s | `pnpm --filter @workspace/scheduled-recipe-check run test` |
| spec export tests | PASS | 1s | `pnpm --filter @workspace/spec-export run test` |
| corpus tests | PASS | 5s | `pnpm --filter @workspace/corpus-harness run test` |
| model-bump check | PASS | 4s | `pnpm --filter @workspace/scripts run check-model-bump` |
| operational evidence check | PASS | 1s | `pnpm --filter @workspace/scripts run check-operational-skill-evidence` |
| browser smoke tests | PASS | 36s | `pnpm --filter @workspace/run-calculator run test:e2e:smoke` |
| browser accessibility tests | PASS | 73s | `pnpm --filter @workspace/run-calculator run test:e2e:a11y` |
| full browser E2E suite | PASS | 1213s | `pnpm --filter @workspace/run-calculator run test:e2e` |

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

Decision: GO
Failures or accepted exceptions: none

