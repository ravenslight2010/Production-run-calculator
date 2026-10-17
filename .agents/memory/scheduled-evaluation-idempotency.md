---
name: Scheduled evaluation idempotency
description: Owner-approved idempotency and legacy-row safety for scheduled queue entries.
---

A scheduled evaluation represents one unit per scope and time bucket, regardless of which scheduler process submits it. Use one canonical scheduler identity at the enqueue boundary and recognize existing entries across actor identities before inserting. Keep the existing database uniqueness guard as the concurrent-writer backstop.

Historical per-date keys may have the form `scheduled-evaluation:<date>:<time-bucket>`. A shared trailing bucket does not make two such rows the same work; duplicate detection must use the full `(scope, idempotency_key)` identity. For any separately approved removal, bind approval to an immutable exact manifest and revalidate it under transaction locks. Preserve terminal rows with attempt receipts.

Do not rewrite, merge, or delete legacy queued rows as part of routine enqueue changes. Any live queue cleanup requires its own reviewed, audited process.

**Why:** The owner selected canonical-identity deduplication because the existing uniqueness rule includes actor identity. Read-only production evidence also showed historical date-specific keys sharing time suffixes; grouping only by that suffix mistakes distinct work for duplicates.

**How to apply:** When changing scheduled-evaluation producers, preserve one scope/time-bucket entry across process identities and leave historical queue rows untouched. Keep duplicate matching, backlog diagnosis, and any live cleanup distinct; live removal requires manager approval of the exact manifest and an audited, locked recheck.
