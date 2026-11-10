# V2 Server Architecture and Cutover Plan

**Status:** Recommended architecture; V2 implementation and cutover are not authorized by this document.  
**Updated:** 2026-11-10  
**Basis:** Owner-confirmed V2 scope, current schema review, V1 production evidence, and Replit documentation checked on 2026-11-10.

## Decision

Build V2 as a server-authoritative web/PWA backed by PostgreSQL. The initial Replit candidate is **one Reserved VM deployment in one V2 project**, running a public API/web process and one supervised auto-track worker process. Keep one API process and one active worker process initially. Both use the same V2 database, with separate, explicitly bounded pools. A process supervisor owns child-process health and restart; database leases and fencing—not process count—own automatic progress.

This revises the earlier candidate of two independently deployed Replit services. Replit documentation says artifacts in one project share data and publish together, but cannot have separate deployment modes or Reserved VM deployments; separate projects have separate managed production databases. Replit documents that one Reserved VM deployment can run multiple services/processes. Thus a single project/deployment can preserve one managed database while separating the API and worker event loops. The exact V2 process layout, shared-database behavior, restart recovery, and publish lifecycle have **not** been exercised in an isolated Reserved VM deployment. That synthetic pilot remains a no-feature-work gate.

V2 is not a continuation of V1's live database or day-state. V1 remains the production system during V2 development. No V1 deployment/configuration change, database write, or historical-run transfer is part of this plan.

## Confirmed scope and boundaries

- First usable release: run control, every production station, full inventory, imports, multi-device sync, and auto-tracking.
- Web/PWA first; no native mobile application in the first release.
- Multiple devices must work on one active run from launch.
- Offline view is read-only, with last-confirmed data and a visible stale/offline state. No queued offline writes.
- Carry approved setup/master data and account identities/role assignments only. Do not carry completed or active production runs, V1 inventory balances, or movement history.
- Establish V2 opening stock from a fresh physical count.
- Keep historical V1 data in V1. At cutover, prefer a separately restricted, read-only V1 archive; decide the retention period before launch.

These scope decisions are recorded in [the V2 scope note](../.agents/memory/v2-scope.md).

## Replit feasibility and deployment boundary

The platform evidence and its limits are recorded separately in [the Replit feasibility note](v2-server-architecture/replit-feasibility.md). In brief:

| Question | Evidence-based result |
|---|---|
| Can two artifacts in one project be independently deployed as API and worker Reserved VMs? | **No.** Replit documents that project artifacts publish together and share infrastructure; an artifact cannot have an independent deployment mode. |
| Can two separate Replit projects independently deploy and use the same Replit-managed production database? | **No native shared managed database.** Each project manages its own production database. Using an externally managed PostgreSQL database would be a separate architecture and is not selected here. |
| Can one Reserved VM deployment run an API and worker process? | **Documented capability.** Replit documents running multiple services/processes in one Reserved VM deployment, including via a process supervisor or a command chain. |
| Has the proposed V2 topology been published and tested with synthetic data? | **No.** The current workspace is the V1 project and its `.replit` target is Autoscale. No separate V2 project/deployment or authorized isolated Reserved VM target is exposed here. Publishing this project would risk changing V1 and is prohibited. |
| What does this mean for the plan? | Use a one-project, one-Reserved-VM, two-process candidate. Before V2 feature implementation, perform a synthetic-data V2 deployment pilot proving process health/restarts, shared DB access, and publish compatibility. If the pilot fails, stop and revisit the hosting/database boundary; do not silently split into projects and assume their managed DBs are shared. |

The local project files are not platform proof: the current API and web artifacts have local development and production build configuration, while root `.replit` still selects Autoscale. No V2 deployment settings were changed.

### Pilot evidence required before feature work

In a separately created V2 project/deployment, with a new empty database and synthetic records only:

