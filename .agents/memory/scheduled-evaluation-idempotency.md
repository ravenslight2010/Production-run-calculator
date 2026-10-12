---
name: Scheduled evaluation idempotency
description: Owner-approved idempotency and legacy-row safety for scheduled queue entries.
---

A scheduled evaluation represents one unit per scope and time bucket, regardless of which scheduler process submits it. Use one canonical scheduler identity at the enqueue boundary and recognize existing entries across actor identities before inserting. Keep the existing database uniqueness guard as the concurrent-writer backstop.

Do not rewrite, merge, or delete legacy queued rows as part of routine enqueue changes. Any live queue cleanup requires its own reviewed, audited process.

**Why:** The owner selected canonical-identity deduplication because the existing uniqueness rule includes actor identity, while production already contains duplicate buckets that cannot safely be collapsed by an ordinary code deploy.

**How to apply:** When changing scheduled-evaluation producers, preserve one scope/time-bucket entry across process identities and leave historical queue rows untouched. Keep backlog diagnosis and any live cleanup as separate work.
