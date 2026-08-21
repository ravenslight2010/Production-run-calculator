---
name: One-time data heals
description: Pattern for shipping exactly-once data corrections as code (prod DB is read-only to the agent)
---

The production database can only be corrected by shipping code. The pattern: a `data_heals` marker table (id text PK + applied_at) and a boot-time `runDataHeals()` before the API begins accepting HTTP requests. Each heal runs in ONE transaction that FIRST claims its marker row with `onConflictDoNothing` — no row returned = already applied (or a concurrent instance is applying), skip. Dev heals on next restart; prod heals on first boot after publish. BOTH dev API workflows run this server, so concurrent-boot safety is mandatory.

**Why:** poisoned learned import matches (bulk multi-customer spec import taught cross-customer cheese-blend aliases) had to be deleted from prod tables the agent can't write.

**How to apply:** add a new heal function in `artifacts/api-server/src/lib/dataHeals.ts` with a fresh stable id; keep pure payload transforms in a separate db-free module for unit tests.

For destructive cleanup based on mutable references (such as profiles naming recipes), lock the reference table through the scan and delete. Starting the process before listening closes the normal request window; the lock protects against another already-running instance.

Gotchas learned (architect-review findings on v1):
- When healing `daily_sync` run values, the new `runValuesUpdatedAt` stamp must be MONOTONIC: `max(storedStamp, now) + 1`, not plain `Date.now()` — a clock-skewed client holding the bad value with a future stamp would re-win strict-LWW and resurrect it.
- Scope alias/correction deletes to the full audited key including context columns (e.g. `import_aliases.brand_context`), or the delete can remove a legitimately different mapping.
- Select `daily_sync` rows `FOR UPDATE` so a concurrent sync PUT can't interleave; heal today-and-future dates only (past days are history) with a hard-coded date literal so the heal is deterministic.
- Also delete the mirrored `ai_corrections` rows — every learned alias is mirrored there and would re-bias AI matching.
