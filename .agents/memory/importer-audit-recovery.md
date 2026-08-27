---
name: Importer audit recovery
description: Constraints for recovering a transient importer-history audit write without replaying an import.
---

Importer audit retries must retain only a bounded, sanitized audit request and must be isolated to the same authenticated user and live/sandbox scope. Every audit write needs a server-enforced operation identifier so a retry after an ambiguous timeout returns the original row rather than recording the outcome twice. The Import workspace must rediscover pending records after reload, not merely after an in-memory event.

**Why:** A browser cannot safely replay an import source after a partial or ambiguous outcome. An unscoped local retry record risks cross-account delivery, while a request without durable idempotency can duplicate audit history after a server committed but the response was lost.

**How to apply:** Preserve the review-first importer flow. Use the bounded audit-retry path only for metadata persistence, bind it to the current authenticated identity, and make server-side idempotency mandatory for all new audit writes.