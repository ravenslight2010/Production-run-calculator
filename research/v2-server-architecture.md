# V2 Server Architecture Recommendation

**Research Date:** 2026-11-09  
**Depth:** Quick, with review of existing project research  
**Sources Consulted:** 13 public technical and platform sources, plus project and production evidence

## Executive Summary

For V2, I recommend a **server-authoritative web/PWA with one stable API deployment and one bounded, dedicated auto-track worker**, using the existing PostgreSQL database as the canonical store. On Replit, the best-fit target to validate is a Reserved VM web/API service plus a Reserved VM background-worker service in the same project. Replit documents Reserved VM as always-on and suitable for API and background-worker workloads; it also documents that artifacts in a project share backend/data and publish together. Before committing to this shape, a small deployment prototype must confirm that the project can give the API and worker the intended independent runtime settings and fixed worker count. [[1]](https://docs.replit.com/features/publishing/deployment-types) [[2]](https://docs.replit.com/features/projects-and-artifacts/artifacts) [[3]](https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects) [[4]](https://docs.replit.com/features/projects-and-artifacts/projects)

This is a better starting point than putting every timer back into the API process or using Autoscale for the timer worker. It separates background timer execution from the API’s JavaScript event loop, while a single API instance keeps the current process-local live fanout simple. It does **not** make database contention disappear: the API and worker need a measured, combined connection budget, short transactions, and bounded concurrency. Node.js documents that long callbacks block other request handling, while PostgreSQL job locks and transactional outboxes still require application-level leases, idempotency, and recovery rules. [[5]](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) [[6]](https://devcenter.heroku.com/articles/background-jobs-queueing) [[7]](https://www.postgresql.org/docs/current/sql-select.html) [[8]](https://www.postgresql.org/docs/current/explicit-locking.html) [[9]](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) [[10]](https://node-postgres.com/guides/pool-sizing)

The devices should display timers from server-confirmed timestamps, not depend on browser timer callbacks to advance production. A PWA can show the last confirmed snapshot while offline, but must be read-only until it reconnects. On wake, it fetches canonical state before allowing new automatic writes. SSE can make live updates fast, but a disconnected device must recover through a durable cursor/snapshot path; neither browser reconnection metadata nor a best-effort pub/sub message is a durable record. [[11]](https://html.spec.whatwg.org/multipage/server-sent-events.html) [[12]](https://redis.io/docs/latest/develop/pubsub/) [[13]](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)

## Background

The owner’s confirmed V2 first-release scope is run control, every production station, importing, sync, and auto-tracking. Multiple devices must be able to work on the same active run from launch. If disconnected, the app is read-only. The first client is web/PWA; a separate native mobile app is not in the first-release scope.

The owner also chose to carry **setup and master data only** from V1, not historical production runs. This sets the migration direction, but the exact table-by-table allowlist, staff-account handling, physical stock baseline, and how V1 history remains accessible after cutover still need to be designed.

Existing project research points to always-running tick, outbox, and job work sharing a small database pool, plus wake fences and process-local SSE. The November 3–7 documents recommended reducing empty work, preserving claim idempotency, and not assuming that a single-process SSE implementation works across instances. Those were useful V1 safety recommendations, not a final V2 topology decision: [pool-pressure research](../attached_assets/sync-autotrack-pool-pressure-research-2026-11-03_1793731809924.md), [background-activity research](../attached_assets/background-server-activity-reduction-research-2026-11-04_1793842032833.md), [five-topic sync research](../attached_assets/sync-autotrack-five-topics-detailed-research-2026-11-04_1793844028867.md), [remaining sync research](../attached_assets/sync-autotrack-remaining-research-all-2026-11-04_1793844028922.md), [November 7 full debug](../attached_assets/full-debug-server-load-sync-autotrack-2026-11-07_1794060956928.md), and [pool/SSE topology research](db-pool-topology-research.md) / [SSE deployment research](sse-deployment-research.md).

The final V1 production review confirmed severe intermittent pool-acquisition and event-loop stalls: runtime pool maximum 10, acquisition p95 about 39 seconds and maximum about 56.8 seconds, with an overlapping event-loop maximum about 37.9 seconds. The configured acquisition timeout is 900 ms, but the observed overrun cannot be attributed to event-loop delay alone. The nearest database-capacity sample was about 41 seconds after the worst interval, and process/instance identity was insufficient to prove same-process causality. This supports isolating and budgeting background work, but it does not identify one V1 root cause. The sanitized measurement details are in [the production evidence note](v2-server-architecture/production-evidence.md).

Replit’s current documentation distinguishes Autoscale—which can add servers and scale to zero—from Reserved VM, which is intended for always-on API and background-worker use. Project artifacts share backend and data and publish together. The documentation does not fully establish the exact independent scaling/resource settings of a web artifact and worker artifact, so that needs a deployment prototype before implementation. [[1]](https://docs.replit.com/features/publishing/deployment-types) [[2]](https://docs.replit.com/features/projects-and-artifacts/artifacts) [[3]](https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects) [[4]](https://docs.replit.com/features/projects-and-artifacts/projects)

## Key Findings

### 1. Keep the API stable; isolate only the work that needs a worker

| Option | Benefit | Main risk | Assessment |
|---|---|---|---|
| One API process with all timers in-process | Fewest moving parts | Repeats the shared event-loop and pool coupling seen in V1 | Not the preferred V2 design |
| One API service plus one bounded background worker | Isolates timer/job callbacks from API request handling; both can use the same canonical database | Adds another process and pool; Replit artifact/runtime settings and DB budget must be verified | **Recommended, subject to prototype** |
| Autoscaled API/worker fleet or many feature services | Can scale separate workloads | Instance count multiplies pools; duplicate timer leadership and cross-instance fanout become harder | Defer until measured need and coordination are proven |

Node.js explains that a long-running callback prevents the event loop from processing other clients; a separate application worker can remove that particular coupling, though a separate process on the same host can still share CPU and memory. The database remains shared, so process separation is not a substitute for a connection budget. [[5]](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) [[6]](https://devcenter.heroku.com/articles/background-jobs-queueing) [[10]](https://node-postgres.com/guides/pool-sizing)

**Recommended deployment shape:** one Reserved VM API/web service and one explicitly bounded Reserved VM worker, both in the same Replit project if the deployment prototype confirms the arrangement. Keep one API instance initially so live peer fanout is not split across independent in-memory client sets. Keep one auto-track worker active, coordinated by a durable database lease/claim rather than by “one timer per app process.” Replit supports Reserved VM web-server or background-worker modes, but the actual artifact configuration and rollout behavior must be proven before treating this as a platform guarantee. [[1]](https://docs.replit.com/features/publishing/deployment-types) [[2]](https://docs.replit.com/features/projects-and-artifacts/artifacts) [[3]](https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects)

### 2. Durable run state—not a browser timer—is the authority

Persist run lifecycle changes and the timestamps needed to calculate elapsed time. The worker evaluates due work from that persisted state and server time. The PWA’s timer is display-only; when the app returns from the background it shows “Syncing,” fetches the canonical snapshot, and only then resumes eligible writes. MDN documents that browsers throttle timers in hidden pages, which is why a client interval cannot be the production clock. [[13]](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)

Represent auto-track actions as durable, idempotent operations tied to the run and station state. A worker can claim due rows in a short transaction, record a lease/claim token, process with bounded concurrency, and acknowledge only while it still owns that token. PostgreSQL documents `SKIP LOCKED` as useful for queue-like consumers, but warns that it produces an inconsistent view; row or advisory locks do not provide durable retries or exactly-once side effects by themselves. An outbox can commit a state change and delivery record together, but consumers must tolerate duplicates. [[7]](https://www.postgresql.org/docs/current/sql-select.html) [[8]](https://www.postgresql.org/docs/current/explicit-locking.html) [[9]](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

Run control, each station, and manual corrections should use online commands with an idempotency key and a canonical revision. The API validates and applies each command transactionally, then returns the accepted state. For corrections, define semantics by operation: additive changes can be represented as deltas and safely rebased; absolute replacements should surface a conflict rather than silently overwrite newer data. The exact station formulas and adjustment rules should be carried forward from V1 and tested, not re-created from memory.

### 3. Live fanout is an optimization; snapshot recovery is the guarantee

Use a durable revision/cursor and canonical snapshot for multi-device consistency. SSE may notify peers quickly, but on reconnect the client must compare its cursor with the durable server position, replay retained changes if available, or fetch a fresh snapshot if not. EventSource’s `Last-Event-ID` helps identify a reconnect point; it does not promise the server retained or replays the event. Redis Pub/Sub is at-most-once, so Pub/Sub alone cannot recover a device that missed a message. [[11]](https://html.spec.whatwg.org/multipage/server-sent-events.html) [[12]](https://redis.io/docs/latest/develop/pubsub/) [[9]](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

For the first V2 deployment, a single API instance avoids the current process-local SSE boundary splitting active peers. The durable cursor/snapshot path is still required after a phone sleeps, the browser kills a stream, or a deployment restarts. If V2 later adds multiple API instances, shared fanout/replay and aggregate pool budgeting become release gates—not assumptions.

### 4. Read-only offline behavior is a useful reliability simplification

Cache only the last confirmed data needed to display the production day and clearly show its freshness. Disable run, station, import, and auto-track writes while offline; do not keep a hidden local write queue. On reconnection, adopt canonical state before enabling writes. This matches the owner’s offline requirement and removes an entire class of delayed-write conflict/replay behavior.

Imports should be a separate staged flow: upload/parse into a reviewable preview, validate, then apply a confirmed change to canonical data. Import parsing should not hold a run timer transaction or compete unboundedly with auto-track work. The app’s existing import rules and audit evidence should be migrated deliberately.

### 5. Carry setup and master data; keep operational history separate

The current schema suggests a practical first-pass migration boundary:

- **Candidate master data to carry:** brand/flavor setup profiles; ingredient identities and approved aliases; dough, cheese, sauce, and mix recipes; production rules; applicator/die defaults; run templates; facility-wide setup settings; saved, approved specification/reference sheets and the import mappings needed to use them. These are shared configuration or reusable production knowledge, not a particular day's run.
- **Inventory configuration to carry:** item catalog, units/conversions, locations, reorder settings, and confirmed product references. **Do not copy on-hand lots, balances, or the movement ledger** as master data. Establish a fresh physical count as V2's opening inventory at cutover.
- **Keep out of the V2 migration by default:** `daily_sync`, completed-run snapshots, production-run history, live schedules, inventory lots/ledger/consumption markers, observations, QC events, surplus decisions, audit/incident records, sync cursors/outbox, active jobs/leases, and sessions/reset tokens. This follows the owner's no-history-transfer choice and avoids replaying V1 operational state into a new system.
- **Decide separately:** active user identities and role assignments. They are needed to operate V2 but are not the same as recipe/setup master data. If users are carried over, require fresh sign-in; never transfer active sessions or password-reset tokens.

Historical V1 records should remain preserved in V1 during the build. Whether V1 stays available as a read-only archive after cutover, and for how long, is a separate retention/access decision.

## Analysis

The most important tradeoff is **event-loop isolation versus database connection multiplication**. V1’s production evidence shows both long checkouts and serious event-loop delay at overlapping times, but cannot prove which caused the other. Keeping all work in one API process preserves a single pool, yet leaves user requests and timers sharing the same event loop. A separate worker protects API responsiveness from worker callback stalls, but introduces another pool and can still compete for PostgreSQL. The safest V2 design is therefore not “more processes”; it is **one stable API, one bounded worker, explicit aggregate pool limits, short transactions, and durable per-run claims**. node-postgres specifically recommends budgeting pool maxima across every process/instance and retaining headroom. The numeric limits must wait until the actual database and deployment budgets are known. [[5]](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) [[7]](https://www.postgresql.org/docs/current/sql-select.html) [[8]](https://www.postgresql.org/docs/current/explicit-locking.html) [[10]](https://node-postgres.com/guides/pool-sizing)

Replit Reserved VM is the stronger initial fit than Autoscale for this always-on operational workflow: the API and timer worker should not depend on scale-to-zero behavior, and the user needs devices to see a stable live run. Replit documents Reserved VM as suited to always-on APIs/background workers and Autoscale as a variable-traffic type that can scale to zero. However, the docs do not establish V2’s exact multi-artifact resource controls, so a proof deployment is a required first gate. The project’s unified artifact publishing means worker and API versions need a compatible release contract, even though the worker is a distinct runtime role. [[1]](https://docs.replit.com/features/publishing/deployment-types) [[2]](https://docs.replit.com/features/projects-and-artifacts/artifacts) [[3]](https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects)

The design should remain intentionally modest: one PostgreSQL source of truth; a clear run/station command model; durable worker claims; a durable outbox/cursor; and a PWA that never writes offline. Do not introduce Redis, a general event-sourcing framework, or multiple services unless the Replit prototype or measured workload shows the simpler design cannot meet the requirements. A pub/sub-only design would be particularly risky because missed live messages are not a durable record.

## Limitations

- The final V1 production telemetry confirms severe stalls but does not identify the triggering operation, establish whether all telemetry came from the same process, or prove that PostgreSQL as a whole was exhausted.
- Current Replit documentation supports always-on Reserved VM API/worker modes and shared project backend/data, but does not fully specify the exact independent resource/scale settings for the proposed two-artifact deployment.
- The production database’s usable connection capacity, provider reserves, deployment overlap, and worker/API instance limits are not established. No pool sizes are recommended here.
- The owner approved setup/master data only, not historical run transfer. Exact table allowlists, identity/role handling, opening inventory count, historical access/retention, and reconciliation rules still need design. V1 should remain the production system until V2 passes an isolated pilot and data-reconciliation checks.
- The cited Chrome timer article from 2021 was not needed for the recommendation; the browser finding is based on the current MDN Page Visibility documentation, and behavior should still be checked on the Android/browser versions in use.

## Recommendations

1. **Adopt the API-plus-dedicated-worker design as the V2 candidate**, not as a final deployment guarantee: one Reserved VM API service and one single-worker Reserved VM service in the same project if a prototype confirms the actual deployment model.
2. Before implementing run features, prove that the two runtime roles can share the V2 database, publish compatibly, restart safely, and keep the worker at one active owner. Measure the database’s usable connection budget, then assign explicit API and worker pool limits with headroom.
3. Keep PostgreSQL as the canonical source; do not switch database providers as part of the rebuild. Put run lifecycle, station state, event/cursor, and worker claims behind small, documented server contracts.
4. Make worker claims idempotent and crash-safe. A duplicate due action or worker restart must never add progress twice; a lease takeover must fence the old worker.
5. Use a durable snapshot/revision/cursor recovery path. Treat SSE as an optimization, not the only route to peer state or wake recovery.
6. Keep offline mode read-only and cache the last confirmed snapshot. Require a successful canonical adopt after wake or reconnect before automatic or manual writes resume.
7. Build in stages: (a) Replit deployment/pool-budget prototype; (b) canonical run state and worker claim model; (c) run control plus auto-track on the PWA; (d) all station modules and imports; (e) two-device, wake, worker-restart, offline, import, and load tests; (f) migrate only approved setup/master data, establish fresh opening inventory, and review cutover. Do not replace or write to V1 production data during these stages.
8. Set explicit acceptance targets before implementation: no duplicate progress on retries/restarts; visible syncing/paused states rather than silent stalls; peer changes converge within the agreed latency; no unexplained long freezes during active-run/wake tests; and idle runs produce no unnecessary claim transactions.

## Sources

1. [Deployment types](https://docs.replit.com/features/publishing/deployment-types) — accessed 2026-11-09, Tier 1 platform documentation.
2. [What's an Artifact?](https://docs.replit.com/features/projects-and-artifacts/artifacts) — accessed 2026-11-09, Tier 1 platform documentation.
3. [Multiple Artifacts vs. Separate Projects](https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects) — accessed 2026-11-09, Tier 1 platform documentation.
4. [What's a Project?](https://docs.replit.com/features/projects-and-artifacts/projects) — accessed 2026-11-09, Tier 1 platform documentation.
5. [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — accessed 2026-11-09, Tier 1 runtime documentation.
6. [Worker Dynos, Background Jobs and Queueing](https://devcenter.heroku.com/articles/background-jobs-queueing) — accessed 2026-11-09, Tier 2 platform guidance.
7. [PostgreSQL 18: SELECT](https://www.postgresql.org/docs/current/sql-select.html) — accessed 2026-11-09, Tier 1 database documentation.
8. [PostgreSQL 18: Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) — accessed 2026-11-09, Tier 1 database documentation.
9. [Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) — accessed 2026-11-09, Tier 2 architecture guidance.
10. [Pool Sizing](https://node-postgres.com/guides/pool-sizing) — accessed 2026-11-09, Tier 2 library maintainer documentation.
11. [HTML Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) — accessed 2026-11-09, Tier 1 web standard.
12. [Redis Pub/Sub](https://redis.io/docs/latest/develop/pubsub/) — accessed 2026-09-19, Tier 1 product documentation.
13. [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) — accessed 2026-11-09, Tier 2 maintained web reference.
