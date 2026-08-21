---
name: Sync integration reset isolation
description: Whole-scope reset behavior and shared sync integration fixture isolation
---

Whole-scope reset endpoints are destructive to every live daily-sync row in the test scope, so they must not be called from a mixed multi-device integration fixture that other cases share.

**Why:** A reset inside the shared sync integration file removes unrelated seeded rows and makes later tests fail as if sync had lost data. Reset semantics already have a dedicated integration suite.

**How to apply:** Keep multi-device convergence tests focused on stale writes, canonical adoption, lifecycle/progress merges, and conflict recording. Cover reset-epoch rejection in the dedicated reset suite and client stale-response tests.