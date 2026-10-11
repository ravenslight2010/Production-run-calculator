# Consolidated Master Backlog (Full) — All Plans & Ideas

**Date:** 2026-10-03  
**Primary branch:** `Replit` · **Experimental:** `main`  
**Purpose:** Single place that lists **every major plan and idea** from repo backlogs plus research handoffs. Detailed design stays in linked plan docs.

**Sources:** `docs/idea-backlog.md` (§1–17), domain plans, sync/uptime decisions, QC/HACCP research, LAN/LOCAL_AI research, gated local-AI & QLoRA decisions.

---

## How to use

| Need | Go to |
|------|--------|
| Sequencing sync/ops | `docs/sync-reliability-unified-plan-2026-09-19.md` |
| Catalog of ideas (repo) | `docs/idea-backlog.md` |
| This file | Full inventory + Replit-next queue + research additions |
| Local AI ship decision | `docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md` (**no-go**) |

**Statuses** = repository capability unless noted as production-verified.

---

## Unified phases

| Phase | Focus | Priority |
|-------|--------|----------|
| **A** | Sync reliability (offline convergence, fencing residual, LWW/stale reconnect) | Highest |
| **B** | Ops integrity (purge QC, SSE topology, workers, readiness policy) | Highest |
| **C** | Inventory truth (actual cases, mix/surplus, packaging, waste) | High |
| **D** | Import safety, QC department, allergens | High |
| **E** | Floor UX, multi-day, AI portfolio (cloud + gated local) | Medium |
| **F** | Reporting, downtime analytics, measured sync opts | Medium |

---

# PHASE A — Sync reliability

## A / Idea §16 — Sync system improvements

**Status:** Snapshot-fenced complete/partial foundation built; residual open  
**Priority:** High  
**Plans:** `sync-system-improvements-plan.md`, `sync-reliability-unified-plan-2026-09-19.md`

### Already built (do not re-propose)
- Protected merge / conflict-safe merge (`protectRunValues`, blank-over-populated)
- SSE live push on accepted writes
- Offline queue + operational mutation cursor
- Daily-reset session fence
- Server live-calc / auto-track projection on sync stream
- Wake-recovery diagnostics in Sync Activity
- Partial PUT with `baseSnapshotId`; complete PUT snapshot fence

### Still open
- Repeated-offline convergence
- Current production deployment evidence / published identity
- Operator visibility of sync health
- Ordinary day-state PUT: broader revision precondition policy (where not yet universal)
- Stale reconnect overwriting newer data (clock/LWW) — revision/epoch tests
- JSON Patch, compression, selective sync, timestamp policy — **conditional on measurements**

### Research addition
- SSE is **process-local `Set`** → Autoscale multi-instance does not fan out (see Phase B).

---

# PHASE B — Operational integrity (Replit-next)

## B1. Soft readiness — DONE in production
- Core hard: process, startup, database, auditProtection  
- AI + background workers: warning only, not 503  
- **Keep this policy**

## B2. Purge-all excludes QC / compliance history — OPEN
- Remove `qualityChecksTable` from purge-all; test  
- Policy: QC tables, future holds, mix_surplus audit trails survive purge  
- **Refs:** idea §2; qc-department-plan; handoff 2026-10-03

## B3. SSE / Autoscale decision — OPEN
- **A)** Single API process, or **B)** shared fanout + tests  
- Owner decision required

## B4. Web-push / background workers — MONITOR
- Soft warning policy correct; production recently ok  
- Document root cause vs transient

## B5. AI operational policy
- Gemini adapter production path  
- Local routing **gated no-go** until gold-set (Phase E)  
- Cost/circuit/metrics: provider-native resilience (idea §17B) — partially built on Gemini adapter

## B6. Privacy-safe operational audit trail (idea §17A)
- Allowlisted schemas; no raw payloads/prompts/IPs  
- Retention/redaction/export before new tables  
- Capability-gated reads; durable writes with operations  
- Reject historical `improvements/observability-resilience` branch patterns

---

# PHASE C — Inventory truth

## C / Idea §1 — Mix plan & prep mix inventory

**Status:** Partial  
**Priority:** High  

### Exists
- Planning math; physical mix-production deduction; surplus/carry ownership (partial)

