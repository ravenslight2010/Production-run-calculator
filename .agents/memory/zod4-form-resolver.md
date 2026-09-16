---
name: Zod 4 form resolver boundary
description: The setup forms retain parsed FormValues while their Zod 4 schemas accept raw browser inputs.
---

Keep the form's public React Hook Form value type as the parsed `FormValues` shape, while the
Zod schema remains responsible for coercing browser strings and applying defaults. With Zod 4
and the current resolver typings, the resolver's raw-input/output split is not assignable to
`useForm<FormValues>` without a localized `Resolver<FormValues>` assertion at the form boundary.

**Why:** Numeric inputs arrive as strings and defaulted fields are optional in the schema input
type, but the rest of the run-calculator context and components depend on parsed `FormValues`.

**How to apply:** When upgrading Zod or `@hookform/resolvers`, preserve the localized boundary
assertion unless the form/context types are deliberately migrated to explicit input and output
generics. Do not remove coercion or weaken validation to make the compiler pass.