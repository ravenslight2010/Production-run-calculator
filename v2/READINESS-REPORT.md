# V2 readiness report

- **Captured:** 2026-11-18, America/Chicago
- **Environment:** private development preview; V2 data in the isolated `v2`
  schema of the project database, with separate read-only production metadata
  and aggregate source evidence
- **Recommendation:** **NO-GO for production publication or operational use**

## Why production remains blocked

- The production read-only SQL identity is `neondb_owner`, not a superuser, but
  it has elevated role-creation, database-creation, and RLS-bypass attributes.
  The owner accepted this role for a private pilot. The actual API and worker
  runtime identity remains unverified until the private app starts.
- Production contains the expected V2 schema objects: 21 tables, 49 functions,
  and 7 triggers. Function definitions, trigger definitions, and table/index/
  constraint fingerprints match development. No PUBLIC schema or table access
  is granted. PUBLIC has default EXECUTE ACLs on the 49 functions, but without
  schema USAGE those functions are not directly callable by PUBLIC; this
  remains a hardening item to review before broader access.
- The two custom V1 role equivalents are seeded only in V2 development.
  Production role rows are not yet present or approved for transfer; Publish
  does not copy development rows as production data.
- Production has no V2 staff accounts, manager, sessions, bootstrap marker,
  runs, or inventory balances. The one-time manager bootstrap secret is absent.
- Production is unpublished. The V2 launcher is configured, but the Networking
  tool still shows extra external port mappings that conflict with the
  single-port deployment requirement.
- Physical-device checks and the manager workflow in the live private preview
  have not been completed.
- V1 setup/master data and staff-account transfer have not been performed.
  Staff must sign in fresh in V2; no run history or V1 stock should be carried
  over. Opening inventory requires a new physical count.

## Evidence summary

| Area | Result | Scope |
| --- | --- | --- |
| Project-level configuration tests | **PARTIAL** | 136 passed; one deployment-port assertion failed because five extra external mappings remain |
| V2 package unit and API tests | **PASS** | 142 tests |
| V2 browser tests | **PASS** | 8 Chromium tests; includes manager setup catalog stage/review/apply/undo at desktop, phone, and tablet portrait/landscape emulated viewports |
| Authenticated manager inventory journey | **PASS** | Real V2 server and Chromium against a disposable PostgreSQL cluster: product import, two reviewed/applied physical counts, production warehouse selection, receipt, transfer, and reload persistence |
| PostgreSQL and role checks | **PASS** | Disposable local cluster; manager/operator authorization, run/station conflicts, inventory ledger, run-to-inventory checks, and approved setup catalog links/retries/rollback/undo/facility fencing |
| Setup-catalog manager UI and API | **PASS** | Chromium browser journey uses a mocked API; actual manager-only API and SQL lifecycle are separately exercised against disposable PostgreSQL |
| V2 build/syntax | **PASS** | Server and web modules |
| V2 production dependency audit | **PASS** | No known high/critical vulnerabilities in `@workspace/lucia-v2` production dependencies |
| Private preview health | **PASS** | Dev-domain `/healthz` returned 200 with API and worker active; sign-in page rendered at 402×874 |
| First-manager bootstrap | **PASS** | Setup is closed; exactly one enabled manager; bootstrap secret removed |
| Owner sign-in | **PASS** | Owner confirmed sign-out followed by normal sign-in |
| Worker restart | **PASS** | Existing pilot evidence confirms supervised restart and recovered health |
| V2 staff role equivalents | **PASS** | `warehouse` and `qc-manager` are seeded in the V2 development schema with the reviewed least-privilege capability sets; disposable PostgreSQL role/session checks pass |
| Live-preview authenticated manager screens | **NOT RUN** | Agent's preview browser has no owner session; isolated authenticated browser test is separate |
| Physical Android/iOS operation | **NOT RUN** | No connected device test environment |
| Safari/WebKit | **BLOCKED** | WebKit download succeeded, but the container lacks runtime libraries needed to launch it |
| V1 source review | **PARTIAL** | Authorized production read-only audit returned aggregate counts only; exact database revision is unknown; no V1 rows were exported or imported |
| Production objects | **PASS (metadata)** | All 49 function definitions, 7 triggers, and 324 table/constraint/index fingerprints match development |
| Production runtime role | **BLOCKED** | Read-only SQL console identity is known; API/worker identity awaits startup logs |
| Private publish | **BLOCKED** | Extra external ports remain in Networking; no production manager/bootstrap code is configured |
| Production database and publish | **BLOCKED** | Runtime role and port configuration remain unresolved; publication guard remains active |

## Data and safety boundary

- The manager browser journey uses only a disposable local PostgreSQL cluster.
  The test cluster is removed after the run.
