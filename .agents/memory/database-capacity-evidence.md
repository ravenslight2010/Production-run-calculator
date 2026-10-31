---
name: Database capacity evidence
description: Interpret app-owned PostgreSQL capacity samples without overstating provider or Autoscale headroom.
---

Correlate phase intervals and event-loop histogram windows only after checking
that they belong to the same process, not just the same serving revision.
Even same-process overlap cannot locate the histogram maximum within the phase
or distinguish database waiting from delayed JavaScript callbacks.

**Why:** A short configured acquisition deadline can coexist with much longer
client-observed failures during runtime stalls. Treating that observation as a
long configured deadline or pure server query time would recommend the wrong
repair.

**How to apply:** Verify the effective deadline from allowlisted runtime
evidence when available; compare interval bounds and process-envelope equality
without retaining host/process identities. Keep server execution time and
provider/host causation unknown until independently measured.

Treat PostgreSQL client-backend counts separately from application pool connections. A remaining-slot estimate is conservative PostgreSQL evidence, not proof of the hosting provider's usable quota or worst-case Autoscale capacity.

Record capture times for independently supplied Autoscale, provider-limit, and peak-metric evidence. Assess each against report generation separately; an outdated or missing source timestamp makes only that source group unknown.

Failure-stage reason codes apply prospectively. Existing unavailable samples are not backfilled and remain unclassified.

PostgreSQL wait-event counts are also prospective. If a sample lacks the optional active-wait or lock-wait fields, treat those values as unknown, not zero.

**Why:** Proxies can multiplex application connections onto fewer database backends, and provider reserves or connection policies can impose limits not represented in PostgreSQL settings. A recent sample window does not refresh unrelated manual evidence, and historical failures cannot be safely classified after the fact. Capacity samples captured before wait-event fields existed cannot establish that no waits occurred.

An authenticated production SQL gateway and deployment telemetry are separate
access paths. A rejected SQL read does not invalidate app-owned primary samples
or establish that deployment logs are unavailable. The built-in production SQL
route is documented as replica-backed, not a substitute for primary phase data.

**Why:** A read-only investigation could read build-bound primary aggregate logs
while the production SQL gateway rejected the session for lack of authentication.
An investigator initially confused missing integration discovery with missing
deployment callbacks.

**How to apply:** Exercise the documented deployment callbacks directly before
declaring telemetry unavailable. Keep provider/primary connection-phase history
and authenticated SQL permissions as separate, precisely owned access gaps.

Before declaring primary capacity or build fields missing from a log record,
inspect the bounded nested `database` and `build` objects, not only top-level
numeric fields. Keep the projection allowlisted rather than printing raw logs.

**Why:** A projection can omit available evidence when it assumes every field is
top-level. Missing projected values do not establish missing source observations.

**How to apply:** Verify the record shape locally before interpreting an absent
summary value. Correct the evidence conclusion explicitly when a projection was
incomplete; retain sampling and build-attribution limitations.

**How to apply:** Use the application's own connection, identify whether it reaches a recovery replica, and label unavailable readings explicitly. Keep provider reserves and Autoscale instance counts unknown unless independently measured; never infer instance count from hostnames, process IDs, or pool/backend counts. Keep the sample-window freshness check for sampled evidence and add independent source-age checks for manual values, preserving fresh groups when another source timestamp is missing or stale. Treat missing reason codes and wait-event counts on pre-update samples as expected history; verify allowlisted codes and count bounds on new samples without retrying the query or logging raw errors. Retain only bounded counts and build identity, not connection strings, role names, query text, or operational rows.
