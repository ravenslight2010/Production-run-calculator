# Development generator health — 2026-10-26

## Scope, provenance, and approval

- Owner: database/migration maintainer; task 3706.
- Base revision: `87868875e3b6f44e52c2beaa3c632ea43d9d71b4`; verification
  concerns the changed working tree, not a published build.
- Captured 2026-10-26, beginning 18:34 UTC, in the isolated task workspace.
- Development SQL target was identified as `heliumdb`, schema `public`.
  All shared-database investigation was read-only.
- Retained data: fixed schema identifiers, aggregate counts, fixture IDs,
  commands, and outcomes. No credentials, connection strings, personal records,
  recipe payloads, or raw operational records are retained.
- The owner explicitly approved **strict serial-contract diagnostics without
  changing saved ID generators**. There was no approval for conversion, shared
  sequence reconciliation, production DDL/data changes, or publishing.

## Contract decision

`lib/db/src/schema/*`, `lib/db/dev/README.md`, and
`.agents/memory/replit-custom-migrations.md` establish the supported current
serial contract. `0003_serial_to_identity.sql` and its forward helper are
historical rehearsal inputs, not supported startup/Publish migrations. The
forward helper can rewind advanced counters and discard grants.

Read-only catalog inspection found all original 37 targets were serial columns
with owned sequences, not BY DEFAULT identities. Startup had logged
`identity_sequence_health / unavailable`. The old diagnostic required identity
metadata even though the current schema and development DB intentionally use
serial.

The approved correction enforces non-null integer serial columns, automatic
sequence ownership, an exact `nextval` default referencing that same sequence,
positive increments, and non-cycling generators. Invalid metadata still throws;
saved-ID drift still warns. It is not a permissive serial-or-identity fallback.
Legacy identity module, export, CLI, and scheduler-event names remain compatible.

The runtime inventory now includes the newer
`freezer_surplus_decision_corrections.id`, giving 38 checked columns. The
historical 37-column migration/repair inventories were not rewritten. Tests bind
the runtime inventory to all current serial schema declarations.

## Verification and failure ledger

Commands use the normal pinned runner with the conflicting inherited
`NODE_OPTIONS` removed; no TLS or toolchain policy was weakened:

```sh
env -u NODE_OPTIONS NODE_ENV=test bash scripts/src/run-release-node.sh bash -c '
  pnpm --filter @workspace/db run test:serial-to-identity &&
  node --test scripts/src/runtime-import-boundaries.test.mjs &&
  pnpm --filter @workspace/api-server exec vitest run src/lib/identitySequenceHealth.test.ts &&
  CI=true pnpm run typecheck &&
  CI=true pnpm exec tsc --build lib/db --force
'
```

| Check / finding | Outcome and disposition |
| --- | --- |
| Old identity-only expectation on serial development metadata | Resolved by owner-approved contract correction, not by generator conversion or warning suppression. |
| First focused run | Failed source-coverage guard: newer freezer-surplus correction serial column was omitted from historical inventory. Resolved by adding it to runtime-only inventory. |
| Second focused run | Exact source-coverage assertion exposed the old scanner skipping a first column preceded by comments (operational cursor). Resolved scanner and added focused regression; no schema edits. |
| Final disposable DB suite | PASS, 7 tests. Private loopback PostgreSQL fixtures; all generated databases/cluster cleaned up by the suite. |
| Runtime import boundaries | PASS, 6 tests. Target inventory, bundling without migration I/O or CLI execution, and direct CLI validation. |
| API health scheduler | PASS, 3 tests. Startup cadence, bounded warning/recovery transitions, sanitized unavailability. |
| Development read-only diagnostic | PASS: 38 checked, 0 drifted; all 38 generator states identical immediately before/after the pass. No shared `nextval` or `setval` calls. |
| Development API startup | PASS: normal managed workflow restarted; `/api/healthz` reports process/startup/database/auditProtection/dependencies/backgroundWorkers all `ok`. No general production-health claim. |
| Workspace and DB typechecks | PASS: `CI=true pnpm run typecheck` (all libraries, API including routes, calculator, mockup, scripts and prerequisite contract checks); `CI=true pnpm exec tsc --build lib/db --force`. Final combined verification command exited 0. |
| Failed diagnostic rollback could return an open/failed transaction to the pool | Resolved: destroy the connection when rollback fails. Disposable injected-rollback regression preserves the original error, unchanged data/counters, and a reusable replacement connection. |
| Automatically started unrelated suites | Client suite finished; waiting release suite stopped in this task copy to keep scope bounded. Neither is task acceptance or release evidence. |
| Toolchain notices | npm warned about pnpm-only config keys during provisioning; focused commands reached project code and passed. No package changes. |
| API root/favicon 404 | Expected API-only path behavior; verification uses `/api/healthz`. No routing/UI change warranted. |
| Existing development master-data health errors | Separate data-health owner boundary: startup reports 1 error in each scope. Not caused or repaired by generator diagnostics; manager-authorized read-only review proposed separately. |
| Production health / production stalls | UNKNOWN for this repair. No production catalog check, migration, shared sequence repair, publish, or causal conclusion. Original incident evidence remains `production-stalls-2026-10-26.md`. Automatically supplied production logs are not revision-bound verification for this working tree. |

The disposable fixtures verify:

- All rows and every checked sequence state unchanged across healthy checks,
  metadata failures, and failed attempted writes.
- PostgreSQL `BEGIN READ ONLY` enforcement rejects DML, `nextval`, and `setval`.
- Missing/constant/wrong-sequence/transformed defaults, detached ownership,
  cycling, negative increments, missing targets, and identity columns fail closed.
- Successful and failing checks roll back and release a reusable client. A
  failed rollback destroys its pooled connection and preserves the original error.
- Called and never-called sequence semantics; equality with a saved ID is drift.
- Imported fixture ID 50000 is retained alongside the earlier 1006; only explicit
  fixture-side reconciliation advances allocation, after which the actual
  default insert returns 50001 and health reports recovery.
- Serial-preserving push/rerun, restored legacy serial defaults, advanced
  empty-table counters, retained grants, and migration error rollback continue
  passing in disposable fixtures. The historical conversion helper is never
  attached to normal pushes or startup.

Final combined verification completed successfully by 18:43 UTC. API workflow
logs after the restart show no `identity_sequence_health / unavailable` warning
through the startup delay; a clean sample is intentionally silent. The separate
direct read-only health result above supplies the positive 38-target result
rather than treating log silence as proof. Full workspace checks reported one
documented intentional recovery-audit difference (UI memo boundaries), zero
missing recovery contracts, and no TypeScript errors.

## Applicability

Desktop, phone, tablet portrait/landscape, Chromium/WebKit compatibility,
physical Android/iOS/PWA, and native-mobile checks: **not applicable** to this
read-only server diagnostic. A screenshot of the API health response confirms
the running route, not a browser/device user journey. No browser suite or full
release check was requested or used as acceptance.
