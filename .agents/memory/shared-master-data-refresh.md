---
name: Shared configuration refresh
description: Realtime propagation rule for shared recipe, profile, and facility configuration edits across open stations.
---

Facility-wide configuration writes should send an allowlisted, bounded invalidation nudge over the authenticated sync stream, scoped to the facility but independent of the station's local production date. The writer's client ID must be excluded, and receiving stations must reload the affected family from its canonical server source rather than trusting event payload data. Reconnect baselines must reconcile every family so missed events recover without polling.

**Why:** Recipes, profiles, name links, die types, tombstones, and PIN-safe settings are shared across stations while day-state synchronization is date-scoped. Sending full values risks secret/request-body leakage, stale caches, cross-date coupling, and self-echo loops.

**How to apply:** Emit only after a successful commit. Keep the family vocabulary fixed and sender-aware; map each family to its canonical fetch/reconcile path. If a mounted consumer otherwise owns a one-time copy, back it with an observable canonical cache so refetches actually reach the open UI. Clear bootstrap validators before invalidation, and treat an empty canonical tombstone list as meaningful so remote restores can clear stale local names. Preserve pending-run hydration and started-run freeze rules rather than mutating live run values from the nudge.