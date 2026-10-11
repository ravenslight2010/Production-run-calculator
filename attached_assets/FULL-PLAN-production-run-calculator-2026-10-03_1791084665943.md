# Full Plan — Production Run Calculator

**Version:** 2026-10-08 (roadmap reconciliation)
**Primary branch (production):** `Replit`  
**Experimental branch:** `main`  
**Published app:** https://lucias-production-assistant.replit.app  

This is the **full plan**: goals, constraints, phase roadmap, every major backlog item, acceptance criteria, and what Replit should do next. Detailed designs remain in linked plan docs; this document is the ordering authority for execution.

---

## 1. Product goal

A **floor-ready production run calculator** for a pizza manufacturing facility that:

1. Stays **up** during the shift (sync, calc, inventory, auth).  
2. Keeps **truthful inventory and run state** across tablets on plant Wi‑Fi.  
3. Supports **QC, allergens, and imports** with human approval — not silent AI writes.  
4. Can eventually run **on a local network with no public internet**, with optional on-prem AI.  
5. Never destroys **compliance / quality history** on daily reset or factory purge.

---

## 2. Non-negotiable constraints

| # | Constraint |
|---|------------|
| 1 | **Human Apply** for AI and high-risk mutations; value protection / claims stay authoritative |
| 2 | **Soft readiness** — AI and background workers must not 503 core `/readyz` |
| 3 | **Purge ≠ destroy QC** — quality/compliance/surplus audit trails survive purge-all |
| 4 | **Server-authoritative inventory** — one idempotent intent per physical event; no parallel client stock writes |
| 5 | **Local AI gated** — no routing from `LOCAL_AI_BASE_URL` alone until gold-set vs Gemini is approved (`docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md`) |
| 6 | **Primary ship path = `Replit`**; `main` is experimental/docs unless explicitly promoted |
| 7 | Vision / QC AI is **assist only**, never release authority |
| 8 | Reject rejected patterns from historical `improvements/observability-resilience` branch |

---

## 3. Current state (verified / catalogued)

### 3.1 Production ops (latest evidence on file; not reprobed for this reconciliation)
- The latest sanitized production record is [`published-background-db-investigation-2026-10-08.md`](../docs/evidence/published-background-db-investigation-2026-10-08.md). It records `/api/readyz` **200** with a background-worker warning and identifies the published build/revision.
- The 2026-10-08 report found that the published web-push scheduler creates work per scope/date/time bucket and that its queue was very large. The checkout has a coalesced producer, but the report says the published build still has the older producer. This is a confirmed queue amplifier, **not proof that it caused every database timeout**.
- The production SQL evidence came from a read replica. Effective primary connection ceiling, deployed pool override, current/peak serving-instance count, and live pool wait state remain unknown; do not claim database headroom. Task #2808 remains the active agent investigation. Continue with authorized Replit evidence rather than asking the owner to transcribe values that may be retrievable there.
- Do not infer the published source from the current checkout or this plan. No production probe, publish, setting change, or data change was performed for this reconciliation.

### 3.2 Capability snapshot (reconciled 2026-10-08; repository capability unless stated)

| Area | Status |
|------|--------|
| Sync | **Partial** — stale/offline convergence and user-visible recovery/status are implemented and tested; exact published behavior/topology and capacity evidence remain incomplete |
| Server live calc | **Done** for projected surfaces (not proof of prod freshness) |
| Inventory | **Partial** — actual-case drawdown, prep-mix, finished-case surplus/allocation, sauce, and packaging formulas exist; direct coverage of some packaging modes and final-total/waste/return reconciliation remain |
| Mixes | **Partial** — server-owned fresh-mix deduction and dated surplus/allocation exist; next-run carry-over prompt was removed; broader reconciliation remains |
| Imports | **Partial** — history, source-versus-landed reporting, deterministic-first supported workbook paths, and transactional apply/guarded undo for spec/premix/cheese exist; universal provenance, impact preview, and health/versioning remain |
| QC | **Gated** beyond retained quality-check records; Phase 1 prerequisites remain unresolved |
| Allergens | **Partial** — ingredient mapping and incomplete-safe read-only run footprint exist; cleaning controls, declarations, and reporting remain |
| Reporting / downtime | **Partial** |
| Line map | **Built** |
| Battery/Wake Lock | **Built** in repo; real-device evidence open |
| Local AI routing | **No-go** until gold set |

