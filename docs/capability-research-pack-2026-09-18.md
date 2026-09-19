# Capability Research Pack — Production Run Calculator

**Date:** 2026-09-18
**Purpose:** Industry and domain research mapped to the **major capability areas represented in the app and its plans**, so prioritization is informed by how mature floor systems handle the same problems—not only by internal backlog order.

**Related docs:**
[improvement-research-2026-09-18.md](improvement-research-2026-09-18.md) · [further-research-2026-09-18.md](further-research-2026-09-18.md) · [sync-system-improvements-plan.md](sync-system-improvements-plan.md) · existing `docs/*-plan.md` files

**Scope fence:** This is a **shift execution** system for a single frozen-pizza facility (web-first; mobile parity paused). It is not PLC/SCADA or full ERP. This is a repository snapshot dated 2026-09-18; revalidate present-tense status against current code, release evidence, and open work before using it as a production-readiness statement.

---

## How to use this pack

| Column | Meaning |
|--------|---------|
| **App capability** | What the product does or plans |
| **Industry norm** | How food plants / MES / WMS typically treat it |
| **Strength today** | Where this codebase is already aligned |
| **Gap / research takeaway** | What to improve or deliberately not build |

Prior research on sync, payload, FSMA 204, and blank guards is **summarized**, not repeated in full.

---

## 1. Day planning & run setup

### What the app uses
- Multi-run day state; brand/flavor profiles; cases needed; line speed / cycle / crusts-per-cycle
- Dough, sauce, cheese, frontline, packaging recipe fields on `FormValues`
- Spec/profile import into runs
- Scheduled-day workflows and multi-day planning documents

### Industry norm
Food scheduling balances **demand, stock, shelf life, allergen changeovers, finite line capacity, and cleaning windows**—not just “fill the day with cases.” Frozen goods can support make-to-stock production; site-specific sequencing rules still require owner and food-safety confirmation.

Practical sequence often cited: demand → available stock/shelf life → capacity & changeovers → schedule validation.

### Strength today
- Strong **per-run calculator** model tuned to this line’s physics (tunnel, batches, skids)
- Profile + import path reduces re-keying
- Shared pure math in `lib/*`

### Gap / takeaway
- Scheduling is still **manual run list**, not constraint solver—appropriate for one line; don’t overbuild APS
- Explicit **changeover/cleaning blocks** in the day plan (duration + required after allergen) would match food scheduling practice
- Multi-day lookahead should prioritize **ingredient availability + allergen sequence**, not only case totals

---

## 2. Live production tracking (auto-track, floor mode)

### What the app uses
- Server-authoritative live calc / timers / line phases over SSE
- Auto-track claims (cases, sauce barrels, app batches)
- Stoppages, pause/resume, skid completion
- Floor Mode UI for glove-friendly control

### Industry norm
MES “execution” layer: electronic work instructions, real-time progress, downtime codes, actual vs plan. Tablets at station; actual counts preferred over assumed rates. Pause/resume and stop reasons feed OEE and continuous improvement.

### Strength today
- **Server-owned projection** is a major differentiator vs pure client calculators
- Shared `@workspace/live-calc` keeps offline fallback honest
- Floor Mode + phone layout tests exist; physical device trial still blocked

### Gap / takeaway
- Keep actuals (cases made, batches made) as first-class for inventory—not only planned `casesNeeded`
- Standardize **stop reason taxonomy** (mechanical, material, quality, changeover, other) for later analytics
- Wake/recovery and handoff are operational reliability, not polish

---

## 3. Line stations (dough, sauce, press/oven, frontline, freeze tunnel, packaging, warehouse)

### What the app uses
- Station-oriented tabs and department boundaries
- Line map UI (U-shaped flow)
- Station-specific progress (sauce barrels, app batches, packaging counts)
- Warehouse coverage from run lines

### Industry norm
Station tablets show **only what that role needs**: timers, next batch, lot to use, quality gate. Upstream/downstream status prevents starving the next station. Digital job travelers replace paper.

### Strength today
- Physical line is modeled (tunnel split, packaging, freezer pulls)
- Department contracts / Home ownership docs exist

### Gap / takeaway
- Formal **station data contracts** (offline-capable vs online-only)—see further research §4
- Freeze tunnel / press as first-class status (fill, transit) if operators currently guess
- Station-to-tab navigation from line map is high UX leverage

---

## 4. Inventory, warehouse, consumption

