# Pre-Implementation Research Pack

**Date:** 2026-09-19  
**Purpose:** Maximum remaining deep-dive research **before** coding prioritization. Complements sync/reconnect/server/domain packs already written.

**Already deep-dived (do not re-litigate here):**  
day-state sync, partial/complete causality, reconnect/wake, SSE, pool, auto-track claims, live-calc, import pipeline, factory KV, profile sync, schema overview, home ownership, e2e/release graph.

---

## 1. Inventory truth (highest product gap after sync)

### Problem (from `inventory-autodeduction-plan.md`)
Consumption is largely a **single event at run-end from planned `casesNeeded`**. Reality includes overproduction, prep mixes, packaging materials, and mid-run actuals—so on-hand drifts.

### Planned deduction events
| Event | Status (per plan) | Notes |
|-------|-------------------|--------|
| Overproduction surplus confirm | Not built | Charge ingredients for excess cases; surplus becomes freezer asset (not re-charged on reuse) |
| Prep mix made | Not built | Deduct components when mix produced |
| Already-made offset | Not built | Reduces *fresh* mix need; no second charge |
| Scale actual vs planned | Plan Feature D | Prefer actual production basis |
| Packaging materials | Implicit gap | Labels/cartons/shippers as SKUs |
| Auto-track sauce-barrel claim | Partial | Can emit `AutoTrackInventoryConsumption` under lock |

### Warehouse / FEFO (capability research)
Industry default for perishables is FEFO + lot genealogy. App has coverage math and warehouse snapshots; **lot-on-run** and FEFO pick guidance are still product backlog.

### Implementation implications
1. Do **not** invent a second inventory write path that bypasses row locks used by sync/claims.  
2. Prefer: claim/intent/surplus confirm → single server transaction → stock ledger.  
3. Until actuals drive deduction, manager dashboards will lie after heavy overproduction days.  
4. Cross-link: reconnect stamp bugs can also “undo” progress fields that inventory later trusts.

### Research open questions
- Where is `casesCompleted` authoritative (packaging progress vs form fields)?  
- Which locations are “onsite” for deduction?  
- Is freezer surplus a first-class lot or a soft counter?

---

## 2. Auth, roles, capabilities

### Model (`roles.ts`)
Capabilities are the **only** gated powers (data-driven roles):

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

**Builtin roles:** `manager` (all), `operator` (none).  
**Starter roles:** supervisor, qc-operator, qc-manager, warehouse, inventory (editable).

Routes use `requireCapability("…")`; UI should mirror the same strings.

### Threat-model highlights (`threat_model.md`)
- Bootstrap: staff signup code must not yield manager by accident.  
- Sandbox vs live scope isolation for KV, QC, runs, alerts.  
- Destructive ops need capability—not merely “logged in.”  
- AI/import/sync: rate limits, body caps (512KB sync), fail closed on auth config.  
- Rate-limit store falls back to memory if Postgres down (not fail-open unlimited).

### Research implications
- Factory-data PUT requires `manage-factory-settings`.  
- Inventory mutations need `manage-inventory`.  
- Expanding QC should add capabilities deliberately (avoid overloading `use-ai-tools`).  
- Reconnect overwrite is not only a sync bug—it is a **trust** bug for operators with write capability on shared tablets.

---

## 3. Session boundary & daily reset

### Mechanism (`sessionBoundary.ts`)
Daily reset **is** the session boundary:

- Fence read from `dayState.resetBoundaryAt` on **today’s live** `daily_sync` row (not `resetAt`).  
- **Why not `resetAt`:** also stamped on future scheduled writes; client-local calendar can equal server UTC “today” and log everyone out early.  
- `resetBoundaryAt` set server-side only when the writer’s **actual current local day** rolls.  
- Cached ~15s so `requireAuth` / SSE do not hit DB every request.  
- Tokens issued before boundary treated as signed-out → whole shift re-auths.

