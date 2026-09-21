# Sync Reliability Unified Plan

**Date:** 2026-09-19  
**Status:** Active reliability authority; complete-write snapshot fencing, provider-key alignment, safe measurements, and deterministic multi-process SSE verification are implemented in the repository
**Reconciled:** 2026-09-21
**Inputs:** [sync contract](sync-deep-dive-2026-09-19.md), [reconnect research](reconnect-reliability-deep-dive-2026-09-19.md), [server research](server-research-deep-dive-2026-09-19.md), [existing improvements plan](sync-system-improvements-plan.md), [operations deep dive](../research/sync-reliability-operations-deep-dive-2026-09-19.md), [integrated continuation](../research/deep-dive-research-continuation-2026-09-19.md), and [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md)

## 1. Purpose

This plan consolidates the sync and operations research into one sequence. It separates:

1. correctness defects that can be fixed from repository evidence;
2. measurements needed before optimization;
3. deployment facts that require live verification;
4. owner policy decisions.

It does not attribute a historical incident to clock skew, declare Autoscale incompatible with SSE, infer database exhaustion, or treat fixture payload savings as production distributions.

## 2. Cross-document comparison

### Agreements

| Area | Consolidated finding |
|---|---|
| Partial writes | `baseSnapshotId` is checked against the locked canonical row; mismatch returns complete fallback without applying |
| Complete writes | Maintained clients send `baseSnapshotId`; the server validates it under lock and returns canonical no-write fallback on mismatch |
| Run conflicts | Per-run LWW compares client-authored numeric stamps |
| Wake recovery | Baseline gating, generation fencing, adopt-before-publish, cancellation discard, and single-flight queuing are established protections |
| Revision | Increment behavior is route-specific; operational intents increment while ordinary day-state PUT retains the current revision |
| Payloads | Privacy-safe wire and pool telemetry is implemented; current production distributions still require revision-bound evidence |
| SSE | Same-process streaming and recovery plus deterministic two-process isolation behavior are implemented; current published topology still requires revision-bound evidence |
| Pooling | Default per-process pool maximum is 10 with a 900 ms acquisition timeout; production capacity inputs are unknown |
| Readiness | Provider-key detection is aligned with the active Gemini adapter; hard-versus-soft dependency policy remains separate |
| AI policy | Whether AI should block global readiness is an owner decision, not a repository fact |

### Corrections and superseded claims

| Prior claim | Current conclusion |
|---|---|
| Every day-state write has optimistic revision locking | Incorrect; ordinary day-state writes retain `canonicalRevision` and do not enforce it as a universal base |
| A partial write can overwrite across a stale base | Incorrect; stale-base partial writes fall back without applying |
| A stale complete write cannot overwrite because revision protects it | Incorrect rationale; protection now comes from an under-lock snapshot precondition, not universal revision locking |
| A larger wall-clock stamp proves causal freshness | Unsupported |
| Replit officially prohibits SSE on Autoscale | Unsupported by the reviewed official documentation |
| Peer broadcasts reach every deployed instance | Unsupported; the registry is process-local |
| 512 KiB is a wire-performance target | Incorrect; it is a sanitized application-document ceiling |
| Any configured AI key proves the active provider is usable | Incorrect; readiness now follows the active adapter's provider-key contract |

## 3. Decisions

1. Preserve complete-write causality before expanding partial encoding.
2. Use explicit canonical-base validation; do not use timestamp clamping as the primary safeguard.
3. Design snapshot and revision changes together:
   - `baseSnapshotId` is the established immediate precondition;
   - if `baseRevision` is introduced, ordinary successful day-state writes must increment `canonicalRevision` atomically.
4. Preserve complete authoritative recovery after any notification or fanout gap.
5. Measure current wire behavior before adopting JSON Patch, compression, selective sync, or broader sparse sections.
6. Verify published SSE behavior before changing deployment topology, heartbeat cadence, or proxy headers.
7. Keep the database pool conservative until capacity and instance-count inputs are known.
8. Keep readiness provider detection aligned independently of the AI hard-versus-soft dependency policy.
9. Preserve auto-track claim coordination, packaging progress, and atomic sauce-barrel inventory effects while changing the day-state protocol.
10. Treat factory data's five-minute timestamp clamp as optional defense-in-depth, not as a substitute for canonical-base validation.
11. Do not block the complete-write protocol fix on an SSE topology decision; database locking and canonical fallback remain valid under either topology.
12. Keep inventory truth, import atomicity, and durable QC/allergen ownership as separate follow-on product tracks.