### What the app uses
- Inventory items/lots, intake, coverage math
- Consume-run / plan draw-down paths
- Freezer pull / surplus ledgers
- Mix surplus / prep mix plans
- Warehouse snapshot streaming

### Industry norm
Food warehouses prefer **FEFO** (first expired, first out) over pure FIFO when shelf life varies by lot. Lot capture at receiving; picks directed by expiry; short-dated alerts (e.g. 90/60/30 day thresholds). Production consumption should post **actual usage** against lots for genealogy.

### Strength today
- Dedicated inventory math package and warehouse coverage design
- Explicit gap analysis and autodeduction plans already in repo
- Server run-lines for coverage (post migration slices)

### Gap / takeaway
| Priority | Practice |
|----------|----------|
| High | Consumption scales to manager-entered `actualCases`; retain actual overproduction capture and remove planned-quantity fallback where actuals are available |
| High | Lot-level usage on runs (`run_lots`) for where-used |
| Medium | FEFO guidance in UI when multiple lots exist (even before full WMS) |
| Medium | Expiry alerts on warehouse coverage |
| Later | Full directed-pick WMS—out of shift-execution scope |

---

## 5. Mix plan & prep

### What the app uses
- Mix definitions and advisory prep plan
- “Already made” style inputs
- Mix-surplus lot recording and allocation endpoints are shipped; end-to-end prep deduction and downstream allocation still require verification

### Industry norm
Prep is real stock movement: components leave inventory when mix is made; finished mix is a semi-finished SKU with its own lot/shelf life. Allocation to downstream runs prevents double-counting.

### Strength today
- Mix domain package exists; surplus ledger plans are detailed

### Gap / takeaway
- Finish and verify the path that turns prep-mix-made into an **inventory transaction**, not an advisory note
- Link leftover mix to next matching run (allocation + reminder)
- Verify “Done” vs residual gaps in code before closing backlog §1

---

## 6. Packaging

### What the app uses
- Cartoned / labeled modes, carton size, labels per roll, circles, shippers, skid stacking, grip/slip sheets
- Packaging progress / auto-track pause handoff designs
- Warehouse needs roll-up by packaging config

### Industry norm
Packaging materials are planned SKUs (film, labels, cases, pallets). Label verification is a quality gate. Changeovers on packaging lines are scheduled constraints.

### Strength today
- Rich packaging field model on the run
- Packaging-specific auto-track design notes in superpowers specs

### Gap / takeaway
- Packaging-material deduction exists for modeled materials; validate master-data linkage and identify any unmodeled materials
- Label verification belongs with QC, not only packaging tab
- Carton size already in blank-template lockstep on main

---

## 7. Freezer, tunnel, surplus, pulls

### What the app uses
- Freeze tunnel timing (total + pre/post)
- Freezer pull groups / surplus ledger
- Cases in freezer style calculations

### Industry norm
Cold chain and WIP buffers are explicit: tunnel residence time is a process parameter; finished goods FEFO in freezer warehouse; pulls are documented movements.

### Strength today
- Tunnel physics in live-calc; freezer-pull domain packages

### Gap / takeaway
- Duplicate pull/run paths have guards and a dedicated surplus ledger; retain integration and audit evidence that all finalization paths avoid double-counting
- Surplus must be usable stock, not only a number on a report

---

## 8. Allergen control

### What the app uses
- Manually selected per-run allergen field, normalization, and advisory sequence warnings; ingredient-derived rollup and cleaning verification are not implemented
- Plan for ingredient→allergen map, cleaning verification, daily report

### Industry norm
Big-9 (US) master data on ingredients; rollup to product; schedule allergen runs last when possible; **documented cleaning verification** between incompatible profiles; label statements generated from recipe. Cross-contact is a controlled process, not a badge color only.

### Strength today
- Sequence warnings exist; dedicated plan is realistic and phased