---

## 4. Phase roadmap (full)

Execute in order of phase letter. Within a phase, use the numbered work queue. Parallelize only where noted.

```text
A Sync reliability
B Ops integrity          ← immediate Replit focus
C Inventory truth
D Import + QC + allergens
E Floor UX + multi-day + AI portfolio
F Reporting + analytics + measured sync opts
```

---

## 5. PHASE A — Sync reliability

**Reconciled 2026-10-08.** “Complete” below means repository behavior and focused coverage are present; it does not by itself prove production deployment behavior.

**Authority:** `docs/sync-reliability-unified-plan-2026-09-19.md`, `docs/sync-system-improvements-plan.md`

### 5.1 Already built (do not rebuild)
- Complete/partial snapshot fencing  
- `protectRunValues` / blank-over-populated guards  
- SSE broadcast on accepted writes (process-local)  
- Offline push queue + operational mutation cursor  
- Daily-reset session fence  
- Server live-calc / auto-track on sync stream  
- Wake-recovery diagnostics  

### 5.2 Current status and evidence
| ID | Work | Status | Current evidence / remaining boundary |
|----|------|--------|--------------------------------------|
| A1 | Repeated-offline multi-device convergence | **Complete in repository** | Merged task #2800 and `sync.convergence.integration.test.ts` cover interleaved offline edits, reload/rebase, and duplicate delivery. This is deterministic test evidence, not a physical-device deployment claim. |
| A2 | Operator-visible sync health and recovery | **Complete in repository** | Merged task #1053; `SyncStatusPopover`, sync diagnostics, and data-health recovery paths expose catching-up/conflict/retry status. |
| A3 | Published identity / deployment evidence | **Partial** | The 2026-10-08 production evidence records the published build identity, but its prepared-source fingerprint did not match the workspace record and the current checkout correction is not in that published build. Reconcile exact deployed source and post-publish behavior; see the evidence file linked in §3.1. |
| A4 | Stale reconnect / LWW policy | **Complete in repository** | Merged tasks #2800 and #2830 plus stale-base/future-stamp integration coverage show canonical adoption/rebase rather than a stale overwrite. Broader real-device coverage is separate. |
| A5 | Broader day-state revision preconditions | **Open / optional** | Existing `baseSnapshotId` fences complete and partial writes. Do not add a second revision contract without a demonstrated gap and its migration/test plan. |
| A6 | JSON Patch / compression / selective sync | **Gated by measurements** | Safe measurements exist, but current production distributions and a proven payload/performance need are prerequisites; no rebuild is justified by the current evidence. |

---

## 6. PHASE B — Operational integrity (do next)

**Authority:** `docs/uptime-and-operational-backlog-decision-2026-10-02.md` + research handoff

**Reconciled 2026-10-08.**

| ID | Work | Priority | Status | Current evidence / remaining boundary |
|----|------|----------|--------|--------------------------------------|
| **B1** | **Purge-all retains `quality_checks`** | P0 | **Complete** | Merged task #2660; the scoped purge integration test in `sync.integration.test.ts` verifies live and sandbox QC rows survive, including rejected staff purge. |
| **B2** | **Enforce the chosen SSE topology** | P0 | **Gated — policy decided** | The decision record says the owner selected one always-on API process on 2026-10-03 (record updated 2026-10-05). Published Autoscale cannot establish an always-on single-process limit. A deployment change/publish and control-plane verification need separate owner approval; do not claim live peer SSE is enforced. |
| **B3** | Web-push queue/root-cause follow-through | P1 | **Partial** | The 2026-10-08 evidence identifies per-date job creation as a queue amplifier; the checkout coalesces enqueueing, but the published build still uses the old producer. The evidence does not prove that this caused every DB timeout. Check whether an approved publish occurred, then re-probe; no owner-supplied metrics are needed before checking Replit sources. |
| **B4** | Preserve soft readiness | P0 | **Complete for checked-out policy; observed in latest probe** | `health.test.ts` covers optional AI/worker warnings as non-blocking and required failures as blocking. The 2026-10-08 published probe returned 200 with a worker warning. |
| **B5** | Privacy-safe operations audit boundary | P2 | **Partial** | Allowlisted, bounded, payload-free audit constraints are documented in `docs/idea-backlog.md` §17 and implemented for scoped records. QC retention, export, and redaction requirements remain owner-gated before broader audit tables. |
| **B6** | Gemini resilience | P1 | **Partial** | Shared bounded retry behavior for malformed JSON and retryable 429 responses is implemented/tested. The required circuit-breaker and stream-metrics scope is not evidenced as complete; provider exceptions outside the safe retry classes remain failures. |