### Sync coupling
- Reset epoch on `data_reset` fences stale PUTs (`stale` response).  
- Wholesale adopt of run list only for **future** scheduled dates; today stays additive/tombstone.  
- Rollover background op is a named background operation (`daily-rollover`).

### Research implications
- Wake + midnight edge cases: device offline across boundary must adopt empty/new day, not push yesterday with high stamps.  
- Any fix to complete-write base revision must respect reset epoch ordering (already lock reset before document).

---

## 4. Background jobs & web push

### Background operations tracked
`daily-rollover` | `server-job-run` | `server-job-prune` | `web-push-schedule`

Diagnostics: rolling failure window (5 min), transient DB codes recognized, feeds readiness degradation when sustained.

### Web push
Kinds: `fifteenMin`, `batchDue`, `warehouseStaging`, `runComplete`, `freezerEmpty`.  
VAPID required; invalid config logged without leaking keys.  
Scheduled evaluation actor; retention ~14 days; subscription validation strict (https endpoint length bounds).  
Candidates use deterministic `dueAt` so late opt-in devices do not get stale floods.

### Research implications
- Push scheduler depends on day-state readability—corrupt/huge documents hurt more than UI alone.  
- Jobs should stay off the sync request path (already separated).

---

## 5. QC department (plan-level)

From `qc-department-plan.md` (phased): lots, weights, components, labels, dates, import approval queue, immutable history surviving operational reset.

**Seeded roles** already include `qc-operator` / `qc-manager` but capabilities are thin (`use-ai-tools`, `review-incidents`)—real QC will need explicit capabilities and tables excluded from purge-all.

### Research implications
- QC records must **not** live only inside resettable day-state JSON.  
- Import approval is owned by QC plan Phase 3—not a blocker for deterministic import work.  
- Field checks / quality checks tables already appear in schema barrel—confirm what is shipped vs planned before building UI.

---

## 6. Allergen tracking (plan-level)

Plan: ingredient→allergen map, sequence warnings (exists in spirit), cleaning verification, daily report.

Industry: Big-9 rollup, schedule allergen runs last, documented cleanouts.

### Research implications
- Depends on stable `ingredientId` (identity resolution work).  
- Sequence warnings without cleaning gate = incomplete control.  
- FSMA 204 full KDE export likely unnecessary for frozen pizza alone—still do customer/GFSI evidence.

---

## 7. Surplus, stoppages, multi-day (plan-level)

| Plan | Core idea |
|------|-----------|
| Overproduction surplus | Confirm extra cases → freezer asset + ingredient charge once |
| Stoppage analytics | Needs coded stop reasons (factory KV server-only list) |
| Multi-day lookahead | Ingredient availability + allergen sequence > pure case totals |

---

## 8. Mobile (paused)

Web-only focus; mobile parity paused. Mobile had async crash classes on sync deserialize (memory note). Any protocol change (baseRevision, claim shape) will need a conscious mobile non-goal or follow-up.

---

## 9. Consolidated risk register (pre-implementation)

| ID | Risk | Domain | Severity | Mitigation direction |
|----|------|--------|----------|----------------------|
| R1 | Stale complete PUT overwrites newer plant state | Sync | Critical | baseSnapshot/baseRevision + revision increment on day write; test |
| R2 | Client stamp ≠ causality | Sync | Critical | Server clamp; rebase after wake |
| R3 | Inventory from plan only | Inventory | High | Actuals + surplus + mix events |
| R4 | Claim accepted then LWW undoes fields | Auto-track + sync | High | Fix R1; keep claim baseUpdatedAt coherent |
| R5 | Partial import apply | Import | Medium | Snapshot/rollback; progress UX |
| R6 | Factory/profile last-writer vs day-state | Master data | Medium | Already per-key LWW+clamp; document operator expectations |
| R7 | Session fence wrong field | Auth | Fixed (use resetBoundaryAt) | Don’t regress to resetAt |
| R8 | AI readiness fails whole API | Ops | Medium | Degraded vs not-ready policy |
| R9 | Multi-instance SSE fanout | Deploy | Medium | Single always-on instance or bus |
| R10 | QC in day-state JSON | QC | Medium | Separate durable tables |
| R11 | home.tsx ownership creep | Client | Medium | Keep extracting per architecture doc |
| R12 | Full release suite lag | QA | Low–Med | Critical-path daily; full on release |

