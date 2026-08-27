# Release Check Report

Generated: 2026-08-27T11:18:16.873Z
Revision: f4056aa5cec5945dce2fda92b3ef933c6026e4ea
Mode: full
Environment: local release validation
Commands: listed in the gate results table below
Evidence paths: release-evidence-full/ and retained files linked below

## Gate results

| Gate | Result | Elapsed | Command |
| --- | --- | ---: | --- |
| production dependency audit | PASS | 1s | `pnpm run audit:prod` |
| generated API client freshness | PASS | 16s | `pnpm run check:api-generated` |
| shared library typechecks | PASS | 1s | `pnpm run typecheck:libs` |
| API server typecheck | PASS | 24s | `pnpm --filter @workspace/api-server run typecheck` |
| run calculator typecheck | PASS | 86s | `pnpm --filter @workspace/run-calculator run typecheck` |
| mockup sandbox typecheck | PASS | 11s | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| scripts typecheck | PASS | 5s | `pnpm --filter @workspace/scripts run typecheck` |
| recovery evidence audit | PASS | 1s | `pnpm run audit:recovery` |
| clean-start smoke | PASS | 23s | `pnpm run check:clean-start` |
| API unit tests (release shard 1/6) | PASS | 56s | `pnpm --filter @workspace/api-server run test:release:unit` |
| API integration tests (release shard 2/6) | PASS | 299s | `pnpm --filter @workspace/api-server run test:release:integration:1` |
| API integration tests (release shard 3/6) | PASS | 190s | `pnpm --filter @workspace/api-server run test:release:integration:2` |
| API integration tests (release shard 4/6) | INFRASTRUCTURE TIMEOUT | 480s | `pnpm --filter @workspace/api-server run test:release:integration:3` |
| API sync tests (release shard 5/6) | PASS | 74s | `pnpm --filter @workspace/api-server run test:release:sync` |
| API sync SSE tests (release shard 6/6) | PASS | 19s | `pnpm --filter @workspace/api-server run test:release:sync-sse` |

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