## 4. Implementation sequence

### Phase 0 — Lock the evidence boundary

**Goal:** Keep implementation and operational claims distinguishable.

- Use fixture data for causality, convergence, payload, and saturation tests.
- Retain only bounded counts, sizes, timings, outcomes, and revision/build identity.
- Do not log day-state bodies, SSE content, recipes, users, devices, facilities, dates, or credentials.
- Label repository tests as deterministic behavior, deployment probes as environment evidence, and owner choices as policy.

**Exit:** Every later phase has explicit evidence fields and sanitization rules.

### Phase 1 — Prove and close complete-write causality — implemented in repository

**Goal:** Prevent an unfenced stale complete body from winning through a larger client stamp.

1. Add the disposable future-stamped complete-write regression.
2. Audit every complete PUT call site and reconnect entry point.
3. Add complete-write base validation:
   - prefer the existing snapshot identity for the first fence;
   - mismatch returns canonical complete state;
   - response states `wrote=false`;
   - incoming stale data is not merged or broadcast.
4. Require trusted recovery before an ordinary client without a base can publish.
5. Preserve post-adopt partial residue behavior.
6. Decide the revision contract before adding `baseRevision`:
   - if used for ordinary writes, increment within the protected write transaction;
   - keep reset-fence-before-row-lock order;
   - maintain compatibility for older clients through an explicit migration window.

**Verification matrix:**

- future-stamped stale complete write;
- stale, malformed, missing, and raced partial bases;
- matching-base partial;
- reset-epoch mismatch;
- blank-over-populated protection;
- tombstones and completed history;
- wake adoption, cancellation, and queued-write discard;
- operational-intent idempotency and revision behavior.
- accepted, duplicate, stale, and conflicting auto-track claims;
- accepted case-claim packaging-progress mirroring;
- sauce-barrel claim state and inventory-consumption atomicity;
- offline-across-midnight recovery using `resetBoundaryAt` and the current reset epoch.

**Exit:** No stale complete write can replace newer canonical run values merely by presenting a larger client stamp.

### Phase 2 — Correct AI provider readiness

**Goal:** Make health status describe the provider the adapter can actually use.

1. Derive readiness configuration from the same contract as the active adapter.
2. Cover:
   - Replit Gemini credentials;
   - direct `GOOGLE_API_KEY`;
   - `OPENAI_API_KEY` without a supported OpenAI adapter;
   - no provider credentials.
3. Preserve process liveness and database readiness semantics.
4. Do not silently decide whether AI absence should fail global readiness.

**Exit:** Readiness cannot report healthy because of an unused key or degraded when the active adapter is correctly configured.

### Phase 3 — Add bounded sync and pool measurements

**Goal:** Replace payload and capacity assumptions with distributions.

Measure separately:

- complete, partial, fallback, and unchanged PUTs;
- complete and partial SSE frames;
- sanitized JSON bytes and actual body/frame bytes where observable;
- duration;
- bounded run-count bucket;
- parser rejection and fallback counts;
- pool total, idle, waiting, acquisition time, and transaction-duration histograms.

Report p50, p95, p99, and maximum by mode. Extend fixture coverage for empty, 1-run, 32-run, 50-run, near-cap, changed-section, stale-base, raced-base, and dropped-write cases.

**Exit:** The team can identify hot sections, fallback tails, and pool contention without inspecting operational content.

### Phase 4 — Verify the published SSE topology

**Goal:** Establish actual behavior of the active Autoscale deployment.

Run a sanitized authenticated probe covering:

- status and allowlisted headers;
- time to headers and first frame;
- at least two heartbeat intervals;
- reconnect delay;
- multiple tabs;
- a second-client synthetic write;
- close category;
- revision/build identity;
- a controlled scale event when feasible.

Run a deterministic two-process test where the write enters process A and the peer stream is attached to process B.

**Decision after evidence:**

- If one verified serving process is the intended constraint, document and enforce it.
- If multiple processes must deliver live notifications, add shared fanout while retaining snapshot recovery.
- Consider Reserved VM only as a topology choice, not an automatic SSE fix.
- Add proxy-specific headers only if the probe demonstrates a need.

