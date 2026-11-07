---
name: Drizzle partial push and sequence scope
description: Table filtering does not guarantee sequence isolation or atomic schema application.
---

Do not treat a table-filtered Drizzle push as isolated from other identity
sequences, or its exit status as proof that all intended changes succeeded.

**Why:** A table-filtered development push applied additive table, column,
constraint and index changes, then attempted to drop an excluded table's
identity sequence. PostgreSQL refused the drop, but the command still exited
zero and its preceding DDL remained applied.

**How to apply:** Rehearse scoped schema pushes against a disposable copy with
the relevant sequence topology. Inspect the proposed sequence operations as
well as tables. After any error, inspect the actual columns, constraints,
indexes and sequence ownership before retrying. Never delete an unrelated
sequence or broaden a forced push merely to make the command finish cleanly.

For projection tables maintained by application transactions, prefer explicit
write and delete maintenance over a new foreign key to `daily_sync` unless the
isolated push proves its existing unique index remains available.

**Why:** Adding a projection-to-`daily_sync` foreign key caused an isolated
sync-writer test to find the existing date/scope conflict index missing after
`push-force`; removing the FK and explicitly clearing projection rows restored
the test. The platform's supported publish path also does not apply triggers.

**How to apply:** After changing schema objects related to `daily_sync`, inspect
the disposable database's actual indexes and constraints, then exercise a real
writer that uses `ON CONFLICT`. Keep projection updates and deletes in the same
application transaction as the canonical snapshot change.
