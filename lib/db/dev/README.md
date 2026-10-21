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
