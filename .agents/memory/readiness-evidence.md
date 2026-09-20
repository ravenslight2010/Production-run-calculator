---
name: Readiness evidence
description: Production readiness recovery records must be bounded, identity-bound, and projected from allowlisted health fields.
---

Readiness recovery evidence should be captured by a read-only probe that stores only fixed check statuses, bounded worker counts, operation names, and timestamps. Require the published deployment identifier and full deployed Git revision explicitly; never infer either from the verifier checkout or retain the target URL/body.

**Why:** Database-worker incidents need proof of fail-closed 503 behavior and later recovery, but health responses can contain diagnostic details that should not become retained operational evidence.

**How to apply:** Use a normal-operation mode for sustained 200 checks and a recovery mode that requires a real worker-diagnostic 503 followed by a later 200. Cap samples and give the record an explicit expiry.