### Gap / takeaway
- Allergen mapping and the cleaning-gate MVP are planned Phase 1–2 work, not current capabilities
- FSMA 204 applicability and KDE requirements need owner, customer, and qualified regulatory confirmation; do not infer them from product type alone
- See [further research §3.1–§3.4](further-research-2026-09-18.md#3-fsma--allergen--qc-gap-analysis-phase-d-scope-control)

---

## 9. QC, quality, incidents, downtime

### What the app uses
- QC-adjacent surfaces include photo quality history, incidents, downtime, and basic inventory lots; unified QC workflows are not implemented
- QC department plan: lots, weights, components, labels, dates, import approval
- AI-assisted issue diagnosis for reports/crashes

### Industry norm
In-process checks, hold/release, CAPA-lite for incidents, downtime coded for OEE. QC records are **immutable**, survive operational resets, exportable for audits. Lot and weight checks are standard on food lines.

### Strength today
- Scattered QC surfaces exist; comprehensive QC plan; audit-survival requirements written clearly
- Incident capture and review exist; generated AI diagnosis is disabled-first or a retirement candidate, not a trusted QC capability

### Gap / takeaway
- **Consolidate** into QC department with today-default / history secondary
- Current purge-all includes quality history; audited QC tables must be excluded before retention can be claimed
- QC Phase 1 is planned: capability/role configuration, `run_lots`, weight checks, dashboard, and retention safeguards
- Stoppage analytics plan already exists—wire taxonomy early

---

## 10. Spec & workbook import

### What the app uses
- Multiple importers (spec, premix, cheese, shipping, sauce, dough, schedule)
- AI-assisted matching + review; learned aliases; history/snapshots
- Corpus harness against source library
- Importer redesign: deterministic-first, AI fallback

### Industry norm
Master data enters via controlled import with validation, versioning, and approval. AI is useful for messy vendor spreadsheets; production systems prefer templates + deterministic parse for repeat files.

### Strength today
- Broad, review-oriented importer coverage for this facility: corpus harness, multiple importers, and review UX; production readiness remains evidence-dependent
- Planned redesign targets deterministic-first parsing; current free-form spec parsing remains AI-first while several specialized importers are deterministic

### Gap / takeaway
- Finish redesign phases (preview diff, rollback, templates)
- QC approval gate after QC department exists
- Keep AI as fallback, not authority

---

## 11. Master data (ingredients, brands, flavors, profiles, recipes)

### What the app uses
- Ingredient catalog with identity resolution work
- Brand/flavor profiles driving run defaults
- Recipe rows with ingredientId + display name cache
- Master-data health audit history

### Industry norm
Single ingredient master; recipes versioned; effective-dated changes; prevent silent rename breaks. Deduplication and stable IDs are foundational.

### Strength today
- Ingredient identity / catalog direction documented
- Health audit practice already run once

### Gap / takeaway
- Extend stable `ingredientId` coverage: identity tooling exists, but duplicate/name-based references remain and allergen attachment is future work
- Profile changes should not silently rewrite historical run meaning
- Periodic master-data health checks as ops ritual

---

## 12. Multi-device sync & offline

### What the app uses
- Full day-state PUT + SSE live push
- LWW + protectRunValues (blank guard, run union, reset escape)
- Offline push queue; daily-reset session fence
- Body limit 10mb after production 413s

### Industry norm
Offline-first floor apps: local write → queue → sync events or deltas; server authority; shift handoff drains queue; device health visible to supervisors.

### Strength today
- Unusually strong merge guards for a custom app
- Server live projection on same channel

### Gap / takeaway
| Item | Stance |
|------|--------|
| Delta sync (JSON Patch or equivalent) | Phase A1 — evaluate and select an implementation; retain full-state fallback |
| Device sync health | Phase A2 |
| Conflict visibility toast | Phase A3 |
| Event-sourcing entire day-state | Defer |
| Details | further-research + sync plan |

---

## 13. Auth, roles, daily reset, security

### What the app uses
- Staff signup code; manager bootstrap
- Capability matrix / roles
- Daily reset of day-state; session boundary at facility local midnight
- Threat model doc; purge-all semantics

### Industry norm
Shared tablets use role badges or short PIN; sessions expire on shift boundaries; audit identity on quality actions; factory reset is rare and controlled.

### Strength today
- Capability model + daily fence match shared-tablet reality
- Threat-model documentation exists; confirm its review date before relying on it as current

### Gap / takeaway
- Phase D needs QC capability/role configuration and route/UI gates; roles are data-driven rather than a hardcoded built-in QC role
- Current purge-all deletes quality history; exclude audited QC tables before claiming preservation
- Re-read threat model when adding device health endpoints

---

## 14. AI features

### What the app uses
- Spec/workbook extraction and review
- Incident capture; historical AI-generated diagnosis is disabled-first or a retirement candidate
- Historical experiments: recap, anomalies, voice, chat (portfolio audited)

### Industry norm
Highest ROI: document ingestion and exception explanation. Lowest trust: unattended decisions on quality release or inventory writes via voice/chat.

### Strength today
- Written **value audit** (2026-09-05) is the right governance artifact
- Corpus-backed import path

### Gap / takeaway
- Execute audit: keep extraction; simplify deterministic “AI-colored” features; disable high-risk entry points
- Bounded cost and safe observability for retained routes; never log imported or operational payload content
- Do not expand vision as release authority

---

## 15. Reporting, history, analytics

### What the app uses
- Run history; day summary packages
- Production reporting plan
- Stoppage analytics plan
- Manager action queue

### Industry norm
End-of-shift report: planned vs actual cases, downtime by reason, waste, checks completed. Trends over weeks beat single-day vanity metrics.

### Strength today
- Plans exist; day-summary library; history retention rules in protect merge

### Gap / takeaway
- Phase F after inventory truth + stable sync
- One-click EOD PDF/CSV is enough MVP
- Downtime cost needs coded stop reasons first

---

## 16. Floor UX, PWA, devices

### What the app uses
- Responsive web; Floor Mode; burn-in considerations
- Screen-off wake test protocol
- Real-device floor-controls doc (hardware trial blocked)
- Web-only focus; mobile paused

### Industry norm
Rugged or commercial tablets; large targets; offline; barcode where lots matter; gloves and cold rooms assumed.

### Strength today
- Explicit device protocols and phone e2e suite
- Wake/recovery diagnostics in the current merged implementation

### Gap / takeaway
- Complete physical Android trial when endpoint available
- Station-sized UI > denser admin on floor tablets
- Barcode lot entry when QC lots ship

---

## 17. Platform, deploy, quality systems

### What the app uses
- pnpm monorepo; OpenAPI codegen; Drizzle
- Docker/Render deployment configuration and schema-safe rollback rehearsal; configuration alone does not prove a healthy live deployment
- CI/release workflows include typecheck and broad test gates, with corpus checks in script suites; evidence is split across lanes
- Institutional memory in `.agents/memory`

### Industry norm
Forward-only schema; immutable releases; separate migrate vs runtime images—already matches good ops practice.

### Strength today
- Strong engineering hygiene for a facility-specific product
- Memory system reduces bus-factor risk

### Gap / takeaway
- Keep rollback discipline; don’t down-migrate
- Payload metrics as operational telemetry (Phase A)

---

## Cross-cutting priority matrix

| Capability area | Research priority to invest next | Why |
|-----------------|----------------------------------|-----|
| Sync delta + health | **P0** | Production payload risk; multi-tablet trust |
| Inventory actuals + lots | **P0** | Downstream planning and genealogy remain less reliable without complete actuals and lot usage |
| Allergen map + cleaning gate | **P1** | Food safety evidence |
| QC Phase 1 dashboard | **P1** | Consolidates existing scattered features |
| Station contracts + handoff | **P1** | Floor adoption |
| Import deterministic redesign | **P1** | Master data quality |
| Packaging material consumption | **P2** | Completes inventory story |
| Stoppage taxonomy + analytics | **P2** | Needs coded reasons |
| AI portfolio cleanup | **P2** | Cost/risk control |
| Multi-day constraint scheduling | **P3** | Manual schedule OK for one line |
| Full FEFO WMS / barcode hardware | **P3** | Beyond shift-execution MVP |
| FSMA 204 KDE export | **P3 pending applicability review** | Owner, customer, and qualified regulatory confirmation required |

---

## What “as much research as possible” still cannot replace

Open facility facts that require owner verification and should be recorded in a dated operational or compliance note—not inferred from technical memory:

1. Typical runs/day and peak day-state size
2. Tablet count and station placement
3. Customer audit / GFSI / retailer checklist items actually demanded
4. Whether any product line handles FTL foods (fresh, seafood, soft cheese, etc.)
5. Preferred stop-reason list from supervisors
6. Current paper processes still outside the app (to prioritize replacement)

---

## Document map (research set)

| Doc | Contents |
|-----|----------|
| This file | All capability areas × industry norms |
| [improvement-research-2026-09-18.md](improvement-research-2026-09-18.md) | Build phases A–F |
| [further-research-2026-09-18.md](further-research-2026-09-18.md) | Sync architecture, payload measurement, Phase D scope, station handoff, and product boundaries |
| [sync-system-improvements-plan.md](sync-system-improvements-plan.md) | Delta sync implementation plan |
| Existing `docs/*-plan.md` | Detailed build specs per domain |

---

## Maintenance

- Add a row under a section when a major capability ships or a production incident changes the gap assessment.
- Do not duplicate full plans here—link out.
- No owner-verified Facility inputs section exists in this snapshot. Append one only after collecting and dating the six answers above; technical files in `.agents/memory/` do not constitute those answers.
