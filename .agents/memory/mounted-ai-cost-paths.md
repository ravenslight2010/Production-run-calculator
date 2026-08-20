---
name: Mounted AI cost paths
description: Express router path behavior required for endpoint-specific AI cost weights
---

# Mounted AI cost paths

When a weighted limiter is mounted beneath a router path, resolve its endpoint
from `req.baseUrl + req.path`, not `req.path` alone.

**Why:** Express strips each mounted prefix from `req.path`. A limiter mounted
at `/api/ai` sees `/optimize`, while configured public endpoint costs are named
`/api/ai/optimize`; using only `req.path` silently falls back to the default
cost.

**How to apply:** Any route-level policy keyed by public paths should normalize
mounted request paths before its lookup, and include a test using the production
mount shape.