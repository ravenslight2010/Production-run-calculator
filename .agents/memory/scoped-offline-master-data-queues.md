---
name: Scoped offline master-data queues
description: Conflict and scope rules for server-authoritative master data with a browser cache and durable offline outbox.
---

Offline master-data snapshots, migration markers, and outboxes must be partitioned by the authenticated data scope. Every asynchronous reconcile or flush captures its starting scope and must refuse to mutate local state after a scope switch.

**Why:** A shared browser can switch between live and sandbox identities while requests are in flight. Global storage keys or unfenced continuations can display or upload one scope's data in the other.

**How to apply:** Key every durable client record by scope, keep single-flight state per scope, clean up reconnect listeners on identity changes, and check the captured scope after each network await before touching cache or queue state.

Legacy local records with no conflict timestamp use reserved revision zero. They may seed an absent server row, but an existing server row at revision zero or higher wins; normal user edits start above zero.

**Why:** Existing server rows can predate the revision column and therefore carry its zero default. Giving unstamped local data a current timestamp would silently overwrite legitimate server state during migration.

**How to apply:** Reconcile legacy data against the complete server record set, treat equal revisions as acknowledged/idempotent, and retain deletion tombstones in server responses so stale devices cannot resurrect records.