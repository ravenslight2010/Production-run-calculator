---
name: Database capacity evidence
description: Interpret app-owned PostgreSQL capacity samples without overstating provider or Autoscale headroom.
---

Treat PostgreSQL client-backend counts separately from application pool connections. A remaining-slot estimate is conservative PostgreSQL evidence, not proof of the hosting provider's usable quota or worst-case Autoscale capacity.

Record capture times for independently supplied Autoscale, provider-limit, and peak-metric evidence. Assess each against report generation separately; an outdated or missing source timestamp makes only that source group unknown.

Failure-stage reason codes apply prospectively. Existing unavailable samples are not backfilled and remain unclassified.

PostgreSQL wait-event counts are also prospective. If a sample lacks the optional active-wait or lock-wait fields, treat those values as unknown, not zero.

**Why:** Proxies can multiplex application connections onto fewer database backends, and provider reserves or connection policies can impose limits not represented in PostgreSQL settings. A recent sample window does not refresh unrelated manual evidence, and historical failures cannot be safely classified after the fact. Capacity samples captured before wait-event fields existed cannot establish that no waits occurred.

**How to apply:** Use the application's own connection, identify whether it reaches a recovery replica, and label unavailable readings explicitly. Keep provider reserves and Autoscale instance counts unknown unless independently measured; never infer instance count from hostnames, process IDs, or pool/backend counts. Keep the sample-window freshness check for sampled evidence and add independent source-age checks for manual values, preserving fresh groups when another source timestamp is missing or stale. Treat missing reason codes and wait-event counts on pre-update samples as expected history; verify allowlisted codes and count bounds on new samples without retrying the query or logging raw errors. Retain only bounded counts and build identity, not connection strings, role names, query text, or operational rows.
