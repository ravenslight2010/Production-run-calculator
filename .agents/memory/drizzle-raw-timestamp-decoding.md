---
name: Drizzle raw timestamp decoding
description: Raw SQL aggregate timestamps may not receive Drizzle's normal timestamp decoder.
---

Treat timestamps returned by raw SQL expressions such as `MIN(timestamp_column)` as potentially serialized strings, even when the expression is annotated as `sql<Date>`. Normalize the runtime value before comparing or formatting it.

**Why:** Integration tests showed that the type annotation does not guarantee runtime decoding for raw aggregate expressions; calling `getTime()` directly failed when PostgreSQL returned a timestamp string.

**How to apply:** When reading timestamp aggregates through `sql<T>`, use an explicit decoder or normalize the value with `Date.parse(String(value))` before date arithmetic.
