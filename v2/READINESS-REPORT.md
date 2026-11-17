# V2 readiness report

**Captured:** 2026-11-17, America/Chicago  
**Environment:** private development preview; V2 data in the isolated `v2`
schema of the project database  
**Recommendation:** **NO-GO for production publication or switching the live app**

## Why production remains blocked

- The production database role is unknown. The development API and worker were
  observed using a superuser role, which conflicts with the general managed
  database guidance. A disposable test separately proves the API can run using
  a restricted role, but that does not establish the published role.
- V2 database functions, triggers, and grants have not been installed and
  verified in the production database. No production database query or change
  was made.
- Production has not been published or cut over. The deployment guard remains
  enabled; do not bypass it.
- Physical-device checks and the manager workflow in the live private preview
  have not been completed.
- V1 setup/master data and staff-account transfer have not been performed.
  Staff must sign in fresh in V2; no run history or V1 stock should be carried
  over. Opening inventory requires a new physical count.

## Evidence summary

| Area | Result | Scope |
| --- | --- | --- |
| V2 unit and API tests | **PASS** | 129 tests |
| V2 station browser tests | **PASS** | 7 Chromium tests; mocked API, desktop and phone-sized viewports |
| Authenticated manager inventory journey | **PASS** | Real V2 server and Chromium against a disposable PostgreSQL cluster: product import, two reviewed/applied physical counts, production warehouse selection, receipt, transfer, and reload persistence |
| PostgreSQL and role checks | **PASS** | Disposable local cluster; manager/operator authorization, run/station conflicts, inventory ledger, and run-to-inventory checks |
| V2 build/syntax | **PASS** | Server and web modules |
| Private preview health | **PASS** | `/healthz` returned `ok`; station worker active, zero consecutive failures |
| First-manager bootstrap | **PASS** | Setup is closed; exactly one enabled manager; bootstrap secret removed |
| Owner sign-in | **PASS** | Owner confirmed sign-out followed by normal sign-in |
| Worker restart | **PASS** | Existing pilot evidence confirms supervised restart and recovered health |
| Live-preview authenticated manager screens | **NOT RUN** | Agent's preview browser has no owner session; isolated authenticated browser test is separate |
| Physical Android/iOS operation | **NOT RUN** | No connected device test environment |
| Safari/WebKit | **NOT RUN** | Chromium evidence only |
| Production database and publish | **BLOCKED** | Role and SQL-object setup remain unresolved; guard remains active |

## Data and safety boundary

- The manager browser journey uses only a disposable local PostgreSQL cluster.
  The test cluster is removed after the run.
- The V2 development schema still has one enabled manager and no run or
  inventory-balance rows. No synthetic test inventory was written to the
  project database.
- V1 schemas, records, sessions, and production data were not read or changed.
- No publication, production cutover, or production data migration occurred.

## Next gates

1. Resolve and verify the production app's database role and supported
   installation path for V2 functions, triggers, and grants.
2. Complete a live-preview manager walkthrough and physical Android/tablet checks
   with synthetic records; record those separately from Chromium emulation.
3. Prepare the separately approved V1 setup/master-data and staff-account
   transfer, with fresh V2 sign-in and a new physical inventory count.
4. Only after those gates are reviewed, ask the owner to authorize and initiate
   publication. Verify the serving revision, API/worker health, and a synthetic
   run before any production use.

## Open gates: owner and next action

- **Production database role and SQL objects — owner: project owner and Replit
  database operator.** Confirm the actual app role without sharing connection
  details, then review and apply the V2 functions, triggers, and grants through
  the supported production database process. Keep publication blocked until
  verified.
- **Live-preview manager walkthrough — owner: project owner.** Use the existing
  signed-in private preview with synthetic records to check setup imports,
  opening counts, warehouse operations, and reload persistence. The agent's
  preview browser has no owner session.
- **Physical Android/tablet checks — owner: project owner or floor tester.**
  Exercise wake/reconnect and run/station controls on the target device, and
  record the browser/device and result. Current Chromium emulation is not a
  substitute.
- **V1 cutover data — owner: project owner and migration operator.** Approve a
  separate, limited transfer plan for setup/master data and staff identities/
  roles. Do not copy historical runs, V1 stock, live sessions, or reset tokens.

## V1 setup and staff transfer rehearsal

The synthetic V2-side rehearsal and schema-based field allowlist are recorded
in [CUTOVER-DATA-TRANSFER.md](./CUTOVER-DATA-TRANSFER.md). The disposable
database test verifies approved-field validation, synthetic products/recipe/
setup references, duplicate handling, same-request retries, reverse-order
setup undo, disabled staff handling, and a fresh V2 session. The existing
authenticated integration also verifies V2 password hashing and sign-in for a
new synthetic operator.

**No V1 rows were extracted or transferred.** The archived V1 tree contains
application source, not a database snapshot, and no authorized read-only V1
source path is configured. The V2 development database is not a V1 source.
Actual source counts, role capability parity, row-level relationships, and
real duplicate cases remain unverified. No production read/export/write was
authorized or performed. The transfer is not ready for real cutover until the
owner separately identifies and authorizes a read-only source path, resolves
unmapped master-data families, reviews the actual mapping, and separately
approves any production destination write.
