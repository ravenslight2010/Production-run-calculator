---
name: Merge target must survive in server pools
description: Recipe-name merges must never delete all source pool rows when the picked target name has no pool row — promote a source by rename instead.
---

# Merge target must survive

**Rule:** in any name-merge cleanup over a server master-data pool (cheese, mixes, dough/sauce named recipes), if the picked target name has NO pool row but sources do, promote the richest source (most components) by renaming it to the target name — server upserts are id-keyed (`onConflictDoUpdate` on [id,scope]), so keeping the id renames in place. Only then backfill/delete the remaining sources.

**Why:** on 2026-07-18 a prod dough merge picked a typed target name with no pool row; the cleanup found no targetRow, skipped backfill, but still deleted all sources — the merged dough vanished factory-wide (Lowe's french fry). Restored via one-time heal `dough-merge-vanish-restore-v1` under a NEW untombstoned name (never clear tombstones — old clients re-push them via the additive union), with run-value repoint targeting whatever row actually exists after the heal.

**How to apply:** any new server pool added to the merge cleanup in `handleApplyRecipeNameMerge` must include the promote-on-missing-target branch. Heals that repoint references must repoint to the surviving row's actual name, never a constant that may not have been inserted.
