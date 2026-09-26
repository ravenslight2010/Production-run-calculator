---
name: Replit custom migrations
description: Replit publishing can sync Drizzle schema without running raw SQL migration scripts required for triggers and functions.
---

Custom database SQL that is not represented in the Drizzle schema must run before the production server starts, not only through development schema commands.

**Why:** Replit's publish flow applied the table/column schema but skipped the checked-in audit trigger and maintenance functions, so strict readiness returned 503 during Autoscale promotion.

**How to apply:** Chain the idempotent custom migration ahead of the production server command in the validated `.replit` deployment run configuration, then let readiness verify the resulting database protection.