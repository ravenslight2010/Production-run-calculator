# Release Check Report

Generated: 2026-08-27T21:16:37.788Z
Revision: 800735ba492e586e318328fcedb15c91f7088055
Mode: full
Environment: local release validation
Commands: listed in the gate results table below
Evidence paths: release-evidence-full/ and retained files linked below

## Gate results

| Gate | Result | Elapsed | Command |
| --- | --- | ---: | --- |
| production dependency audit | PASS | 1s | `pnpm run audit:prod` |
| generated API client freshness | PASS | 20s | `pnpm run check:api-generated` |
| shared library typechecks | PASS | 1s | `pnpm run typecheck:libs` |
| API server typecheck | PASS | 41s | `pnpm --filter @workspace/api-server run typecheck` |
| run calculator typecheck | PASS | 78s | `pnpm --filter @workspace/run-calculator run typecheck` |
| mockup sandbox typecheck | PASS | 6s | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| scripts typecheck | PASS | 4s | `pnpm --filter @workspace/scripts run typecheck` |
| recovery evidence audit | PASS | 1s | `pnpm run audit:recovery` |
| clean-start smoke | PASS | 26s | `pnpm run check:clean-start` |
| API unit tests (release shard 1/6) | PASS | 71s | `pnpm --filter @workspace/api-server run test:release:unit` |
| API integration tests (release shard 2/6) | PASS | 314s | `pnpm --filter @workspace/api-server run test:release:integration:1` |
| API integration tests (release shard 3/6) | PASS | 182s | `pnpm --filter @workspace/api-server run test:release:integration:2` |
| API integration tests (release shard 4/6) | PASS | 308s | `pnpm --filter @workspace/api-server run test:release:integration:3` |
| API sync tests (release shard 5/6) | PASS | 25s | `pnpm --filter @workspace/api-server run test:release:sync` |
| API sync SSE tests (release shard 6/6) | PASS | 17s | `pnpm --filter @workspace/api-server run test:release:sync-sse` |
| run calculator tests | PASS | 322s | `pnpm --filter @workspace/run-calculator run test` |
| production rules tests | PASS | 4s | `pnpm --filter @workspace/production-rules run test` |
| inventory math tests | PASS | 5s | `pnpm --filter @workspace/inventory-math run test` |
| spec reconcile tests | PASS | 4s | `pnpm --filter @workspace/spec-reconcile run test` |
| scheduled recipe check tests | PASS | 3s | `pnpm --filter @workspace/scheduled-recipe-check run test` |
| spec export tests | PASS | 4s | `pnpm --filter @workspace/spec-export run test` |
| corpus tests | PASS | 14s | `pnpm --filter @workspace/corpus-harness run test` |
| model-bump check | PASS | 14s | `pnpm --filter @workspace/scripts run check-model-bump` |
| operational evidence check | PASS | 2s | `pnpm --filter @workspace/scripts run check-operational-skill-evidence` |
| browser smoke tests | FAIL | 170s | `pnpm --filter @workspace/run-calculator run test:e2e:smoke` |

## Preview evidence

- Clean-start: **PASS**
- [Clean-start evidence](clean-start/clean-start-evidence.json)
- [Proxied browser result](clean-start/browser-result.json)
- [Preview screenshot](clean-start/preview-home.png)
- [API startup log](clean-start/startup-api.log)
- [Web startup log](clean-start/startup-web.log)
- [Mockup startup log](clean-start/startup-mockup.log)
- Full browser report: not produced

## Browser duration review

Not evaluated in this release mode.

The browser result contains the retained web HTML response and the API health response observed through the web preview proxy.

## Operational review

Operational warnings: none
Accepted exceptions: none

Decision: NO-GO
Failures or accepted exceptions: none

