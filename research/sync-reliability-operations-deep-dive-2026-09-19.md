# Sync Reliability and Operations Deep Dive

**Research date:** 2026-09-19  
**Depth:** Deep  
**Repository revision:** `b0f9d281ece0002fc0ad9543edb8dbdac84ceeb4`  
**Sources consulted:** 30 deduplicated external sources, current repository implementation, focused tests, and sanitized deployment metadata  
**Evidence boundary:** No credentials, production payloads, database records, user identifiers, recipe content, request bodies, or SSE frame content were retained.

## Executive summary

The current sync implementation is materially safer and more efficient than a full-state-only design. Partial writes are tied to a canonical snapshot, validated while the daily row is locked, and rejected into a complete authoritative fallback when the base is stale. Conditional partial peer frames also reduce same-process SSE traffic. Those protections address many reconnect and payload-growth risks.

One stale-write path remains structurally possible: a complete day-state write has no equivalent snapshot or revision precondition, while per-run conflict resolution trusts client-authored timestamps. A disconnected client carrying an old run value and a numerically newer timestamp can therefore win the LWW comparison even though it never observed the intervening edit. HTTP conditional requests and optimistic-concurrency guidance use validators specifically to prevent this lost-update class. [[1]](https://www.rfc-editor.org/rfc/rfc9110.html) [[2]](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage) Physical time alone is not a causal ordering mechanism. [[3]](https://www.cs.cornell.edu/courses/cs614/2002sp/Clocks.Lamport.1.pdf) This is a verified protocol possibility, not a verified production incident.

The published service is currently an active, successful public Replit Autoscale deployment. Official documentation confirms that Autoscale adds and removes servers with traffic, can scale to zero, and exposes a configurable maximum server count. [[11]](https://docs.replit.com/features/publishing/deployment-types) [[12]](https://docs.replit.com/references/publishing/autoscale-deployments) The application’s SSE registry is process-local, so cross-instance delivery is not established. Official Replit pages reviewed do not explicitly guarantee or reject SSE, sticky sessions, buffering, or stream lifetime; those properties require a sanitized live probe. Reserved VM is the documented dedicated, always-on alternative, but it does not by itself prove SSE correctness. [[13]](https://docs.replit.com/references/publishing/reserved-vm-deployments)

Database capacity is likewise unresolved rather than demonstrably unsafe. Every process creates a pool with default maximum 10 and a 900 ms acquisition timeout. Pool sizing must account for the maximum number of serving instances, other services, and reserved database capacity. [[18]](https://node-postgres.com/guides/pool-sizing) [[20]](https://www.postgresql.org/docs/current/runtime-config-connection.html) No evidence currently establishes the deployed database connection ceiling, maximum Autoscale instance count, production pool override, or transaction-duration distribution.

The most concrete newly discovered defect is in readiness configuration. `/readyz`, `/healthz`, and `/` accept either `AI_INTEGRATIONS_GEMINI_API_KEY` or `OPENAI_API_KEY` as proof that AI is configured, while the active adapter uses Replit Gemini credentials or `GOOGLE_API_KEY`. A direct-Gemini-only environment can therefore be reported degraded despite a usable provider, and an OpenAI-key-only environment can be reported ready even though that adapter does not use the key. Separately, whether optional AI should make the whole operational service unready is a product policy decision. Readiness should gate dependencies required for core traffic; soft dependencies should degrade the affected capability rather than indiscriminately remove unrelated service traffic. [[23]](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/) [[24]](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html)

## Research method and evidence

The review combined four evidence classes:

| Evidence class | What it can establish | What it cannot establish |
|---|---|---|
| Repository implementation | Current contracts, lock order, limits, headers, pool configuration, and readiness logic | Production frequency, latency, topology, or incident causality |
| Focused automated tests | Deterministic behavior for covered fixtures | Uncovered future-clock complete writes, production network behavior, or real payload distributions |
| Sanitized deployment metadata | Current target, active build state, and visibility | Proxy buffering, stream lifetime, instance count, affinity, or database capacity |
| External primary sources | Standards and platform/runtime guidance | Whether this particular deployment currently exhibits a failure |

Focused verification ran 99 tests across sync-contract, merge-protection, and health suites; all passed. This confirms the mechanics those tests cover. It does not add the missing future-clock complete-write case or constitute production evidence.

## Finding 1: reconnect fencing is strong, but complete writes retain a causal gap

Partial writes carry `syncVersion: 1` and `baseSnapshotId`. The server locks the reset fence and daily document, validates the base against that locked canonical state, reconstructs omitted sections, and only then runs normalization, merge protection, capping, and persistence. A stale, malformed, missing, or raced base is not applied; the response is a complete authoritative `partialFallback`.

Foreground recovery also provides multiple client-side protections: baseline gating, generation fencing, adopt-before-publish ordering, cancellation of obsolete recovery work, and a single-flight queue that replaces older queued state with the newest local snapshot. These mechanisms make the ordinary wake path substantially safer than a naive offline queue.

The remaining path is specific:

1. Devices A and B adopt the same run value and timestamp.
2. A writes a newer value.
3. B remains offline and does not observe A.
4. B later sends its old value in a **complete** document with a numerically larger client timestamp.
5. Complete writes do not prove their base snapshot.
6. The per-run LWW comparison accepts B because its timestamp is larger.

Lamport’s ordering work explains why a larger physical timestamp does not prove that the event observed another event. [[3]](https://www.cs.cornell.edu/courses/cs614/2002sp/Clocks.Lamport.1.pdf) Hybrid logical clocks can preserve happened-before relationships while remaining near wall-clock time, but introducing HLC values alone would not replace a server-enforced base precondition. [[4]](https://www.usenix.org/system/files/conference/hotcloud15/hotcloud15-demirbas.pdf)

### Claim assessment

| Claim | Assessment | Confidence | Boundary |
|---|---|---:|---|
| Stale partial writes can overwrite across a mismatched base | **Contradicted** | High | The under-lock snapshot check returns complete fallback without applying the sparse write |
| A stale complete write with a future client timestamp can win | **Verified as a protocol possibility** | High | Directly follows from complete-write handling and LWW comparison; focused end-to-end regression case is still missing |
| This mechanism caused the historical production overwrite | **Unsupported** | High | No revision-bound trace or deterministic incident reproduction was provided |
| Current wake recovery eliminates every stale-write path | **Partially verified** | High | Strong for successful foreground recovery; not universal across complete writes and all entry points |

### Decision

Extend an explicit snapshot or revision precondition to ordinary complete writes before changing the timestamp model. On mismatch, return canonical state and require rebase. A future-stamp policy may be added as defense in depth, but clamping timestamps alone does not establish causality.

## Finding 2: partial sync saves fixture bytes, but production economics are unmeasured

The current sparse contract is purpose-built and is not RFC 6902 JSON Patch. JSON Patch is an ordered operation language with `add`, `remove`, `replace`, `move`, `copy`, and `test`. [[5]](https://www.rfc-editor.org/rfc/rfc6902.html) JSON Merge Patch has different null and array semantics that do not map cleanly onto this application’s tombstones and protected run lists. [[6]](https://datatracker.ietf.org/doc/html/rfc7396)

Existing tests already measure useful synthetic behavior. A 32-run fixture records complete and partial request/response sizes, latency, merge time, and convergence, and asserts more than 50% request savings for the covered one-run sparse update. SSE fixture coverage compares actual partial peer bytes with equivalent complete frames. This verifies material savings for those fixtures, not for production traffic.

The application has three distinct size layers:

| Layer | Current fact |
|---|---|
| Express parser | 10 MB request parser ceiling |
| Sanitized aggregate document | 512 KiB application bound |
| Transport | HTTP/SSE framing and optional content encoding, not yet retained as production distributions |

HTTP compression is negotiated separately from application document limits. [[7]](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression) SSE also adds line framing and blank-line delimiters around serialized data. [[8]](https://html.spec.whatwg.org/multipage/server-sent-events.html) Compression therefore cannot replace structural reduction or the 512 KiB safety cap.

The next evidence should be low-cardinality histograms and counters, not payload logging. Tail percentiles matter because averages can hide fallback and near-cap behavior. [[9]](https://sre.google/workbook/monitoring/) OpenTelemetry’s metrics model supports histogram aggregation and attribute removal for this purpose. [[10]](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)

Recommended dimensions are limited to mode, direction, outcome, bounded run-count bucket, byte histogram, duration histogram, and fallback/complete/partial counters. Do not label by user, device, facility, date, snapshot, run, recipe, or arbitrary error text.

### Decision

Retain the current sparse contract. First measure complete, partial, fallback, unchanged, and peer-frame distributions separately. Expand sparse coverage only for demonstrated hot sections. Treat JSON Patch as optional future encoding, not prerequisite architecture. Do not use 500 KB as a p95 target; 512 KiB is a hard sanitized-document ceiling, not a performance objective.

## Finding 3: Autoscale plus process-local SSE is an unresolved topology boundary

The SSE route establishes `text/event-stream`, disables ordinary caching, keeps the connection alive, flushes headers, emits an initial complete frame, and sends a default heartbeat approximately every 15 seconds. It removes clients and clears timers on response close. A peer baseline advances only after `response.write()` succeeds.

The peer registry is a module-level in-process set. A write handled by process A can broadcast to clients connected to process A. The code contains no shared fanout bus that would notify clients connected to process B. The initial/recovery complete frame and snapshot-aware wake path can repair gaps later, but they do not make a missed live notification instantaneous.

Official Replit documentation establishes that Autoscale can add servers and scale to zero. [[11]](https://docs.replit.com/features/publishing/deployment-types) [[12]](https://docs.replit.com/references/publishing/autoscale-deployments) The reviewed pages do **not** publish a stream-duration guarantee, buffering policy, sticky-session guarantee, or numeric maximum instance count. It would therefore be inaccurate to say Replit officially prohibits SSE on Autoscale. It is equally inaccurate to claim the current process-local fanout reaches every peer under scale-out.

SSE clients reconnect automatically after a stream closes, and comment lines can be used as keep-alives. [[8]](https://html.spec.whatwg.org/multipage/server-sent-events.html) Proxy buffering and read timeouts remain independent variables: NGINX, for example, buffers upstream responses by default and applies read timeout between upstream reads. [[15]](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) `flushHeaders()` only establishes Node’s side of prompt header delivery. [[16]](https://nodejs.org/api/http.html#class-httpserverresponse)

A shared bus would address cross-process notification, but a basic Redis Pub/Sub channel is at-most-once and cannot replace canonical snapshot recovery. [[17]](https://redis.io/docs/latest/develop/pubsub/) Any bus design must preserve complete recovery after missed messages.

### Safe live verification

An authenticated probe should retain only status, allowlisted headers, time to headers, time to first frame, heartbeat gaps, close category, reconnect delay, frame mode, and revision/build identity. It must discard frame contents and avoid credential-bearing URLs. The probe should cover idle heartbeats, a second-client synthetic write, reconnect, multiple tabs, and—if controllable—a scale event.

### Decision

The 2026-09-20 sanitized published probe observed prompt complete baselines, prompt peer frames for two concurrent streams, a roughly 14.2-second heartbeat gap, and complete reconnect recovery in 146 ms. It did not expose instance identity or force cross-instance routing. A deterministic two-process fixture then proved that a process-B stream misses a process-A write while a reconnect to process B recovers the complete canonical snapshot from the shared database. See [SSE scale verification](sse-scale-verification-2026-09-20.md).

Therefore, if Autoscale remains able to serve from more than one process, shared fanout is required for prompt peer updates. Complete initial/reconnect recovery must remain authoritative even with shared fanout. The alternatives are a verified single-serving-process constraint or an always-on single-server topology. The probe found no reason to change heartbeat cadence or add proxy-specific headers.

## Finding 4: pool defaults are defensible, but production capacity is unknown

Each Node process creates one `pg.Pool`. The default maximum is 10 unless `DATABASE_POOL_MAX` is a positive integer; acquisition/connection timeout is 900 ms. SSE connections do not reserve a database client for their lifetime, although initial reads, heartbeats, projections, and writes create periodic database demand. Background worker concurrency and scheduled jobs add per-process demand after startup.

node-postgres recommends budgeting pool maximum across every service instance and retaining headroom, especially in autoscaling environments. [[18]](https://node-postgres.com/guides/pool-sizing) Its Pool API queues acquisition when all clients are busy and exposes total, idle, and waiting counts. [[19]](https://node-postgres.com/apis/pool) PostgreSQL’s server connection limit and reserved slots are deployment-specific inputs. [[20]](https://www.postgresql.org/docs/current/runtime-config-connection.html)

The required budget is:

```text
safe_pool_max <= floor((database_capacity - reserves - other_services) / maximum_instances)
```

The current evidence does not provide database capacity, administrative reserve, other-service demand, maximum Autoscale instances, active instance count, production pool override, pooler presence, or transaction-duration percentiles. Increasing the per-process pool now could multiply total demand under scale-out without solving long transactions.

The 900 ms acquisition timeout is not a statement or transaction timeout. Protected writes contain deliberate locks and should not receive arbitrary deadlines without convergence testing. Optional diagnostics and background operations are better candidates for short statement/lock budgets.

PgBouncer is also not a transparent toggle. Session, transaction, and statement pooling have different transaction and prepared-statement semantics. [[21]](https://www.pgbouncer.org/usage.html) [[22]](https://www.pgbouncer.org/config.html)

### Decision

Keep pool maximum conservative until the four budget inputs are known. Add bounded pool gauges and acquisition/transaction histograms. Run an isolated saturation test and two-process fanout test. If a pooler is considered, validate transaction and session assumptions before deployment.

## Finding 5: readiness has a provider-key defect and an unresolved policy boundary

Liveness is intentionally process-only. Readiness waits for startup, executes `SELECT 1`, checks AI configuration, and evaluates sustained background-worker failures. Database/startup/background failures are plausible core reasons to return 503.

The AI configuration check is incorrect relative to the adapter:

| Environment configuration | Current readiness interpretation | Adapter reality |
|---|---|---|
| Replit Gemini key | Configured | Supported |
| `GOOGLE_API_KEY` only | Not configured | Supported |
| `OPENAI_API_KEY` only | Configured | Not used by the active Gemini adapter |
| No AI key | Not configured | AI calls unavailable |

This mismatch should be fixed independently of the broader policy decision.

Kubernetes defines readiness as traffic eligibility and liveness as process recovery; readiness may include dependencies required to serve expected requests. [[23]](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/) AWS distinguishes hard dependencies from soft dependencies and recommends preserving core business value through graceful degradation where safe. [[24]](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html) Circuit breakers prevent repeated failing calls from consuming resources and belong around provider use rather than process liveness. [[25]](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) Service health promises should match what users actually depend on. [[26]](https://sre.google/sre-book/service-level-objectives/)

Repository architecture indicates that sync and most floor operations do not invoke AI, while retained extraction and unresolved-name workflows do. That supports treating AI as a degraded capability unless owners explicitly define those workflows as mandatory for every service instance or shift.

### Decision

First align readiness with the actual provider adapter. Then obtain an owner decision: if AI-assisted workflows are optional during production execution, remove AI from global core readiness and expose named AI capability health instead. Keep bounded provider timeout/retry/circuit-breaker behavior inside retained AI routes. Transient provider errors may be retried selectively; configuration, authentication, quota, and invalid-request failures require different handling. [[27]](https://platform.openai.com/docs/guides/error-codes)

## Cross-cutting analysis

All five areas point to the same architectural rule: canonical recovery is more important than assuming uninterrupted delivery. Partial snapshot preconditions protect sparse writes; complete writes should gain equivalent causality. SSE provides low-latency notification, but complete initial/recovery reads remain the authority after gaps. A future shared bus can improve timeliness but must not become the only recovery source. Database pool sizing must consider every elastic process rather than one local runtime. Readiness must describe the service’s core contract rather than the presence of every optional integration.

The evidence also separates three kinds of work that should not be combined:

1. **Correctness fixes:** align AI readiness keys and add a complete-write base precondition.
2. **Measurement:** collect bounded sync size/mode histograms, pool wait/transaction distributions, and sanitized SSE timing.
3. **Topology decisions:** choose shared fanout versus a verified single-server/always-on deployment model, and size the database pool from known capacity.

Changing deployment type, adding Pub/Sub, raising pool size, adopting JSON Patch, or globally clamping timestamps before these measurements would introduce complexity without resolving the established gaps.

## Prioritized recommendations

| Priority | Recommendation | Evidence level |
|---:|---|---|
| 1 | Correct readiness key detection to use the same provider configuration as the active adapter | Verified defect |
| 2 | Add a focused regression proving current future-clock complete-write behavior, then require a complete-write snapshot/revision precondition | Verified protocol gap; incident causality unproven |
| 3 | Run the sanitized published SSE probe and a two-process fanout test | High-impact topology unknown |
| 4 | Add low-cardinality complete/partial/fallback/SSE size and timing histograms | Production economics currently unknown |
| 5 | Obtain maximum Autoscale instances and database connection capacity; compute the explicit pool budget | Required capacity inputs missing |
| 6 | Decide whether AI is a hard operational dependency or degraded optional capability | Owner policy decision |
| 7 | Evaluate shared fanout or Reserved VM only after probe results | Architecture decision, not immediate fix |
| 8 | Keep JSON Patch, compression, pool-size increases, and proxy-specific headers deferred until evidence supports them | Avoid premature complexity |

## Limitations

An authenticated production SSE probe was performed on 2026-09-20 under the evidence boundary documented in [SSE scale verification](sse-scale-verification-2026-09-20.md). It did not retain production payloads or records and could not establish active instance count, affinity, forced cross-instance routing, a platform stream-duration guarantee, database connection capacity, production pool override, pooler presence, actual payload distributions, or historical incident causality.

External Replit documentation establishes Autoscale scale-out/scale-to-zero and Reserved VM’s always-on model, but it does not explicitly guarantee or prohibit SSE, sticky sessions, buffering, or stream duration. Those facts remain testable deployment properties rather than documentation claims.

## Sources

1. [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — IETF standard, June 2022, Tier 1.
2. [Manage concurrency in Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage) — Microsoft documentation, Tier 1.
3. [Time, Clocks, and the Ordering of Events in a Distributed System](https://www.cs.cornell.edu/courses/cs614/2002sp/Clocks.Lamport.1.pdf) — academic paper, Tier 1.
4. [Hybrid Logical Clocks](https://www.usenix.org/system/files/conference/hotcloud15/hotcloud15-demirbas.pdf) — USENIX paper, Tier 1.
5. [RFC 6902: JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html) — IETF standard, April 2013, Tier 1.
6. [RFC 7396: JSON Merge Patch](https://datatracker.ietf.org/doc/html/rfc7396) — IETF standard, October 2014, Tier 1.
7. [Compression in HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression) — MDN reference, Tier 2.
8. [WHATWG HTML: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) — living standard, Tier 1.
9. [Google SRE Workbook: Monitoring](https://sre.google/workbook/monitoring/) — Google SRE guidance, Tier 2.
10. [OpenTelemetry Metrics Data Model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/) — specification, Tier 1.
11. [Replit Deployment types](https://docs.replit.com/features/publishing/deployment-types) — official platform documentation, Tier 1.
12. [Replit Autoscale Deployments](https://docs.replit.com/references/publishing/autoscale-deployments) — official platform documentation, Tier 1.
13. [Replit Reserved VM Deployments](https://docs.replit.com/references/publishing/reserved-vm-deployments) — official platform documentation, Tier 1.
14. [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) — maintained reference, Tier 2.
15. [NGINX HTTP proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) — vendor reference, Tier 1.
16. [Node.js HTTP API](https://nodejs.org/api/http.html#class-httpserverresponse) — runtime documentation, Tier 1.
17. [Redis Pub/Sub](https://redis.io/docs/latest/develop/pubsub/) — vendor documentation, Tier 1.
18. [node-postgres Pool Sizing](https://node-postgres.com/guides/pool-sizing) — maintainer documentation, Tier 2.
19. [node-postgres Pool API](https://node-postgres.com/apis/pool) — maintainer documentation, Tier 2.
20. [PostgreSQL Connections and Authentication](https://www.postgresql.org/docs/current/runtime-config-connection.html) — official documentation, Tier 1.
21. [PgBouncer Usage](https://www.pgbouncer.org/usage.html) — maintainer documentation, Tier 2.
22. [PgBouncer Configuration](https://www.pgbouncer.org/config.html) — maintainer documentation, Tier 2.
23. [Kubernetes Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/) — official documentation, Tier 1.
24. [AWS graceful degradation guidance](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html) — official guidance, Tier 1.
25. [Microsoft Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) — official guidance, Tier 1.
26. [Google SRE: Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) — technical guidance, Tier 1.
27. [OpenAI API error codes](https://platform.openai.com/docs/guides/error-codes) — provider documentation, Tier 1.
28. [PostgreSQL Limits](https://www.postgresql.org/docs/current/limits.html) — official documentation, Tier 1.
29. [node-postgres Pool Sizing source](https://github.com/brianc/node-postgres/blob/master/docs/pages/guides/pool-sizing.md) — maintainer repository, Tier 2.
30. [W3C EventSource Working Draft](https://www.w3.org/TR/eventsource/) — historical specification reference, Tier 1.