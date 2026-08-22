---
name: Strict profile acknowledgement
description: The invariant for explicit profile-save acknowledgement boundaries
---

An explicit profile-save acknowledgement boundary must await the entire coalesced queue, including follow-up work scheduled as an in-flight flush completes, before deciding whether persistence succeeded.

**Why:** A single-flight background flush can resolve while its `finally` callback is scheduling a newer queued operation. Checking the queue immediately afterward produces a false pending-save error even when the API acknowledged every write.

**How to apply:** Keep ordinary flushes best-effort and retryable, but make strict callers drain successive flights and re-check the queue. Preserve the queue and surface the actual error when a response is failed or does not acknowledge every submitted item.