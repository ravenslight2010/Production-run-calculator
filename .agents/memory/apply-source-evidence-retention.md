---
name: Apply source evidence retention
description: Project decision for retaining spec-import source text with manager-approved Apply records.
---

Retain exact, bounded parser source text only with the same authorized live spec Apply operation and its applied-value snapshot. Do not put it in reusable import snapshots or reconstruct it for legacy operations. The retention period has not yet been set.

**Why:** The user approved storing source with Apply so the evidence remains bound to a completed human review and the transaction that records its resulting values.

**How to apply:** Keep sandbox, pending, undone, unauthorized, and source-missing operations out of exports. Never log raw source or actor identity. Establish a separate retention/deletion policy before removing stored source evidence.