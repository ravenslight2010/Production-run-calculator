---
name: Owner-selected SSE topology
description: Owner's single-process SSE decision and limits on related work.
---

The owner-provided SSE brief dated 2026-10-03 selects Option A: one always-on
API process/instance. Do not implement shared fanout or claim multi-instance
live peer updates without a new owner decision.

**Why:** The owner explicitly chose the simpler single-process operating model
instead of authorizing a shared broker.

**How to apply:** Document this requirement and separately verify the actual
deployment constraint. The owner's choice is not proof that a published
deployment already enforces it. Preserve soft readiness for optional AI/workers.

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