### B2 decision (recorded; enforcement still open)

| Option | Meaning |
|--------|---------|
| **A — selected** | One always-on API process; accept the single failure domain. Current Autoscale deployment does not enforce this. |
| **B — not selected** | Shared event bus and two-process SSE behavior. Revisit only with a separate owner decision. |

Until an approved deployment change is published and verified: do not claim the selected single-process constraint or multi-instance live-peer delivery is in effect.

---

## 7. PHASE C — Inventory truth

**Authority:** `docs/inventory-autodeduction-plan.md`, `docs/overproduction-surplus-plan.md`, idea-backlog §1/3/4

### 7.1 Hard rule
Every physical stock change = **one server idempotent intent/transaction**. No second client ledger.

### 7.2 Work items — reconciled 2026-10-08

| ID | Work | Priority | Status | Current evidence / remaining boundary |
|----|------|----------|--------|--------------------------------------|
| C1 | Mix-made deduction and audit | High | **Complete for recorded day-start events** | `inventory.integration.test.ts` covers idempotent day-start deductions, rollback/retry, and mix surplus creation. |
| C2 | `mix_surplus`, allocations UI, purge retention | High | **Partial** | `MixSurplusStrip`, the mix-surplus API, and inventory integration tests cover scoped lots and allocation. The purge route does not delete the table, but a direct purge-retention assertion was not found. |
| C3 | Auto-suggest leftover mix on next run | Medium | **Deferred by recorded product direction** | Carry-over prompts were removed from the run UI (see `LiveRunTabContent.tsx` comment dated 2026-07-10). Do not restore without renewed product approval. |
| C4 | Actual cases drive run consumption | High | **Partial verification** | The server source scales to `actualCases` with a planned-value fallback; current inventory integration tests cover finalization/idempotency but do not directly assert actual-case scaling. Add that focused regression. |
| C5 | Overproduction events, disposition, and inventory adjustment | Medium | **Partial** | Actual-case consumption already charges excess production once; surplus confirmation creates the finished-case asset. Separate event history, waste/discard/donate dispositions, and analytics are not built. |
| C6 | Freezer pull double-count protection | High | **Partial** | Allocation updates the dated surplus and finished-case inventory in server code. Existing tests cover allocation idempotency and generic location transfers, but not parity of the two representations through confirm, replacement, and purge. |
| C7 | Packaging consumption across 13 items and modes | High | **Partial — formulas exist** | `computeRunLines` and daily-supply math include the packaging lines; `index.test.ts` directly checks circles, shippers, cartons, shipper labels, tape, glue, and ink, but not every slip/grip/label/pallet/mode combination. Extend focused coverage; do not rebuild existing formulas as missing features. |
| C8 | Packaging lots tied to QC lot entries | Medium | **Gated on QC lots** | Depends on QC Phase 1 being scoped and implemented. |
| C9 | Waste / spoilage / returns | Lower | **Open; product rules required** | No single server-authoritative waste/return workflow is established. |
| C10 | Final-total freeze / field reconciliation | Medium | **Open** | Completion-time accepted totals and correction/reconciliation rules need definition. |

### 7.3 Packaging evidence
Formula paths exist for circles, shippers, cartons, slip/grip sheets, labels, pallets, and daily supplies (tape/glue/ink). Current focused tests cover only part of that matrix, so status is partial for verification—not a claim that the other package lines are absent.

### 7.4 Remaining order
1. Add focused assertions for uncovered packaging lines/modes and parity for freezer-surplus versus finished-case inventory; verify mix-surplus purge retention.
2. Define final-total freeze and physical reconciliation rules.
3. After owner agreement on reason codes and disposition, implement waste, spoilage, stoppage-loss, and return events.

---

## 8. PHASE D — Import, QC, allergens

### 8.1 Imports — reconciled 2026-10-08
**Authority:** `docs/import-system-plan.md`, `docs/importer-redesign-plan.md`