---

## 10. Recommended implementation order (research-backed)

Not a commitment—ordering by **risk reduction per unit effort**:

### Wave 0 — Prove the hole
1. Disposable integration test: future-stamped stale **complete** write must not win (or documents current fail).  
2. Metrics counters: `partial_fallback`, `complete_without_base`, `future_stamp_candidate`, `baseline_ms`.

### Wave 1 — Causality (sync)
1. Increment `canonicalRevision` on successful day-state write.  
2. Require `baseRevision` and/or `baseSnapshotId` on complete PUTs; mismatch → authoritative snapshot, no apply.  
3. Client: after wake, only partial residue against post-adopt base.  
4. Optional: clamp run stamps to serverNow + 5m (mirror factory KV).

### Wave 2 — Connect reliability
1. Snapshot GET first on wake; end “recovering” on day-state adopt.  
2. Proxy SSE buffering off; confirm idle timeouts.  
3. Same wake owner for visibility and SSE error.

### Wave 3 — Inventory truth
1. Surplus confirm deduction.  
2. Prep-mix made deduction + already-made offset.  
3. Wire sauce-barrel claim consumption path end-to-end if not fully live.

### Wave 4 — Master data & import safety
1. Import preview diff + undo snapshot.  
2. Audit log transaction id spanning multi-entity apply.

### Wave 5 — QC / allergen MVP
1. Durable QC tables + capability.  
2. Allergen map + cleaning gate.

---

## 11. Explicit non-goals (near term)

- Full WMS / directed FEFO picking hardware  
- HLC/CRDT rewrite of day-state  
- WebSocket replacement for SSE without evidence  
- Mobile parity until web protocol stabilizes  
- FSMA 204 KDE export without customer demand  
- Event-sourcing entire day document  

---

## 12. Document index (research corpus)

| File | Topic |
|------|--------|
| `capability-research-pack-2026-09-18.md` | All product domains × industry |
| `improvement-research-2026-09-18.md` | Build phases A–F |
| `further-research-2026-09-18.md` | Payload, FSMA, patch libs |
| `server-research-2026-09-19.md` | API surface |
| `server-research-deep-dive-2026-09-19.md` | PUT/SSE/pool code |
| `sync-deep-dive-2026-09-19.md` | Partial/complete architecture |
| `reconnect-reliability-deep-dive-2026-09-19.md` | Wake + overwrite |
| `deep-dive-research-continuation-2026-09-19.md` | Revision not on day PUT |
| `domain-deep-dives-2026-09-19.md` | Live-calc, import, factory, home, e2e |
| `all-remaining-deep-dives-2026-09-19.md` | Claims SM, import apply, factory KV, release DAG |
| **This file** | Inventory, auth, reset, jobs, QC, allergen, risk register, waves |

Replit branch also carries condensed copies under `docs/` and graded notes under `research/`.

---

## 13. Ready-to-build checklist

Before writing production code for Wave 1:

- [ ] Confirm deploy topology (single instance vs multi) for SSE assumptions  
- [ ] Add failing/tracking test for stale complete overwrite  
- [ ] Agree client wire fields: `baseRevision` required vs optional during rollout  
- [ ] Decide AI-missing readiness policy  
- [ ] Note mobile non-goal in PR template  

---

*This pack is intended to be sufficient to start Wave 0–1 without further broad research. Remaining unknowns are mostly production metrics and facility-specific inventory location rules.*
