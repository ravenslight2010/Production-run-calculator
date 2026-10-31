---
name: Browser attempt retention approval
description: Owner-approved automatic diagnostic retention and its destructive-operation boundary.
---

Browser-attempt diagnostic cleanup has standing owner approval for **30 days**,
automatically when a browser check starts. The owner explicitly chose this over
manual confirmation on October 29, 2026. This is not approval to delete release
evidence or user-provided files, or to shorten the period under storage pressure.

**Why:** The owner requested automatic cleanup instead of the proposed manual
policy, while the task required a separate retention/deletion decision.

**How to apply:** Preserve this approval boundary when changing diagnostic
storage. Changes to the retention period or deletion scope need a new owner
decision. Never treat elapsed time alone as proof that an unfinished legacy
attempt is inactive.
