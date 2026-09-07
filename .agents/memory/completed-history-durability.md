---
name: Completed history durability
description: Persistence rules for immutable completed-run records and their offline upload lifecycle.
---

Completed-run history is append-only server authority. Browser history is only a scope-bound read cache plus a durable upload queue; active-day synchronization remains a separate mutable protocol.

**Why:** An offline completion may be the only surviving copy. Ordinary reset, master-data undo, transient server failure, or an account switch must not erase it, upload it into another scope, or expose another scope's cached history.

**How to apply:** Namespace completion caches and outboxes by authenticated scope, capture scope across in-flight work, remove queue entries only after acknowledgement or canonical conflict reconciliation, retry transient failures, and preserve completion storage through normal reset/undo. Aggregate reports prefer immutable records per completed run, including runs completed earlier today.

When completion moves into a newer atomic lifecycle command, do not let that command and the legacy history uploader race on the same immutable run key. A migration bridge may accept legacy evidence only when its operation identity, server-observed arrival window, and lifecycle facts all match the locked run; otherwise require review without side effects.

**Why:** An unrestricted “history already exists” fallback lets stale or unrelated immutable records control current lifecycle time, while two independent writers can permanently deadlock finalization on a uniqueness constraint.

**How to apply:** Give new completions one authoritative writer. Keep compatibility narrow, time-bounded by a server timestamp, fact-validated, and covered in both compatible-first and incompatible-first transaction tests.