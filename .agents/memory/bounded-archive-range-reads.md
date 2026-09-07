---
name: Bounded archive range reads
description: Durable API and database rules for adding date-range search to retained archives.
---

Archive range reads need three independent bounds: a maximum date span, a maximum returned row count, and an index aligned with facility scope plus the range/order columns. A response limit alone does not stop PostgreSQL from scanning and sorting an unbounded retained archive.

**Why:** A superficially bounded endpoint can still do unbounded database work, and representing mutually exclusive exact-period and range query shapes as optional parameters produces generated clients that accept invalid combinations.

**How to apply:** For retained audit/history tables, add a query-aligned scoped index and cap both range and output. If OpenAPI tooling cannot strongly type mutually exclusive query parameter sets, preserve the exact-period endpoint and expose range search as a separate operation with required start/end dates.