# Server Research — API

**Date:** 2026-09-19
**Scope:** Server capabilities, boundaries, and priorities
**Related:** [Server deep dive](server-research-deep-dive-2026-09-19.md), [sync deep dive](sync-deep-dive-2026-09-19.md), [capability research](capability-research-pack-2026-09-18.md)

## 1. Server ownership

The API is authoritative for:

- protected day-state merge and snapshot contracts;
- live calculation, timers, and operational projection;
- authentication, capabilities, and reset-boundary sessions;
- inventory, warehouse coverage, and master-data writes;
- operational intent ledgers and read-only sync diagnostics;
- bounded background work and health reporting.

It is not a thin CRUD proxy.

## 2. Strengths to preserve

- Protected additive merge with blank, tombstone, reset, and history guards.
- Partial PUT validation under the daily row lock.
- Conditional partial SSE with complete recovery fallback.
- Server-owned live projection.
- Separate liveness, readiness, and sync-health concepts.
- Short database acquisition timeout and bounded payload structures.
- Convergence, large-day, SSE, role, and pool-pressure test surfaces.

These are implementation strengths, not a production-readiness claim.

## 3. Research conclusions

### Sync

Partial sync already exists. Prioritize measurement and targeted expansion before adding another patch representation. JSON Patch remains optional and must reconstruct a full candidate before protected merge.

### SSE

The heartbeat and conditional partial peer frames already exist. Remaining work is deployed-proxy verification, device health, conflict visibility, and multi-instance fanout only if the topology grows.

### Database

Keep transactions short and broadcasts outside the transaction. Confirm pool sizing against the actual database and serving-instance count before changing defaults.

### Readiness

Current readiness treats missing AI configuration as unavailable. Deciding whether floor operations should remain ready with AI degraded is a product-policy decision.

### AI

AI failures must remain isolated from sync and liveness. Retained routes need bounded input/output, timeouts, safe cost telemetry, and no payload logging.

### Heals and jobs

Repairs are break-glass operations. Preserve idempotency, scope, audit records, definition fingerprints, leases, and fail-closed behavior.

### Deployment

Do not infer live proxy, timeout, replica, or connection limits from repository configuration alone. Verify the active deployment before setting operational recommendations.

## 4. Ordered server priorities

| Priority | Work |
|---|---|
| P0 | Measure current partial/full PUT and SSE frame behavior safely |
| P0 | Strengthen reconnect causality without weakening fallback |
| P1 | Add complete per-device health and client conflict visibility |
| P1 | Verify proxy buffering, idle timeout, and database pool sizing |
| P2 | Decide AI readiness and bounded graceful-drain semantics |
| P3 | Add shared SSE fanout only for a measured multi-instance need |

## 5. Non-goals

- Replacing PostgreSQL with a document database.
- Event-sourcing the entire day-state during partial-sync work.
- Moving live calculation back to client authority.
- Replacing SSE with WebSockets without measured need.
- Allowing sync-health checks to repair data.
- Raising parser or document caps instead of measuring payload structure.

## 6. Evidence boundary

Release readiness, deployed proxy behavior, real payload percentiles, partial-fallback rates, and facility device counts require revision-bound or owner-verified evidence. Repository structure alone does not prove them.