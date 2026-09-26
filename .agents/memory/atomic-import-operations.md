---
name: Atomic import operations
description: Durable transaction and recovery rules for reviewed multi-entity imports.
---

Reviewed multi-entity imports must keep one stable operation identity for ambiguous retries. Server-owned master-data changes and the success history record commit in one transaction; the client adopts local projections only after validating the canonical committed response.

**Why:** A fresh retry identity can duplicate an import after a lost response, and local adoption before acknowledgment can expose state that the server rolled back.

**How to apply:** Preserve importer-specific normalization during projection, retain the exact reviewed payload for retry, and make undo compare and restore only the rows and aliases touched by that operation. Unrelated later edits must neither block undo nor be overwritten.