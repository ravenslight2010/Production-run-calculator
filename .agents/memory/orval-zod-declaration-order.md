---
name: Orval Zod declaration order
description: Generated Zod constraint constants can be emitted after validators that use them.
---

Generated Zod output must normalize scalar constraint declarations ahead of validator initializers after Orval generation.

**Why:** Orval's operation traversal can place a numeric or regex constraint after the schema that references it, causing TypeScript declaration-order errors and runtime temporal-dead-zone failures.

**How to apply:** Keep the normalization in the API-spec generation hook and validate both fresh output and the generated package typecheck when changing the OpenAPI contract or Orval configuration.