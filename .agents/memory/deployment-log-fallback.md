---
name: Deployment log fallback
description: How to preserve attribution when revision-scoped runtime logs cannot be retrieved.
---

When the revision-scoped deployment log reader is unavailable, a current-serving-build log query can still provide bounded evidence, but it is not interchangeable with revision-scoped evidence.

**Why:** A production verification attempt found that the scoped reader returned no usable records while the current-serving reader returned recent records. Without independently confirming the serving build identity, those logs could be attributed to the wrong source.

**How to apply:** Confirm deployment metadata and the live build identity first. Query only the current build's relevant time window, retain sanitized counts and ranges rather than raw logs, and keep any source-identity mismatch unresolved.

An isolated task copy's expected source record can lag behind a newer owner-controlled Publish. A mismatch proves that checkout comparison failed; it does not by itself mean the owner needs to publish that older copy.

**Why:** Official Publish logs can contain a newer independently prepared and sealed fingerprint matching the runtime even while the task-copy expectation differs.

**How to apply:** Preserve the failed checkout comparison and never synthesize an expected record from the runtime response. Compare official prepared/sealed build identities separately when verifying artifact-level telemetry availability; do not treat that narrower proof as exact Git provenance, a checkout-source-match receipt, or release approval.

Deployment-log responses can contain serialized log text despite an array-shaped documented contract. Platform severity filters may also omit application Pino error/warning records that appear under an info-level query.

**Why:** A scoped runtime investigation encountered both behaviors; treating an empty severity-filtered response as absence of application failures would have reversed its conclusion.

**How to apply:** Inspect the returned shape before parsing. Use bounded literal event queries and allowlisted application outcome fields when severity behavior disagrees with known records. Check truncation/cursors before counting; retain no raw payloads. Treat empty aggregate error metrics as missing evidence unless the API explicitly supplies zero.