### Open / proposed
1. Harden mix-made deduction (idempotent event, audit log)  
2. `mix_surplus` + allocations tables (exclude from purge-all)  
3. Leftover UI + freezer reminder  
4. Auto-allocation to next matching run (manager confirm)  
5. Operator reconciliation & production evidence  

**Code refs:** `lib/mixes`, MixesTab UI, inventory draw-down engine, mix surplus plan slices

---

## C / Idea §3 — Overproduction & surplus

**Status:** Partial  
**Priority:** Medium  
**Plan:** `overproduction-surplus-plan.md`

### Exists
- Freezer surplus confirm/pull; use-first; reorder alerts  

### Open
- Real-time overproduction detection during run  
- Ingredient-level overages (dough/sauce/cheese)  
- Inventory auto-adjust on actual vs planned cases  
- Broader disposition: store / donate / ship / discard / use-next  
- Surplus dashboard, history, trends, thresholds  
- Table: `overproduction_events` (immutable)

---

## C / Idea §4 — Inventory system gap fixes

**Status:** Partial  
**Priority:** High  
**Plans:** `inventory-autodeduction-plan.md`, inventory gap analysis  

### Rule
One server-authoritative, idempotent transaction/intent per physical event — **no parallel client stock writes**.

### Planned tracks
| Track | What |
|-------|------|
| A | Overproduction inventory deduction |
| B | Mix/prep mix deduction |
| C | Freezer pull deduction (fix double-count) |
| D | Actual cases instead of planned |
| E | Full packaging (13 items) |

**Packaging list:** circles, shippers, cartons (partial today); still needed: slip/grip sheets, top/bottom/shipper labels, pallets, tape, glue, glue sticks, ink — modes cartoned / labeled / n-a  

**QC tie-in:** packaging deductions carry lot numbers from QC lot entries  

### Lower priority open
- Waste/spoilage logging  
- Mid-run stoppage waste  
- Ingredient returns at run-end  
- Final-total freeze / field reconciliation  

### Build order (inventory plans)
1. Actual cases + overproduction + mix deduction  
2. Freezer pull double-count fix  
3. Full packaging  
4. Waste & returns  

---

# PHASE D — Import, QC, allergens

## D / Idea §15 — Import system (from backlog tail)

**Status:** Partial  
**Priority:** High  
**Plans:** `import-system-plan.md`, `importer-redesign-plan.md`

### Exists
- Seven importer flows, review, aliases, history, audit recovery  

### Planned items (backlog matrix themes)
1. Structured preview  
2. Progress / transaction identity  
3. Pre-apply snapshot + **guarded undo**  
4. Validation hardening  
5. Cross-importer linking / import health view  
6. Import → inventory impact projection  
7. Batch import  
8. Data versioning / re-import diff  
9. **QC approval gate** (after QC dept)  
10. Scheduling (deferred)  
11. Deterministic-first parsing; AI fallback only  
12. Atomic apply  

### Build order
1. Preview + progress + snapshot/undo  
2. Validation + cross-import health + inventory impact  
3. Batch + versioning  
4. QC approval gate  
5. Scheduling deferred  

---

## D / Idea §2 — QC department (comprehensive)

**Status:** Open beyond thin foundations  
**Priority:** High — Phase 1 after product scope  
**Plan:** `qc-department-plan.md`

### Features consolidating into QC
- Quality photo checks, incidents, downtime trends  
- Lot tracking (extend), substitutions manager + log  
- Weight / component / label / date checks  
- Import & recipe approval, future planning, dashboard  

### Locked constraints
- QC data survives daily reset + factory purge  
- Immutable audit trail; append-only; exportable  
- Daily reset archives yesterday; history view for past  
- Importers shared; QC approval gate (unverified badge)  

### Plan phases
1. QC role, run lots, weight checks, dashboard  
2. Component, label, date verification  
3. Import/recipe approval, future planning  
4. Trends, lot traceability reports, analytics  

### Plan tables (9)
`run_lots`, `weight_checks`, `component_checks`, `label_checks`, `date_checks`, `qc_checklists`, `qc_audit_log`, `qc_recipes`, `qc_future_plans`

### Research additions (industry)
- `product_holds` / hold-release disposition  
- Line clearance / allergen changeover records  
- Finished-lot identity + mock-recall support  
- HACCP **evidence** storage (not full plan authoring)  
- FSMA preventive-controls style checks as product decides  

