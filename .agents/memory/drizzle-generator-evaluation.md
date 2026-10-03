---
name: Drizzle generator evaluation
description: Compare generated migration output across Drizzle Kit versions without treating run metadata as schema drift.
---

When comparing Drizzle Kit versions, pass the schema and dialect explicitly if
generating outside the project's configured output directory. Compare generated
SQL and schema contents directly, but normalize only the generated snapshot ID
and journal timestamp; those values change between runs even when the schema is
identical.

**Why:** A valid before/after comparison can show different raw metadata solely
because the generator writes a fresh ID and timestamp for each run.

**How to apply:** Capture baseline and candidate outputs in temporary
directories, compare SQL byte-for-byte, and compare snapshots after removing
only the run-specific ID and timestamp. Do not apply the generated migration
during a tooling evaluation.