---
name: Apply source evidence retention
description: Project decision for retaining spec-import source text with manager-approved Apply records.
---

Retain exact, bounded parser source text only with the same authorized live spec Apply operation and its applied-value snapshot. Do not put it in reusable import snapshots or reconstruct it for legacy operations. Delete stored source text and exporter-created private files after 90 days.

For other workbook reviews, filenames and sheet/cell citations are temporary review context. Do not retain workbook bytes, raw cell contents, or citation maps in import history or logs. Approved business values may persist through the normal import commit; source evidence must not.

**Why:** The user approved storing spec source with Apply so the evidence remains bound to a completed human review and the transaction that records its resulting values, and selected 90 days as the source/export retention period. For other workbook reviews, they required traceability without retaining uploaded workbook data beyond the active review.

**How to apply:** Keep sandbox, pending, undone, unauthorized, and source-missing operations out of exports. At expiry, remove only stored source text; preserve digests, actor authorization evidence, applied values, and operation history. Local exporter files have owner-only expiry markers and require the owner to run or schedule the bounded cleanup command. For other workbook importers, keep source-aware evidence outside legacy result and commit shapes, and never log raw source or actor identity.