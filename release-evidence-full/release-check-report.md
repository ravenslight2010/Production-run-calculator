# Release Check Report

Generated: 2026-08-26T16:08:13.829Z
Revision: bb47c12669bb82b9f41e37810e8cbb5b00ea5b09
Mode: full
Environment: local release validation
Commands: listed in the gate results table below
Evidence paths: release-evidence-full/ and retained files linked below

## Gate results

| Gate | Result | Elapsed | Command |
| --- | --- | ---: | --- |
| production dependency audit | PASS | 1s | `pnpm run audit:prod` |
| generated API client freshness | PASS | 14s | `pnpm run check:api-generated` |
| shared library typechecks | PASS | 2s | `pnpm run typecheck:libs` |
| API server typecheck | PASS | 15s | `pnpm --filter @workspace/api-server run typecheck` |
| run calculator typecheck | PASS | 41s | `pnpm --filter @workspace/run-calculator run typecheck` |
| mockup sandbox typecheck | PASS | 5s | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| scripts typecheck | PASS | 3s | `pnpm --filter @workspace/scripts run typecheck` |
| recovery evidence audit | PASS | 1s | `pnpm run audit:recovery` |
| clean-start smoke | PASS | 27s | `pnpm run check:clean-start` |
| API unit tests (release shard 1/6) | PASS | 46s | `pnpm --filter @workspace/api-server run test:release:unit` |
| API integration tests (release shard 2/6) | PASS | 97s | `pnpm --filter @workspace/api-server run test:release:integration:1` |
| API integration tests (release shard 3/6) | PASS | 77s | `pnpm --filter @workspace/api-server run test:release:integration:2` |
| API integration tests (release shard 4/6) | PASS | 245s | `pnpm --filter @workspace/api-server run test:release:integration:3` |
| API sync tests (release shard 5/6) | PASS | 32s | `pnpm --filter @workspace/api-server run test:release:sync` |
| API sync SSE tests (release shard 6/6) | PASS | 12s | `pnpm --filter @workspace/api-server run test:release:sync-sse` |
| run calculator tests | PASS | 251s | `pnpm --filter @workspace/run-calculator run test` |
| production rules tests | PASS | 1s | `pnpm --filter @workspace/production-rules run test` |
| inventory math tests | PASS | 1s | `pnpm --filter @workspace/inventory-math run test` |
| spec reconcile tests | PASS | 1s | `pnpm --filter @workspace/spec-reconcile run test` |
| scheduled recipe check tests | PASS | 1s | `pnpm --filter @workspace/scheduled-recipe-check run test` |
| spec export tests | PASS | 2s | `pnpm --filter @workspace/spec-export run test` |
| corpus tests | PASS | 5s | `pnpm --filter @workspace/corpus-harness run test` |
| model-bump check | PASS | 5s | `pnpm --filter @workspace/scripts run check-model-bump` |
| operational evidence check | PASS | 1s | `pnpm --filter @workspace/scripts run check-operational-skill-evidence` |
| browser smoke tests | PASS | 44s | `pnpm --filter @workspace/run-calculator run test:e2e:smoke` |
| browser accessibility tests | PASS | 72s | `pnpm --filter @workspace/run-calculator run test:e2e:a11y` |
| full browser E2E suite | FAIL | 1174s | `pnpm --filter @workspace/run-calculator run test:e2e` |

## Preview evidence

- Clean-start: **PASS**
- [Clean-start evidence](clean-start/clean-start-evidence.json)
- [Proxied browser result](clean-start/browser-result.json)
- [Preview screenshot](clean-start/preview-home.png)
- [API startup log](clean-start/startup-api.log)
- [Web startup log](clean-start/startup-web.log)
- [Mockup startup log](clean-start/startup-mockup.log)
- [Full browser report](browser-full/FINAL-REPORT.md)

## Release assessment

- App health: **PASS** — artifact-managed API and web workflows were running; clean-start and proxied preview evidence passed.
- Release evidence: **FAIL** — generated client, typechecks, six API shards, package tests, recovery, clean-start, smoke, accessibility, PWA, sync, warehouse, and operational evidence gates passed; the terminal full browser suite failed with 89 passed, 4 skipped physical-device cases, 5 failed, and 1 serial visual case not run.
- Security readiness: **PASS** — production dependency audit passed; the shipping review found no unresolved high/critical dependency, authorization, secret, or sensitive-log blocker.
- Operational readiness: **PASS** — existing marker-guarded heals were observed only on the disposable validation database; no new or changed heal was found in this revision; no schema change or destructive schema operation was run; sync/reset/SSE and recovery coverage passed; destructive browser tests used the explicit disposable E2E controls and dedicated clean-start ports; rollback remains through the existing checkpoint/Git recovery path.
- Accepted exceptions: **none** — skipped physical-device cases are recorded as unavailable coverage, not waivers of the required browser failures.

## Operational review

Operational warnings: none
Accepted exceptions: none

Decision: NO-GO
Failures or accepted exceptions: `manager-action-queue-stale.spec.ts:169`; `mix-plan.spec.ts:680`, `1206`, and `2496`; `visual-regression.spec.ts:116`. Release owner must resolve or validly re-evaluate these browser failures and regenerate revision-bound evidence before publish.
