---
name: Idle downtime reports
description: Owner-reported timing pattern for production interruptions, with limits on what it proves.
---

The owner reports that they have not noticed downtime while actively using the app; the interruptions they have noticed occur while the app is idle or unused. On 2026-11-02, they also reported that most growing timeout/network-failure notices appear around phone wake. Their screenshots showed an 8.6-second authentication wait and a 1,480,032 ms network wait, both marked as backgrounded. Later that day, they reported that waking a second app/client while one remains foreground can be followed by similar symptoms on the foreground client after the waking client settles. They also reported that a warm return after backgrounding can remain unhealthy, while fully closing and reopening has worked. Screen recordings show cold launches reaching the app's server-baseline/snapshot UI and Pack views with pending-sync indicators; the owner separately identified one recording as a stopped-auto-tracking case and another as a button tap with visible feedback but no confirmed action. They later narrowed the touch symptom: switching tabs still works, but controls inside tab screens can stop responding; timers may continue while auto-tracking stops, sometimes after a manual edit followed by Resume or a peer wake. On 2026-11-05, the owner reported that during a particularly busy workday the app was opened only once and no production run was started. This is a useful low-use observation, not server telemetry. These are user-reported timing and recovery clues plus client-side evidence, not proof that a background job caused the interruption, one client corrupted another, a cold reopen fixed the underlying cause, or the server spent the browser-measured time processing.

**Why:** This makes background work, pool acquisition, timers, readiness during sparse traffic, wake-time client recovery, volatile client state, and cross-client interaction important correlation targets. A cold reopen clearing symptoms may reset client state but can also coincide with network or server recovery. Browser wait can include time suspended in the background; aggregate probes still cannot establish user-request impact or causality.

**How to apply:** In production investigations, compare warm return with cold reopen and correlate both with background-worker, database-pool, request, and client responsiveness telemetry. Include a two-client case where one stays foreground while another wakes. Separately measure tab navigation, in-screen control actions, timer progress, and auto-track claim/commit after a manual edit and Resume. Keep user observation separate from independently measured evidence; distinguish client elapsed wait from server processing, and do not infer the initiating cause from timing alone.

## Approval to repair after investigation

The owner clarified that choosing “investigate further” means to continue causal investigation, not to decline a fix. This applies consistently to prior and future investigations. Evidence-supported changes are approved once the relevant investigation is exhausted; do not ask for another approval solely because a repair is needed.

**Why:** The owner has chosen further investigation several times and clarified that these choices defer repair until the evidence is sufficient; they do not refuse the repair.

**How to apply:** Complete the relevant client, server, and background-work evidence pass, then make the narrow supported repairs and verify them. Ask again only if new product behavior or policy choices are needed.

## Approved no-work auto-track boundary

The owner approved a conservative server auto-track optimization: skip a date transaction only when the existing claim builders show no due claims and wall-clock bookkeeping is unchanged. Missing, malformed, or uncertain state must use the existing locked transaction. Keep tick cadence, claim authority, outbox polling, other worker cadence, and pool sizing unchanged.

**Why:** The owner suspects idle background work contributes to pool pressure, but preserving server authority and restart-safe claim bookkeeping takes priority over reducing work.

**How to apply:** Use this boundary when reducing scheduled auto-track database work. Validate both the idle skip and active/uncertain fallbacks; do not infer production impact without a measured before/after window.
