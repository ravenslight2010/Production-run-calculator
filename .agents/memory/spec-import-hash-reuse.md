---
name: Spec-import exact-file parse reuse
description: Re-importing a byte-identical spec file must reuse the saved snapshot parse (SHA-256 sourceHash), never re-run the AI.
---

**Rule:** A re-import of the exact same spec file(s) (same `sourceKey` AND same SHA-256 `sourceHash` stored on the saved snapshot) reuses the snapshot's parse and skips the AI entirely.

**Why:** AI re-reads of the same workbook drift between calls (values swap between rows, weights misread). The re-import prune diffs the new parse against the previous snapshot, so drift looks like real spec changes and is applied — silently clobbering user data. Prod evidence: two snapshots of the identical file with different applicator weights and swapped sausage values.

**How to apply:**
- Reuse requires an EXACT `sourceKey` match — a batch snapshot's data is the merged whole-batch parse, so reusing it for a partial/single-file re-import would resurrect the other files' content.
- Multi-file fingerprint = per-file SHA-256 hex sorted + joined `|` + re-hashed (order-independent, mirrors `deriveSourceKey` sorting). Hash failure ⇒ `undefined` ⇒ skip reuse, never block the import.
- The reuse path still re-runs the post-parse hygiene against CURRENT data (tombstone partition, cheese canonicalize/dedupe, summary, discrepancies); only the AI passes are skipped (`newAliases`/`flagged` empty).
- Multi-file: hash BEFORE the parse loop — it releases buffers as it goes.
- Server accepts only `^[0-9a-f]{64}$` for `sourceHash`; anything else is stored null (legacy/malformed never qualify for reuse).
- Mobile clients don't send a hash yet; their snapshots simply aren't reusable (fine while parity is paused).
