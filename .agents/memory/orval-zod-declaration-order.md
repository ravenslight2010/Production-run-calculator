---
name: Orval Zod generation behavior
description: Generated Zod declaration order, date coercion, and package-graph quirks.
---

Generated Zod output must normalize scalar constraint declarations ahead of validator initializers after Orval generation.

**Why:** Orval's operation traversal can place a numeric or regex constraint after the schema that references it, causing TypeScript declaration-order errors and runtime temporal-dead-zone failures.

**How to apply:** Keep the normalization in the API-spec generation hook and validate both fresh output and the generated package typecheck when changing the OpenAPI contract or Orval configuration.

Normalize excess blank lines after hoisting generated scalar declarations.

**Why:** Hoisting leaves variable-sized blank gaps; saved workspace output and fresh temporary generation can otherwise differ only in whitespace and fail the exact freshness comparison.

**How to apply:** Keep the generator's whitespace normalization deterministic and verify normal generation against the isolated freshness check, without weakening the comparison.

Packages exercised by the API-spec toolchain smoke check must be direct
dev-dependencies, not incidental members of Orval's optional-peer graph.

**Why:** An Orval update can remove an optional peer from the resolved graph;
then the smoke check passes in an old install but fails after a frozen install.

**How to apply:** When changing Orval, compare its peer graph with the packages
the smoke check loads and keep each smoke-tested package explicitly declared.

OpenAPI `date-time` request fields can generate `zod.coerce.date()`. A validated
ISO string may therefore arrive at route logic as a `Date`, even when adjacent
handwritten types still describe it as a string.

**Why:** Assuming the parsed value remains a string can silently drop a valid
observation timestamp from persisted diagnostics.

**How to apply:** Normalize bounded date-time values after schema parsing, and
test through the generated request schema or route rather than only calling a
context builder with an unparsed string.