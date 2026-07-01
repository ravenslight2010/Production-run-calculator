---
name: Recipe-merge sync-receive guards
description: The web sync-receive merge-survival logic is now importable pure helpers in storage.ts; keep home.tsx wired to them.
---

The web sync-receive handler is inline in `pages/home.tsx` and not importable. The two operations that keep a recipe-name merge from being silently undone by a stale peer sync were extracted into pure, exported helpers in `src/storage.ts` so they can be regression-tested end-to-end:

- `acceptRemoteRunValueOnSync(remoteVals, localVals, remoteTs, localTs)` — the per-run lost-update decision. Keeps local when remote is empty-over-populated OR local stamp is strictly newer. A merge advances re-pointed runs' stamps, so the stale pre-merge selection loses here.
- `dropTombstonedPresetKeys(obj, deletedMap, namespace)` — drops folded-away recipe-preset keys from the additive preset union via the merged deletion tombstones.

**Why:** these guards were only covered at the storage-primitive/pure-helper level; the full receive path had no test, so a receive-handler refactor could silently resurrect a merged-away recipe name or overwrite a merged selection.

**How to apply:** if you refactor the home.tsx receive handler's run-values loop or recipe-preset union, keep calling these helpers (don't re-inline the logic) — the end-to-end guard is `src/recipeMergeSyncReceive.test.ts`, which drives the REAL `applyRecipeNameMerge` + storage primitives + these helpers exactly as the handler wires them.
