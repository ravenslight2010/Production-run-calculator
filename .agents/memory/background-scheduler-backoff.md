---
name: Background scheduler backoff
description: "Background database schedulers should stop hammering a degraded pool while readiness still reports sustained worker failures."
---

After a bounded transient retry is exhausted, each auxiliary scheduler should use
a small, capped exponential delay before starting another pass. Keep readiness
fail-closed for sustained worker failures; backoff reduces amplification during
the incident but must not turn a live worker failure into a healthy signal.

**Why:** A single process can have several independent timers polling the same
database. Repeating those polls at their normal cadence during connection
establishment failures can prolong pool pressure and create repeated readiness
flaps even when direct database probes intermittently succeed.

**How to apply:** Give each scheduler its own backoff state, reset it only after
a successful pass, and keep the existing exact transient-error classifier and
bounded retry unchanged.