### Immediate code dependency
- **B2 purge exclusion** before expanding QC tables  

---

## D / Idea §5 — Allergen tracking

**Status:** Foundation built  
**Priority:** High — food safety  
**Plan:** `allergen-tracking-plan.md`

### Exists
- Per-run allergen (none/egg/soy/custom)  
- Sequence warnings; custom from specs  

### Needed
- Ingredient → allergen mapping  
- Auto-computed run allergen footprint  
- QC pre-run checklist  
- Cleaning verification with system block  
- Label declarations  
- Cross-contact alerts  
- Daily allergen report  

---

# PHASE E — UX, multi-day, AI

## E / Idea §8 — Multi-day lookahead dashboard

**Status:** Planning  
**Priority:** Medium  
**Plan:** `multi-day-lookahead-plan.md`

### Needed
- Unified 7-day timeline (runs, prep, availability, conflicts)  
- Freezer capacity / mix overload / ingredient shortfall conflicts  
- Packaging availability (13 items)  
- Consolidated “what to prep today” checklist  
- Capacity planning  

### Exists today (separate)
- Production schedule, freezer pull plan, mix plan, reorder/use-first  

---

## E / Idea §9 — Production line map — BUILT
- 7-zone U-map in Run tab; toggle; typecheck clean  
- Continue polish under floor UX  

## E / Idea §10 — Line station expansion

**Status:** Ideas only  
**Priority:** Medium  

- Freeze tunnel fill + transit countdown  
- Press/oven station view  
- Production cooler tracking  
- Upstream/downstream behind alerts  
- Station-to-tab nav from line map  
- Line occupancy heatmap  
- Multi-line support (future facility)  

---

## E / Idea §12 — Battery & performance

**Status:** Implementation built; real-device evidence open  
**Research:** `battery-performance-research.md`  
**Priority:** Medium  

- Visibility-aware clock/timer consolidation — built  
- Floor Mode Wake Lock — built  
- Controlled real-device battery evidence — open  

---

## E / Idea §11 — AI improvements (value-audit governed)

**Status:** Portfolio governed — not open-ended expansion  
**Priority:** Medium  
**Authority:** `ai-feature-value-audit-2026-09-05.md`

### Keep
- Spec/workbook extraction + review + explicit Apply  
- Correction memory; sanitizers; cost controls; shared routing/retries  

### Keep but simplify
- Production recap, anomalies, schedule ordering — deterministic face; drop model narration as product  

### Consolidate
- Import matching / merge suggest / fill-missing → one “resolve unresolved setup” path  

### Disable / retire by default
- Voice → mutate state  
- Broad day Q&A; shift-optimize chat  
- Mix/recipe chat as primary UX  
- Forecast-from-history-only  
- Quality/label vision as **release authority**  

### Still valid (narrow)
- Deterministic import templates + AI fallback only  
- Routing/fallback for retained extraction  
- Observability: cost, failure, apply-vs-discard rates  

### Research additions (not overriding audit)
| Item | Status |
|------|--------|
| LOCAL_AI / Ollama plant path | Architecture + checklist + compose sketch; **code gated** on gold-set |
| Silent local URL routing | **Forbidden** (gated decision) |
| QLoRA / distillation | Preflight tooling; no promotion without Phase-0 |
| AI gateway skills | Design research only |
| Facility knowledge health | Bounded pool, audits, client-writable rules |
| In-app multi-agents | Propose only; never autonomous inventory/sync/purge |

---

# PHASE F — Reporting & analytics

## F / Idea §6 — Production reporting

**Status:** Partial  
**Priority:** Medium  
**Plan:** `production-reporting-plan.md`

### Exists
- Day/week summary; AI narration + fallback; operational report; completed-run history  

### Needed
- Automated end-of-day  
- PDF/CSV export  
- Multi-day trends  
- Per-run cost; waste cost  
- Comparison views  

---

## F / Idea §7 — Stoppage & downtime analytics

**Status:** Partial  
**Priority:** Medium  
**Plan:** `stoppage-analytics-plan.md`

### Exists
- Stoppage logging; trends by type/run/hour/reason; stall nudge  