1. Configure one Reserved VM deployment to run API and worker as separate supervised processes; confirm the API remains reachable while the worker is stopped/restarted.
2. Have both processes connect to the same V2 database; write a synthetic marker through one process and read it through the other. Confirm the V1 database is not configured or reachable from either process.
3. Kill/restart the worker process and the whole deployment separately. Confirm lease expiry/fencing, recovery of due work, and no duplicate progress.
4. Publish a harmless version change and record which processes/builds restart, whether the database remains available, and whether API/worker versions can be kept compatible.
5. Measure the actual database connection ceiling and reserves, the deployment's configured pool limits, and maximum connections across steady operation and publish/restart overlap. Record the source, units, timestamp, deployment identity, and uncertainty. Do not use a later capacity sample as evidence for an earlier peak.
6. Save only sanitized configuration and measurements; no customer rows, credentials, or production payloads.

The pilot is a required prerequisite, not an assertion that those outcomes have already passed.

## Responsibilities and canonical state

### API/web process

- Serve the same-origin PWA and authenticated API from the one deployment.
- Own authorization, validation, command idempotency, canonical revisions, transactional writes, snapshot reads, import staging/review/apply, and append-only audit/outbox records.
- Apply operator/manager commands. Do not allow clients to mutate persisted records directly.
- Return an accepted canonical state/revision or a typed conflict with the latest canonical state. A client request is never treated as accepted merely because it was sent or locally displayed.
- Enforce role/capability checks for every mutation; scope all access to the facility and active run.

### Auto-track worker process

- Evaluate due automatic actions from persisted server timestamps and canonical run/station state. Browser timers only render elapsed time.
- Claim work briefly in PostgreSQL, then process with bounded concurrency and short transactions. Do not hold row locks while doing calculations or remote work.
- Advance progress only in the transaction that validates the current run revision, station state, due-action identity, lease generation, and idempotency key.
- Write an outbox event in the same transaction as each accepted state change. The worker cannot apply manual edits, imports, role changes, or inventory corrections.
- Expose health/heartbeat information. The supervisor restarts a failed child; database lease expiry and fencing recover ownership if the old child cannot be trusted.
- Avoid empty claim transactions when no work is due. Measure polling/query frequency and idle database activity.

### Canonical run and station state

PostgreSQL is authoritative. Model each active run and its station progress as versioned server-owned state, not a browser-local run document. A run carries stable identity, lifecycle state, schedule/setup snapshot, start/pause/resume/complete timestamps, and aggregate revision. Station records carry the station's inputs, progress, state revision, and any station-specific timer/claim cursor. Preserve V1's approved production formulas by extracting/testing their domain rules; do not recreate them from recollection or accept unexplained UI-only calculations.

Use server timestamps for elapsed time and due work. A client's local timer can display a projection, but refresh, sleeping, process restart, or device handoff must reproduce the same canonical result from stored timestamps and accepted progress.

### Canonical inventory state

The inventory item catalog and location/unit/conversion configuration are master data. On-hand state is derived from location-specific lots and an append-only movement ledger. All receiving, transfer, count, correction, and run-consumption operations update lots and ledger atomically. Each movement has an operation identity and authenticated actor; transfers have balanced source/destination effects. A run's consumption is tied to its stable completion/consumption operation so retries cannot decrement twice. V2's opening count is a first-class, auditable baseline event; it is never synthesized from V1 balances.

## Commands, revisions, conflicts, and retries

Every state-changing API command includes:

- authenticated actor and facility scope (derived/validated by the server, not trusted from the body);
- stable client-generated idempotency key unique within the actor/scope/command domain;
- target run, station, inventory item/location, or import operation identity;
- expected canonical revision for edits that replace state;
- explicit operation intent and validated payload.

The server checks the idempotency receipt before reapplying work. Repeating the same key and same request returns the original accepted result; reusing a key with a different request is rejected. Receipt, domain mutation, new revision, audit record, and outbox row commit atomically. A timeout after commit is safe to retry with the same key. Do not promise exactly-once message delivery; guarantee at-most-once domain effect through uniqueness and transactional checks.

| Command class | Conflict rule |
|---|---|
| Run lifecycle and station absolute replacement | Require current expected revision. On mismatch, return conflict and canonical snapshot; never last-write-wins over newer production state. |
| Explicit additive progress | Use a unique operation ID and validate the station/run is still eligible. Rebase only when the command semantics are additive and the operator intent is preserved. |
| Automatic progress | Use worker-generated deterministic due-action identity plus current lease/fencing generation and station revision. Duplicate/retried claims return the existing receipt or no-op. |
| Inventory receipt/transfer/count/adjustment | Require operation ID and the latest relevant item/lot revisions or lock target rows transactionally. Serialize competing corrections. Absolute count/replacement conflicts rather than silently overwriting; additive movements are individually ledgered. |
| Import apply | Stage/validate first, then apply one manager-confirmed immutable import operation transactionally and idempotently. Replayed apply returns its recorded result. |