**Exit:** Cross-instance delivery, buffering, heartbeat survival, and reconnect behavior are measured rather than inferred.

### Phase 5 — Compute and validate the database budget

**Goal:** Size each process from total deployment capacity.

Obtain:

- database connection ceiling and reserved slots;
- other-service connection demand;
- maximum and current serving instances;
- production pool override and pooler presence;
- pool wait and transaction-duration distributions.

Compute:

```text
safe_pool_max <= floor((database_capacity - reserves - other_services) / maximum_instances)
```

Retain headroom, then run isolated saturation and two-process fanout tests. Do not treat the 900 ms acquisition timeout as a statement or transaction timeout.

**Exit:** The chosen pool maximum has a documented budget and saturation evidence.

### Phase 6 — Make the AI dependency policy explicit

**Goal:** Align traffic eligibility with operational requirements.

Owner decision:

- **Recommended default:** startup, database, and sustained core-worker failures govern global readiness; AI exposes named capability health and degrades only AI-assisted routes.
- **Alternative:** keep AI as a hard readiness dependency only if specific retained AI workflows are contractually mandatory for all production operation.

Provider calls should have bounded timeout, selective retry, and circuit-breaker behavior regardless of the readiness policy.

Implement these controls around the active Gemini adapter, with one bounded half-open probe and content-free metrics for duration, outcome, retry count, and bounded token/cost totals. Do not log prompts, responses, users, or operational payloads. The retained design boundaries are cataloged in [Idea Backlog §17](idea-backlog.md#17-residual-observability--resilience-ideas).

**Exit:** The policy is documented, tested, and reflected consistently in health endpoints and user-facing failures.

### Phase 7 — Optimize only from evidence

Possible work, only if measured:

- expand sparse coverage for hot sections;
- compression;
- JSON Patch;
- selective per-run read scope;
- future-stamp rejection or clamp;
- HLC or Lamport metadata.

Do not implement all options. Each requires a measured trigger and a rollback-compatible migration.

## 5. Dependency graph

```text
Phase 0
  ├─> Phase 1 complete-write causality
  ├─> Phase 2 readiness-key correction
  └─> Phase 3 measurements
          ├─> Phase 4 SSE topology decision
          ├─> Phase 5 pool budget
          ├─> Phase 6 AI dependency policy
          └─> Phase 7 evidence-driven optimization
```

Phases 1 and 2 are independent correctness tracks. Phase 3 can proceed in parallel if instrumentation does not change merge behavior. Topology, pool, and optimization decisions must wait for their required measurements.

Inventory actuals/surplus, import rollback, and durable QC/allergen work are adjacent product tracks rather than dependencies of Phases 1–3. They should consume the corrected server-authoritative transaction and causality boundaries rather than introduce independent client-side write paths.

## 6. Release gates

Before shipping Phase 1:

- complete-write regression passes;
- partial mismatch still never applies;
- convergence and reset-boundary suites pass;
- old-client behavior is explicitly supported or rejected with a migration response;
- no new payload logging exists.

Before changing topology or pool size:

- sanitized probe/saturation evidence is revision-bound;
- database and instance-count inputs are recorded;
- complete recovery remains authoritative after missed notifications.

Before changing global readiness policy:

- provider-key matrix passes;
- core behavior with AI unavailable is exercised;
- the owner decision names which workflows are hard dependencies.

## 7. Work not to combine

- Do not bundle the complete-write protocol change with JSON Patch.
- Do not bundle SSE topology changes with database pool increases.
- Do not use provider-key correction to silently change the global readiness policy.
- Do not add future-stamp clamping as a substitute for base validation.
- Do not use development fixtures as proof of production topology or incident causality.
- Do not combine the sync protocol migration with inventory actuals, import rollback, or QC schema work.
- Do not copy factory KV's timestamp-only LWW into day-state as the complete-write fix.

## 8. Unified definition of done

The reliability program is complete when:

1. complete and partial writes both have explicit, tested causal boundaries;
2. wake recovery adopts before publishing and rebases only meaningful residue;
3. production-safe metrics establish payload, fallback, reconnect, and pool distributions;
4. deployed SSE behavior and cross-instance fanout are verified;
5. the pool budget is derived from actual database and topology inputs;
6. readiness keys match the active adapter;
7. AI dependency policy is explicit;
8. no conclusion relies on retained production payload content or unsupported incident attribution.