---
name: Owner-selected SSE topology
description: Owner's deployment choice and limits on live peer SSE support.
---

On 2026-10-10 the owner confirmed that immediate cross-process peer updates
remain required while retaining Autoscale, declined a VM switch, and approved
PostgreSQL outbox plus `LISTEN/NOTIFY` as the shared-fanout design direction.
Live peer SSE remains unsupported until implementation is safe and verified.

On 2026-10-10 the owner confirmed that the database connection-budget gate
passed, allowing the outbox implementation to proceed. The supporting sanitized
capacity evidence is not attached to this source handoff.

**Why:** The owner decision cleared the implementation gate, but the prior
capacity samples alone did not prove the aggregate production budget or the
behavior of cross-process replay.

**How to apply:** Proceed with the approved durable PostgreSQL outbox and
`LISTEN/NOTIFY` wake-up design after the owner's budget confirmation, but keep
peer SSE unsupported until sanitized deployment-bound capacity evidence and
cross-process delivery/replay proof are retained. Notifications are not the
replay source. Preserve soft readiness for optional AI/workers.

The current published Autoscale deployment does not enforce one always-on API
process. Replit documents a configurable Autoscale maximum but permits scaling
to zero; deployment metadata reports the deployment type and build status, not
the effective maximum or current/peak server and process counts. A maximum of
one still does not prove always-on operation. Reserved VM is continuously
running as one VM, but its run command must still be checked for a single API
process.

**Why:** A platform capacity cap and a single-machine deployment are not the
same as proof of one continuously serving application process.

**How to apply:** Autoscale remains the selected topology, but do not claim peer
SSE support until peak-aligned capacity evidence and process-count bounds prove
a safe connection budget, and cross-process delivery/replay tests pass. A
single always-on process is no longer the selected requirement. Require owner
approval before changing deployment target or publishing; never infer live
topology from `.replit` or a successful build.