---
name: API route composition recovery
description: A route can remain in authorization inventories while a merge drops its mounted router.
---

Authorization inventories do not prove that a route is reachable. When a merge reorganizes
router families, verify both the endpoint behavior and the assembled router composition; a
missing mount can return 404 while all route-local authorization tests still pass.

**Why:** A reviewed merge preserved the applicator evidence implementation and policy rows but
omitted its family mount, so integration requests failed with 404s until the composition was
restored.

**How to apply:** For API merge regressions, pair route-policy checks with a focused HTTP smoke
test through the assembled root router, especially for newly moved or family-owned routes.