All conflicts must be visible and recoverable; no silent client-side merge for operational values.

## Worker ownership, fencing, and database budget

There is one worker process in the initial deployment. A durable database lease row records owner identity, lease expiry, heartbeat, and monotonically increasing fencing generation. Acquisition/takeover occurs transactionally; a new owner increments the generation. Every claim and commit verifies the current generation and lease. A stale process that resumes after a pause, network partition, or deployment restart cannot commit work under its old generation. The lease provides coordination, not exactly-once effects: unique due-action/command receipts and transactional state changes provide duplicate protection.

After a crash, an unacknowledged action becomes eligible only after safe lease expiry. The new worker re-reads canonical run/station state and either applies the still-due operation once or records why it is no longer eligible. A worker restart never resets a run timer, invents elapsed progress, or replays a committed action.

Do not set numeric pool sizes from V1's pool maximum or a delayed capacity sample. Establish a V2-specific usable connection budget first:

`API pool maximum + worker pool maximum + deploy/migration overlap + monitoring/admin reserve <= 80% of measured usable database connections.`

The remaining 20% is minimum headroom for bursts and maintenance; increase it if the pilot shows provider-reserved connections, connection churn, or publish overlap needs more. Record the provider ceiling, unavailable/reserved slots, number of application processes, pool maxima, and measurement window. Every future increase in process/instance count multiplies the aggregate pool budget and is a design review trigger. Multi-instance API/worker fleets are not in initial scope.

V1's production evidence showed runtime `pool.max=10`, severe acquisition and event-loop stalls in the same broad interval, and a database-capacity sample about 41 seconds later. That sample was not contemporaneous and did not prove root cause or usable V2 capacity. See [sanitized production evidence](v2-server-architecture/production-evidence.md); do not treat its later headroom reading as a V2 connection limit.

## Multi-device sync, wake, and offline behavior

Each accepted mutation increments a server-owned revision and writes a durable outbox event in the same transaction. The API exposes a canonical snapshot with its revision/high-water cursor and a bounded cursor-based change feed. SSE is a prompt to fetch/read newer state, not the record of truth and not a requirement for recovery. Events missed during disconnect, sleep, browser suspension, deployment restart, or retention expiry are recovered from the durable cursor/feed or a fresh snapshot.

Client protocol:

1. On load, wake, focus after suspension, network recovery, SSE reconnect, or a revision gap, immediately show `Syncing` and disable run/station/inventory/import/auto-track writes.
2. Request changes after the last confirmed cursor. If the cursor is valid and retained, apply them in order and verify the resulting revision. If it is absent, too old, malformed, or discontinuous, discard the local operational projection and fetch a complete canonical snapshot.
3. Adopt the server state and cursor atomically in the local cache. Only after a successful response may the client enable online writes.
4. If offline, keep the last confirmed snapshot visible with an explicit stale timestamp/status; disable all mutating actions. Do not queue commands for later replay. A reconnect must complete step 2 or 3 before resuming.
5. Treat SSE as an invalidation signal. Duplicate, reordered, or lost notifications cannot corrupt state because reads are revisioned and idempotent.

Two online devices may issue commands concurrently. One wins the expected revision; the other receives conflict and refreshed canonical state, then the user can reapply an intent-safe operation. Devices converge from durable revisions even if SSE is down. Multiple API instances, cross-instance SSE, or native clients require separate design and are out of scope.

## Table-level transfer and cutover plan

This is an explicit allowlist against the current Drizzle schema. The allowlist is the only automatic transfer path; all unlisted tables default to excluded. V2 schema/API owners must approve field transforms and identifiers before running any transfer. Run the rehearsal against a disposable V2 database and synthetic/approved export only. Never point transfer scripts at V1 production.

### Carry, subject to validation and mapping

