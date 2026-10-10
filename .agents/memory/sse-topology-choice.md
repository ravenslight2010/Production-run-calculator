---
name: Owner-selected SSE topology
description: Owner's deployment choice and limits on live peer SSE support.
---

The owner decided on 2026-10-10 not to switch the production deployment to a
VM; Autoscale remains the selected target. Shared fanout has not been approved,
so live peer SSE must remain unsupported unless the owner makes a new topology
decision.

**Why:** The owner declined the availability and deployment tradeoff of a VM,
and has not authorized the separate shared-fanout architecture needed for
cross-process SSE on Autoscale.

**How to apply:** Keep `.replit` aligned with Autoscale and describe live peer
SSE as unsupported. Do not implement shared fanout or claim multi-instance
delivery without explicit approval. Preserve soft readiness for optional
AI/workers.

The current published Autoscale deployment does not enforce one always-on API
process. Replit documents a configurable Autoscale maximum but permits scaling
to zero; deployment metadata reports the deployment type and build status, not
the effective maximum or current/peak server and process counts. A maximum of
one still does not prove always-on operation. Reserved VM is continuously
running as one VM, but its run command must still be checked for a single API
process.

**Why:** A platform capacity cap and a single-machine deployment are not the
same as proof of one continuously serving application process.

**How to apply:** Treat Autoscale as unverified for the SSE policy unless
separate documented settings and runtime evidence prove both always-on
operation and a single process. Require owner approval before changing target
or publishing; never infer live topology from `.replit` or a successful build.