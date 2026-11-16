---
name: Node typings match runtime
description: Keep Node ambient types aligned with the runtime major.
---

Keep `@types/node` aligned with the supported Node runtime major unless a concrete compatibility requirement prevents it. Type-only packages still affect which APIs compile as available.

**Why:** A newer ambient type major can allow code to compile against APIs that the deployed runtime does not provide. Aligning types with the runtime also exposes differences in global declarations during typecheck.

**How to apply:** When the Node runtime major changes, reassess the matching `@types/node` major and run the full workspace typecheck. Prefer explicit imports from Node modules when a runtime type should not rely on a changing global declaration.
