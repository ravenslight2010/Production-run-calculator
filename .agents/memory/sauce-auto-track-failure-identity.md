---
name: Sauce auto-track failure identity
description: Automatic Sauce retry notices must follow the claim event identity, not the error message or retry attempt.
---

Automatic Sauce failure dismissal is keyed by the claim event identity. Retries reuse that identity, while a later barrel receives a new identity; accepted or duplicate success clears only the matching pending notice.

**Why:** Operators need to dismiss one repeatedly failing barrel without hiding a later barrel failure, and tab navigation must not reset the decision.

**How to apply:** Keep this state scoped to the web Home/Sauce station boundary. Do not route automatic Sauce claim failures through the global manual write-error banner, and keep manual `+1 Barrel` failures on that existing path.