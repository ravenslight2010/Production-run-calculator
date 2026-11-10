---
name: Replit managed database clone scope
description: Safeguards for copying application records between Replit-managed production and development databases.
---

When cloning Replit-managed databases, treat provider-owned `_system` migration metadata as environment-specific; copy only the application schema after verifying the target schema. Prefer an atomic data-only restore over dropping and recreating `public`, and preserve sequence values plus a verified destination backup.

**Why:** Provider migration records describe deployment history, not application records. A clean full-schema restore can fail when existing destination objects depend on `public`; a data-only transaction avoids replacing environment metadata and reduces the blast radius.

**How to apply:** Compare application tables, columns, constraints, indexes, triggers, routines, and sequences first. Rehearse both backups locally, filter only explicitly excluded credential/session data, then truncate and restore the verified application tables in one transaction with row-count and domain-aggregate assertions. Keep the destination server stopped until copied queues and external side effects are reviewed.
