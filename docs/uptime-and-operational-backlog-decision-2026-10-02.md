# Uptime and Operational Backlog — Decision Record

**Captured:** 2026-10-02
**Repository revision reviewed:** `d143c7ff5f95e8da2e8f8b15c41ed53c4ee5a3ed`
**Environment checked:** Production deployment metadata and health-only HTTP probes; no credentials, operational payloads, or raw logs retained
**Decision (updated 2026-10-10):** The owner decided not to switch to a VM. Autoscale remains the deployment choice; shared fanout has not been approved. The checked-in target is `autoscale`, matching the active deployment metadata. Live peer SSE is explicitly unsupported on this topology.

## Current evidence and limits

| Evidence | Verified result | What it does not prove |
|---|---|---|
| Checked-in `.replit` deployment settings | `deploymentTarget = "autoscale"`; production command starts the API server with one Node command per serving server | The number of currently serving servers or the revision each one runs |
| Replit deployment metadata (rechecked 2026-10-02) | An active, public Autoscale deployment with a successful build | Serving-server count, maximum concurrency, affinity, or source/build revision; the supported metadata includes no revision field |
| Replit [deployment-type documentation](https://docs.replit.com/features/publishing/deployment-types) | Autoscale can scale from zero and add servers to handle traffic; it does not inherently provide session affinity | Whether more than one server was serving this deployment during the probe |
| Replit deployment metadata and checked-in `.replit` (read-only recheck, 2026-10-05) | Deployment is active with a successful build and type `autoscale`; `.replit` also selects `autoscale` and starts one Node command per serving machine | Effective Autoscale maximum, current/peak serving-machine count, always-on status, process count on the published build, or deployed source revision |
| Replit deployment metadata (read-only check, 2026-10-09) | An active public deployment with a successful build and type `autoscale`; metadata does not expose instance or process counts | Current/peak serving-machine count, effective Autoscale maximum, process count on the published build, or deployed source revision |
| Replit deployment metadata after two owner-reported publishes (read-only check, 2026-10-09) | Deployment still reports `autoscale` with a successful build; sanitized `/api/livez` and `/api/readyz` probes returned HTTP 200; a bounded 48-hour log summary found one `Server listening` line | Whether Publishing settings were changed, current/peak serving-machine count, process count, or deployed source revision |
| Sanitized SSE topology observation (`release-evidence/sse-topology-observation-2026-10-09.json`) | Captures the active deployment type, health statuses, and minimized log counts; explicitly records live peer SSE as unsupported | Provider deployment ID, deployed revision, and serving-process counts remain unavailable |
| Owner decision and checked-in deployment configuration (2026-10-10) | Owner declined a VM change; `.replit` selects `autoscale`, matching the latest read-only metadata recheck | Whether the current process count or Autoscale maximum would support live peer SSE; shared fanout is not approved |
| Replit [machine configuration](https://docs.replit.com/features/publishing/machine-configuration) and [deployment types](https://docs.replit.com/features/publishing/deployment-types) documentation (checked 2026-10-05) | Autoscale supports a configurable maximum but can scale to zero; Reserved VM is continuously running on a dedicated VM | A configured maximum of one does not provide an always-on guarantee; one VM alone does not prove that its run command starts only one API process |
| Sanitized production probe and diagnostics (rechecked 2026-10-02) | `/api/livez` returned 200; `/api/readyz` returned 503. `process`, `startup`, `database`, `auditProtection`, and `dependencies` were `ok`, while `backgroundWorkers` was `error`. The allowlisted worker diagnostics showed `web-push-schedule` with 5 recent failures against a threshold of 3, status `warning`, and generic code `operation_failed` | The raw worker exception, exact deployed source revision, or whether the failure rate will persist |
| Checked-out readiness implementation and route tests | Commit `263514fe814ba16eb83f4fef83be9deb04816db6` maps optional AI and sustained worker failures to warnings; only startup, database, and audit-protection failures block readiness. The route tests cover warning-only HTTP 200 and required-failure HTTP 503 behavior | That production is running this implementation |
| Sync SSE implementation and isolated two-process test | Source inspection confirms immediate broadcasts iterate a module-local client set. The focused test passed four times through runner-created temporary local PostgreSQL clusters (16.8s, 14.0s, 16.4s, and 13.8s); it asserts no data frame within one second after a process-A write and complete canonical state on reconnect. Retained evidence contains only sanitized status and elapsed time; no production database was used. | Production routing, proxy buffering, stream lifetime, or actual instance count |

The worker status has a bounded explanation: five recent scheduled web-push failures exceeded the worker warning threshold of three. The stored diagnostic code is only `operation_failed`; it does not identify the underlying exception, and no raw error or operational payload was retained.

The live readiness behavior matches the earlier checked-in policy before commit `263514fe814ba16eb83f4fef83be9deb04816db6`, which promoted sustained worker failures to `error` and required every readiness check to be `ok`. The current checkout maps that same degradation to `warning` and gates readiness only on startup, database, and audit protection. This is a strong behavioral mismatch, but not proof of the exact production revision: supported deployment metadata has no build/source revision, the live health response exposes no build identity, and the sampled health/worker logs did not provide one. The production revision therefore remains **unknown**, rather than inferred from the verifier checkout.

The checked-out route test passed on 2026-10-02 (11 tests). No further readiness code change was needed in this task because the intended policy is already present in the checked-out source. **Owner action required:** republish the current checked-out source containing commit `263514fe814ba16eb83f4fef83be9deb04816db6`, then re-probe production. A warning-only condition should give `/api/readyz` HTTP 200 with `backgroundWorkers: warning`; startup, database, and audit-protection failures must continue to give HTTP 503 as verified by the route tests. No publish was performed. Do not consider the live mismatch resolved until the owner has published and the production probe confirms the corrected behavior.

The 2026-09-21 branch map is an ancestry snapshot, not current deployment or topology evidence. It explicitly excludes proof of what is published or whether production SSE crosses instances. The current checkout is later than that snapshot.

## SSE fanout boundary

`artifacts/api-server/src/routes/sync.ts` stores open `/sync/events` connections in a process-local `Set`. Day-state writes, manual-section lock notices, reset/rollover notices, and master-data invalidation notices write to that local set; there is no shared SSE broker in this route. A write handled by another process therefore does not immediately fan out to that process's connected clients.

The SSE handler rereads canonical day state and reset state on its approximately 15-second heartbeat, but its day-state event is not a general cross-process replay mechanism. Heartbeat projections are accepted by the client only when their snapshot ID matches the client's current snapshot. The source test in `sync.convergence.integration.test.ts` asserts that a connected second-process peer does not receive another process's write within one second, then verifies a reconnect receives a complete canonical snapshot. On 2026-10-05 the focused test passed four times (16.8s, 14.0s, 16.4s, and 13.8s) using separate runner-created local PostgreSQL clusters. Only sanitized status and timing were retained; the runner ignores inherited database URLs, and no production database was used. This verifies the test's API-process boundary, not production routing, proxy behavior, or instance count.

The server-research note's suggestion to check proxy buffering and idle timeouts remains valid, but no proxy-specific behavior is inferred here. The deployment documentation reviewed does not guarantee SSE affinity, buffering behavior, or stream duration.

## Topology recommendation

Do not treat sticky sessions as a verified solution. Replit's Autoscale documentation does not promise affinity, and an SSE connection and later write requests may be served by different processes.

| Choice | Benefits | Costs and risks | Appropriate when |
|---|---|---|---|
| **One always-on API process** | Keeps immediate in-memory fanout within one process; fewer database pools and simpler operations | Gives up scale-to-zero; one process is a failure point; a single process must be enforced, not assumed from Autoscale | The owner accepts the availability/cost tradeoff and the platform can verify one process |
| **Autoscale with shared cross-process fanout** | Retains Autoscale behavior while delivering live events to clients connected to other processes | Requires a shared event path, outage/replay behavior, cross-process tests, and a database-connection budget based on maximum server count | Scale-out or scale-to-zero is required and live peer updates must continue across processes |

### Owner decision and current enforcement

On 2026-10-03 the owner selected one always-on API process. On 2026-10-10 the
owner decided not to switch the deployment to a VM. Autoscale remains selected,
and no shared-fanout design has been approved. Since the process-local client
set has no cross-instance fanout, live peer SSE is explicitly unsupported on
the current deployment. Reconnect recovery does not make multi-process live
delivery supported.

The 2026-10-05 check was read-only and bounded to the checked-in deployment
target, published deployment metadata, and current Replit deployment
documentation. It retained no URL, credentials, request payload, or raw logs.
Metadata reported an active Autoscale deployment and successful build, but did
not expose its effective maximum, current/peak machine count, or process count.
Replit's current Autoscale documentation says the maximum can be configured,
but the minimum is zero and the service can scale to zero; it does not guarantee
exactly one always-on instance. Thus the published deployment is
**NOT ENFORCED / NOT VERIFIED** for the owner's SSE policy. A maximum of one,
if configured, would still not establish always-on operation.

On 2026-10-09 the owner approved changing to one always-on VM, but on
2026-10-10 decided not to make that change. The checked-in `.replit` target is
now `autoscale`, matching the latest read-only deployment metadata recheck.
Autoscale can scale to zero and may add servers; the available metadata does
not expose its effective maximum or current/peak process counts. The prior
sanitized health probes and bounded log summary do not establish those values.
No shared-fanout design has been approved. Therefore live peer SSE remains
unsupported. Reconsider support only after a new owner-approved topology
decision and evidence for that topology.

The topology result does not alter soft readiness: optional AI and
background-worker warnings remain non-blocking; startup, database, and audit
protection remain the core readiness gates.

### Evidence and acceptance checks required before a deployment change

1. Identify the exact production build/revision and correlate it with readiness behavior. Obtain a safe, sanitized explanation for the current `backgroundWorkers: error`; do not infer it from the response status.
2. For the selected single-process policy, obtain dated deployment control-plane evidence for always-on status, maximum serving-process count, and current/peak counts. A minimum of one or sticky routing alone is insufficient. If the target cannot guarantee one always-on process or the counts cannot be observed, record the policy as unverified and obtain separate owner approval before changing deployment configuration.
3. In an isolated environment with two API processes sharing one test database, verify the selected design. For shared fanout, cover a day-state write, manual-section acquired/released, configuration invalidation, reset, and rollover across processes, including scope/date isolation and duplicate/loss behavior. For a single-process choice, verify the platform constraint rather than relying on affinity.
4. Verify authenticated SSE first-frame timing, delivery across at least two heartbeat intervals, disconnect/reconnect recovery, and proxy idle-timeout/buffering behavior. Use synthetic records and retain only sanitized statuses, timings, bounded counts, and revision identity.
5. Calculate the database connection budget using the database ceiling/reserves, other services, maximum serving-server count, and per-process pool limit. Do not increase pool limits before this calculation.
6. Confirm the live readiness contract on the exact deployed revision: optional AI absence and worker warnings do not block readiness; required startup, database, and audit-protection failures still do.

## Disposition of older proposals

**Status terms:** Implemented means supported by current source/tests; stale means the older claim or suggested fix no longer matches the repository; still open means the capability remains incomplete; owner/product input means requirements must be decided before implementation.

| Older proposal or claim | Disposition | Current implementation and remaining boundary |
|---|---|---|
| Stale complete writes can overwrite newer state; add complete/partial snapshot fences | **Stale as a code recommendation; convergence remains open** | Complete and partial writes validate snapshot preconditions under lock, with canonical fallback. Repeated-offline convergence and deployed behavior still need evidence. See `docs/sync-system-improvements-plan.md` and `docs/sync-reliability-unified-plan-2026-09-19.md`. |
| Keep Autoscale only if all peers receive immediate SSE fanout | **Still open** | Autoscale is active and can add servers; immediate SSE fanout is process-local. The two-process test proves reconnect recovery, not cross-process delivery. |
| AI or background-worker problems should make core readiness fail | **Stale for the checked-out source; production mismatch is open** | Current source treats AI as optional and worker degradation as a warning. Audit append-only protection is an additional hard readiness condition absent from the old brief. The live 503 must be reconciled against the deployed revision. |
| Inventory consumption uses planned cases only; prep-mix and overproduction events are unrecorded | **Stale** | Run consumption scales to `actualCases`; completed-run drawdown, prep-mix physical events, packaging, freezer assets/allocations, and sauce-barrel consumption have server-owned, idempotent paths. Do not deduct finished-case surplus ingredients twice. |
| Inventory is complete after those physical-event deductions | **Still open** | Final-total freezing, field reconciliation, waste/spoilage, stoppage waste, and returns remain. FEFO/lot genealogy and unified multi-day capacity planning are also not established as complete. Owner input is needed for waste/return events and reconciliation rules. |
| Multi-entity import Apply can partially land and has no guarded rollback | **Stale for spec, premix, and cheese imports** | Those three apply through one server operation and transaction with idempotent retry and guarded undo. Guide/schedule projections have different recovery boundaries; a structured before/after preview, broader provenance, batch operations, and QC approval remain open. |
| QC has only schema placeholders and no persisted quality records | **Older claim stale; QC department still open and depends on owner/product input** | A manager-capability-gated inventory quality-check record/history exists. It is not the full durable QC department, audit/export model, station checklist, or import approval queue. Product decisions are needed for QC ownership, capabilities, retention, and required workflows. |
| Allergen controls are only a run label | **Partly implemented; safety controls still open and depend on owner/product input** | Run labels, normalization, and sequence warnings exist. Ingredient-level mapping, verified cleaning gates, declarations, and reporting remain. Owner/product input is required before assigning blocking rules or label authority. |
| Factory/profile LWW, reset/session boundaries, and operational workflows are greenfield | **Older claim stale; remaining capabilities are partial** | Server-side factory/profile writes and reset/session fences exist; warehouse snapshots/staging, completed history, and authoritative reports exist. Unified multi-day planning, broader downtime classification/correlation, operator visibility, and production reconciliation remain partial. |
| Mobile parity and physical-device wake work should be part of this backlog | **Not proposed here** | The product boundary remains web-only; physical-device-only work is excluded from this task. |

## Prioritized bounded proposals

These are disposition proposals, not work silently added to this task:

1. **P1 — Reconcile the live readiness failure.** Correlate the published build revision with the checked-out readiness contract, inspect only sanitized deployment diagnostics, and resolve why production returns 503 for a worker warning. Preserve hard failures for startup, database, and audit protection.
2. **P1 — Decide whether to support live peer updates while retaining Autoscale.** Keep peer SSE unsupported unless the owner separately approves a shared-fanout design; if approved, verify cross-process delivery, reconnect recovery, and the database connection budget before claiming support.
3. **P2 — Close inventory completion and reconciliation gaps.** Freeze the accepted final consumption basis and define audited waste/returns handling; keep all stock mutations in the existing server-authoritative idempotent transaction paths. Confirm reason codes and physical workflow with the owner first.
4. **P2 — Set QC and allergen product rules before building controls.** Decide required checks, accountable roles, retention/export requirements, cleaning-verification evidence, and which conditions may block production. Implement these as a bounded QC/allergen phase only after those owner decisions.

Release-evidence, evidence-handoff, release-timing, and release-browser work are excluded here because they are tracked separately.

## Sources

- `attached_assets/replit-uptime-brief-for-agent-2026-09-20_1790731446649.md`
- `attached_assets/main-vs-replit-branch-map-2026-09-20_1790731446665.md`
- `attached_assets/pre-implementation-research-pack-2026-09-19_1790731446706.md`
- `attached_assets/all-remaining-deep-dives-2026-09-19_1790731446723.md`
- `attached_assets/domain-deep-dives-2026-09-19_1790731446737.md`
- `docs/branch-map-2026-09-21.md`
- `docs/server-research-deep-dive-2026-09-19.md`
- `docs/sync-reliability-unified-plan-2026-09-19.md`
- `docs/idea-backlog.md`
- `docs/inventory-autodeduction-plan.md`, `docs/inventory-gap-analysis.md`
- `docs/import-system-plan.md`, `docs/qc-department-plan.md`, `docs/allergen-tracking-plan.md`
- `artifacts/api-server/src/routes/health.ts`, `artifacts/api-server/src/routes/health.test.ts`
- `artifacts/api-server/src/routes/sync.ts`, `artifacts/api-server/src/routes/sync.convergence.integration.test.ts`
- `artifacts/run-calculator/src/pages/home.tsx`