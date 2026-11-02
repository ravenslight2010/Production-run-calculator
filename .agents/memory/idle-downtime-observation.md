---
name: Idle downtime reports
description: Owner-reported timing pattern for production interruptions, with limits on what it proves.
---

The owner reports that they have not noticed downtime while actively using the app; the interruptions they have noticed occur while the app is idle or unused. On 2026-11-02, they also reported that most growing timeout/network-failure notices appear around phone wake. Their screenshots showed an 8.6-second authentication wait and a 1,480,032 ms network wait, both marked as backgrounded. Treat this as a user-observed timing pattern plus client-side evidence, not proof that a background job caused the interruption or that the server spent that time processing.

**Why:** This makes background work, pool acquisition, timers, readiness during sparse traffic, and wake-time client recovery important correlation targets. Browser wait can include time suspended in the background; aggregate probes still cannot establish user-request impact or causality.

**How to apply:** In production investigations, correlate the reported idle/wake windows with background-worker, database-pool, request, and client responsiveness telemetry. Keep user observation separate from independently measured evidence; distinguish client elapsed wait from server processing, and do not infer the initiating cause from timing alone.
