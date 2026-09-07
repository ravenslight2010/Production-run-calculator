---
name: Master-data audit boundary
description: Production master-data scans are bounded, read-only, and must surface immutable-history coverage gaps.
---

Master-data audits must be scope-locked and bounded by rows, JSON payload size, component depth, findings, and a date window. Ambiguous aliases, duplicate names, stale links, and orphaned references remain review-only; no fuzzy or automatic repair is justified by a scan alone. A repair candidate needs an explicit owner, deterministic fingerprint, before/after preview, and an undoable repair batch.

**Why:** Production contains protected operational history and legacy master data where a plausible replacement can still be wrong. The live schema may also lag newer history tables, so missing coverage must be reported instead of silently treated as empty.

**How to apply:** Treat the scan as evidence, not a source of truth. Record truncation and unavailable-history coverage in the report, and require a separately approved manager workflow for any later repair.