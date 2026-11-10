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
- Artifacts in one project share backend/data and publish together. The docs do not fully establish independent scaling or exact multi-artifact Reserved VM topology [@v2-replit-artifacts] [@v2-replit-multiple-artifacts].

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
- A separate worker can isolate the API event loop, but it adds a database pool. Its value depends on explicit combined connection budgets and a real Replit deployment test.
- Replit docs support always-on Reserved VM web/worker modes and shared project data; they do not fully specify the independently scaled multi-artifact deployment shape needed for a two-service design.
- Existing source documents are dated 2026-11-03 through 2026-11-07; the latest Nov 9 production capture changes the confidence from “likely pool pressure” to “checkout and event-loop stalls confirmed, trigger unknown.”

## Gaps

- Filled: Replit's current docs identify Reserved VM as always-on and support a background-worker deployment mode; same-project artifacts share backend/database and publish together. Exact independent resource and scaling controls remain unverified.
- Filled: authoritative technical sources establish that event-loop blocking delays request handling, leases/locks need idempotency and durable state, SSE reconnect is not durable replay, and browser timers are throttled in hidden pages.
- Owner decision: migrate setup/master data only; historical production runs do not transfer into V2.
- Owner decision: carry account identities and role assignments; require a fresh sign-in and do not transfer active sessions or reset tokens.
- Owner decision: full inventory is in V2's first usable release; seed it from a fresh physical count rather than copied V1 balances.
- Still to define: exact master-data allowlist, secure account revalidation, count workflow, and V1 history retention/access after cutover.
- Limitation: the exact production cause is unknown; checkout and event-loop stalls are confirmed but not same-process correlated.
- Limitation: the database provider's usable connection budget, Replit worker/API maximum counts, and deploy-overlap behavior are unknown.
- Limitation: no table-level V1-to-V2 mapping or production cutover design has been approved.