| Current V1 table | Transfer treatment |
|---|---|
| `brand_profiles` | Carry approved product setup profiles, preserving brand/flavor display names and validated profile values. |
| `ingredients` | Carry active catalog identities, names, categories, reviewed allergen state, and approved merge/display references needed by recipes. Validate merged/deactivated identities before mapping. |
| `dough_recipes`, `cheese_recipes`, `sauce_recipes`, `mixes` | Carry approved current recipes and their components/assignments; validate all referenced ingredients and units. |
| `production_rules` | Carry enabled factory rules and reviewed exceptions after V2 rule-schema/capability validation. |
| `run_templates` | Carry reviewed templates as setup only; validate against V2 run fields. |
| `die_types`, `die_line_defaults` | Carry current die catalog and reviewed line defaults; test units and missing/legacy defaults. |
| `freezer_pull_items` | Carry current freezer-pull definitions; not their run-level completion/fulfillment history. |
| `ingredient_batch_weights` | Carry reviewed ingredient weights only when the ingredient identity resolves uniquely in V2. |
| `import_aliases`, `spec_import_aliases`, `photo_aliases` | Carry only validated mappings whose canonical target exists in V2; reject ambiguous or unsafe aliases. |
| `saved_spec_sheets`, `saved_premix_sheets`, `saved_shipping_guides`, `saved_cheese_sheets` | Carry only the latest owner-approved parsed/reference snapshots needed for setup/import workflows. Do not copy original workbook uploads or import audit history. |
| `inventory_items` | Carry catalog identity, category, name, unit, reorder settings, confirmed conversion/ingredient links, and consumption priority. Do not copy on-hand values. |
| `inventory_locations` | Carry approved location names and onsite designation, after a physical-location walk-through. |
| `inventory_settings` | Carry reviewed non-stock policy such as expiry alert lead time; seed a V2 default if not explicitly approved. |
| `inventory_product_references` | Carry only product-reference rows whose item key maps exactly to a carried catalog item. |
| `cycle_count_schedules` | Carry section/cadence/enabled definitions; reset `last_counted_at` so V2 does not inherit a false claim that a V2 count occurred. |
| `users` | Carry opaque user ID, username, and reviewed disabled status only. Do not copy `password_hash`, password/session revocation stamps, sandbox flag, preferences, or onboarding state. Users remain pending V2 credential revalidation until activated. |
| `roles`, `user_roles` | Seed V2 built-in roles from V2 policy. Carry custom role names/capabilities only after capability-by-capability review; map each user assignment explicitly. Unknown capabilities or role names block that account from activation. |

### Exclude or rebuild in V2

