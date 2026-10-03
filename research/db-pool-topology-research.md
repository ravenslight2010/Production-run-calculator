## Repository Findings

**Revision:** `b0f9d281ece0002fc0ad9543edb8dbdac84ceeb4`

- `lib/db/src/index.ts` creates one `pg.Pool` per Node process. `DATABASE_POOL_MAX` is accepted only when it is a positive integer; otherwise `max = 10`. `connectionTimeoutMillis = 900`; no `idleTimeoutMillis`, `keepAlive`, `maxUses`, or pool-level `statement_timeout` is configured. An idle-client `error` listener logs and allows node-postgres to reconnect on later queries.
- `.replit` selects `deploymentTarget = "autoscale"`. Deployment metadata independently reported an active, successful, public Autoscale deployment. The metadata did not expose instance count, database connection capacity, proxy behavior, or pooler presence; the production URL was not retained.
- SSE client state is process-local: `artifacts/api-server/src/routes/sync.ts` stores clients in a module-level `Set`, and `broadcast()` iterates that set. There is no shared pub/sub, external fanout, sticky-session configuration, or cross-process broadcast adapter in the inspected code. A single process can fan out correctly; multiple processes cannot directly see each other’s connected clients.
- SSE connections themselves do not hold a database client continuously. The stream’s initial/recovery path and heartbeat/calc paths perform database work separately. This avoids one pool slot per open tablet, but it creates periodic database demand proportional to active clients and tick activity.
- Protected sync work uses `db.transaction()` and locks reset/document rows. The route contains multiple transaction paths for writes, rollover, operational actions, and claims. The code and tests establish lock ordering and fallback behavior, but no production transaction-duration histogram was found. The ordinary pool has no general transaction or statement deadline in `lib/db`; diagnostic persistence does set transaction-local `statement_timeout` and `lock_timeout` (900 ms caller budget / 800 ms DB budget for background diagnostics).
- Server-job workers default to concurrency `2` per process and are started after readiness. Other schedulers also start after readiness: auto-track ticks, daily rollover, web-push, master-data scans, and health/background persistence. Their exact simultaneous database demand is not represented as a single connection budget.
- Shutdown stops auxiliary loops and calls `server.close()` with a five-second force-exit. The serving shutdown path does **not** call `pool.end()`. Tests and process fixtures do call `pool.end()`, but those are not production shutdown evidence.
- Readiness performs a `SELECT 1`, checks startup state, requires an AI provider key, and checks sustained background-worker diagnostics. It returns `503` for failed dependencies or database/startup/background checks. Liveness is intentionally database-independent.

## External Evidence

1. **node-postgres pool sizing — maintainer documentation, Tier 2, current fetched copy**
   - Across multiple service instances, aggregate all pool `max` values; fixed-instance “napkin math” must preserve headroom for scaling and administration.
   - In autoscaling environments without a proxy, the guidance is to keep each pool conservative, around the default `10`, rather than multiply a large pool by an unknown instance count.
   - Saved evidence: `research/sources/pool-01-node-postgres-sizing.md` and `research/sources/pool-10-node-postgres-github.md`.
   - URLs: `https://node-postgres.com/guides/pool-sizing`; `https://github.com/brianc/node-postgres/blob/master/docs/pages/guides/pool-sizing.md`

2. **node-postgres Pool API — maintainer documentation, Tier 2**
   - When a pool is full, acquisition waits in a FIFO queue; `pool.idleCount` exposes idle clients.
   - Transactions must stay on one acquired client; dispatching transaction statements through independent `pool.query()` calls is unsafe.
   - The documented default idle timeout is 10 seconds, but this repository leaves the option at the library default rather than declaring it explicitly.
   - Saved evidence: `research/sources/pool-06-node-postgres-api.md`.
   - URL: `https://node-postgres.com/apis/pool`