- The V2 development schema still has one enabled manager and no run or
  inventory-balance rows. No synthetic test inventory was written to the
  project database.
- A limited read-only audit of the owner-identified V1 production source was
  performed for the allowlisted setup/staff scope. Only aggregates, role parity
  results, category/unit counts, profile field-key frequencies, and
  names/categories-only ingredient-reference match counts were retained.
  No individual usernames, account IDs, recipe/formula rows, profile values,
  ingredient IDs, allergen fields, credentials, sessions, reset tokens, runs,
  or inventory balances/movements were returned or saved.
- Production reads were limited to schema/object metadata and aggregate counts;
  no business rows or credentials were returned. No production data was written,
  no publication occurred, and no V1 data was transferred.

## Next gates

1. In **Tools → Networking**, remove the external mappings for ports 5173, 8081,
   4200, 3001, and 5000; keep only external port 80 for the API on local port
   5000. The controlled `.replit` replacement does not reliably persist
   Networking-managed mappings.
2. Configure a fresh one-time production manager bootstrap code through Replit
   Secrets, create the first V2 manager after private publication, then remove
   the code. The production database currently has no staff accounts.
3. Set the deployment to private, publish it, and verify the serving revision,
   actual API/worker DB role logs, `/healthz`, sign-in, and a synthetic run
   lifecycle before operational use.
4. Complete manager workflows and physical Android/tablet checks with synthetic
   records. Review and apply any separately approved V1 setup/staff transfer
   only after the destination mappings are accepted; opening inventory requires
   a fresh physical count.
## Open gates: owner and next action

- **Networking port mappings — owner: project owner.** Use Tools → Networking to
  remove the five extra external mappings. Confirm only the local 5000 → external
  80 mapping remains before publishing.
- **Production runtime identity — owner: project owner and Replit database
  operator.** After the private app starts, compare the API and worker's
  structured role logs with the approved private-pilot database role. Do not
  share database URLs or credentials.
- **First production manager — owner: project owner.** Set a fresh one-time
  bootstrap secret securely, create the first manager through the existing
  guarded setup, and remove the secret immediately afterward.
- **Live-preview manager walkthrough — owner: project owner.** Use the existing
  signed-in private preview with synthetic records to check setup imports,
  opening counts, warehouse operations, and reload persistence. The agent's
  preview browser has no owner session.
- **Physical Android/tablet checks — owner: project owner or floor tester.**
  Exercise wake/reconnect and run/station controls on the target device, and
  record the browser/device and result. Current Chromium emulation is not a
  substitute.
- **Production function ACL hardening — owner: project owner and database
  operator.** Review revoking default PUBLIC EXECUTE on V2 functions before
  broadening access; the current schema has no PUBLIC USAGE or table grants.
- **V1 cutover data — owner: project owner and migration operator.** The
  approved setup-family targets and manager review workflow are implemented.
  A limited aggregate source review is recorded in
  [CUTOVER-DATA-TRANSFER.md](./CUTOVER-DATA-TRANSFER.md), but row-level mappings
  and imports are not approved. Review the product, recipe, setup, and role
  mappings, identify an authorized read-only source path for any future row-level
  review, and approve a destination before transfer. `qc-manager` behavior still
  depends on QC and manager-history work. Do not copy historical runs, V1 stock,
  live sessions, or reset tokens; separately approve any production write.

## V1 setup and staff transfer rehearsal

The synthetic V2-side rehearsal and schema-based field allowlists are recorded
in [CUTOVER-DATA-TRANSFER.md](./CUTOVER-DATA-TRANSFER.md). The disposable
database tests verify products/recipe/setup references, the approved setup
families, explicit ingredient and die links, unscoped legacy flavors,
case-insensitive duplicates, same-request retries, rollback, guarded undo,
facility scope, disabled staff handling, and a fresh V2 session. The
authenticated integration also verifies V2 password hashing and sign-in for a
new synthetic operator. A separate emulated Chromium manager journey verifies
the setup-catalog UI; it is not a live-preview or physical-device test.

**No V1 rows were exported, imported, or changed.** An owner-authorized,
read-only production-source audit returned aggregate table counts, duplicate
checks, role-capability parity, and profile field-key frequencies. Its exact
database revision is unknown; individual staff identities, formula/profile
payloads, credentials, active runs, and inventory stock were not returned or
retained. The audited source counts and unresolved mappings are recorded in
[CUTOVER-DATA-TRANSFER.md](./CUTOVER-DATA-TRANSFER.md). The transfer is not
ready for cutover until the owner reviews the role and setup mappings, approves
a row-level source path and source-to-V2 links, and separately approves the
destination and any production write.