| Current V1 table(s) | Treatment |
|---|---|
| `production_runs`, `daily_sync`, `completed_run_history` | Exclude all active, scheduled, and completed V1 production-run state and snapshots. |
| `sync_outbox_cursors`, `sync_outbox_events`, `sync_conflict_logs`, `data_reset` | Exclude cursors, pending sync, conflict/reset state. Start V2 with fresh cursors/epochs. |
| `inventory_lots`, `inventory_ledger`, `inventory_consumed_runs`, `inventory_observations` | Exclude all balances, lots, movement history, run-consumption markers, photos/drafts/count observations. Establish V2 stock only through fresh physical count. |
| `mix_surplus_lots`, `mix_surplus_allocations`, `freezer_surplus_lots`, `freezer_surplus_allocations`, `freezer_surplus_adjustments`, `freezer_surplus_confirmations`, `freezer_surplus_decision_corrections` | Exclude run/day surplus, allocation, adjustment, and acknowledgment history. |
| `auth_sessions`, `password_reset_requests`, `staff_invitations`, `signup_access_codes`, `rate_limit_counters`, `sandbox_meta` | Exclude tokens, reset challenges, invitations, sign-up codes, throttles, and sandbox metadata. V2 issues new credentials/invitations. |
| `import_history`, `import_operations`, `import_gold_cases`, `import_gold_scores`, `import_gold_retention`, `import_gold_approvals` | Exclude import execution/audit records, retained evaluation cases, scores, and approvals; use approved saved reference snapshots listed above instead. |
| `audit_logs`, `incidents`, `operational_reports`, `operational_intent_ledger`, `action_items`, `field_check_observations`, `field_check_issues`, `applicator_batch_evidence` | Exclude V1 audit, operational incident/report, field-check, and evidence history. |
| `finalized_operational_reports` | Exclude finalized report payloads and signatures; V2 creates new reports from V2 run evidence. |
| `quality_checks`, `qc_workflow_events` | Exclude completed/in-progress V1 quality records; define V2 quality defaults separately. |
| `data_heals`, `data_health_repair_batches`, `master_data_operations`, `master_data_undo_epochs`, `merged_away`, `denied_merges`, `merge_aliases`, `duplicate_review_groups`, `master_data_health_scans` | Exclude repair/undo/merge history and health scans. Reconcile any required current master identities in the carry tables, not by replaying operation logs. |
| `background_operation_events`, `automatic_tracking_deferred_diagnostics`, `server_jobs`, `server_job_attempts`, `scheduled_job_cleanup_plans`, `cache_maintenance_events` | Exclude all worker claims, attempts, diagnostic state, and maintenance work. V2 starts with no jobs or leases. |
| `web_push_subscriptions`, `web_push_deliveries`, `web_push_alert_arms`, `scheduled_alert_records`, `scheduled_job_leases`, `freezer_alert_run_projection`, `freezer_alert_projection_status`, `proactive_alert_settings` | Exclude device subscriptions, delivery/claim state, run projections, and alert policy; V2 enrolls devices and seeds reviewed alert defaults anew. |
| `ai_result_cache`, `ai_corrections`, `ai_conversation_turns`, `facility_knowledge`, `run_suggestions` | Exclude cached AI output, conversations, generated suggestions, and operational memory. No AI payload/history is part of cutover. |
| `fill_missing_values`, `factory_kv` | Do not bulk-copy. V2 starts from explicit typed setup tables. If a current value is demonstrably required, review and map it as a named, schema-validated field before cutover. Explicitly exclude deletion tombstones and undo stamps in `factory_kv`. |
| `supervisor_pin_settings` | Exclude PIN material; establish a new V2 credential through manager-controlled setup. |

Any table added to the V1 schema before cutover must be added to this decision matrix as `carry`, `exclude`, or `rebuild`; absence from this list never implies transfer permission. Table/column names above were verified against `lib/db/src/schema/index.ts` and the current schema files on 2026-11-10.

### Account revalidation and session invalidation

This is a future cutover procedure; it performs no current V1 write.

1. Freeze V1 writes only during an owner-approved cutover window and preserve a verified V1 backup/archive. Keep V1's historical records separate from V2.
2. Export only the approved identity/role fields above through a restricted, audited process. Transfer no password hashes, sessions, bearer/cookie tokens, reset codes, invitations, or sign-up credentials.
3. In V2, create each carried identity in a non-activated/pending state with a V2-generated unusable credential value. A manager verifies each person's identity and role, then uses V2's single-use, short-lived revalidation/invitation flow to set a new password and activate the account. Do not deliver plaintext passwords in migration files or logs.
4. Revalidate role capabilities against V2 policy; do not automatically elevate an account when a role or capability fails to map. Require a manager to resolve the exception.
5. Start with empty V2 auth-session and password-reset tables and a newly provisioned V2 session-signing secret. This ensures V1 session material is not accepted in V2. At the approved cutover, revoke/retire V1 sessions and reset challenges as part of restricting V1 to archive access; this is a planned future operation, not authorized now.
6. Smoke-test one manager and one operator account, denied/unmapped roles, disabled users, fresh sign-in, password change, sign-out/revocation, and attempted reuse of a V1 token before enabling production traffic.

### Fresh physical inventory baseline

1. Before V2 opens, reconcile the carried catalog and locations against the actual site. Do not use V1 lot quantities as expected counts or opening values.
2. Choose and record a cutover timestamp. Pause receiving, transfers, and consumption during each physical count window; count every carried item at every relevant location in its defined unit. Record explicit zero outcomes, lot/expiration where tracked, counter, reviewer, and count time. An uncounted or unknown item stays unavailable for consumption until it is physically counted and approved.
3. Resolve unit/conversion mismatches and recount discrepancies before approval. Do not silently convert from an unconfirmed conversion factor.
4. Manager confirms the reviewed count; V2 writes opening lots and balanced `opening-count` ledger entries in one idempotent operation per count batch. The initial on-hand sum must equal the approved physical count for every item/location.
5. Resume inventory movements only after the count batch is committed and its receipt is visible on all devices. Preserve count evidence and the V2 opening ledger; never import V1 movement events to fill gaps.