3. **PostgreSQL connection settings — PostgreSQL 18 official documentation, Tier 1**
   - `max_connections` bounds concurrent server connections and is typically 100 by default, though the deployed value is environment-specific.
   - PostgreSQL reserves connection slots for superusers and, in current versions, optionally roles with `pg_use_reserved_connections`; application pools must leave room for those reserves and operational access.
   - Saved evidence: `research/sources/pool-07-postgresql-connections.md`.
   - URL: `https://www.postgresql.org/docs/current/runtime-config-connection.html`

4. **Replit deployment types — official Replit documentation, Tier 1 vendor source**
   - Autoscale adds servers under load and can scale down as low as zero when idle.
   - Reserved VM is a single dedicated VM intended for always-on APIs/background work and consistent performance.
   - Saved evidence: `research/sources/pool-08-replit-deployment-types.md` and `research/sources/pool-11-replit-autoscale.md`.
   - URLs: `https://docs.replit.com/features/publishing/deployment-types`; `https://docs.replit.com/references/publishing/autoscale-deployments`

5. **PgBouncer usage/configuration — official PgBouncer documentation, Tier 2 maintainer source**
   - Session pooling keeps a backend connection assigned for the client session; transaction pooling releases it after each transaction; statement pooling releases it after each statement and disallows multi-statement transactions.
   - Transaction/statement pooling has prepared-statement implications. Current PgBouncer can track protocol-level named prepared statements when configured with `max_prepared_statements`; otherwise transaction pooling may not preserve assumptions made by clients about prepared statements/session state.
   - Saved evidence: `research/sources/pool-04-pgbouncer-usage.md` and `research/sources/pool-05-pgbouncer-config.md`.
   - URLs: `https://www.pgbouncer.org/usage.html`; `https://www.pgbouncer.org/config.html`

## Reproduction or Measurement Design

### A. Pool budget and topology probe

Record only sanitized gauges and timings:

- process/build identifier, instance count if available, `pool.totalCount`, `pool.idleCount`, `pool.waitingCount`;
- acquisition wait duration, query/transaction duration, timeout/error code;
- active SSE connection count and background operation name;
- never record SQL parameters, day-state, recipes, request bodies, cookies, or tokens.

Formula:

```text
aggregate application connection ceiling
  <= instance_count × pool_max
     + other application services
     + migration/admin reserve
     + database/superuser reserve
```

With database capacity `C`, non-API reserve `R`, other service budget `O`, and maximum serving instances `N`:

```text
safe_pool_max <= floor((C - R - O) / N)
```

The formula must use the **maximum** Autoscale instance count, not the currently observed count. Inputs `C`, `R`, `O`, and `N` are currently unknown.

### B. Saturation test

In an isolated environment, set a small pool and run concurrent protected writes, readiness checks, health queries, server jobs, and SSE clients. Measure whether the 900 ms acquisition deadline produces bounded failures and whether queued requests recover after clients are released. Verify that a transaction acquires one client for its full duration and that no path leaks it.

### C. Multi-process fanout test

Run two API processes against the same database with two authenticated SSE clients deliberately assigned to different processes. Perform a write through process A and observe process B. Expected result under current code: process B does not receive an in-process broadcast unless some separate client recovery/read path refreshes it. Do not retain event payloads; record only whether a bounded event arrived and latency.

This test is necessary before claiming that Autoscale is safe for live peer SSE. A one-process browser test cannot establish cross-instance behavior.

### D. Deployment stream probe

Against the published app, use a disposable authenticated test account or non-sensitive health/SSE fixture. Capture only HTTP status, response headers, heartbeat arrival timestamps, disconnect/reconnect timing, and an event-type allowlist. Verify:

- initial SSE frame arrives;
- heartbeat interval is below the platform/proxy idle timeout;
- data frames are not buffered until the connection closes;
- reconnects can land on another process without losing canonical state;
- maximum instance setting and actual concurrent instance count are known.

If authenticated production probing cannot be safely isolated, mark it unavailable rather than collecting operational payloads.

### E. Shutdown drain test

Send SIGTERM with active SSE and in-flight database work. Measure server close duration, whether pool clients remain, whether a five-second force-exit truncates work, and whether a subsequent process can acquire connections. Compare explicit `pool.end()` behavior in an isolated fixture; do not change serving code as part of this research.