### Needed
- Real-time alerts + live banner  
- Downtime cost  
- Free-text reason classification  
- Recurring-issue detection (3+)  
- Root-cause recommendations  
- Correlations (shift, hour, brand)  

---

# Full idea index (§1–17)

| § | Title | Priority | Status |
|---|--------|----------|--------|
| 1 | Mix plan & prep mix inventory | High | Partial |
| 2 | QC department | High | Open (thin foundations) |
| 3 | Overproduction & surplus | Medium | Partial |
| 4 | Inventory gap fixes | High | Partial |
| 5 | Allergen tracking | High | Foundation |
| 6 | Production reporting | Medium | Partial |
| 7 | Stoppage & downtime analytics | Medium | Partial |
| 8 | Multi-day lookahead | Medium | Planning |
| 9 | Production line map | — | **Built** |
| 10 | Line station expansion | Medium | Ideas |
| 11 | AI improvements (audit-governed) | Medium | Portfolio governed |
| 12 | Battery & performance | Medium | Built + evidence open |
| 13–14 | *(see full idea-backlog for any intermediate numbering in repo)* | | |
| 15 | Import system enhancements | High | Partial |
| 16 | Sync system improvements | High | Partial foundation |
| 17 | Residual observability & resilience | Medium | Design retained; bad branch rejected |

*If §13–14 exist with distinct titles in a longer local copy, treat repo `idea-backlog.md` as canonical for those numbers; this consolidation prioritizes content completeness over numbering gaps in truncated fetches.*

---

# Plan document index

| Document | Topic |
|----------|--------|
| `docs/idea-backlog.md` | Master idea catalog |
| `docs/sync-reliability-unified-plan-2026-09-19.md` | Sync order |
| `docs/sync-system-improvements-plan.md` | Sync residual |
| `docs/uptime-and-operational-backlog-decision-2026-10-02.md` | Readiness/ops |
| `docs/qc-department-plan.md` | QC |
| `docs/import-system-plan.md` / `importer-redesign-plan.md` | Imports |
| `docs/inventory-autodeduction-plan.md` | Inventory |
| `docs/overproduction-surplus-plan.md` | Surplus |
| `docs/allergen-tracking-plan.md` | Allergens |
| `docs/production-reporting-plan.md` | Reporting |
| `docs/stoppage-analytics-plan.md` | Downtime |
| `docs/multi-day-lookahead-plan.md` | Multi-day |
| `docs/ai-feature-value-audit-2026-09-05.md` | AI portfolio |
| `docs/battery-performance-research.md` | Battery |
| `docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md` | Local AI no-go |
| `docs/evidence/conditional-qlora-training-decision-2026-10-02.md` | QLoRA gate |
| `docs/superpowers/plans/*` | Historical slices (live-calc, mix surplus, …) |

**Research pack (session artifacts, not necessarily on branch):**  
consolidated handoff, QC industry/HACCP, embedded LAN AI, LOCAL_AI checklist, plant compose sketch, free/no-API agents, facility knowledge, AI gateway, distill/QLoRA notes.

---

# Immediate Replit work queue

```text
P0/P1
[ ] B2 Purge-all excludes quality_checks + test
[ ] B3 Owner SSE option A or B + follow-through
[ ] B4 Web-push root-cause note
[ ] A  Offline convergence / stale LWW tests (ongoing)

P1/P2 product tracks (parallel as capacity allows)
[ ] C  Inventory truth per inventory/mix/surplus plans
[ ] D15 Import atomic apply / preview / undo
[ ] D2  QC Phase 1 after written product scope (+ B2 first)
[ ] D5  Allergen mapping & gates

Gated / later
[ ] E3 Local AI only after gold-set revisits gated decision
[ ] E8 Multi-day lookahead
[ ] E10 Station expansion ideas
[ ] F6/F7 Reporting & downtime analytics
[ ] Measured sync optimizations (Patch/compression/selective)
```

---

# Explicit non-goals (near term)

- Full HACCP document control product  
- Ungated local model routing from URL alone  
- Autonomous agents applying production mutations  
- Hard-fail readiness on AI again  
- Reusing rejected observability branch patterns  
- Treating vision QC as release authority  

---

*Full consolidation 2026-10-03 — all major backlog plans/ideas + research. Prefer one backlog authority over scattered notes.*
