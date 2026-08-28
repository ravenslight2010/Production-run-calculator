# Release Check Report

Generated: 2026-08-28T10:53:30.227Z
Revision: fa1800fc807a3c39d12c1018af6624bd0548b9fe
Mode: full
Environment: local release validation
Commands: listed in the gate results table below
Evidence paths: release-evidence-full/ and retained files linked below

## Gate results

| Gate | Result | Elapsed | Command |
| --- | --- | ---: | --- |
| production dependency audit | PASS | 3s | `pnpm run audit:prod` |
| generated API client freshness | PASS | 25s | `pnpm run check:api-generated` |
| shared library typechecks | PASS | 7s | `pnpm run typecheck:libs` |
| API server typecheck | PASS | 38s | `pnpm --filter @workspace/api-server run typecheck` |
| run calculator typecheck | PASS | 62s | `pnpm --filter @workspace/run-calculator run typecheck` |
| mockup sandbox typecheck | PASS | 7s | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| scripts typecheck | PASS | 5s | `pnpm --filter @workspace/scripts run typecheck` |
| recovery evidence audit | PASS | 1s | `pnpm run audit:recovery` |
| clean-start smoke | PASS | 21s | `pnpm run check:clean-start` |
| API unit tests (release shard 1/6) | PASS | 65s | `pnpm --filter @workspace/api-server run test:release:unit` |
| API integration tests (release shard 2/6) | PASS | 226s | `pnpm --filter @workspace/api-server run test:release:integration:1` |
| API integration tests (release shard 3/6) | PASS | 165s | `pnpm --filter @workspace/api-server run test:release:integration:2` |
| API integration tests (release shard 4/6) | PASS | 433s | `pnpm --filter @workspace/api-server run test:release:integration:3` |
| API sync tests (release shard 5/6) | PASS | 28s | `pnpm --filter @workspace/api-server run test:release:sync` |
| API sync SSE tests (release shard 6/6) | PASS | 14s | `pnpm --filter @workspace/api-server run test:release:sync-sse` |
| run calculator tests | PASS | 232s | `pnpm --filter @workspace/run-calculator run test` |
| production rules tests | PASS | 1s | `pnpm --filter @workspace/production-rules run test` |
| inventory math tests | PASS | 1s | `pnpm --filter @workspace/inventory-math run test` |
| spec reconcile tests | PASS | 1s | `pnpm --filter @workspace/spec-reconcile run test` |
| scheduled recipe check tests | PASS | 1s | `pnpm --filter @workspace/scheduled-recipe-check run test` |
| spec export tests | PASS | 2s | `pnpm --filter @workspace/spec-export run test` |
| corpus tests | PASS | 6s | `pnpm --filter @workspace/corpus-harness run test` |
| model-bump check | PASS | 5s | `pnpm --filter @workspace/scripts run check-model-bump` |
| operational evidence check | PASS | 1s | `pnpm --filter @workspace/scripts run check-operational-skill-evidence` |
| browser smoke tests | FAIL | 53s | `pnpm --filter @workspace/run-calculator run test:e2e:smoke` |

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

