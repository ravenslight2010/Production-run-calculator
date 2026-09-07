---
name: Historical repair compatibility
description: Compatibility rules for moving released one-time repairs behind the shared registry without changing their production semantics.
---

Released, self-transactional one-time repairs must keep their marker claim and mutations in the original atomic transaction until that repair family is deliberately migrated to the shared transaction runner. The compatibility runner may validate ordering, dependency markers, skip status, and persisted results, but must not add an outer transaction that changes locking or commit behavior.

Historical marker results can contain nested summaries, large detail arrays, or a valid legacy `NULL`. Compatibility inspection may use bounded recursive JSON to decide what is safe to log or return, but it must not reject already-committed repairs because their historical result shape is unbounded or absent.

**Why:** Rejecting a historical result after its repair transaction commits can leave the database repaired but startup degraded. Wrapping an existing transaction can also alter marker and locking semantics for repairs that may already have run in production.

**How to apply:** When extracting another repair family, either migrate its transaction and marker ownership fully to the shared runner, or retain the explicit compatibility mode. Pin released order and identity, require the marker after execution, omit unsafe result payloads from telemetry, and verify repeated startup reports a skip without reapplying mutations.