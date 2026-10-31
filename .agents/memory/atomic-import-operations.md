---
name: Atomic import operations
description: Durable transaction and recovery rules for reviewed multi-entity imports.
---

Reviewed multi-entity imports must keep one stable operation identity for ambiguous retries. Server-owned master-data changes and the success history record commit in one transaction; the client adopts local projections only after validating the canonical committed response.

**Why:** A fresh retry identity can duplicate an import after a lost response, and local adoption before acknowledgment can expose state that the server rolled back.

**How to apply:** Preserve importer-specific normalization during projection, retain the exact reviewed payload for retry, and make undo compare and restore only the rows and aliases touched by that operation. Unrelated later edits must neither block undo nor be overwritten.

When a retained source snapshot is saved after the atomic changes, an idempotent history retry may attach only a snapshot verified in the current scope and matching the original import/source. It must not rewrite the committed outcome or replay the import.

**Why:** The atomic operation can create its durable history row before the optional review snapshot is available; deduplication must not make that reference impossible to add or allow cross-scope attachment.

**How to apply:** Treat later snapshot metadata as a narrowly scoped reference enrichment on the same authenticated operation, and leave the original status, summary, and operation identity unchanged.

User cancellation before Apply is a review outcome, not an ambiguous operation failure.

**Why:** Treating a cancelled preview as a status-less network error locked the original review behind “the earlier save may have reached the server,” even though no Apply request existed.

**How to apply:** Keep cancellation separate from uncertain commit responses. Cancel must leave no pending operation, failed-commit history or exact-retry lock; an actual unconfirmed Apply must retain its existing original-ID recovery.

Operational import QC and model-evaluation results are independent approvals.
The owner approved advisory QC review of already committed operations, not a
QC-before-Apply gate or permission to undo, reimport, or use customer sources for
model evaluation.

**Why:** A model score is not an operational manager's decision; a QC rejection
does not authorize destructive recovery or expand source-use/retention consent.

**How to apply:** Keep QC evidence tied to the exact committed result. Preserve
existing Apply/Undo capabilities and separate evaluation-use authorization when
changing any import review or Gold Lab surface.