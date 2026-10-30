# Isolated local staging sandbox

## Scope and platform boundary

The owner approved a testing sandbox rather than granting a separate Replit
project. This runner creates a **local app instance and a new PostgreSQL
cluster/database**, not the app's built-in public sandbox account and not a
separately published Replit staging deployment. Shared development and published
production are never accepted as target substitutes.

Official Replit documentation confirms that artifacts in one project share
backend/database/settings. Independent publishing requires a separate project:

- https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects
- https://docs.replit.com/features/data-and-storage/development-and-production
- https://docs.replit.com/teams/identity-and-access-management/manually-copy-projects
- https://docs.replit.com/features/agent/app-testing

App Testing alone is not evidence of an independently disposable database.
Do not point this runner at an existing database or deploy its stage credentials.

## Run

From the repository root, with the installed Node/pnpm/PostgreSQL tools:

```sh
node --test scripts/src/staging/*.test.mjs
node scripts/src/isolated-staging.mjs check
node scripts/src/isolated-staging.mjs serve
```

Use the repository's pinned Node runner around these commands if the current
shell does not have the pinned Node version. `check` builds both app surfaces,
seeds synthetic manager/operator accounts, verifies inventory authorization and
restart persistence, resets to an empty database, reseeds, and cleans up.
`serve` does the same verification and then keeps the loopback app available for
further audits. Enter `r` to reset; Ctrl-C stops it and deletes its fixtures,
credentials, app process and cluster. The same command recreates a fresh sandbox.
No fixture survives the runner's normal exit. Do not force-kill the runner.

For automation, send SIGTERM **only to the printed runner PID**, not to its
entire process tree. Some job-stop tools forcibly kill all descendants without
allowing cleanup. If this happens, use:

```sh
node scripts/src/staging/cleanup.mjs .local/isolated-staging/run-XXXXXX
```

Use only the exact private directory printed by that run. Recovery refuses a
live runner, arbitrary paths, missing identity records and mismatched app or
cluster identities. It removes only the independently verified stopped/owned
stage resources. A forced stop is not reported as a normal passing run.
Run repository-wide source scanners after stopping staging, not concurrently
with temporary runtime files being created or removed.

The printed private `access.json` path contains stage-only generated credentials.
Read it programmatically for authorized tests; never paste its contents into
chat, reports, screenshots or version control. Reset rotates credentials and
sessions. It is removed on cleanup. No production records or credentials are
copied; executable product code and web assets come from the current source.

## Safety and identity

- No target URL/database overrides are accepted. Each run mints a new stage ID,
  database name, private directory, cluster system identifier and loopback ports.
- Child environments are allowlisted, excluding inherited database credentials,
  manager passwords, session keys, AI keys and deployment markers.
- A private ownership record, independent `pg_controldata` identity, live
  PostgreSQL identity/owner/port/database and database ownership comment must
  agree before schema setup, seed, API mutations or reset.
- Before startup, the copied API's identity and executable hash are verified.
  Once started, its served `/api/build-info`, unique process response marker and
  living owned process must agree as well. Redirects are forbidden.
- Both API and PostgreSQL bind loopback only. The networking preload changes only
  the test process's bind address and adds its stage marker; product routes and
  authorization remain unchanged.
- PostgreSQL TCP access uses a fresh stage-only SCRAM password. Local socket
  access is confined to the private runner directory.
- Local builds intentionally identify as `development`; that describes the
  build procedure, **not** permission to use shared development as a target.
- Cleanup verifies cluster ownership and stopped state before deleting its
  private directory. Ambiguous identity fails closed and retains the directory
  for authorized inspection rather than deleting an unknown resource.

## Evidence and limits

Sanitized JSON reports live in ignored `.local/isolated-staging/reports/`.
They record timestamps, source HEAD and content fingerprint, served build
identity, stage app/cluster/database identity, role, check and result. Source
HEAD is context only when `gitBinding` is unavailable: the content fingerprint
identifies uncommitted source precisely. Credentials are deleted during cleanup;
successful runs also delete private logs. Failed-run logs are retained privately
for diagnosis and must not be shared without review. Reports contain neither.

The audit checks five manager-only denials with unchanged inventory-table
digests, invalid-session and invalid-input no-write paths, a manager adjustment
and its database quantity, process restart, sign-in recovery, persisted quantity,
continued operator denial, empty reset and synthetic reseed.

These are **local API/database results**, not proof of browser offline recovery,
physical-device behavior, provider services, or the exact published production
runtime. Task #3728 retains its original published-target acceptance and remains
unverified unless separately established. A separately published staging app
still requires a separately authorized Replit project.
