# Consolidated Master Backlog — Production Run Calculator

**Date:** 2026-10-03  
**Primary branch:** `Replit` (runtime) · **Experimental:** `main`  
**Sources merged:** `docs/idea-backlog.md`, domain plans, sync/uptime decisions, QC/HACCP research, LAN/offline AI research, Replit handoff (readiness/SSE/purge), gated local-AI decision (2026-10-02)

This file is a **single catalog** of plans, ideas, and open work. It does not replace detailed plan docs; it points to them and sets **order**.

---

## Authority / how to use this file

| Topic | Authority doc |
|-------|----------------|
| Sync & ops sequencing | `docs/sync-reliability-unified-plan-2026-09-19.md` |
| Inventory / import / QC domain deps | `research/additional-domain-research-synthesis-2026-09-19.md` (if present) + domain plans |
| Uptime / readiness | `docs/uptime-and-operational-backlog-decision-2026-10-02.md` |
| Local AI routing | `docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md` (**no-go until gold set**) |
| QC department | `docs/qc-department-plan.md` + industry research |
| Idea catalog (repo) | `docs/idea-backlog.md` |

**Capability statuses** describe **repo capability**, not necessarily production acceptance.

---

## Recommended phase order (unified)

| Phase | Focus | Priority | Status snapshot |
|-------|--------|----------|-----------------|
| **A** | Sync reliability: offline convergence, reset/auto-track, fencing | Highest | Partial — fencing/SSE/protect built; convergence & evidence open |
| **B** | Operational integrity: readiness, purge safety, SSE topology, worker noise | Highest | Soft readiness **live**; purge QC / SSE decision **open** |
| **C** | Inventory truth: actual cases, mix/surplus, packaging, waste | High | Partial |
| **D** | Import safety + durable QC + allergens | High | Import partial; QC open beyond thin foundations |
| **E** | Station UX, multi-day prep, AI portfolio (cloud + gated local) | Medium | Line map built; local AI **gated no-go** |
| **F** | Reporting, downtime analytics, measured sync optimizations | Medium | Partial |

Phases A–B are the reliability program. Inventory/import/QC are adjacent product tracks, not blockers for complete-write fencing.

---

## P0 / P1 — Do next on `Replit` (runtime integrity)

### B1. Purge-all excludes QC / quality history
- **Problem:** `qualityChecksTable` still in purge-all on tip (`sync.ts`).
- **Do:** Remove from purge lists; comment; test insert → purge → row remains.
- **Extend policy:** future `run_lots`, `weight_checks`, `qc_audit_log`, holds, mix_surplus never on purge-all.
- **Refs:** idea-backlog §2; qc-department-plan; handoff 2026-10-03.

### B2. SSE / Autoscale topology decision
- **Fact:** SSE = process-local `Set` in `sync.ts`.
- **Owner chooses:**
  - **A)** Single always-on API process (document), or  
  - **B)** Shared fanout + multi-process tests  
- **Refs:** sync research; uptime backlog; handoff.

### B3. Web-push / background workers
- Soft readiness treats sustained failures as **warning only** (correct).
- Production recently **ok**; still document root cause vs transient so it doesn’t regress silently.
- **Refs:** uptime decision; production probes.

### A1. Sync residual reliability
- Repeated-offline convergence  
- Operator visibility of sync health  
- Deployment evidence for published identity/readiness  
- Stale reconnect / LWW when client clocks lie (revision/epoch policy + tests)  
- **Refs:** `sync-reliability-unified-plan`; sync-system-improvements-plan; idea-backlog capability table.

### B4. AI dependency policy (operational)
- Soft readiness: AI optional — **keep**  
- Cloud: Gemini via `lib/integrations-openai-ai-server`  
- Local routing: **blocked** until gold-set comparison (see E2)  
- **Refs:** gated-local-ai-adapter-decision-2026-10-02.

---

## Phase C — Inventory truth

| ID | Item | Status | Plan |
|----|------|--------|------|
| C1 | Mix-made physical deduction + mix surplus ledger / allocation | Partial | idea-backlog §1; mix surplus plan |
| C2 | Overproduction detection + disposition + inventory adjustment | Partial | overproduction-surplus-plan |
| C3 | Actual cases vs planned for consumption | Partial / planned | inventory-autodeduction-plan |
| C4 | Freezer pull double-count fix | Planned | inventory plans |
| C5 | Full packaging (13 items) + lot tie-in to QC | Planned | inventory-autodeduction-plan |
| C6 | Waste / spoilage / returns | Open (lower) | inventory gap analysis |
| C7 | Server-authoritative, idempotent intent per physical event | Rule | domain synthesis |

**Rule:** no parallel client stock-write path.

---

## Phase D — Import, QC, allergens

### D1. Import system
- **Status:** Partial — seven flows, review, aliases, history exist  
- **Open:** atomic apply, guarded undo, deterministic-first parsing, provenance  
- **Plans:** `import-system-plan.md`, `importer-redesign-plan.md`  
- **AI:** propose only; human Apply; deterministic-first then model  

