---
name: Orval query-param coerce quirk
description: Generated *QueryParams zod schemas use zod.coerce.string(), which turns a MISSING param into the string "undefined" instead of failing.
---

Orval generates query-param schemas like `CheckUsernameAvailableQueryParams =
zod.object({ username: zod.coerce.string().min(1)... })`. Because of
`zod.coerce.string()`, parsing `req.query` for a **missing** param coerces
`undefined` → `"undefined"` (length 9), which passes `.min(1)` and never 400s.

**Why:** `coerce.string()` runs `String(value)` before validation, so absence is
indistinguishable from a literal value at the schema level.

**How to apply:** For any GET endpoint validating required query params with the
generated `*QueryParams` schema, guard presence explicitly first
(`typeof req.query.x !== "string" || x.trim() === ""` → 400), then run the zod
parse for the remaining length/format constraints. Don't rely on the generated
schema alone to reject a missing param.
