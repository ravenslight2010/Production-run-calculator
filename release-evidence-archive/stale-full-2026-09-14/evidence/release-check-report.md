# Release Check Report

Generated: 2026-09-02T18:59:50.968Z
Revision: f5e4b2e228582509fb4c434515592d776c20ac3d
Mode: full
Environment: local release validation
Commands: listed in the gate results table below
Evidence paths: release-evidence-full/ and retained files linked below

## Gate results

| Gate | Result | Elapsed | Command |
| --- | --- | ---: | --- |
| production dependency audit | FAIL | 11s | `pnpm run audit:prod` |
| generated API client freshness | PASS | 35s | `pnpm run check:api-generated` |
| shared library typechecks | NOT REACHED | 0s | `pnpm run typecheck:libs` |
| API server typecheck | NOT REACHED | 0s | `pnpm --filter @workspace/api-server run typecheck` |
| run calculator typecheck | NOT REACHED | 0s | `pnpm --filter @workspace/run-calculator run typecheck` |
| mockup sandbox typecheck | NOT REACHED | 0s | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| scripts typecheck | NOT REACHED | 0s | `pnpm --filter @workspace/scripts run typecheck` |
| recovery evidence audit | PASS | 11s | `pnpm run audit:recovery` |
| clean-start smoke | NOT REACHED | 0s | `pnpm run check:clean-start` |
| API unit tests (release shard 1/6) | NOT REACHED | 0s | `pnpm --filter @workspace/api-server run test:release:unit` |
| API integration tests (release shard 2/6) | NOT REACHED | 0s | `pnpm --filter @workspace/api-server run test:release:integration:1` |
| API integration tests (release shard 3/6) | NOT REACHED | 0s | `pnpm --filter @workspace/api-server run test:release:integration:2` |
| API integration tests (release shard 4/6) | NOT REACHED | 0s | `pnpm --filter @workspace/api-server run test:release:integration:3` |
| API sync tests (release shard 5/6) | NOT REACHED | 0s | `pnpm --filter @workspace/api-server run test:release:sync` |
| API sync SSE tests (release shard 6/6) | NOT REACHED | 0s | `pnpm --filter @workspace/api-server run test:release:sync-sse` |
| run calculator tests | NOT REACHED | 0s | `pnpm --filter @workspace/run-calculator run test` |
| production rules tests | NOT REACHED | 0s | `pnpm --filter @workspace/production-rules run test` |
| inventory math tests | NOT REACHED | 0s | `pnpm --filter @workspace/inventory-math run test` |
| spec reconcile tests | NOT REACHED | 0s | `pnpm --filter @workspace/spec-reconcile run test` |
| spec import tests | NOT REACHED | 0s | `pnpm --filter @workspace/spec-import run test` |
| scheduled recipe check tests | NOT REACHED | 0s | `pnpm --filter @workspace/scheduled-recipe-check run test` |
| spec export tests | NOT REACHED | 0s | `pnpm --filter @workspace/spec-export run test` |
| corpus tests | NOT REACHED | 0s | `pnpm --filter @workspace/corpus-harness run test` |
| model-bump check | NOT REACHED | 0s | `pnpm --filter @workspace/scripts run check-model-bump` |
| operational evidence check | NOT REACHED | 0s | `pnpm --filter @workspace/scripts run check-operational-skill-evidence` |
| onboarding bypass guard | NOT REACHED | 0s | `pnpm --filter @workspace/run-calculator run check:e2e:onboarding` |
| browser smoke tests | NOT REACHED | 0s | `pnpm --filter @workspace/run-calculator run test:e2e:smoke` |
| browser accessibility tests | NOT REACHED | 0s | `pnpm --filter @workspace/run-calculator run test:e2e:a11y` |
| full browser E2E suite | NOT REACHED | 0s | `pnpm --filter @workspace/run-calculator run test:e2e` |

## Timing

Total wall-clock: 35s

| Stage | Wall-clock |
| --- | ---: |
| prerequisites | 35s |

## Preview evidence

- Clean-start did not run; no preview evidence was produced.
- [Clean-start evidence](clean-start/clean-start-evidence.json)
- [Proxied browser result](clean-start/browser-result.json)
- [Preview screenshot](clean-start/preview-home.png)
- [API startup log](clean-start/startup-api.log)
- [Web startup log](clean-start/startup-web.log)
- [Mockup startup log](clean-start/startup-mockup.log)
- [Full browser report](browser-full/FINAL-REPORT.md)

## Browser duration review

Not evaluated in this release mode.

The browser result contains the retained web HTML response and the API health response observed through the web preview proxy.

## Operational review

Operational warnings: none
Failures or accepted exceptions: production dependency audit (FAIL)
Interrupted gates: none
Not-reached gates: shared library typechecks (NOT REACHED); API server typecheck (NOT REACHED); run calculator typecheck (NOT REACHED); mockup sandbox typecheck (NOT REACHED); scripts typecheck (NOT REACHED); clean-start smoke (NOT REACHED); API unit tests (release shard 1/6) (NOT REACHED); API integration tests (release shard 2/6) (NOT REACHED); API integration tests (release shard 3/6) (NOT REACHED); API integration tests (release shard 4/6) (NOT REACHED); API sync tests (release shard 5/6) (NOT REACHED); API sync SSE tests (release shard 6/6) (NOT REACHED); run calculator tests (NOT REACHED); production rules tests (NOT REACHED); inventory math tests (NOT REACHED); spec reconcile tests (NOT REACHED); spec import tests (NOT REACHED); scheduled recipe check tests (NOT REACHED); spec export tests (NOT REACHED); corpus tests (NOT REACHED); model-bump check (NOT REACHED); operational evidence check (NOT REACHED); onboarding bypass guard (NOT REACHED); browser smoke tests (NOT REACHED); browser accessibility tests (NOT REACHED); full browser E2E suite (NOT REACHED)
Accepted exceptions: none

Decision: NO-GO

