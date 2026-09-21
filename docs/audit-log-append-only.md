# Audit log append-only protection

`audit_logs` is retained compliance history. Application routes must not
update or delete it, and ordinary database roles are blocked from doing so by
the database trigger installed by
`lib/db/migrations/0001_audit_logs_append_only.sql`.

## Applying the migration

The normal schema commands apply the table schema and then the protection:

```bash
pnpm --filter @workspace/db run push-force
```

The SQL is idempotent. It creates a `NOLOGIN` role named
`audit_maintenance`, installs the append-only trigger, and exposes only two
bounded functions to that role:

- `redact_audit_log(id, changes)` changes only the redacted JSON evidence.
- `delete_audit_log(id, reason)` records a retained deletion event before
  deleting the requested row.

The maintenance role is not granted to the application. A separately
authorized database operator must connect through an administrative channel
and use `SET ROLE audit_maintenance` for an approved operation. The role is
non-login and cannot create databases, roles, or replication slots.

## Approved maintenance workflow

Use the checked-in maintenance command instead of an ad hoc `UPDATE` or
`DELETE`. The command refuses to fall back to `DATABASE_URL`; the operator
must provide an administrative connection in `AUDIT_MAINTENANCE_DATABASE_URL`.
That connection must be authorized to assume the non-login
`audit_maintenance` role, while the normal application connection must not be
granted membership in that role.

Every invocation requires:

- `--action redact` or `--action delete`;
- the affected `--audit-id`;
- `--authorized-by`, identifying the person or approval authority;
- `--reason`, explaining why the operation is needed; and
- `--operator`, identifying the person running the command.

Redaction also requires a bounded replacement object in `--changes-json`.
Deletion does not accept a replacement payload.

Example:

```bash
AUDIT_MAINTENANCE_DATABASE_URL="$APPROVED_ADMIN_DATABASE_URL" \
  pnpm --filter @workspace/scripts run audit:maintain -- \
  --action redact \
  --audit-id 123 \
  --authorized-by compliance-reviewer \
  --reason "Remove an accidentally captured personal detail" \
  --operator on-call-operator \
  --changes-json '{"outcome":"redacted","reasonCode":"approved_privacy_cleanup"}'
```

The command opens one transaction, assumes `audit_maintenance`, records an
`audit_log_maintenance_approved` event containing the operator, authorizer,
reason, action, and target ID, then calls the bounded redaction or deletion
function. A failed operation rolls back the approval record as well. Deletion
also retains the database function's `audit_log_deleted` compensating event.
The command prints only bounded result metadata (`approvalId`, `auditId`, and
action), never the connection string or replacement payload.

## Verification

The API integration suite uses a disposable database and verifies that
historical reads and inserts still work, ordinary update/delete statements
and function calls fail without `audit_maintenance`, the approval record and
bounded maintenance functions work only after `SET ROLE audit_maintenance`,
and the down/up SQL rollback cycle restores and reinstates the guard:

```bash
pnpm --filter @workspace/api-server run test -- src/routes/auditLogs.integration.test.ts
```

The command argument contract is covered separately:

```bash
pnpm --filter @workspace/scripts exec vitest run src/maintain-audit-log.test.mts
```

## Operational rollback

Rollback is a schema rollback only; it does not rewrite audit data. On an
isolated or maintenance-window connection, run the checked-in down SQL:

```bash
psql "$DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --file lib/db/migrations/0001_audit_logs_append_only.down.sql
```

This removes the trigger and bounded functions but deliberately leaves the
non-login role in place so a role lifecycle change is not coupled to a schema
rollback. The down/up cycle is covered by the integration test. Re-apply the
forward migration before returning the database to normal application use;
do not use rollback as a way to edit retained rows.