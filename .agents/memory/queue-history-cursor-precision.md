---
name: Queue history cursor precision
description: Why stable database keys are safer than JavaScript timestamps for PostgreSQL keyset pagination.
---

Use a stable database key for keyset pagination when the source timestamp can carry precision that the application runtime cannot preserve. JavaScript Date values round PostgreSQL timestamps to milliseconds, so encoding a timestamp cursor can exclude or duplicate rows that share a millisecond boundary.

**Why:** A cursor reconstructed from a rounded timestamp may no longer describe the row boundary used by the database, which can make later pages silently empty or incomplete.

**How to apply:** Prefer an ordered immutable key such as an ID, or preserve the database timestamp as an exact numeric/text value from the query. Keep the cursor opaque and validate decoded values at the route boundary.