---
name: Owner-selected SSE topology
description: Owner's deployment choice and limits on live peer SSE support.
---

On 2026-10-10 the owner confirmed that immediate cross-process peer updates
remain required while retaining Autoscale, declined a VM switch, and approved
PostgreSQL outbox plus `LISTEN/NOTIFY` as the shared-fanout design direction.
Live peer SSE remains unsupported until implementation is safe and verified.

**Why:** The owner selected the shared-fanout direction, but the per-process
database pool can saturate and the Autoscale serving-process maximum is
unavailable. A listener consumes a persistent connection per process or one
slot from the existing pool, so the aggregate budget is not established.

**How to apply:** Keep `.replit` aligned with Autoscale and describe live peer
SSE as unsupported until peak-aligned primary capacity and Autoscale process
limits prove a safe connection budget, and cross-process delivery/replay tests
pass. The approved design direction is a durable PostgreSQL outbox with
`LISTEN/NOTIFY` as a wake-up hint; notifications are not the replay source.
Preserve soft readiness for optional AI/workers.

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