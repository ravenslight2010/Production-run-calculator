---
name: Explicit profile acknowledgement
description: The standalone manager profile editor requires canonical server acknowledgement before fan-out or success.
---

Explicit manager setup edits must use the authoritative profile-write path and verify that the server response contains the submitted values, not merely the submitted key. Failed, malformed, or canonical-conflict responses keep the queued operation available for retry; implicit run-form saves remain stamp-guarded.

**Why:** A stamp-guarded upsert can return HTTP 200 with the older canonical row when a stale device loses LWW. Treating that response as success made the editor report a local-only save and propagate stale setup.

**How to apply:** Any deliberate manager editor save should await the strict profile queue boundary and only then show success or call profile propagation. Keep authoritative writes capability-gated separately from ordinary autosaves.