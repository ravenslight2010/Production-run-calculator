---
name: Audit-log scope boundary
description: The authorization boundary for compliance and forensic audit-log reads.
---

Audit-log reads are live-only manager surfaces. A sandbox session must not inspect
live compliance records even when its seeded role has the manager capability.

**Why:** Audit logs are used for factory-wide compliance and forensic review; a
scope parameter or default must never let a sandbox session read live records.

**How to apply:** Keep the live-scope middleware before the manager capability
middleware on every audit-log read route, and cover both sandbox denial and live
manager success in integration tests. Persist only server-derived stable actor IDs
and action-specific bounded evidence; never expose the internal scope or network
metadata in audit responses/exports. Required audit inserts must share the
business mutation transaction.