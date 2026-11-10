# Research Notes: V2 Server Architecture

**Status:** complete
**Depth:** Quick

## Plan

- **Question:** Which V2 server architecture best supports active multi-device runs and auto-tracking while reducing V1's background-work and pool-pressure risks?
- **Scope:** Replit deployment fit, durable run/timer ownership, background worker isolation, shared sync/fanout, and read-only offline behavior.
- **Audience:** Product owner and technical maintainer.
- **Deliverable:** A concise, source-checked architecture recommendation with tradeoffs, limits, and a staged validation path.

## Focus Areas

| # | Area | Status | Sources |
|---|---|---|---|
| 1 | Replit deployment fit for API and worker | done | 5 |
| 2 | Durable timers, leases, and connection budgets | done | 7 |
| 3 | Multi-device delivery and recovery | done | 5 |

## Coverage Checklist

- [x] Reserved VM is documented for always-on API/worker workloads; the exact two-artifact topology still needs a small deployment prototype.
- [x] Process isolation can protect the API event loop, but separate pools require an aggregate connection budget.
- [x] Persisted job leases/claims, idempotency, and short transactions are needed; `SKIP LOCKED` or an advisory lock alone is not a complete job system.
- [x] A canonical snapshot plus durable cursor/outbox recovery is stronger than relying on SSE or Pub/Sub replay alone.
- [x] Read-only offline operation avoids a client write queue; cache the last confirmed snapshot and require online writes.
- [x] Before launch, verify Replit artifact topology, database capacity, migration/cutover, multi-device recovery, and wake/worker failure behavior.

## Findings Log

_[@key] markers reference external sources in this investigation's `sources.json`._

### Replit deployment fit

- Reserved VM is documented for always-on APIs/background workers; its deployment setup selects web-server or background-worker mode [@v2-replit-deployment-types].
- Autoscale adds servers under load and can scale to zero; Replit docs do not guarantee the stream affinity or cross-instance behavior this app would need [@v2-replit-deployment-types].
- Replit documentation confirms artifacts in a project share backend/data and publish together; artifacts do not get independent deployment modes. Separate projects have separate managed production databases, so independent projects do not satisfy the shared managed DB assumption. A Reserved VM can run multiple supervised processes, supporting a revised one-project/one-deployment API-plus-worker candidate. See [the final feasibility evidence](replit-feasibility.md).
- Documentation confirms the platform boundary, not the V2 app's process health, restart, database sharing, publish compatibility, or actual connection budget. No isolated V2 Reserved VM deployment was available in this task; the synthetic pilot remains a hard gate.

### Durable timers and worker isolation

- Node.js documents that a long callback blocks event-loop handling for other clients; moving background work to an application process can isolate that loop, but does not eliminate shared-host or shared-database contention [@v2-node-event-loop] [@v2-heroku-background-workers].
- PostgreSQL `SKIP LOCKED` can support queue-like claims, but provides neither durable job semantics nor exactly-once effects; advisory locks coordinate but do not replace persisted state [@v2-postgresql-select-locking] [@v2-postgresql-explicit-locks].
- An outbox can atomically persist a domain change plus delivery record; consumers must tolerate duplicate delivery and be idempotent [@v2-aws-transactional-outbox].
- Pool budgets must cover all API and worker instances; the existing project guidance says instance count and usable database capacity are not yet established [@pool-01-node-postgres-sizing].

### Multi-device sync and recovery

- EventSource reconnect metadata is transport state, not proof of durable server replay; snapshot/cursor recovery remains an application responsibility [@v2-whatwg-sse].
- Redis Pub/Sub is at-most-once; live notification alone is not a durable multi-device recovery log [@sse-06-redis-pubsub].
- Browser guidance documents hidden-page timer throttling; elapsed production progress should derive from persisted server timestamps/state, not client timer callbacks [@v2-mdn-page-visibility].

### Project evidence

- Five supplied research documents consistently identify always-on outbox/tick/job work, shared DB-pool pressure, wake fences, and process-local SSE as risks. They recommend cheap no-work paths, durable claims, one process until multi-instance behavior is proved, and snapshot recovery.
- Latest production telemetry in the final V1 pass showed pool max 10, acquisition p95 39.0 s/max 56.8 s, and event-loop delay max 37.9 s in the overlapping telemetry window. The configured timeout is 900 ms; runtime timeout was not directly reported. Database headroom was sampled about 41 seconds after the worst interval, and process identity was not sufficient for same-process correlation. This confirms severe stalls but not which component triggered them.
- User-reported pattern remains active-run wake/auto-track stall, sometimes briefly recovering after refresh; user stopped production testing for the day.

## Conflicts & Open Questions

- Existing research's “one API instance” is a safe interim restriction, not a proven V2 topology. Current production telemetry still does not establish serving-instance count.
- A worker process can isolate the API event loop, but it adds a database pool and shares a Reserved VM's resources. Its value depends on explicit combined connection budgets and a real Replit deployment test.
- Independent API/worker deployment modes in separate artifacts are not supported as originally proposed. Separate projects do not share a Replit-managed production database. The revised candidate is one Reserved VM deployment with supervised API and worker processes; its actual behavior remains untested.
- Existing source documents are dated 2026-11-03 through 2026-11-07; the latest Nov 9 production capture changes the confidence from “likely pool pressure” to “checkout and event-loop stalls confirmed, trigger unknown.”

## Gaps

- Filled: Replit's current docs identify Reserved VM as always-on and support multiple supervised processes in one deployment; same-project artifacts share backend/database and publish together but cannot have independent deployment modes. Separate projects have separate managed production databases.
- Filled: authoritative technical sources establish that event-loop blocking delays request handling, leases/locks need idempotency and durable state, SSE reconnect is not durable replay, and browser timers are throttled in hidden pages.
- Filled: The architecture now records the revised single-project/single-Reserved-VM/two-process candidate, the exact project/deployment/database boundary, a schema-based transfer allowlist/exclusion plan, account revalidation, fresh-count procedure, and measurable acceptance checks.
- Still required before V2 feature work: an isolated, synthetic-data Reserved VM deployment pilot proving process health/restart, shared V2 DB access, publish compatibility, and measured connection ceilings. Current task access does not include a separate V2 project or isolated publish target; do not publish the current Autoscale/V1 project.
- Owner decision: migrate setup/master data only; historical production runs do not transfer into V2.
- Owner decision: carry account identities and role assignments; require a fresh sign-in and do not transfer active sessions or reset tokens.
- Owner decision: full inventory is in V2's first usable release; seed it from a fresh physical count rather than copied V1 balances.
- Owner/management decision still needed before cutover: V1 archive access and retention period. Until set, keep V1 history preserved and read-only after an approved cutover.
- Limitation: the exact production cause is unknown; checkout and event-loop stalls are confirmed but not same-process correlated.
- Limitation: actual V2 database connection budget, Reserved VM process restart behavior, and publish overlap behavior remain unmeasured.
