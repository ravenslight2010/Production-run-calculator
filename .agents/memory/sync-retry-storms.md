---
name: Sync retry storm prevention
description: Retryable live-sync writes must be single-flight and bounded across wake, focus, online, and local-edit signals.
---

Retryable sync work must keep one active chain per client, retain only the newest queued payload, use bounded exponential backoff with jitter, and cancel obsolete timers when foreground reconciliation establishes a newer generation.

**Why:** Background tabs and reconnect bursts can otherwise create overlapping writes, amplify outages, and replay state captured before wake reconciliation.

**How to apply:** Preserve the adopt-before-publish foreground barrier; successful, stale-reset, authorization, and cancellation outcomes must terminate or reset the chain rather than enter network retry.