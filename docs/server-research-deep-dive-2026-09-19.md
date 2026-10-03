# Server Research Deep Dive — Sync, SSE, Pool, and Limits

**Date:** 2026-09-19
**Parent:** [Server research overview](server-research-2026-09-19.md)
**Related:** [Unified reliability plan](sync-reliability-unified-plan-2026-09-19.md), [Sync deep dive](sync-deep-dive-2026-09-19.md), [2026-09-19 operations research](../research/sync-reliability-operations-deep-dive-2026-09-19.md)

## 1. Request and document limits

The API has two distinct limits:

- Express JSON parsing: `10mb`.
- Sanitized aggregate sync document: 512 KB.

`sanitizeSyncPayload` enforces structural bounds before the protected write. `capMergedResult` applies the same aggregate target after merge and removes bounded optional bulk fields before rejecting an oversized retained result.

Do not use the 10 MB parser ceiling as a sync performance target.

## 2. Protected write transaction

The critical order is:

```text
transaction
  lock reset epoch
  reject stale epoch
  lock daily document
  validate/reconstruct partial input when present
  apply server clock clamps
  protectRunValues
  cap/canonicalize/apply reset boundary
  update or insert
commit
record conflict diagnostics
broadcast canonical result
```

Reset fencing and partial-base validation occur under lock. Conflict logging is outside the successful write transaction and must not roll back accepted plant state.

Patch or alternate encodings must reconstruct a full candidate before the existing protected merge pipeline. Do not patch inside `protectRunValues`.

## 3. SSE

The handler:

- registers scoped, date-specific clients in process;
- removes clients on response close;
- sends an initial complete frame even for an empty day;
- emits a roughly 15-second heartbeat;
- emits active live-calc frames on a shorter cadence;
- uses cached `client.lastData` for calc ticks;
- reads canonical/reset state on the separate heartbeat path;
- conditionally sends partial peer frames when safe and materially smaller;
- sends complete frames on gaps or when partial is not worthwhile.

The handler does not currently set `X-Accel-Buffering: no`. Add it only after confirming the deployed proxy needs it. The active deployment target is Autoscale, and official Replit documentation confirms that Autoscale can add servers and scale to zero. The reviewed documentation does not explicitly guarantee or prohibit SSE, affinity, buffering, or stream duration. Because fanout is process-local, multiple serving instances would require shared fanout or another verified ownership model. Treat this as a compatibility risk requiring a sanitized live probe, not a confirmed outage.

## 4. Database pool

Current relevant settings:

- `connectionTimeoutMillis: 900`;
- validated positive `DATABASE_POOL_MAX`, default 10;
- idle-pool error handler;
- no pool-level `keepAlive` or `statement_timeout` in the inspected configuration.

Size the pool against actual database connection limits and serving-instance count. SSE clients do not hold database clients. Keep protected write transactions short.

Use `safe_pool_max <= floor((database_capacity - reserves - other_services) / maximum_instances)`. The deployed database capacity, reserves, other-service budget, maximum Autoscale instances, and production pool override are not established by repository evidence. Do not increase the per-process pool until those inputs are known.

## 5. Health and diagnostics

- `/livez` reports process liveness.
- `/readyz`, `/healthz`, and `/` include startup, database, AI-configuration, and sustained background-worker state.
- Current readiness returns 503 when neither configured AI key is available.
- The readiness key check is inconsistent with the active adapter: readiness accepts `OPENAI_API_KEY`, while the adapter supports Replit Gemini credentials or direct `GOOGLE_API_KEY`. Correct this configuration defect before deciding the broader readiness policy.
- Manager-facing `GET /api/sync/health` already exists and is included in authorization inventory.
- Sync health is read-only and must not auto-repair canonical data.

Whether optional AI absence should degrade diagnostics rather than fail readiness is a product and operating-policy decision.

## 6. Shutdown

Current shutdown stops auxiliary workers, calls `server.close()`, and force-exits after five seconds. It does not explicitly:

- send an SSE shutdown event;
- call `pool.end()` in the serving shutdown path.

Any graceful-drain improvement must remain bounded so a dead stream cannot block deployment indefinitely.

## 7. Safe metrics

Recommended bounded instrumentation:

```text
sync.put.mode
sync.put.bytes
sync.put.runs
sync.partial_fallback
sync.sse.clients
sync.sse.frame_bytes
pg.pool.waiting
pg.pool.idle
```

The listed names are proposed metrics, not current production evidence. Record counts, modes, timings, revisions, and byte lengths only; never record operational payload content.

## 8. Priorities

1. Measure current complete/partial PUT and peer-frame behavior.
2. Verify proxy buffering and idle timeout against the existing heartbeat.
3. Document pool sizing against the actual deployed topology.
4. Decide AI-readiness semantics.
5. Improve explicit SSE/pool shutdown only if deploy evidence shows a need.
6. Introduce a multi-instance fanout adapter only when a second serving instance exists.

Provider-specific proxy, timeout, and pool assumptions require deployment evidence; do not infer them from old Docker, Caddy, or host configuration files.