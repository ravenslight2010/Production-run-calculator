---
name: Orval Zod declaration order
description: Generated Zod constraint constants can be emitted after validators that use them.
---

Generated Zod output must normalize scalar constraint declarations ahead of validator initializers after Orval generation.

**Why:** Orval's operation traversal can place a numeric or regex constraint after the schema that references it, causing TypeScript declaration-order errors and runtime temporal-dead-zone failures.

**How to apply:** Keep the normalization in the API-spec generation hook and validate both fresh output and the generated package typecheck when changing the OpenAPI contract or Orval configuration.

Packages exercised by the API-spec toolchain smoke check must be direct
dev-dependencies, not incidental members of Orval's optional-peer graph.

**Why:** An Orval update can remove an optional peer from the resolved graph;
then the smoke check passes in an old install but fails after a frozen install.

**How to apply:** When changing Orval, compare its peer graph with the packages
the smoke check loads and keep each smoke-tested package explicitly declared.