| ID | Work | Status | Current evidence / remaining boundary |
|----|------|--------|--------------------------------------|
| D1 | Structured preview, progress, transaction identity | **Partial** | Import History, operation IDs, retry/reopen, and source-versus-landed reports exist (merged task #1354). A universal structured before/after diff is not present. |
| D2 | Pre-apply snapshot and guarded undo | **Partial — supported importers complete** | Merged task #2428 and `importOperations.integration.test.ts` cover transactional snapshots, retry, and conflict-guarded undo for spec/premix/cheese. Local guide and schedule projections keep separate boundaries. |
| D3 | Deterministic-first parse; AI fallback | **Complete for supported workbook layouts** | Merged task #1923; `deterministicWorkbook.test.ts` verifies deterministic parse and fail-closed unsupported layouts. Photos and unsupported/ambiguous sources still require explicit review/fallback. |
| D4 | Atomic apply | **Partial — supported importers complete** | Spec/premix/cheese use one server transaction and operation identity; do not describe all importer types as atomic. |
| D5 | Cross-import health view | **Partial** | Spec/mix reconcile paths exist; a unified view across all importer types remains. |
| D6 | Import → inventory impact projection | **Open** | Show projected demand from reviewed recipe changes using inventory math; preview only, with no stock mutation. |
| D7 | Batch import and re-import diff/versioning | **Partial** | Multi-file spec parsing exists; mixed/all-importer batch workflows and source-keyed before/after version diffs remain. |
| D8 | QC approval gate | **Gated on QC Phase 1** | Do not create an import approval queue before the QC role, evidence, and retention decisions are resolved. |
| D9 | Scheduling integration | **Deferred** | Keep deferred unless a recurring source and owner-approved workflow justify it. |

**Remaining order:** finish provenance in the active source-cell work; then prioritize D6 and broader cross-import health; batch/versioning and QC approval remain later/gated.

### 8.2 QC department
**Authority:** `docs/qc-department-plan.md` + industry research

**QC Phase 1 owner direction:** see `docs/qc-department-plan.md`. Direction exists, but it is not implementation approval. Do not start schema, API, or UI work until target/tolerance sources, role/capability mapping, history/export access, and privacy/redaction policy are resolved.

| Phase | Scope | Status |
|-------|-------|--------|
| **QC0** | Quality history survives purge | **Complete** — tested by B1 |
| **QC1** | Separate lot and weight pages; filtered history + CSV; append-only audit | **Gated** — prerequisites above remain |
| **QC2** | Component, label, date checks | **Open after QC1** |
| **QC3** | Import/recipe approval; future plans | **Gated after QC1 and owner workflow decisions** |
| **QC4** | Trends, traceability reports, analytics | **Later** |
| **QC-R** (research) | Holds/release; line clearance; finished-lot ID; mock recall; HACCP *evidence* only |

**Tables (plan):** run_lots, weight_checks, component_checks, label_checks, date_checks, qc_checklists, qc_audit_log, qc_recipes, qc_future_plans  
**Research tables:** product_holds, line_clearances  

**Locked:** survive daily reset + purge; append-only audit; exportable.

### 8.3 Allergens
**Authority:** `docs/allergen-tracking-plan.md`

| ID | Work | Status |
|----|------|--------|
| AL1 | Ingredient → allergen map | **Complete foundation** — reviewed ingredient mapping exists |
| AL2 | Auto run allergen footprint from recipe | **Complete as read-only, incomplete-safe visibility** |
| AL3 | QC pre-run checklist | **Gated on QC scope and sign-off decisions** |
| AL4 | Cleaning verification gate | **Gated on approved cleaning evidence and blocking rules** |
| AL5 | Label declarations | **Open** — product/label authority and verified coverage remain |
| AL6 | Cross-contact alerts + daily report | **Open** — define validated triggers and reporting rules |

---

## 9. PHASE E — Floor UX, multi-day, AI portfolio

### 9.1 Floor UX
| ID | Work | Status |
|----|------|--------|
| E1 | Line map dashboard | **Built** — polish only |
| E2 | Freeze tunnel visualization | Idea |
| E3 | Press/oven station view | Idea |
| E4 | Production cooler tracking | Idea |
| E5 | Upstream/downstream lag alerts | Idea |
| E6 | Occupancy heatmap / multi-line | Idea |
| E7 | Real-device battery evidence | Open |

### 9.2 Multi-day lookahead
**Plan:** `docs/multi-day-lookahead-plan.md`

- 7-day unified timeline  
- Conflicts: freezer capacity, mix overload, ingredient/packaging shortfall  
- “What to prep today” checklist  

### 9.3 AI portfolio (audit-governed)
**Authority:** `docs/ai-feature-value-audit-2026-09-05.md`, gated local-AI decision

| Keep | Simplify | Consolidate | Retire/avoid |
|------|----------|-------------|--------------|
| Extraction + Apply | Recap/anomalies as deterministic | Match/merge/fill-missing → one resolve path | Voice mutate; open day Q&A; vision as release authority |

| Future local / plant | Gate |
|----------------------|------|
| `LOCAL_AI_*` adapter | Gold-set comparison vs Gemini required |
| `docker-compose.plant.yml` + Ollama | After adapter approved |
| USB model preload runbook | Air-gap ops |
| QLoRA/distillation | No promotion without Phase-0 metrics |

**In-app agents:** propose only; never autonomous purge/sync/inventory.

---

## 10. PHASE F — Reporting & analytics

### 10.1 Production reporting
**Plan:** `docs/production-reporting-plan.md`  
Automated EOD, PDF/CSV, multi-day trends, cost, waste cost, comparisons.

### 10.2 Downtime analytics
**Plan:** `docs/stoppage-analytics-plan.md`  
Live alerts, cost, reason classification, recurrence (3+), root-cause hints, correlations.

### 10.3 Measured sync optimizations
Only after Phase A metrics: JSON Patch, compression, selective sync, timestamp policy experiments.

---

## 11. Complete backlog index (all major ideas)

**Status reconciliation:** 2026-10-08. Phase A–D detail and evidence boundaries are in §§5–8 above.

| # | Item | Phase | Priority | Status |
|---|------|-------|----------|--------|
| 1 | Mix plan & prep mix surplus | C | High | Partial |
| 2 | QC department | D | High | Gated beyond retained quality-check records |
| 3 | Overproduction & surplus | C | Medium | Partial |
| 4 | Inventory gap fixes (13 packaging, etc.) | C | High | Partial — formulas exist; targeted coverage and reconciliation remain |
| 5 | Allergen tracking | D | High | Partial — mapping/footprint built; controls and declarations remain |
| 6 | Production reporting | F | Medium | Partial |
| 7 | Stoppage & downtime analytics | F | Medium | Partial |
| 8 | Multi-day lookahead | E | Medium | Planning |
| 9 | Production line map | E | — | **Built** |
| 10 | Line station expansion | E | Medium | Ideas |
| 11 | AI portfolio (audit) | E | Medium | Governed |
| 12 | Battery & performance | E | Medium | Built + evidence open |
| 15 | Import system enhancements | D | High | Partial — scoped atomic apply/undo, import history, and source/landed reporting built |
| 16 | Sync system residual | A | High | Partial — convergence and user-facing recovery built; deployment evidence remains |
| 17A | Privacy-safe ops audit | B | Medium | Partial — guardrails documented; QC retention/export requirements remain |
| 17B | Provider AI resilience | B | Medium | Partial (Gemini) |
| R1 | Purge excludes QC | B | P0 | **Done** — current quality history is retained; see QC Phase 1 decision note |
| R2 | SSE A/B decision and enforcement | B | P0 | **Policy decided: one always-on process; enforcement/publish gated** |
| R3 | Web-push queue/root-cause follow-through | B | P1 | **Partial** — queue amplifier found and checkout corrected; published build still needs verification |
| R4 | Stale LWW reconnect | A | High | **Complete in repository** — merged stale-base convergence coverage |
| R5 | LOCAL_AI + plant compose | E | Gated | Research only |
| R6 | Hold/release, line clearance, lot recall | D | Research | After QC1 |
| R7 | HACCP evidence storage | D | Research | Not full doc control |

---

## 12. Linked plan documents

| Path | Topic |
|------|--------|
| `docs/idea-backlog.md` | Idea catalog |
| `docs/sync-reliability-unified-plan-2026-09-19.md` | Sync sequencing |
| `docs/sync-system-improvements-plan.md` | Sync residual |
| `docs/uptime-and-operational-backlog-decision-2026-10-02.md` | Readiness |
| `docs/evidence/published-background-db-investigation-2026-10-08.md` | Latest bounded production identity, readiness, and queue evidence |
| `docs/qc-department-plan.md` | QC |
| `docs/import-system-plan.md` / `importer-redesign-plan.md` | Imports |
| `docs/inventory-autodeduction-plan.md` | Inventory |
| `docs/inventory-gap-analysis.md` | Historical inventory gap snapshot and current reconciliation |
| `docs/overproduction-surplus-plan.md` | Surplus |
| `docs/allergen-tracking-plan.md` | Allergens |
| `docs/production-reporting-plan.md` | Reporting |
| `docs/stoppage-analytics-plan.md` | Downtime |
| `docs/multi-day-lookahead-plan.md` | Multi-day |
| `docs/ai-feature-value-audit-2026-09-05.md` | AI keep/retire |
| `docs/battery-performance-research.md` | Battery |
| `docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md` | Local AI no-go |
| `docs/evidence/conditional-qlora-training-decision-2026-10-02.md` | QLoRA gate |
| `docs/superpowers/plans/*` | Historical implementation slices |

---

## 13. Immediate execution queue (Replit)

Reconciled 2026-10-08. The list separates agent work from owner-only approvals; do not rerun completed work as if it were absent.

```text
AGENT-EXECUTABLE (in order)
1. Continue active task #2808 using authorized Replit evidence; the 2026-10-08 read-replica/log investigation does not establish primary connection headroom or the cause of every timeout. Do not change pool settings without a capacity budget.
2. Check current published identity/readiness and whether the scheduler correction is deployed. If not, record the owner-publish gate; after an approved publish, repeat the bounded read-only verification.
3. Close focused C2/C4/C6/C7 verification gaps: mix-surplus purge retention, actual-case scaling, parity between freezer-surplus allocations and finished-case inventory, and packaging line/mode assertions. Do not rebuild existing formula paths.
4. Continue D6 import-impact preview after the active source-cell work (#2854); compute projected demand from the reviewed import only, with no inventory writes.

OWNER-ONLY / APPROVAL GATES
1. Approve any deployment-target/publish change needed to enforce the selected always-on single API process.
2. Resolve the remaining QC Phase 1 target/tolerance, capability, history/export, and privacy/redaction prerequisites before QC schema/API/UI work.
3. Decide final-total reconciliation and waste/spoilage/return event rules before adding stock mutations.
4. Approve cleaning-gate and label-declaration authority before allergen controls can block production or create claims.

DEFERRED
5. Realtime surplus detection, carry-over prompts removed by prior product direction, broad multi-importer versioning, and measured sync optimizations remain deferred until their listed dependencies or evidence justify them.
```

---

## 14. Acceptance criteria (program level)

**Reliability**
- [x] Checked-out core `/readyz` returns 200 for optional AI/worker warnings; the 2026-10-08 published probe also returned 200 with a worker warning
- [x] QC history survives purge-all
- [ ] Published SSE topology is enforced and verified (owner-selected single-process policy is not enforced by current Autoscale evidence)
- [x] Repository convergence tests cover multi-device offline→online stale-write recovery; this is not physical-device production evidence

**Inventory**
- [x] Implemented physical-event paths use server idempotent handling; see C1/C4/C6 and retain the remaining-event boundary there
- [~] Server source uses actual production for consumption; direct actual-case scaling coverage remains open
- [ ] Mix surplus and overproduction have complete disposition/history and reconciliation

**QC / safety**
- [ ] Phase 1 lots/weights (when scoped) with audit trail  
- [ ] Allergen path toward cleaning gates (ingredient mapping and read-only footprint exist; controls remain gated)
- [ ] AI never sole release authority  

**AI**
- [ ] Extraction remains Apply-gated  
- [ ] No silent local routing  
- [ ] Plant offline path only after explicit gold-set approval  

**Product**
- [ ] Floor map remains usable  
- [ ] Import review has a universal structured before/after diff (scoped history, source/landed reporting, and guarded undo already exist)
- [ ] Reporting/downtime improvements do not block A–D  

---

## 15. Explicit out of scope (this plan revision)

- Full HACCP document management system  
- Ungated on-device model download at plant runtime  
- Autonomous multi-agent plant control  
- Replacing Gemini quality online with untested local models  
- Merging all `main` experiments without Replit review  

---

## 16. Document control

| Field | Value |
|-------|--------|
| Title | Full Plan — Production Run Calculator |
| Date | 2026-10-08 |
| Replaces | Scattered handoffs as *ordering* authority; does not delete detailed plans |
| Next review | After agent-side deployment evidence is refreshed or an owner approval changes a gated decision |

---

*End of full plan.*
