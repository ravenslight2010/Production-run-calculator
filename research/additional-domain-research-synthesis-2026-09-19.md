# Additional Domain Research Synthesis

**Date:** 2026-09-19  
**Status:** Integrated comparison of three supplied research packs  
**Source revision:** `Replit` at `191fca40`  
**Related:** [unified sync reliability plan](../docs/sync-reliability-unified-plan-2026-09-19.md), [integrated continuation](deep-dive-research-continuation-2026-09-19.md), [operations deep dive](sync-reliability-operations-deep-dive-2026-09-19.md)

## 1. Scope

This synthesis incorporates:

- the supplied pre-implementation research pack;
- the supplied remaining deep dives on claims, imports, factory data, and release evidence;
- the supplied domain deep dives on live calculation, auto-track, schema, Home ownership, and E2E.

It records supported additions, corrects overbroad recommendations, and separates sync prerequisites from adjacent product work.

## 2. New high-confidence findings

### 2.1 Inventory truth is a separate high-impact product gap

Current inventory deduction is still primarily tied to planned run demand. The existing inventory plan identifies additional events that are not all implemented:

- confirmed overproduction surplus;
- prep-mix production;
- already-made offsets that reduce fresh production without charging ingredients twice;
- actual production replacing planned production as the deduction basis;
- packaging materials as managed stock;
- lot-level and FEFO behavior.

The reliable architecture direction is a single server-authoritative transaction or intent per physical inventory event. New work must not create a second client-side stock mutation path that bypasses inventory locks, idempotency, or run-finalization rules.

Open product decisions remain:

- which completed-case register is authoritative for actual production;
- which inventory locations count as onsite and eligible for consumption;
- whether freezer surplus is a first-class lot or a softer quantity record;
- how packaging materials enter the stock ledger.

Inventory truth is important, but it is not a prerequisite for complete-write causal fencing.

### 2.2 Auto-track claims have stronger local acceptance rules than ordinary complete writes

The auto-track claim state machine includes:

- lifecycle and generation validation;
- contiguous sequence requirements;
- duplicate event recognition;
- base-stamp checks;
- per-mutation `from` validation;
- outcomes of `accepted`, `duplicate`, `stale`, or `conflict`.

Accepted case claims also mirror values into packaging progress. Sauce/app net claims enforce a constrained mutation shape.

The sauce-barrel channel can derive a typed inventory-consumption instruction. The claim function does not itself write inventory; the sync route must apply the day-state mutation and inventory effect atomically while retaining the required lock.

These rules protect claim acceptance but do not prevent a later unfenced complete day-state write from winning per-run LWW. The complete-write protocol fix must therefore include auto-track coordination and packaging-progress regression cases.

### 2.3 Session boundary and reset epoch are distinct safeguards

Authentication uses `resetBoundaryAt` from today's live day-state row, with bounded caching. It deliberately does not use the more general `resetAt` field, because future scheduled writes can carry reset-related values without representing the live facility day transition.

Day-state writes also carry the separate reset epoch. Any complete-write precondition must preserve:

1. reset-fence lock and validation;
2. daily-row lock;
3. snapshot or revision validation;
4. protected merge;
5. atomic persistence.

Transient session-boundary database failures may use the last cached boundary. That recovery behavior should not be conflated with accepting a stale sync write.

### 2.4 Import apply remains multi-step

Multi-entity imports are not one SQL transaction across profiles, recipes, mixes, and related authoritative data. A failure can leave a partial apply.

Current import history and snapshot metadata do not establish a generally available transactional rollback. Structured preview, pre-apply snapshot, progress reporting, transaction identity, and guarded undo remain planned safety work.

Import safety is a distinct workstream. It should not be bundled into the day-state protocol change.

### 2.5 Factory data has bounded stamps, not causal fencing

Factory data:

- is facility-scoped;
- requires `manage-factory-settings` for reads and writes;
- stores independent key/value rows;
- clamps client timestamps to at most five minutes in the future;
- updates only when the incoming timestamp is newer;
- re-reads and returns the winning row;
- broadcasts an invalidation nudge rather than the complete value.

The five-minute clamp is a useful reference for future-stamp diagnostics and defense-in-depth. It is not a complete causality model: an offline writer can still hold unseen old content with a plausible later timestamp. Day-state complete-write hardening should copy the bounded-stamp idea only after adding an explicit canonical-base fence.

### 2.6 Roles are capability-driven

The current capability set includes:

```text
manage-staff
manage-inventory
edit-production-rules
approve-password-resets
review-incidents
use-ai-tools
manage-factory-settings
manage-profiles
```

Manager has all capabilities and operator has none by default. Starter role names are seeds, not an exhaustive enum; role names are data-driven.

New inventory, QC, import-approval, and factory operations should use deliberate capabilities rather than manager-name checks or overloading `use-ai-tools`.

### 2.7 QC and allergen records require durable ownership

Quality and allergen evidence should not exist only in resettable day-state JSON. Durable QC work needs:

- explicit capabilities;
- durable tables and immutable history;
- lifecycle rules that survive daily operational resets;
- a clear import-approval boundary;
- stable ingredient identity before allergen rollup;
- a cleaning verification gate if allergen sequence warnings become operational controls.

These are product-design requirements, not immediate sync-plan tasks.

### 2.8 Release evidence is revision-bound

The standard and full release commands build a dependency graph across prerequisites, library output, typechecks, API/package tests, clean-start, container checks, and serial browser gates.

A successful command alone is insufficient when required retained evidence is absent, incomplete, or bound to another revision. Infrastructure timeout remains distinct from a product assertion failure.

The added release research confirms existing release-process documentation; it does not change the sync implementation sequence.

## 3. Corrections to the supplied recommendations

### 3.1 Timestamp clamp is not the primary fix

The pre-implementation risk register paired the client-clock problem primarily with server clamping and rebase. The corrected priority is:

1. explicit canonical-base validation for complete writes;
2. adopt-before-publish and post-adopt residue rebase;
3. bounded future-stamp measurement;
4. optional clamp or rejection as defense-in-depth.

Clamping cannot prove that a writer observed the value it replaces.

### 3.2 Factory KV is not the day-state causality template

Factory KV demonstrates bounded timestamps and conditional per-key SQL updates. It does not solve the unseen-write problem. The established partial day-state snapshot fence is the stronger template for complete-write causality.

### 3.3 Deployment topology does not block the protocol fix

The supplied ready-to-build checklist required deciding single-instance versus multi-instance SSE topology before Wave 1. That dependency is unnecessary.

Complete-write base fencing is valid under one or many processes because the daily row is locked and canonical state is read from the database. SSE topology verification remains required before claiming instantaneous cross-instance peer notification or changing the deployment model.

### 3.4 AI policy does not block provider-key correction

The owner decision about hard versus soft AI dependency can follow the concrete readiness-key fix. The service should first detect the provider configuration the active adapter can actually use.

### 3.5 Mobile is a declared non-goal, not a silent compatibility assumption

The product remains web-only. If legacy mobile code or clients still exist, protocol migration should explicitly state whether they receive compatibility behavior or are unsupported. The sync change should not imply renewed mobile parity work.

## 4. Cross-domain risk map

| Risk | Domain interaction | Plan treatment |
|---|---|---|
| Stale complete write replaces accepted claim state | Sync + auto-track | Phase 1 regression matrix includes coordination and packaging progress |
| Accepted sauce claim and inventory effect diverge | Auto-track + inventory | Preserve atomic application under the existing lock/transaction boundary |
| Offline device crosses local-day reset | Auth + reset + sync | Preserve reset-epoch ordering and require new-day adoption before publish |
| Import fails after partial authoritative writes | Import + master data | Separate import-safety plan with preview, progress, snapshot, and guarded undo |
| Factory/client clock runs ahead | Factory data + sync | Measure and bound stamps only as defense-in-depth |
| QC evidence disappears at daily reset | QC + storage | Use durable relational ownership, not day-state-only storage |
| Ingredient identity changes break allergen or inventory | Import + master data + compliance | Stabilize ingredient identity before downstream rollups |
| Release report is stale or incomplete | QA + delivery | Require evidence verifier for the same revision |

## 5. Revised pre-implementation order

### Track A — Immediate correctness

1. Add the stale, future-stamped complete-write proof.
2. Add complete-write base validation and canonical fallback.
3. Preserve reset, auto-track, packaging, tombstone, blank, and completed-history invariants.
4. Correct AI provider-key readiness detection.

### Track B — Measurement

1. Add bounded sync mode, fallback, size, reconnect, and future-stamp metrics.
2. Add pool wait and transaction-duration distributions.
3. Run the sanitized published SSE and two-process fanout probes.

### Track C — Evidence-driven operational decisions

1. Choose shared fanout or an enforced single-process topology.
2. Compute the database pool budget.
3. Decide global versus capability-specific AI readiness.

### Track D — Adjacent product integrity

1. Inventory actuals, surplus, prep-mix, and packaging events.
2. Import preview and guarded multi-entity recovery.
3. Durable QC and allergen controls.

Tracks A and B can proceed without completing Track D. Track D should reuse the corrected causal and transactional boundaries rather than create parallel client-write mechanisms.

## 6. Remaining human decisions

- AI hard dependency versus degraded capability.
- Inventory location and lot ownership.
- Authoritative production actual for deduction.
- Scope and cadence of QC/allergen controls.
- Compatibility policy for any legacy mobile client.
- Whether production requires multiple serving instances with live cross-instance notification.

## 7. Evidence boundary

The supplied packs are architectural research, not production runtime evidence. Repository implementation and tests support deterministic behavior; deployment probes establish environment behavior; owners decide policy and product semantics. None of these documents proves a historical overwrite cause, production database exhaustion, or cross-instance SSE failure.