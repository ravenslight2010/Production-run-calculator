---
name: Readiness evidence
description: Production readiness recovery records must be bounded, identity-bound, and projected from allowlisted health fields.
---

Readiness recovery evidence should be captured by a read-only probe that stores only fixed check statuses, bounded worker counts, operation names, and timestamps. Require a current, explicit provider-neutral deployment handoff containing the published deployment identifier and full deployed Git revision; never infer either from the verifier checkout or retain the target URL/body.

**Why:** Database-worker incidents need proof of fail-closed 503 behavior and later recovery, but health responses can contain diagnostic details that should not become retained operational evidence. A separate expiring handoff prevents an operator or verifier checkout from silently substituting deployment identity.

**How to apply:** Validate the bounded handoff before the first live probe, reject missing/stale/conflicting metadata, then use normal-operation mode for sustained 200 checks or recovery mode for a real worker-diagnostic 503 followed by a later 200. Cap samples and give the record an explicit expiry.

Published standard and full release verification must require the retained JSON
path and validate it against caller-supplied deployment and revision identities
before accepting GO. Development and disposable fixtures may opt out explicitly;
that opt-out must not be available to the published release command.

**Why:** A valid-but-missing readiness record otherwise leaves the release
evidence contract unable to distinguish a proven deployment from an unchecked
one.

**How to apply:** Keep the production requirement at the release verifier
boundary, require both identity arguments before validation, and require the GO
report to declare the retained readiness path.
