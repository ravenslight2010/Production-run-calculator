# Local staging verification — 2026-10-30

## Result and authority

**PASS** for the owner-approved isolated **local** sandbox and inventory
API/database audit. This is not a separately published Replit staging app.
The adjacent JSON is the sanitized, complete unattended-run report. Its source
content fingerprint binds the tested source, including workspace-only required
build inputs. Git binding is unavailable, so the recorded HEAD is context,
not an independently verified source-to-commit binding.

No shared-development or production database was queried, seeded, reset or
compared. Isolation is proved by the freshly initialized private PostgreSQL
cluster's independently read system identifier, matching live database identity,
unique stage database/ownership marker, stage app process/response marker,
copied build identity and served web hash, plus an allowlisted child environment.
No inherited production/development credentials were passed to the app.

## Checks

- **PASS** — 27 Node tests: unknown/development/production and mismatched app/DB
  identities rejected; unowned cleanup paths rejected; published-runtime and
  caller-supplied target overrides refused; inherited credentials excluded.
- **PASS** — `node scripts/src/isolated-staging.mjs check`: independently built
  app, new password-protected local cluster, synthetic manager/operator accounts,
  inventory mutation denials without inventory-table changes, successful manager
  adjustment, invalid-session/input no-write paths, restart/sign-in persistence,
  empty reset, credential rotation/reseed, and stopped-process/closed-port cleanup.
- **PASS** — `bash scripts/src/run-release-node.sh pnpm run typecheck`
  before syncing main. After sync, the 27 safety tests and complete isolated
  app build/API/database/reset/cleanup audit passed again; the adjacent JSON
  records that merged-source run.
- **PASS** — unauthenticated app screenshot displayed the sign-in landing page.
  Expected unauthenticated 401s were present; authenticated assertions come from
  the real API/database audit, not from the screenshot.
- **PASS** — `git diff --check`.
- **NOT REACHED** — published production, real-device behavior, browser offline
  recovery and external AI/provider services.

## Setup failures and repairs

The first attempt failed closed because PostgreSQL's textual `inet` included
`/32`; the live query now extracts the host explicitly. The next attempt failed
because the copied server could not resolve an external code dependency; the
private runtime now links only the installed product dependency directory.
Both failed attempts stopped and removed their clusters.

An initial repository typecheck raced with runtime-file cleanup and failed on
an already removed generated file. The complete typecheck passed after sandbox
cleanup. Run source scanners outside runtime creation/removal.

A job-stop tool then forcibly terminated a live diagnostic runner and its
descendants before its cleanup handler could finish. The owned stopped directory
was removed only after verifying its private owner marker, copied build identity,
stopped PostgreSQL state and closed app/database ports. The runner now persists
sanitized progress plus private resource identities, and provides an explicit
ownership-checked orphan cleanup command. Normal unattended cleanup passed
separately; a forced stop must never be counted as a passing normal exit.

The recovery exercise used a second fresh sandbox from the pre-sync source
fingerprint (`d833c9172177b63213ad2b83a41c3423`, API build
`app-build:2bc455ca-be1e-448d-9110-c9d837ec8338`). **PASS**: cleanup refused
while its runner was alive. After deliberately killing only that runner,
ownership-checked recovery stopped its app and PostgreSQL and removed its
fixtures. That interrupted run retains overall `NOT REACHED`, with
`auditStatus: PASS` and `forced-stop-owned-resource-recovery: PASS`; it is not
substituted for the unattended normal-exit report.

Final checks found no stage runtime directories or live staging processes.
The current production-source fingerprint still matches the successful report.

## Handoff

Use [the runbook](../isolated-staging.md) to recreate or reset the sandbox.
Successful cleanup removes accounts, sessions, database, app process and private
runtime files; only sanitized reports remain.

Task #3728's exact published-target acceptance, ownership and status are
unchanged. These local results do **not** complete its production verification.
