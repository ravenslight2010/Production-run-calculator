---
name: Scoped offline master-data queues
description: Conflict and scope rules for server-authoritative master data with a browser cache and durable offline outbox.
---

Offline master-data snapshots, migration markers, and outboxes must be partitioned by the authenticated data scope. Every asynchronous reconcile or flush captures its starting scope and must refuse to mutate local state after a scope switch.

**Why:** A shared browser can switch between live and sandbox identities while requests are in flight. Global storage keys or unfenced continuations can display or upload one scope's data in the other.

**How to apply:** Key every durable client record by scope, keep single-flight state per scope, clean up reconnect listeners on identity changes, and check the captured scope after each network await before touching cache or queue state.

Browser coverage for account switches must verify delivery effects as well as rendered queue visibility: a UI filter can hide another account's record while an asynchronous flush still sends it.

**Why:** Visual absence alone cannot prove that retained work was not replayed or applied under the newly signed-in identity.

**How to apply:** In disposable multi-identity browser fixtures, assert the queued ID, request count, request identity, and application count before and after switching accounts; never use real accounts or credentials.

Legacy local records with no conflict timestamp use reserved revision zero. They may seed an absent server row, but an existing server row at revision zero or higher wins; normal user edits start above zero.

**Why:** Existing server rows can predate the revision column and therefore carry its zero default. Giving unstamped local data a current timestamp would silently overwrite legitimate server state during migration.

**How to apply:** Reconcile legacy data against the complete server record set, treat equal revisions as acknowledged/idempotent, and retain deletion tombstones in server responses so stale devices cannot resurrect records.

Unowned legacy factory-directory lists and factory commands require explicit
manager review even when the server row is absent. Equal canonical values may be
reconciled automatically; a manager's explicit Apply is a new current-session edit.

**Why:** Those legacy records have neither authenticated owner nor live/sandbox
origin. Absence on the currently selected server does not establish the right to
upload them there. This boundary is stronger than revision-zero reconciliation
for legacy records whose owner has already been established.

**How to apply:** Preserve unresolved evidence separately from live read state.
Never use it for offline bootstrap or assign its queue to the next account.
Keep genuinely unowned quarantine explicitly unowned until manager review; do
not give it to whichever staff account happens to hydrate first. Otherwise the
account that can see the evidence may lack permission to resolve it. Newly
authorized commands still belong to the reviewing identity and scope.

A persistence migration's inventory must include the previous migration's entire
supported key set, not just the read caches currently being removed.

**Why:** Adjacent browser-only settings can become inaccessible behind new
memory/server getters even though their original bytes still exist.

**How to apply:** Exercise legacy upgrades with absent server rows for every
previously supported setting. Keep original bytes until explicit resolution or
canonical acknowledgment, including settings outside the new read-cache set.

Do not infer sensitive read authorization from manager-only write authorization.
Trace staff consumers before narrowing a bootstrap projection.

**Why:** Operational defaults often look valid, so a missing staff-readable
setting can silently change live production behavior instead of showing an error.

**How to apply:** Keep an explicit non-secret operational read allowlist, preserve
administrative read and write fences, and verify non-default manager configuration
through a fresh staff session and a scope change.