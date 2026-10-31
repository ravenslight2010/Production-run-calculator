---
name: Express route uniqueness
description: Prevent stale duplicate Express handlers from appearing live while an earlier handler answers the same method and path.
---

Keep one deliberate terminal registration for each public method/path. Express evaluates registrations in order; when an earlier handler sends the response, later declarations for the same method/path are unreachable. If multiple middleware steps are needed, compose them in one route chain or use explicit `next` behavior.

**Why:** A copied legacy sync handler remained after its replacement. It looked like a second implementation of current behavior, but the earlier handler answered requests first. Future edits could easily target the inactive code.

**How to apply:** When reviewing or modularizing route families, inspect the assembled route inventory and handler order, then confirm the authoritative registration is the one exercised by integration tests. Do not infer runtime behavior from a source declaration alone.

Also distinguish an isolated router test from an assembled application test.
Directly mounting a router in a fixture can prove its handler while the real
application never mounts it. Check authorization inventories in both directions:
mounted protected reads must be classified, and intended classified endpoints
must actually be reachable through the assembled API.

**Why:** A declaration, an authorization-list entry and an isolated passing test
can agree while the manager-facing request still has no connected handler.
