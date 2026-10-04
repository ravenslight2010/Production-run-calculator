# Full Plan — Production Run Calculator

**Version:** 2026-10-03  
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

### 3.1 Production ops (probed)
- `/api/readyz` → **200** soft readiness  
- AI capability configured (Gemini path)  
- Background workers recently **ok** (including web-push)  
- `Replit` tip at last check: **`3412b790`** (early 2026-10-03) — handoff items below not all landed in git

### 3.2 Capability snapshot (from idea-backlog)

| Area | Status |
|------|--------|
| Sync | **Partial** — fencing, SSE, protect, offline queue, live calc projection built; offline convergence & evidence open |
| Server live calc | **Done** for projected surfaces (not proof of prod freshness) |
| Inventory | **Partial** — actual-case, packaging partial, surplus, prep-mix, freezer, sauce events |
| Mixes | **Partial** — deduction/surplus exist; reconciliation open |
| Imports | **Partial** — flows/review/aliases; atomic apply/undo/deterministic-first open |
| QC | **Open** beyond thin foundations |
| Allergens | **Partial** foundation |
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

**Authority:** `docs/sync-reliability-unified-plan-2026-09-19.md`, `docs/sync-system-improvements-plan.md`

### 5.1 Already built (do not rebuild)
- Complete/partial snapshot fencing  
- `protectRunValues` / blank-over-populated guards  
- SSE broadcast on accepted writes (process-local)  
- Offline push queue + operational mutation cursor  
- Daily-reset session fence  
- Server live-calc / auto-track on sync stream  
- Wake-recovery diagnostics  

### 5.2 Remaining work
| ID | Work | Done when |
|----|------|-----------|
| A1 | Repeated-offline multi-device convergence tests & fixes | Documented scenarios pass |
| A2 | Operator-visible sync health (beyond raw logs) | Floor can see “catching up / conflict / ok” |
| A3 | Published identity / deployment evidence in ops report | Matches running build |
| A4 | Stale reconnect / LWW policy (revision/epoch; no old overwrite new) | Tests prove clock skew cannot clobber |
| A5 | Optional: broader day-state revision preconditions | Spec + tests; no silent data loss |
| A6 | JSON Patch / compression / selective sync | **Only if** measurements justify |

---

## 6. PHASE B — Operational integrity (do next)

**Authority:** `docs/uptime-and-operational-backlog-decision-2026-10-02.md` + research handoff

| ID | Work | Priority | Done when |
|----|------|----------|-----------|
| **B1** | **Purge-all excludes `quality_checks`** (+ comment + test) | P0 | Test green; QC row survives purge |
| **B2** | **SSE topology decision** — single process **or** shared fanout | P0 | Owner choice recorded; implemented or documented |
| **B3** | Web-push root-cause note (or explicit accept transient) | P1 | Written note; probe stays clean |
| **B4** | Preserve soft readiness forever unless owner reverses | P0 | Route tests still assert warning→200 |
| **B5** | Privacy-safe ops audit design (allowlist, retention) before new audit tables | P2 | Design approved; no raw payload storage |
| **B6** | Gemini resilience maintained (timeout, circuit, stream metrics) | P1 | Existing tests pass; no local silent route |

### B2 decision table

| Option | Meaning |
|--------|---------|
| **A** | Min 1 API instance; document Autoscale limit; accept single failure domain |
| **B** | Shared event bus; two-process SSE tests for day-state, lock, reset, rollover |

Until decided: do not claim multi-instance live peers work.

---

## 7. PHASE C — Inventory truth

**Authority:** `docs/inventory-autodeduction-plan.md`, `docs/overproduction-surplus-plan.md`, idea-backlog §1/3/4

### 7.1 Hard rule
Every physical stock change = **one server idempotent intent/transaction**. No second client ledger.

### 7.2 Work items

| ID | Work | Priority |
|----|------|----------|
| C1 | Mix-made deduction hardened + audit | High |
| C2 | `mix_surplus` + allocations UI; purge-exclude | High |
| C3 | Auto-suggest leftover mix on next run (confirm) | Medium |
| C4 | Actual cases drive consumption (not only planned) | High |
| C5 | Overproduction events + disposition + inventory adjust | Medium |
| C6 | Freezer pull double-count fix | High |
| C7 | Full packaging 13 items + modes (cartoned/labeled/n-a) | High |
| C8 | Packaging lots tied to QC lot entries | Medium (needs QC lots) |
| C9 | Waste / spoilage / returns | Lower |
| C10 | Final-total freeze / field reconciliation | Medium |

### 7.3 Packaging checklist
Circles, shippers, cartons (partial today). Still open: slip sheets, grip sheets, top/bottom/shipper labels, pallets, tape, glue, glue sticks, ink.

### 7.4 Build order
1. Actual cases + overproduction path + mix deduction/surplus  
2. Freezer pull double-count  
3. Full packaging  
4. Waste & returns  

---

## 8. PHASE D — Import, QC, allergens

### 8.1 Imports
**Authority:** `docs/import-system-plan.md`, `docs/importer-redesign-plan.md`

