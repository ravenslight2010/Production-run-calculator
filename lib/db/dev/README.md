# Development serial-generator repair

The schema deliberately retains legacy `serial` generators while production
uses them. Replit Publish compares the actual development and production
schemas; it does not execute the historical serial-to-identity helper.
Direct conversion succeeding on a disposable database is therefore not proof
that Publish can migrate a populated serial schema.

`restore-serial-generators.sql` is a one-time, explicitly approved **development**
repair, not a deployment migration. Apply it only through the normal Agent
development SQL permission, as one transaction. Never connect it to production,
the deployment build, server startup, or the regular schema-push commands.

It locks the 37 known parent tables, restores serial defaults and ownership,
preserves existing sequence progress and grants, checks row counts and content
hashes in the transaction, and rejects unexpected generator configurations.
Already-serial columns are not changed on reruns. It deletes no table rows.

After repair:

1. Verify that all 37 generators are serial and no identity columns remain.
2. Recompute the development-to-production Publish diff. The serial-to-identity
   conversion statements must be absent; investigate any other changes normally.
3. Refresh the prepared publish source record, then let the user retry Publish.

Regression command (uses disposable, loopback-only databases):

```sh
pnpm --filter @workspace/db run test:serial-to-identity
```

The historical command name is retained for compatibility. The test now covers
serial-preserving `push`/`push-force`, the approved identity-to-serial development
repair, reruns, existing IDs, advanced empty-table counters, and audit grants.
The forward-conversion SQL/helper remain historical rehearsal inputs only;
they are not part of normal development or publishing commands.

The retained forward helper resets counters from `MAX(column)`, not from the
old generator's state. It can therefore rewind populated or empty advanced
counters and discard explicit sequence grants. Its corrected empty-table
first value does not make it preservation-safe. The older push-first package
chain can also report exit code zero despite a Drizzle SQL sequence-name
collision; always inspect the SQL result separately from process status.

For the bounded historical/current characterization (requires the documented
Git objects, the pinned workspace toolchain, and local PostgreSQL), run:

```sh
NODE_ENV=test node --test lib/db/migrations/branch-claims.integration.test.mjs
```

This creates source-only, frozen-lockfile historical workspaces and private
loopback database clusters. It never connects the historical helper to normal
push commands or supplies evidence for a production Publish conversion.
