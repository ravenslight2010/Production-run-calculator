---
name: Shared master-data refresh
description: Realtime propagation rule for shared recipe and catalog edits across open stations.
---

Facility-wide master-data writes should send a bounded nudge over the authenticated sync stream, scoped to the facility but independent of the station's local production date. The writer's client ID must be excluded, and receiving stations should invalidate the canonical bootstrap query so the server remains the only payload source.

**Why:** Recipe data is shared across stations while day-state synchronization is date-scoped. Sending a full recipe payload or reusing date filtering risks stale caches, cross-date coupling, and self-echo refetch loops.

**How to apply:** Keep the event small and sender-aware; clear the bootstrap validator before invalidation so an old ETag cannot turn the refresh into a cached 304. Preserve existing pending-run hydration and started-run freeze rules rather than mutating live run values from the nudge.