### V1 history and retention

Keep V1 history in the existing V1 environment during development. At cutover, make V1 read-only and restrict historical access to authorized managers; do not connect V2 to V1 tables or use V1 as a live lookup. Set a retention/access period with the owner before cutover, including who may access it and how records are eventually deleted or retained. Until that policy is approved, retain the archive and do not purge it. This recommendation does not authorize changing V1 now.

## Failure cases and required responses

| Failure | Required behavior |
|---|---|
| API accepts a command but response is lost | Retry same idempotency key; return the original accepted result without a second state change. |
| Two devices submit based on the same revision | One commits; the other receives a conflict and canonical state. No silent replacement. |
| Device sleeps, loses network, or misses SSE events | Show syncing/read-only, recover from cursor or full snapshot, then enable online writes. |
| Client has an expired or invalid cursor | Reject delta-only recovery and send a complete canonical snapshot. |
| Worker dies before commit | Lease expires; new worker re-evaluates current state and applies an eligible action once. |
| Worker dies after commit but before acknowledgment | Retry resolves to existing idempotency receipt; progress is not added twice. |
| Old worker resumes after lease takeover | Fencing generation fails; it cannot commit. |
| Database pool is exhausted or acquisition is delayed | Bound concurrency/timeouts, surface degraded status, preserve canonical state, do not locally claim writes succeeded; alert before retry storms. |
| Manual inventory correction races with automatic consumption | Serialize/lock the affected item/lot and reject stale absolute correction; retain each accepted ledger movement. |
| Import parse is ambiguous or apply response is lost | Keep staged preview unchanged; require review; idempotent apply returns its existing outcome. |
| Cutover identity/role cannot map | Leave the account pending/disabled and require manager resolution; do not grant a broader fallback role. |

## References and evidence

Platform claims are based on official Replit documentation checked on 2026-11-10 and summarized in [the feasibility note](v2-server-architecture/replit-feasibility.md):