### D2. QC department
- **Status:** Open beyond thin foundations (`qualityChecks`, incidents, downtime inputs)  
- **Plan:** `qc-department-plan.md`  
- **Phase 1 (product-gated):** role, `run_lots`, `weight_checks`, dashboard; purge survival  
- **Phase 2+:** component/label/date checks, import/recipe approval, analytics  
- **Industry add-ons (research):** hold/release, line clearance/allergen changeover, finished-lot identity, mock-recall path, HACCP *evidence* storage (not full doc control)  
- **Tables (plan):** run_lots, weight_checks, component_checks, label_checks, date_checks, qc_checklists, qc_audit_log, qc_recipes, qc_future_plans (+ research: product_holds, line_clearances)  

### D3. Allergens
- **Status:** Foundation (run label, sequence warnings)  
- **Open:** ingredient mapping, auto footprint, QC checklist, cleaning gate, declarations, reports  
- **Plan:** `allergen-tracking-plan.md`  

---

## Phase E — UX, multi-day, AI portfolio

### E1. Floor / station UX
- Line map dashboard: **built**  
- Station expansion ideas: freeze tunnel, press/oven, cooler, upstream/downstream alerts  
- Battery/performance: partial; real-device evidence open  
- **Refs:** idea-backlog §9–10; battery-performance-research  

### E2. Multi-day lookahead
- Unified 7-day timeline, conflicts, prep checklist  
- **Plan:** `multi-day-lookahead-plan.md`  

### E3. AI portfolio (cloud + future local)
| Track | Decision |
|-------|----------|
| Gemini / current adapter | Production path; stream metrics hardened |
| Local URL alone | Must **not** mark AI configured or route traffic |
| LOCAL_AI / plant Ollama | Architecture + checklist + compose sketch **researched**; **code gated** on gold-set vs Gemini |
| QLoRA / distillation | Tooling/preflight on branch; **no promotion** without Phase-0 quality bars |
| In-app agents | Propose + Apply only; no autonomous purge/sync/inventory |
| Facility knowledge / corrections | Bounded memory; health audits; CLIENT_WRITABLE rules |

**Plans/research (external to repo tip):**  
- `embedded-lan-offline-ai-architecture-2026-10-03.md`  
- `local-ai-adapter-checklist-2026-10-03.md`  
- `plant-docker-compose-ollama-sketch-2026-10-03.md`  
- `no-api-local-ai-agents-research-2026-10-03.md`  
- Prior: facility knowledge, AI gateway, import+builtin AI  

---

## Phase F — Reporting & analytics

| ID | Item | Plan |
|----|------|------|
| F1 | Automated EOD, PDF/CSV, trends, cost, comparisons | production-reporting-plan |
| F2 | Live downtime alerts, classification, cost, recurrence | stoppage-analytics-plan |
| F3 | Conditional sync opts (JSON Patch, compression, selective sync) | Only after measurements |

---

## Cross-cutting constraints (locked)

1. **Human Apply** for AI and risky mutations; value protection / claims stay authoritative.  
2. **Soft readiness** — AI and background workers never hard-block core `/readyz`.  
3. **Purge policy** — daily reset ≠ destroy QC/compliance/surplus audit trails.  
4. **Server-authoritative inventory** — one idempotent event per physical action.  
5. **Local AI** — no silent routing from URL presence; gold-set gate first.  
6. **Primary branch `Replit`** for production; `main` experimental/docs.  

---

## Index of plan documents (repo)

| Doc | Topic |
|-----|--------|
| `docs/idea-backlog.md` | Master idea catalog |
| `docs/sync-reliability-unified-plan-2026-09-19.md` | Sync sequencing |
| `docs/sync-system-improvements-plan.md` | Sync improvements |
| `docs/uptime-and-operational-backlog-decision-2026-10-02.md` | Readiness / ops |
| `docs/qc-department-plan.md` | QC department |
| `docs/import-system-plan.md` / `importer-redesign-plan.md` | Imports |
| `docs/inventory-autodeduction-plan.md` | Inventory gaps |
| `docs/overproduction-surplus-plan.md` | Surplus |
| `docs/allergen-tracking-plan.md` | Allergens |
| `docs/production-reporting-plan.md` | Reporting |
| `docs/stoppage-analytics-plan.md` | Downtime |
| `docs/multi-day-lookahead-plan.md` | Multi-day |
| `docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md` | Local AI no-go |
| `docs/evidence/conditional-qlora-training-decision-2026-10-02.md` | QLoRA gate |
| Superpowers plans under `docs/superpowers/plans/` | Slice histories (live-calc, mix surplus, etc.) |

---

## Immediate Replit work queue (copyable)

```text
[ ] B1 Purge-all excludes quality_checks (+ test)
[ ] B2 Owner SSE A vs B → implement or document
[ ] B3 Web-push root-cause note (or accept transient)
[ ] A1 Offline convergence / stale LWW tests (ongoing reliability)
[ ] C — continue inventory truth per inventory plans (no client stock writes)
[ ] D2 QC Phase 1 only after product scope written
[ ] D1 Import atomic apply / deterministic-first (per import plans)
[ ] E3 Local AI only after gold-set decision revisit
[ ] E1/E2 UX and multi-day as capacity allows
[ ] F reporting/analytics after A–D critical path
```

---

## Out of scope for near-term Replit (explicit)

- Full HACCP document authoring system  
- Un-gated local model routing  
- Autonomous agents writing production data  
- Changing soft readiness back to hard-fail on AI  
- Merging experimental `main`-only research as production without Replit review  

---

*Consolidated 2026-10-03 from repo plans + cross-branch research. Prefer updating this file when priorities change rather than scattering new “source of truth” notes.*