## Claim Assessments

| Claim | Assessment | Confidence | Evidence and limitation |
|---|---|---:|---|
| The pool defaults to 10 and can be overridden by a positive `DATABASE_POOL_MAX`. | **verified** | high | Direct implementation in `lib/db/src/index.ts`. Does not prove the production environment value. |
| Pool acquisition is bounded at 900 ms. | **verified** | high | Direct configuration. This bounds connection establishment/checkout behavior as implemented by node-postgres, but does not bound an already-running SQL statement or transaction. |
| Idle pool-client failures will not crash the process. | **partially verified** | medium | An idle-client error listener exists and tests cover resilience patterns; sustained database outage behavior and all driver error modes still require runtime evidence. |
| The current pool is safely sized for production Autoscale. | **unsupported** | high | Pool max, database `max_connections`, reserved capacity, other services, and maximum Autoscale instances are not all known. |
| The current default of 10 is a conservative starting point for autoscaling. | **verified** | medium | Supported by node-postgres maintainer guidance and local default; suitability for this workload remains unmeasured. |
| SSE clients consume one database connection each. | **contradicted** | high | SSE clients are stored in process memory; database work is performed on request/tick paths. A stream can create intermittent DB demand but does not reserve one client continuously. |
| Peer SSE works across all serving instances. | **unsupported** | high | Broadcast registry is a module-local `Set`; no shared fanout adapter or sticky-session contract was found. One-process behavior is not multi-process proof. |
| Autoscale can add/remove serving instances. | **verified** | high | Official Replit deployment documentation and current deployment metadata. Exact maximum/current count remains unknown. |
| Autoscale is automatically compatible with this application’s long-lived SSE contract. | **partially verified** | high | Autoscale is active and the app exposes SSE, but platform docs describe dynamic servers while repository fanout is process-local. Actual routing, stream lifetime, buffering, and multi-instance delivery need a bounded deployment probe. |
| Protected sync transactions are bounded by a global database statement timeout. | **contradicted** | high | General pool config has no statement timeout; only shared diagnostic transactions set local 800 ms statement/lock deadlines. |
| Readiness detects database unavailability and sustained background-worker degradation. | **verified** | high | `health.ts` and `health.test.ts` directly cover 503 and recovery behavior. |
| Readiness should require an AI provider key for core operational availability. | **needs-human** | high | Current code intentionally returns dependency error when no AI key exists, but whether optional AI should gate core floor operations is product/operating policy, not a technical fact. |
| Serving shutdown gracefully drains the database pool. | **partially verified** | high | HTTP server and auxiliary loops are stopped with a five-second force exit; production shutdown does not call `pool.end()`. Existing tests/fixtures are not production proof. |
| PgBouncer can be added transparently without reviewing transaction/session behavior. | **contradicted** | high | PgBouncer documents materially different session/transaction/statement semantics and prepared-statement configuration. The app’s transaction and session assumptions must be tested first. |

## Recommendations

1. **Do not increase `DATABASE_POOL_MAX` yet.** Keep the default 10 until the maximum Autoscale instance count and database connection capacity are known. Increasing a per-process pool multiplies connection demand elastically.
2. **Make the connection budget explicit.** Obtain `C`, `N`, reserve `R`, and other-service budget `O`; calculate a maximum per-process pool with headroom. Add bounded gauges for total/idle/waiting/wait duration, not payload logging.
3. **Treat cross-instance SSE as an unresolved reliability boundary.** Either verify a single-instance deployment constraint, add shared fanout/recovery guarantees, or use a deployment target/topology whose routing and process model are compatible with the required stream semantics. Do not infer safety from local tests.
4. **Run the two-process fanout and published stream probes before changing SSE cadence or adding `X-Accel-Buffering: no`.** Those changes should respond to observed proxy/routing behavior, not assumptions.
5. **Audit long transaction paths for bounded server-side deadlines.** The 900 ms pool acquisition deadline is not a query deadline. Add per-operation statement/lock budgets only where semantics permit, especially around optional diagnostics and background work; avoid applying an arbitrary timeout to protected canonical writes without convergence testing.
6. **If a pooler is introduced, choose its mode deliberately.** Transaction pooling is potentially compatible with short, self-contained transactions but requires prepared-statement/session-state review. Statement pooling is unsuitable for the app’s multi-statement transactions.
7. **Rehearse shutdown with active SSE and database work.** Decide whether explicit `pool.end()` belongs in bounded production shutdown, ensuring it cannot block deployment indefinitely. Record only timing/outcome evidence.
8. **Separate core readiness from optional AI if operations confirms AI is nonessential.** A possible policy is: `/livez` stays process-only; `/readyz` gates startup/database/core workers; AI health appears as a degraded dependency or separate capability check. This requires owner approval, not silent code change.
9. **Prefer one process/instance only as an explicitly verified interim assumption, not as an architectural guarantee.** Autoscale documentation says the service can scale; a hidden single-instance assumption is fragile unless the deployment limit is configured and retained as release evidence.