1. [Replit deployment types](https://docs.replit.com/features/publishing/deployment-types) — Reserved VM and Autoscale characteristics.
2. [What's an Artifact?](https://docs.replit.com/features/projects-and-artifacts/artifacts) — artifacts share project backend/data and publish together.
3. [Multiple Artifacts vs. Separate Projects](https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects) — independent publishing requires separate projects.
4. [Reserved VM deployments](https://docs.replit.com/references/publishing/reserved-vm-deployments) — deployment configuration and multiple-process approach.
5. [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production) — project database environments.
6. [Projects](https://docs.replit.com/features/projects-and-artifacts/projects) — project-level ownership/boundaries.
7. [Node.js: Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop).
8. [PostgreSQL SELECT / SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html).
9. [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).
10. [AWS transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).
11. [node-postgres pool sizing](https://node-postgres.com/guides/pool-sizing).
12. [HTML Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html).
13. [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).

V1 operational evidence is bounded and sanitized in [production-evidence.md](v2-server-architecture/production-evidence.md). Existing schema facts are from the files under `lib/db/src/schema/`; they are source evidence for the migration matrix, not proof that V2 has those tables or should copy them verbatim.

## Acceptance checks

The isolated deployment pilot and later V2 release must pass all applicable checks below. Thresholds are targets for the V2 pilot/release and must be recorded against a stated test environment and workload; missing evidence is not a pass.

- **Deployment boundary:** a single V2 Reserved VM deployment runs exactly one healthy API process and one supervised worker process; both use the same synthetic V2 database; neither can reach V1; publish and restart outcomes are documented.
- **Connection budget:** measured API + worker + publish/migration overlap + reserve uses no more than 80% of the measured usable DB connection budget, with at least 20% headroom. Explicit pool maxima are recorded before workload testing; no limit is inferred from a delayed sample.
- **Two-device active run:** with two browser clients issuing at least 100 mixed run/station commands under concurrent revisions, every accepted command has one receipt, stale replacements conflict, both clients converge to the same canonical revision within 2 seconds at p95, and duplicate progress count is zero.
- **Wake/reconnect:** after backgrounding one client for at least 10 minutes, interrupting network, and separately restarting API/deployment, the client shows syncing/read-only until it adopts the current snapshot/cursor; it then displays the exact server state and accepts no stale queued writes.
- **Offline:** while disconnected, all mutation controls are disabled and the cached snapshot is visibly marked stale; zero mutating API commands are accepted or queued. After reconnect, writes resume only after successful canonical adoption.
- **Worker restart/retry:** kill the worker before and after a committed due action, restart it, and allow lease takeover. Each due-action identity changes progress no more than once; stale worker commits are rejected; accepted actions recover without resetting server time.
- **Inventory:** concurrently receive, transfer, count-correct, and consume the same synthetic item. Every operation is idempotent, lot totals reconcile exactly to ledger movements within the documented unit precision, and no accepted movement is lost or duplicated.
- **Import:** exercise valid, ambiguous, invalid, canceled, and retried applies for each supported workbook family; no ambiguous preview auto-applies, failed apply leaves canonical setup unchanged, and retry returns the original operation result.
- **Failure visibility:** API/worker/database failures show a bounded degraded/syncing state and a recoverable message; no UI reports a command accepted before the database transaction commits.
- **Data transfer:** a disposable-database rehearsal reports row counts and reference integrity for every allowlisted table; proves all excluded operational tables have zero transferred rows; transfers no run history, balances, ledger, sessions, token/reset material, or credentials.
- **Account/count cutover:** role mappings are explicitly reviewed; V1 tokens fail in V2; pending accounts cannot mutate; V2 stock equals the approved physical-count report by item and location, with every opening lot and ledger line linked to the count receipt.
- **Idle worker:** over a 30-minute no-due-work test, no progress or lease-claim writes occur beyond the configured heartbeat/health cadence, and no run timer changes.

## Staged implementation plan

1. **Deployment and capacity proof (gate before feature work).** Create an isolated V2 Replit project and disposable synthetic database. Test the one-Reserved-VM API/worker process supervisor, database sharing, restarts, publish compatibility, API health, and aggregate connection budget. Stop and revise the hosting design if any boundary fails.
2. **Canonical server model and command foundation.** Define V2 run/station/inventory schemas, stable identities, revisions, transactional command receipts, audit/outbox, capability checks, error/conflict contracts, and migration-safe initial schema. Test retries, stale revisions, and two writers before adding station logic.
3. **Run control and worker-owned automatic progress.** Implement create/start/pause/resume/complete and server-time projections; add durable lease/fencing and due-action idempotency. Validate two devices, worker crashes before/after commit, and idle no-work behavior.
4. **All production stations.** Port the established V1 domain formulas into tested shared logic, then implement station commands/state in small station groups. Verify each station's manual edits, automatic progress, units, and run lifecycle against approved fixtures.
5. **Full inventory.** Implement catalog, locations, lots, receiving, transfers, cycle counts, adjustments, run consumption, and audit ledger. Verify serializable/locked operations and reconciliation under concurrent commands.
6. **Imports and setup/master data.** Implement staged parse → review → validate → confirmed idempotent apply, including saved-reference and alias handling. Validate all workbook families and preserve their per-import uncertainty/undo semantics; no import may mutate V1.
7. **Multi-device PWA sync and offline read-only.** Implement snapshot/cursor recovery and SSE invalidations; test mobile/desktop browsers, sleep/wake, reconnect, missed/duplicate notifications, expired cursors, and role-specific command paths.
8. **Auto-track completeness and operational failure tests.** Tune due-work scheduling only after observing actual load. Run combined two-device, station, inventory, import, wake, worker-restart, connection-saturation, and idle tests. Any threshold miss returns to its owning stage.
9. **Transfer rehearsal and cutover review.** Rehearse the table allowlist, account revalidation, session invalidation, and fresh physical count using a disposable target; reconcile counts and role capabilities. Keep V1 as the production system until owners approve the V2 pilot, archive access/retention, and a separately gated cutover. This stage performs no production transfer as part of the architecture task.
