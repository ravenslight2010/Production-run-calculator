---
name: Sauce auto-track failure identity
description: Automatic Sauce retry notices must follow the claim event identity, not the error message or retry attempt.
---

Automatic Sauce failure dismissal is keyed by the claim event identity. Retry the same identity only when the request may not have committed (transport or transient server failure) or when the server explicitly rolled back the transaction for a correctable inventory setup issue. Accepted or duplicate success adopts canonical values and clears only the matching notice. A canonical conflict/stale result is ledgered under its event ID: adopt canonical values, retire that ID, and require an explicit retry with a fresh identity.

**Why:** Operators need to dismiss one repeatedly failing barrel without hiding a later barrel failure. Replaying a ledgered conflict with the same ID can only return the same rejection forever, while changing IDs after an uncertain commit could duplicate progress or inventory effects.

**How to apply:** Keep the notice scoped to the web Home/Sauce station boundary. Classify retryability without exposing server details; do not route automatic Sauce claim failures through the global manual write-error banner, and keep manual `+1 Barrel` failures on that existing path.