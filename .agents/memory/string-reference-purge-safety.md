---
name: String-reference purge safety
description: Preservation rule for deleting recipe master data referenced by profile and production snapshots through names rather than foreign keys.
---

# String-reference purge safety

Treat every persisted recipe name in profiles and run snapshots as a live
reference before deleting a zero-value or apparently orphaned recipe. This
includes completed, started, historical, pending, and future runs. History may
be immutable, but its text link still needs the master row to remain resolvable.

**Why:** Recipe links are names rather than database foreign keys. A generic
purge that checked profiles but not historical run values could delete a row
before a later, more careful reconciliation had a chance to preserve it,
leaving completed production with a dangling reference.

**How to apply:** Any master-data purge must lock every table that can create a
text reference, collect references from both profile variants and all stored
run values, repoint only the explicitly mutable scope, then re-read references
before conditional deletion. Test the real boot order, not only the purge in
isolation.