---
name: API route typecheck isolation
description: The API route diagnostic lane must stay independent from generated validator rebuilds while preserving the full check as authority.
---

The focused API route check intentionally compiles route sources without project-reference rebuilds and resolves `@workspace/api-zod` from the last successful declaration output.

**Why:** A generated validator source failure can otherwise prevent TypeScript from reaching an edited route, while weakening compiler settings would make the diagnostic misleading.

**How to apply:** Use the focused route command for diagnosis only; keep the normal API package typecheck as the authoritative gate and regenerate declarations through the normal API codegen flow.