---
name: Saved-spec snapshot prune matching
description: Re-import prune must match snapshots per-FILE (intersection), not by exact sourceKey — batch imports save one compound-key snapshot.
---

# Saved-spec snapshot prune matching

Rule: when selecting previous-import snapshots to prune a spec re-import against, match per FILE — split every `sourceKey` on `|` and select any snapshot whose file set INTERSECTS the current import's file set — never require an exact sourceKey match.

**Why:** multi-file batch imports save ONE snapshot under a compound `"a|b|c"` sourceKey. An exact-key lookup for a later single-file re-import found nothing, the prune silently skipped, and the full re-apply clobbered user edits made since the batch import (production data loss: renamed sauce + profile links, unrecoverable).

**How to apply:**
- Selection: `selectPruneSnapshots` (web savedSpecSheets) — intersection match, newest-first (createdAt desc, id desc), legacy blank/null keys never match.
- Merge: `mergePruneSnapshots` (lib spec-import) — combine matched snapshots newest-first, first-seen wins per profile (brand+flavor ci) and recipe (kind + loose name key), then feed `pruneSpecImportAgainstSnapshot`.
- Snapshot SAVE stays a FULL unpruned parse under the compound key (retention keeps 2 per key bucket; batch and single-file buckets are distinct, so batch snapshots aren't evicted by single-file imports).
- A silent "no snapshot matched → apply everything" fallback is exactly the data-loss shape; any new snapshot-keyed lookup must think about key-shape drift (compound vs single, legacy blanks).
- Tests mocking savedSpecSheets should pass the REAL `deriveSourceKey`/`selectPruneSnapshots` through via `importOriginal`, or they validate a fake key shape.
