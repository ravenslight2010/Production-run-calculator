---
name: Batch upsert atomicity + client pending-map
description: Server batch save routes must be transactional when clients repoint local references only after success; heals persist the intended rename map before the write.
---

Rule: any server route that saves a batch of master-data rows (dough/sauce named-recipe pools, etc.) must wrap the upsert loop in ONE `db.transaction`. Clients (rename heals, merges) re-point local references only after the endpoint succeeds — a partial commit strands local references to half-renamed names, and a retry can't rediscover the old→new pairs from the now-renamed pool.

**Why:** the one-time dough/sauce name-cleanup heal renames pool entries server-first, then runs `applyRecipeNameMerge` locally. A mid-loop 500 with some rows committed made the retry's map empty for those rows — permanent stale references.

**How to apply:**
- Server: `await db.transaction(async (tx) => { ...upserts... })` in every batch POST.
- Client heals: persist the intended old→new map to localStorage BEFORE the server write (`<marker>-pending-<kind>`), merge it into the map on retry, clear it only after the local repoint ran. This also covers "server saved, client crashed before repoint".
