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
