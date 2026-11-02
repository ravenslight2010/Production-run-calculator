---
name: Idle downtime reports
description: Owner-reported timing pattern for production interruptions, with limits on what it proves.
---

The owner reports that they have not noticed downtime while actively using the app; the interruptions they have noticed occur while the app is idle or unused. Treat this as a user-observed timing pattern, not proof that active requests are unaffected or that a background job caused the interruption.

**Why:** This makes background work, pool acquisition, timers, and readiness during sparse traffic important correlation targets, while aggregate probes still cannot establish user-request impact or causality.

**How to apply:** In production investigations, correlate the reported idle windows with background-worker and database-pool telemetry. Keep user observation separate from independently measured evidence, and do not infer the initiating cause from timing alone.
