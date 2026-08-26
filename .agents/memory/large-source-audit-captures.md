---
name: Large source-audit captures
description: How to retain complete production snapshots when tool output budgets constrain escaped JSON payloads.
---

Production master-data snapshot payloads can exceed the durable callback budget even when the final JSON file is just under the workspace file limit, because SQL output escaping expands the recorded result. Shard the six bounded table reads, persist each complete part, and assemble the final snapshot locally.

**Why:** A truncated or failed callback must never be mistaken for a partial production snapshot, and the audit format requires complete row counts for every allowlisted table.

**How to apply:** Keep the source manifest as a hash of the stable source corpus (excluding the audits directory); if any source-library file changes during capture preparation, recalculate the new snapshot manifest and rerun the file-only comparison before retaining the pair.