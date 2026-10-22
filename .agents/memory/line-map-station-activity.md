---
name: Line Map station activity
description: Approved evidence boundaries for real station-age display.
---

Station-age display must use a server-accepted event tied to the selected run. A fresh projection may show elapsed age even when the event itself is old; missing or stale projections, future timestamps, and mismatched runs remain unknown. Freeze Tunnel and Warehouse use explicit on-screen confirmations. Keep activity evidence in the time-varying operational projection, not the persisted sync snapshot or production counters.

**Why:** Run-wide edit time and counters can change for unrelated reasons and do not prove that a station was active. The owner approved explicit confirmations for Tunnel and Warehouse instead of guessing.

**How to apply:** When adding station sources, define the authoritative action, run identity, server timestamp, freshness rule, and unknown-state behavior. Preserve run lifecycle and production math.
