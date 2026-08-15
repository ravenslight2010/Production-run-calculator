---
name: Saved-spec snapshot prune matching
description: Re-import prune must match snapshots per-FILE (intersection), not by exact sourceKey — batch imports save one compound-key snapshot.
---

# Saved-spec snapshot prune matching

Two distinct snapshot-lookup modes — use the right one for each path:

**PRUNE path** (`commitSpecImport`): use **intersection** matching (`selectPruneSnapshots`). A file first imported in a batch lives in a compound-key snapshot; exact-key lookup would miss it, silently skip the prune, and clobber user edits made since.

**REMOVAL-DETECTION path** (`computeProfilesRemovedFromWorkbook`): use **exact file-set** matching (filter `s.sourceKey === currentKey`). Intersection finds the "A|B|C|D" batch snapshot when re-importing only "A", then reports B/C/D profiles as "removed from workbook" — false positives. Safe failure mode for removal detection is [] (no warnings), not clobbered data.

**Why the distinction matters:** the batch snapshot can't tell which profiles came from which file. Prune correctness requires finding it; removal-warning correctness requires ignoring it.

**How to apply:**
- `selectPruneSnapshots` (web savedSpecSheets) — intersection match, newest-first. Used only in the prune path.
- Removal detection: inline exact `s.sourceKey === sourceKey` filter (no helper), newest-first sort.
- `mergePruneSnapshots` (lib spec-import) — combine matched snapshots newest-first, first-seen wins per profile (brand+flavor ci) and recipe (kind + loose name key).
- Snapshot SAVE stays a FULL unpruned parse under the compound key (batch and single-file buckets are distinct so batch snapshots aren't evicted by single-file imports).
- Tests mocking savedSpecSheets should pass the REAL `deriveSourceKey`/`selectPruneSnapshots` through via `importOriginal`, or they validate a fake key shape.