| ID | Work |
|----|------|
| D1 | Structured preview + progress / transaction id |
| D2 | Pre-apply snapshot + **guarded undo** |
| D3 | Deterministic-first parse; AI **fallback only** |
| D4 | Atomic apply |
| D5 | Cross-import health view |
| D6 | Import → inventory impact projection |
| D7 | Batch import + re-import diff/versioning |
| D8 | QC approval gate (after QC Phase 1) |
| D9 | Scheduling integration (deferred) |

**Build order:** D1–D2 → validation/health/impact → batch/versioning → QC gate.

### 8.2 QC department
**Authority:** `docs/qc-department-plan.md` + industry research

**Do not start Phase 1 schema until product answers:** required checks; who writes/releases; retention; does hold block complete-run?

| Phase | Scope |
|-------|--------|
| **QC0** | B1 purge exclusion shipped |
| **QC1** | QC role; `run_lots`; `weight_checks`; dashboard; OpenAPI/routes |
| **QC2** | Component, label, date checks |
| **QC3** | Import/recipe approval; future plans |
| **QC4** | Trends, traceability reports, analytics |
| **QC-R** (research) | Holds/release; line clearance; finished-lot ID; mock recall; HACCP *evidence* only |

**Tables (plan):** run_lots, weight_checks, component_checks, label_checks, date_checks, qc_checklists, qc_audit_log, qc_recipes, qc_future_plans  
**Research tables:** product_holds, line_clearances  

**Locked:** survive daily reset + purge; append-only audit; exportable.

### 8.3 Allergens
**Authority:** `docs/allergen-tracking-plan.md`

| ID | Work |
|----|------|
| AL1 | Ingredient → allergen map |
| AL2 | Auto run allergen footprint from recipe |
| AL3 | QC pre-run checklist |
| AL4 | Cleaning verification gate (block if needed) |
| AL5 | Label declarations |
| AL6 | Cross-contact alerts + daily report |

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

| # | Item | Phase | Priority | Status |
|---|------|-------|----------|--------|
| 1 | Mix plan & prep mix surplus | C | High | Partial |
| 2 | QC department | D | High | Open |
| 3 | Overproduction & surplus | C | Medium | Partial |
| 4 | Inventory gap fixes (13 packaging, etc.) | C | High | Partial |
| 5 | Allergen tracking | D | High | Foundation |
| 6 | Production reporting | F | Medium | Partial |
| 7 | Stoppage & downtime analytics | F | Medium | Partial |
| 8 | Multi-day lookahead | E | Medium | Planning |
| 9 | Production line map | E | — | **Built** |
| 10 | Line station expansion | E | Medium | Ideas |
| 11 | AI portfolio (audit) | E | Medium | Governed |
| 12 | Battery & performance | E | Medium | Built + evidence open |
| 15 | Import system enhancements | D | High | Partial |
| 16 | Sync system residual | A | High | Partial |
| 17A | Privacy-safe ops audit | B | Medium | Design |
| 17B | Provider AI resilience | B | Medium | Partial (Gemini) |
| R1 | Purge excludes QC | B | P0 | **Open on tip** |
| R2 | SSE A/B decision | B | P0 | **Open** |
| R3 | Web-push note | B | P1 | Monitor |
| R4 | Stale LWW reconnect | A | High | Open |
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
| `docs/qc-department-plan.md` | QC |
| `docs/import-system-plan.md` / `importer-redesign-plan.md` | Imports |
| `docs/inventory-autodeduction-plan.md` | Inventory |
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

Copy into the agent as the active sprint:

```text
MUST DO NEXT
1. [B1] Purge-all: remove qualityChecksTable; test survives purge
2. [B2] Owner chooses SSE Option A or B; record decision; implement or document
3. [B3] Web-push: root-cause note or explicit “accept transient”
4. [B4] Do not regress soft readiness

THEN
5. [A1–A4] Offline convergence + stale LWW tests
6. [C] Inventory truth track (actual cases, mix surplus, freezer double-count)
7. [D] Import preview/undo/atomic apply (deterministic-first)
8. [D] QC Phase 1 only after product scope + B1 done
9. [D] Allergen mapping when QC/import capacity allows

GATED / LATER
10. Local AI adapter + plant compose only after gold-set decision overturned
11. Multi-day lookahead, station ideas, reporting, downtime analytics
12. Measured sync optimizations
```

---

## 14. Acceptance criteria (program level)

**Reliability**
- [ ] Core `/readyz` 200 when AI down and when workers warn  
- [ ] QC history survives purge-all  
- [ ] SSE behavior matches documented topology  
- [ ] Multi-device offline→online does not lose newer data to older clocks  

**Inventory**
- [ ] Physical events are server-idempotent  
- [ ] Actual production can drive consumption  
- [ ] Mix surplus and overproduction have durable disposition  

**QC / safety**
- [ ] Phase 1 lots/weights (when scoped) with audit trail  
- [ ] Allergen path toward cleaning gates  
- [ ] AI never sole release authority  

**AI**
- [ ] Extraction remains Apply-gated  
- [ ] No silent local routing  
- [ ] Plant offline path only after explicit gold-set approval  

**Product**
- [ ] Floor map remains usable  
- [ ] Import path has preview + undo direction  
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
| Date | 2026-10-03 |
| Replaces | Scattered handoffs as *ordering* authority; does not delete detailed plans |
| Next review | After B1–B3 land or owner changes phase priority |

---

*End of full plan.*
