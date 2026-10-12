---
name: Owner-selected SSE topology
description: Owner's deployment choice and limits on live peer SSE support.
---

On 2026-10-10 the owner confirmed that immediate cross-process peer updates
remain required while retaining Autoscale, declined a VM switch, and approved
PostgreSQL outbox plus `LISTEN/NOTIFY` as the shared-fanout design direction.
Live peer SSE remains unsupported until implementation is safe and verified.

On 2026-10-10 the owner confirmed that the database connection-budget gate
passed, allowing the outbox implementation to proceed. A sanitized production
recheck retained on 2026-10-11 does not prove a safe budget: most capacity
queries were unavailable and pool waiters reached 16. The owner later confirmed
the configured Autoscale maximum is three machines, but current/peak process
counts, peak non-API clients, and provider limits remain unknown.

On 2026-10-11 the owner approved a hybrid capacity-reporting approach: keep the
database sampler bounded and read-only, derive database-client peaks from
complete primary samples, and use manual Replit evidence for machine/process
configuration and provider limits. Replit's documented Admin API/Monitoring
surface does not provide an automatic runtime-metrics export. The report must
bind samples to a verified deployment fingerprint and fail closed when any
required source, time-window, or platform metric is missing. It must never
enable peer SSE or change deployment settings.

**Why:** Owner confirmation and sampled idle headroom are not a peak-aligned
connection budget, especially when process limits and some capacity reads are
unavailable. Isolated replay tests do not replace deployed-topology evidence.

**How to apply:** Proceed with the approved durable PostgreSQL outbox and
`LISTEN/NOTIFY` wake-up design, but keep peer SSE unsupported until sanitized
deployment-bound capacity evidence proves safe peak headroom and cross-process
delivery/replay proof passes. A bounded maximum pool calculation is useful but
does not replace representative peak and provider evidence. Use the offline
reporter to combine verified samples with manual platform evidence; unknown
inputs remain an explicit gap. Notifications are not the replay source.
Preserve soft readiness for optional AI/workers.

The current published Autoscale deployment does not enforce one always-on API
process. Replit documents a configurable Autoscale maximum but permits scaling
to zero; a configured maximum of three does not establish current/peak serving
counts. A maximum of one still does not prove always-on operation. Reserved VM is continuously
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