## Gaps

- No safe production connection-capacity value, maximum Autoscale instance count, actual current instance count, pool environment override, pooler presence, proxy timeout, or cross-instance routing evidence was available.
- No production transaction-duration or pool-wait percentile data was retained. Repository code establishes many transaction paths but not their runtime duration under floor load.
- No deterministic two-process fanout result was run in this research session; the design above is the next safe verification.
- PostgreSQL’s documented default/limits do not identify the managed database’s actual connection plan or reserved slots.
- Replit official deployment pages establish Autoscale scaling characteristics but do not, in the inspected evidence, establish this app’s active routing, sticky-session behavior, SSE idle timeout, or buffering behavior.
- No evidence establishes that the historical sync incident was caused by pool exhaustion; that would require sanitized traces or a reproduction.

## Sources

1. node-postgres, “Pool Sizing,” maintainer documentation, fetched 2026-09-19, Tier 2. URL: `https://node-postgres.com/guides/pool-sizing`. Saved: `research/sources/pool-01-node-postgres-sizing.md`.
2. node-postgres, “Pool API,” maintainer documentation, fetched 2026-09-19, Tier 2. URL: `https://node-postgres.com/apis/pool`. Saved: `research/sources/pool-06-node-postgres-api.md`.
3. PostgreSQL 18, “19.3 Connections and Authentication,” official documentation, fetched 2026-09-19, Tier 1. URL: `https://www.postgresql.org/docs/current/runtime-config-connection.html`. Saved: `research/sources/pool-07-postgresql-connections.md`.
4. PostgreSQL 18, “Appendix K PostgreSQL Limits,” official documentation, fetched 2026-09-19, Tier 1. URL: `https://www.postgresql.org/docs/current/limits.html`. Saved: `research/sources/pool-09-postgresql-limits.md`.
5. Replit, “Deployment types,” official platform documentation, fetched 2026-09-19, Tier 1 vendor source. URL: `https://docs.replit.com/features/publishing/deployment-types`. Saved: `research/sources/pool-08-replit-deployment-types.md`.
6. Replit, “Autoscale Deployments,” official platform documentation, fetched 2026-09-19, Tier 1 vendor source. URL: `https://docs.replit.com/references/publishing/autoscale-deployments`. Saved: `research/sources/pool-11-replit-autoscale.md`.
7. PgBouncer, “Usage,” official project documentation, fetched 2026-09-19, Tier 2 maintainer source. URL: `https://www.pgbouncer.org/usage.html`. Saved: `research/sources/pool-04-pgbouncer-usage.md`.
8. PgBouncer, “Configuration,” official project documentation, fetched 2026-09-19, Tier 2 maintainer source. URL: `https://www.pgbouncer.org/config.html`. Saved: `research/sources/pool-05-pgbouncer-config.md`.
9. node-postgres, “Pool Sizing” source mirror, maintainer repository, fetched 2026-09-19, Tier 2. URL: `https://github.com/brianc/node-postgres/blob/master/docs/pages/guides/pool-sizing.md`. Saved: `research/sources/pool-10-node-postgres-github.md`.