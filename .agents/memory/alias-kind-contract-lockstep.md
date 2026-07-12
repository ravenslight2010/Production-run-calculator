---
name: Alias-kind enum contract lockstep
description: Adding a value to a lib-owned enum that appears in an API request body requires updating openapi.yaml + codegen, or saves silently 400.
---

**Rule:** When a new value is added to a lib-owned enum that flows through an API request body (e.g. a new spec-import alias `kind` in `SPEC_ALIAS_KINDS`), the OpenAPI spec enum must be updated and codegen re-run in the same change. The server route may validate against the lib constant, but the generated Zod body schema parses FIRST and rejects unknown enum values.

**Why:** The dough/sauce "Use existing" correction memory shipped client+lib complete but the generated `SaveSpecImportAliasesBody` still enumerated the old kinds — every save containing the new kind 400'd at parse, and because clients save learned aliases best-effort (failures swallowed), the feature silently did nothing.

**How to apply:** Any time a shared-lib enum/union gains a member and that value is sent to the server, grep `lib/api-spec/openapi.yaml` for the enum and extend it, run codegen, and keep a lockstep test that iterates the lib constant through the generated request schema (see `specImportAliases.contract.test.ts` for the pattern).
