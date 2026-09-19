# Idea Backlog

Master list of improvement ideas for the Production Run Calculator. Each idea includes what it is, why it matters, and key code references.

**Current ordering authority (2026-09-19):** use the [Sync Reliability Unified Plan](sync-reliability-unified-plan-2026-09-19.md) for sync and operations sequencing and the [Additional Domain Research Synthesis](../research/additional-domain-research-synthesis-2026-09-19.md) for inventory, import, QC, and cross-domain dependencies. The earlier [improvement research](improvement-research-2026-09-18.md) remains useful historical context. Keep this file as the catalog of built foundations, remaining work, and product ideas.

### Recommended build order (summary)

| Phase | Focus | Priority |
|-------|--------|----------|
| **A** | Reliability correctness: complete-write causal fencing, AI provider-key readiness correction, reset/auto-track regression coverage | Highest |
| **B** | Operational evidence: sync/pool measurements, published SSE verification, database capacity budget, AI dependency policy | High |
| **C** | Inventory truth: actual cases, overproduction, prep-mix events, freezer movement, packaging completeness | High |
| **D** | Import safety, durable QC ownership, allergen controls | High |
| **E** | Station-first UX, unified multi-day preparation, AI portfolio decisions | Medium |
| **F** | Reporting, downtime analytics, and evidence-triggered sync optimizations | Medium |

Phases A and B are the reliability program. Inventory, import, QC, and allergen work are adjacent product tracks, not prerequisites for complete-write fencing. JSON Patch, compression, selective sync, and timestamp policy remain conditional on measurements.

---

## 1. Mix Plan & Prep Mix Inventory

**Status**: Partially built — planning math and already-made offsets exist; physical mix-production deduction and surplus ownership remain
**Priority**: High — same root issue as overproduction inventory gap
**Research note (2026-09-18):** Status line previously said Done while summary still described advisory-only mix plan. Treat as **partial**: confirm what shipped (surplus ledger / daily deduction) against code before closing residual work.

### Summary
Mix plan must move stock when prep mixes are made, track leftovers, and allocate into later runs. Residual work if any of the following still apply:
1. Ingredient deduction when prep mix is made
2. Leftover tracking (like freezer surplus but for mixes)
3. Auto-allocation to next matching run + reminder of freezer stock

### The Problem (historical / residual)
- `lib/mixes/src/index.ts` long said "Advisory only — this never moves stock"
- When prep mixes are made, ingredients get used but inventory may not reflect it
- "Already Made" input may lack full inventory connection
- Leftover/excess mix in the freezer and next-run reminders may still be incomplete

### Proposed Solution

**A. Deduction on Mix-Made**
- "Already Made" is an offset to fresh mix need, not a deduction trigger
- A separate, idempotent "mix made" event must deduct component ingredients when physical production occurs
- Same mechanism as `consume-run`: look up mix components → compute lbs needed → call `planDrawDown`
- Audit-logged: "Prep mix made: {mix name} → deducted {qty} {ingredient} from inventory"

**B. Mix Surplus / Leftover Tracking**
- Like `FreezerSurplusLot` but for prep mixes
- Track: mix name, brand/flavor, amount made, amount used, amount remaining, production date
- Stored in freezer — shows up as a reminder: "You have 15 lbs of Bobo's Veggie Mix in the freezer"
- When next matching run comes up → auto-suggest using leftover mix before making new
- "Use leftover" reduces the "amount to make" for the next run

**C. Auto-Allocation to Next Run**
- Similar to freezer surplus "Use on Next Run"
- If leftover mix exists for brand/flavor → automatically reduce the plan amount
- Reminder/notification: "Freezer has {qty} lbs of {mix} — reduce production by {qty}?"
- Manager confirms or overrides

**D. Mix Surplus DB Table**
- `mix_surplus` table: mix_id, brand, flavor, amount_made, amount_used, amount_remaining, production_date, location (freezer), created_at
- `mix_surplus_allocations` table: surplus_id, run_id, amount_allocated, allocated_at
- Excluded from purge-all (like QC tables — audit trail)

### Build Order
1. Add mix-made action that deducts from inventory
2. Create `mix_surplus` table + API
3. Leftover tracking UI (shows available mix stock)
4. Auto-allocation to next matching run
5. Freezer reminder/notification

### Code References
- `lib/mixes/src/index.ts` — mix model and plan math (pure, advisory)
- `artifacts/run-calculator/src/components/MixesTabContent.tsx` — mix plan UI
- `artifacts/run-calculator/src/components/MixAlreadyMadeInput.tsx` — already-made input
- `artifacts/run-calculator/src/components/MixesManager.tsx` — mix recipe editor
- `lib/db/src/schema/` — add mix_surplus tables
- `artifacts/api-server/src/routes/inventoryLogic.ts` — draw-down engine (reuse)

---

## 2. QC Department (Comprehensive)

**Status**: Planning
**Full plan**: [docs/qc-department-plan.md](qc-department-plan.md)
**Priority**: High — Phase 1 first

### Summary
Full QC department with own section in the app, like managers have. Consolidates scattered QC features (quality photo checks, incidents, downtime) into one place. Adds lot tracking, weight checks, component checks, label/date verification, import approval queue, recipe approval, future planning, and a unified QC dashboard.

### Features Moving In
- Quality photo checks (existing Quality tab)
- Incidents log (existing Incidents tab)
- Downtime trends (existing Downtime tab)
- Lot tracking (existing inventory lot field — extend to full per-run logging)
- **Substitutions Manager** (currently in Inventory tab — temporary ingredient subs, manager/QC only)
- **Substitution Log** (currently in Inventory tab — read-only history of today's sub actions)
- All new QC features (weight checks, component checks, label/date verification, import approval, recipe approval)

### Key Constraints (locked in)
- QC data survives daily reset + factory purge (excluded from purge-all)
- Full immutable audit trail (who/what/when/where/why/evidence)
- Daily reset = archive yesterday, show only today (history view for past days)
- All existing QC tabs consolidate into single QC tab
- Importers stay shared — QC approval gate (unverified badge until approved)
- Append-only audit records, never deleted, exportable as CSV/PDF

### Build Order
- **Phase 1**: QC role, lot tracking per run, weight checks, QC dashboard
- **Phase 2**: Component checks, label verification, date verification
- **Phase 3**: Import approval queue, recipe approval, future planning
- **Phase 4**: Weight trend graphs, lot traceability reports, QC analytics

### Code References
- `artifacts/run-calculator/src/departments/QcDepartment.tsx` — QC department boundary
- `artifacts/run-calculator/src/components/QualityHistoryTab.tsx` — photo quality checks (move to QC)
- `artifacts/run-calculator/src/components/InventoryTab.tsx` — lot tracking (basic, extend)
- `artifacts/run-calculator/src/components/StaffRolesCard.tsx` — needs "qc" role
- `lib/db/src/schema/inventory.ts` — inventory schema (has lot field)
- `artifacts/api-server/src/routes/sync.ts:1198` — purge-all handler (exclude QC tables)
- `artifacts/run-calculator/src/pages/home.tsx` — tab rendering, import dialogs

### New Database Tables (9)
`run_lots`, `weight_checks`, `component_checks`, `label_checks`, `date_checks`, `qc_checklists`, `qc_audit_log`, `qc_recipes`, `qc_future_plans`

### New API Routes (19)
CRUD for each check type, dashboard/aggregation, audit/compliance, import approval, recipe approval, future plans

---

## 3. Overproduction & Surplus Management

**Status**: Planning
**Full plan**: [docs/overproduction-surplus-plan.md](overproduction-surplus-plan.md)
**Priority**: Medium

### Summary
Surplus system currently only handles freezer overproduction AFTER a run ends. Expand to real-time detection during runs, ingredient-level overages, disposition decisions (store/donate/ship/discard/use-next), surplus history, trend analysis, and configurable thresholds.

### What Exists Already
- Freezer surplus confirm (post-run excess → freezer lot)
- Freezer surplus pull (allocate lots to upcoming runs)
- Use First (expiry prioritization)
- Reorder (stock alerts)

### What's Missing
- Real-time overproduction detection
- Ingredient-level overages (dough, sauce, cheese)
- **Inventory auto-adjustment on overproduction** (critical: consumption is currently based on planned `casesNeeded`, not actual `casesCompleted` — overproduced ingredients are unaccounted for)
- Disposition flow (store-in-freezer | use-on-next-run only)
- Surplus dashboard + history
- Trend analysis + recurring-overproduction alerts

### New Database Tables
- `overproduction_events` — immutable log of all overproduction incidents + dispositions

### Code References
- `lib/freezer-pull/src/surplus.ts` — surplus math
- `artifacts/run-calculator/src/components/FreezerSurplusPanel.tsx` — surplus UI
- `lib/db/src/schema/freezerSurplus.ts` — freezer surplus DB
- `lib/live-calc/src/index.ts` — calc engine (add detection)


## 4. Inventory System Gap Fixes

**Status**: Partially built — foundational stock and run-finalization consumption exist; actuals, surplus, prep-mix, freezer movement, and packaging remain
**Full plan**: [docs/inventory-autodeduction-plan.md](inventory-autodeduction-plan.md)
**Analysis**: [docs/inventory-gap-analysis.md](inventory-gap-analysis.md)
**Priority**: High — foundational for all other systems

**Current dependency rule:** inventory changes must use one server-authoritative, idempotent transaction or intent per physical event. They must not add a parallel client stock-write path. See the [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md).

### Summary
Inventory consumption is a single-point event (run-end) rather than continuous. 8 gaps identified. Comprehensive plan covers all critical + medium + non-ingredient packaging gaps.

### What's Planned (Full 13-Item Packaging List)
| Area | What | Status |
|------|------|--------|
| **A** | Overproduction inventory deduction | Planned (overproduction plan) |
| **B** | Mix/prep mix inventory deduction | Planned (mix plan) |
| **C** | Freezer pull → inventory deduction (fix double-counting) | Planned |
| **D** | Use actual cases instead of planned | Planned |
| **E** | **Full packaging inventory (13 items)** | Planned |

**Complete packaging list** (most lot-tracked by QC):

| Item | Currently Tracked |
|------|-------------------|
| Circles | ✓ cartoned only |
| Shippers | ✓ cartoned only |
| Cartons | ✓ cartoned only |
| Slip sheets | ✗ |
| Grip sheets | ✗ |
| Top labels | ✗ |
| Bottom labels | ✗ |
| Shipper labels | ✗ |
| Pallets | ✗ |
| Tape | ✗ |
| Glue | ✗ |
| Glue sticks | ✗ |
| Ink | ✗ |

**Consumption by mode**:
- `cartoned`: circles, shippers, cartons, grip/slip, pallets, tape/glue/ink
- `labeled`: circles, shippers, top/bottom labels, shipper labels, grip/slip, pallets, tape/glue/ink
- `n-a`: grip/slip, pallets only

**QC lot tracking tie-in**: Packaging deductions carry lot numbers from QC lot entries → full traceability (QC entry → inventory deduction → run consumption → audit trail)

### Still Open (lower priority)
- Waste/spoilage logging
- Stoppages mid-run waste
- Ingredient returns at run-end

### Build Order
1. Actual cases + overproduction deduction + mix deduction (Phase 1)
2. Freezer pull double-counting fix (Phase 2)
3. Full packaging gaps — all 13 items (Phase 3)
4. Waste & returns (Phase 4)

---

## 5. Allergen Tracking

**Status**: Foundation built; safety improvements planned
**Full plan**: [docs/allergen-tracking-plan.md](allergen-tracking-plan.md)
**Priority**: High — food safety

### Summary
Basic allergen field exists per run. Need ingredient-level allergen mapping, QC allergen verification, cleaning verification, label declarations, and daily allergen reports.

### What Exists
- Allergen per run (none/egg/soy/custom)
- Sequence warnings (allergen → non-allergen cleaning)
- Custom allergen support from spec sheets

### What's Needed
- Ingredient → allergen mapping
- Auto-computed run allergen footprint from recipe
- QC pre-run allergen checklist
- Cleaning verification with system block
- Allergen declaration for labels
- Cross-contact risk alerts
- Daily allergen report

---

## 6. Production Reporting

**Status**: Planning
**Full plan**: [docs/production-reporting-plan.md](production-reporting-plan.md)
**Priority**: Medium

### Summary
Day/week summary exists with AI narration. Need automated end-of-day reports, PDF/CSV export, multi-day trends, cost tracking, waste cost, and comparison views.

### What Exists
- Day/week summary aggregation
- AI summary narration + fallback
- Server-authoritative operational report
- Completed-run history DB

### What's Needed
- Automated end-of-day report
- PDF/CSV export
- Multi-day trends
- Per-run cost tracking
- Waste cost calculator
- Comparison views

---

## 7. Stoppage & Downtime Analytics

**Status**: Planning
**Full plan**: [docs/stoppage-analytics-plan.md](stoppage-analytics-plan.md)
**Priority**: Medium

### Summary
Downtime trends exist. Need real-time alerts, downtime cost, reason classification, recurring-issue detection, root-cause recommendations, and correlations.

### What Exists
- Stoppage logging per run
- Downtime trends (by type/run/hour/reason)
- Stall detection nudge

### What's Needed
- Real-time downtime alerts (threshold + live banner)
- Downtime cost tracking
- Free-text reason auto-classification
- Recurring-issue detection (same reason 3+ times)
- Root-cause recommendations
- Correlations (shift, hour, brand)

---

## 8. Multi-Day Lookahead Dashboard

**Status**: Planning
**Full plan**: [docs/multi-day-lookahead-plan.md](multi-day-lookahead-plan.md)
**Priority**: Medium

### Summary
Warehouse, mixes, freezer, and inventory are separate tabs with no unified upcoming-day view. Need a 7-day timeline combining runs, prep needs, availability, conflicts.

### What Exists
- Production schedule (upcoming days)
- Freezer pull plan (days-early)
- Mix plan (make-day)
- Reorder alerts + use-first

### What's Needed
- Unified 7-day timeline view
- Conflict detection (freezer capacity, mix overload, ingredient shortfall)
- Ingredient availability for upcoming runs
- Packaging availability (13 items)
- Consolidated "what to prep today" checklist
- Capacity planning

---

## 9. Production Line Map Dashboard

**Status**: Built and merged

### Summary
Visual 7-zone production line map in the Run tab showing all physical zones in U-shaped flow layout matching the facility photo. Color-coded status badges, real-time metrics, click-to-navigate to tabs.

### Zones
Dough (stone) → Sauce (red) → Press/Oven (gray) → Frontline (amber) → Freeze Tunnel (sky) → Packaging (emerald) → Warehouse (stone)

### What's Done
- `LineMapDashboard.tsx` component created and integrated into Run tab
- Toggle button (MapPin icon) in run tab header
- All 7 TS errors fixed
- Typecheck passes

### Current State
- Integrated into the current Run/Live station surfaces
- Continue station-to-tab navigation and operational polish under the Floor UX phase

### Code References
- `artifacts/run-calculator/src/components/LineMapDashboard.tsx` — new component
- `artifacts/run-calculator/src/pages/home.tsx:18994` — showLineMap state + toggle
- `lib/live-calc/src/linePhases.ts` — line phase model

---

## 10. Line Station Expansion

**Status**: Ideas only
**Priority**: Medium

### Summary
Add dedicated tracking for physical stations currently missing from the app.

### Ideas
- **Freeze tunnel visualization** — fill level visual, transit countdown
- **Press/Oven monitoring** — dedicated station view with timing
- **Production cooler tracking** — not tracked at all today
- **Upstream/downstream alerts** — warn when a station is falling behind
- **Station-to-tab quick nav** from line map
- **Line occupancy heatmap** — which stations are active over time
- **Multi-line support** — if facility adds a second line

### Code References
- `lib/live-calc/src/linePhases.ts` — 3-phase line model
- `lib/live-calc/src/index.ts` — `Calc` type with `preTunnelMin`, `freezerTime`
- `artifacts/run-calculator/src/frontlineRows.ts` — frontline need derivation

---

## 11. AI Improvements

**Status**: Portfolio governed by value audit (not open-ended expansion)
**Priority**: Medium — cleanup and narrow retention over new broad surfaces
**Authoritative doc:** [ai-feature-value-audit-2026-09-05.md](ai-feature-value-audit-2026-09-05.md)
**Research note (2026-09-18):** Earlier “expand AI” ideas (QC vision as authority, voice mutation, open NL day Q&A) conflict with the audit. Default stance: **keep extraction**, simplify deterministic features that were presented as AI, disable/retire high-risk or low-unique-value entry points.

### Portfolio direction (from audit)

| Direction | Examples |
|-----------|----------|
| **Keep** | Spec/workbook extraction with review + explicit apply; correction memory; sanitizers; cost controls; shared routing/retries |
| **Keep but simplify** | Production recap, anomalies, schedule ordering — keep deterministic results; drop model narration as the product face |
| **Consolidate** | Import matching / merge suggest / fill-missing → one bounded “resolve unresolved setup” path |
| **Disable / retire** | Voice command classification that mutates state; broad day Q&A; shift-optimize chat; mix/recipe chat as primary UX; forecast-from-history-only; quality/label vision treated as release authority |

### Ideas still valid (narrow)

- Stronger deterministic import templates + AI **fallback only** (aligns with importer redesign)
- AI model routing / fallback providers for **retained** extraction workloads (rate-limit resilience)
- Observability: cost, failure rate, apply-vs-discard rates for extraction

### Ideas to avoid by default

- Expanding voice → immediate writes without stronger confirmation
- New open-ended assistants that recombine already-visible live-run facts
- Presenting deterministic math as dependent on a model

### Code References
- `artifacts/api-server/src/routes/ai*.ts` — AI route handlers
- `lib/ai-memory/` — shared AI memory system
- `lib/integrations-openai-ai-server/` — AI server integration
- `artifacts/run-calculator/src/components/ai/` — AI UI components
- `docs/ai-feature-value-audit-2026-09-05.md` — decision standard

---

## 12. Battery & Performance

**Status**: Ideas only
**Priority**: Medium

### Summary
Reduce battery drain and improve performance, especially on mobile devices.

### Ideas
- **Reduce network polling frequency** — adaptive polling based on run state
- **Lazy load tab content** — only load active tab data
- **Service worker caching** — offline support for viewed data
- **WebSocket instead of SSE** — more efficient bidirectional sync
- **Background sync** — batch updates instead of real-time push for non-critical data
- **Compression** — gzip/brotli for API responses
- **Virtual scrolling** — for long lists (inventory, history)

### Code References
- `artifacts/run-calculator/src/contexts/LiveRunContext.tsx` — live data context
- `artifacts/run-calculator/src/hooks/useAutoTrack.ts` — auto-tracking engine
- `artifacts/api-server/src/routes/sync.ts` — sync endpoint

---

## 13. Server-Side Migration

**Status**: Done (slices 1–7 merged; Replit saw the same goal)
**Priority**: High

### Summary
Server owns every live, time-varying operational surface the server can compute, streamed over the sync SSE:
calc → per-run consumption `runLines` + `summaryStats` → batch/finish `timers` → 3-stage `linePhases` → warehouse
coverage consumption. The client adopts the server projection while confirmed/fresh, and runs the same shared math
(`@workspace/live-calc`) locally only when offline, stale, or when the server has no counterpart for the surface
(unsaved form edits, history, prior-run drain). Cross-device consistency is guaranteed by construction; no surface
dual-owns state.

### Server-Owned Surfaces (adopted when online)
- **Live calc** (slice 1) — server 5s calc tick on the sync SSE for any active run; client adopts inside a 10s
  freshness window; local `computeCalc` fallback on stale/offline/run-switch.
- **Setup-form calc** (slice 2) — tick emits `setupTick: true` frames for pending selected runs so the Live tab has a
  fresh server calc on switch, covering the "form calculations (yield, batch needs, dough supply)" item.
- **Per-run consumption + summary** (slice 3) — server streams `runLines` (ingredient + packaging consumption) and
  `summaryStats` for every run in the SSE frame; client stores lines in `serverRunLinesRef` and adopts current-run
  summaryStats (covers the "ingredient math" item).
- **Batch/finish timing** (slice 4) — `OperationalProjection.timers` carries `currentBatchNum`, `secUntilNextBatch`,
  `totalBatchesNeeded` computed from the server clock (covers the "run timing calculations" item).
- **Line phases** (slice 5) — server computes the 3-stage press/tunnel/packaging model in the projection; client
  adopts with countdown extrapolation and exact-local fallback.
- **Phase display strips** (slice 6) — the ended-run badge, 3-phase status strip, and line-stage section read
  `useLiveRun().linePhases`; the client is a thin display for the phase surface.
- **Warehouse coverage** (slice 7) — Inventory coverage consumes server-streamed per-run `runLines` via
  `computeWarehouseCoverage(..., serverConsumptionLinesByRunId?)`, replacing local lines when the run id matches.

### Intentionally Local Paths (audited, keep client-side)
These are NOT migration gaps — each has no server counterpart or must reflect unsaved client state:
- **Setup-form need rows / validation** (`buildNeedRows`, packaging need rows, `productionNeedsAvailable` gate) —
  write-decisions over unsaved form edits; server calc only covers confirmed/current runs.
- **Auto-track propose/claim** (`useAutoTrack` suggestion + case-tick write, prior-run freezer-drain advance) —
  client proposes/claims writes; the server response is canonical (sync-invariant-check §8). The draining run is
  ended and has no server projection.
- **Exports** (CSV run rows, shop-list text) — deterministic serialization of saved day-state.
- **History / AI analysis inputs** (`buildShapedRun` → aiSummary/aiSchedule/aiAnomaly; `statFromRun` → runInsights;
  historical PPM heuristic) — offline analysis of historical/planned runs the server does not stream calcs for.
- **Day totals table** — already `runSummaryStatsById.get(run.id) ?? computeSummaryStats(...)` (server-adopted with
  local fallback).

### End State
"Client becomes thin display layer + input collector": achieved for every live surface. Local math is the exact same
shared `@workspace/live-calc`/`inventory-math` code the server runs, so offline mode is pixel-identical, and online
mode converges to the server in ≤1 tick. Remaining server-migration appetite (if any) is capped by surfaces the
server genuinely cannot stream (unsaved edits, history, ended-run drain).

### Specs / Plans
- `docs/superpowers/specs/2026-09-13-server-live-calc-stream-design.md` / `...-slice2-design.md` ... `...-slice6-design.md`
- `docs/superpowers/specs/2026-09-14-server-live-calc-stream-slice4-design.md` ... `...-slice6-design.md`
- `docs/superpowers/specs/2026-09-14-server-warehouse-coverage-runlines-design.md`
- Plans live alongside each spec under `docs/superpowers/plans/`.

### Code References
- `lib/live-calc/src/index.ts` — shared calculation engine (client + server)
- `lib/live-calc/src/operationalProjection.ts` — server projection (calc/timers/linePhases)
- `artifacts/api-server/src/routes/sync.ts` — SSE stream + live calc tick
- `artifacts/api-server/src/lib/liveCalcTick.ts` — tick policy helpers
- `artifacts/run-calculator/src/contexts/LiveRunContext.tsx` — adoption + local fallback
- `artifacts/run-calculator/src/operationalState.ts` — `shouldUseServerCalc` freshness gate
- `artifacts/run-calculator/src/inventoryShared.ts` — server-consumption-aware coverage

## 14. Responsive Design & Visual Quality

**Status**: Ideas only
**Priority**: Medium

### Summary
Fix layout issues on phones (too large) and tablets (too small). Prevent overlap and improve readability.

### Ideas
- **Phone-optimized layout** — single column, larger touch targets
- **Tablet-optimized layout** — two-column, better use of space
- **Breakpoint system** — proper sm/md/lg breakpoints
- **Font scaling** — responsive text sizes
- **Touch target sizing** — minimum 44px for all interactive elements
- **Dark mode polish** — consistent color scheme
- **Animation improvements** — smooth transitions, micro-interactions
- **Loading skeletons** — better perceived performance

### Code References
- `artifacts/run-calculator/src/components/ui/` — UI component library
- `artifacts/run-calculator/src/pages/home.tsx:16899` — bottom nav grid
- `artifacts/run-calculator/tailwind.config.*` — Tailwind config

---

## 15. Import System Improvements

**Status**: Planning
**Full plan**: [docs/import-system-plan.md](import-system-plan.md)
**Redesign plan**: [docs/importer-redesign-plan.md](importer-redesign-plan.md)
**Priority**: High — QC is the primary source for imports

### Summary
7 importers exist (spec, premix, cheese, shipping, sauce, dough, schedule) with AI-assisted matching, review stages, learned aliases, history, snapshots. 10 improvements planned + full importer redesign (deterministic-first, AI-fallback).

### Redesign Goals
More accurate, more automatic, more verifiable, less AI:
- **Deterministic-first parse** — template files parse with NO AI; free-form falls back to AI
- **Cell-level provenance** — every parsed value tagged with source cell
- **Auto-verify** — cross-field rule checks; confident items auto-apply
- **Verification report** — round-trip diff + corpus check + signed hash
- **AI as fallback only** — lower cost, fewer rate limits, smaller hallucination surface

### What Exists
- AI-assisted brand/flavor matching + fuzzy fallback
- Second-pass AI review (ReviewBadge)
- Learned aliases from past imports
- Import history: browse, filter, reopen snapshots, retry
- Audit recovery for pending records
- Capability gates (canImportSpec, etc.)

Current apply behavior is multi-step across authoritative domains rather than one transaction. History and saved review snapshots do not yet provide general transactional rollback.

### What's Planned
| # | Improvement | Status |
|---|------------|--------|
| 1 | **QC approval gate** — moved to QC dept plan (Shared Importers); import system only needs to expose `qc_review_status` + review queue API | In QC dept (after QC built) |
| 2 | Rollback / undo last import | Planned |
| 3 | Structured preview diff (what will change) | Planned |
| 4 | Batch import (multi-file) | Planned |
| 5 | Template download (per importer) | Planned |
| 6 | Validation rules pre-check | Planned |
| 7 | Import scheduling (deferred) | Later |
| 8 | Cross-importer linking (import health view) | Planned |
| 9 | Import → inventory impact projection | Planned |
| 10 | Data versioning (re-import diff) | Planned |

### Build Order
1. Structured preview + progress/transaction identity + pre-apply snapshot and guarded undo (Phase 1 — standalone)
2. Validation + cross-import health + inventory impact (Phase 2)
3. Batch import + versioning (Phase 3)
4. **QC approval gate** — after QC department is built (Phase 4)
5. Scheduling (deferred)

### Code References
- `artifacts/run-calculator/src/components/SpecImportDialog.tsx`
- `artifacts/run-calculator/src/components/PremixImportDialog.tsx`
- `artifacts/run-calculator/src/components/CheeseImportDialog.tsx`
- `artifacts/run-calculator/src/components/ShippingImportDialog.tsx`
- `artifacts/run-calculator/src/components/ImportHistoryPanel.tsx`
- `lib/spec-import/src/index.ts` — spec import parser

---

## 16. Sync System Improvements

**Status**: Strong partial-sync foundation built; complete-write causal fencing, evidence, and operator visibility remain
**Priority**: **High** (raised 2026-09-18; was Medium)
**Full plan:** [sync-system-improvements-plan.md](sync-system-improvements-plan.md)
**Ordering authority:** [sync-reliability-unified-plan-2026-09-19.md](sync-reliability-unified-plan-2026-09-19.md)

### Summary
Cross-device sync is already stronger than older backlog text credited. The immediate remaining work is complete-write causality and evidence-safe operations—not greenfield delta sync.

### Already built (do not re-propose as ideas)
- **Protected merge / route-specific revision** — additive/tombstone merges exist, but ordinary day-state PUT retains `canonicalRevision` and does not enforce it as a universal precondition
- **Conflict-safe merge** — `protectRunValues` + blank-over-populated guard
- **Live push** — SSE broadcasts on accepted writes
- **Offline queue** — `syncPushQueue` + operational mutation cursor
- **Daily-reset session fence** — facility-local boundary force-expires stale sessions
- **Server-authoritative live calc / auto-track projection** on the sync stream
- **Wake-recovery timing diagnostics** in Sync Activity
- **Partial PUT** with under-lock `baseSnapshotId` validation and complete authoritative fallback
- **Conditional partial peer SSE** with complete initial/recovery frames

### Still missing (build these)
1. **Complete-write causal fence** — add the future-stamped stale-complete regression, require a trusted snapshot or jointly designed revision base, and return canonical state with `wrote=false` on mismatch
2. **AI readiness-key correction** — align health detection with the active provider adapter without silently changing the global hard-versus-soft dependency policy
3. **Evidence-safe measurements** — complete/partial/fallback/SSE distributions, reconnect timing, future-stamp candidates, and pool pressure without payloads or operational identifiers
4. **Published SSE and capacity verification** — authenticated stream probe, two-process fanout test, and explicit database connection budget
5. **Complete per-device sync health** — manager-visible last seen, queue depth, and lag
6. **Field-specific conflict visibility** — explain when another device's value is retained
7. **Conditional optimization** — broader sparse coverage, JSON Patch, selective sync, compression, or timestamp policy only when measurements justify them

### Resolved guardrail
- Client and server blank templates now both include `cartonSize: 1`, with mirrored regression coverage. Keep the lockstep test mandatory whenever defaults change (research §2.1).

### Code References
- `artifacts/api-server/src/routes/sync.ts` — sync endpoint
- `artifacts/api-server/src/lib/protectRunValues.ts` — blank / LWW merge guard
- `artifacts/run-calculator/src/contexts/SyncContext.tsx` — sync context
- `artifacts/run-calculator/src/syncPushQueue.ts` — offline queue
- `.agents/memory/sync-body-limit.md` — payload growth incident
- `artifacts/api-server/src/routes/sync.convergence.integration.test.ts` — sync convergence coverage

---

## 17. Residual Observability & Resilience Ideas

**Status**: Design items retained after review; the historical branch implementation was rejected
**Priority**: Medium — build only against current architecture and measured need

### A. Privacy-safe operational audit trail

Preserve the goal of durable, authorized operational evidence without retaining arbitrary request or state payloads.

**Required boundaries**:
- Derive facility/scope from the authenticated request; never accept caller-selected scope as authorization
- Use immutable, allowlisted event schemas with server-generated actor identity and timestamps
- Store bounded identifiers, counts, outcomes, and reason codes—not recipes, day-state bodies, prompts, credentials, raw IP addresses, or unrestricted JSON
- Define retention, redaction, export, pagination, and purge behavior before adding tables
- Gate reads with the correct capability and live-scope fence
- Keep high-stakes audit writes in the same durable transaction or fail the operation explicitly; do not silently swallow missing compliance records
- Add schema migration, OpenAPI, generated-client, authorization, isolation, and retention tests

**Owner plans**: [QC Department](qc-department-plan.md) for compliance records; domain-specific operational plans for non-QC events.

### B. Provider-native AI resilience

Retained AI extraction workloads need bounded failure behavior implemented around the active Gemini adapter.

**Required boundaries**:
- Explicit request timeout and cancellation
- Selective retry only for transient, safe failures; honor `Retry-After` where available
- Single-probe circuit-breaker recovery with bounded cooldown
- Capability-specific health and user-facing degradation; do not silently change global readiness policy
- Safe metrics for duration, outcome, retry count, and bounded token/cost totals without prompts, responses, users, or operational payloads
- Provider-key detection and resilience tests must use the same adapter contract

**Owner plans**: [Sync Reliability Unified Plan](sync-reliability-unified-plan-2026-09-19.md) Phase 6 and the [AI value audit](ai-feature-value-audit-2026-09-05.md).

### Rejected implementation boundary

Do not reuse the historical `improvements/observability-resilience` branch. Its query monkey-patching, caller-selected audit scope, raw diagnostic exposure, unrestricted telemetry, obsolete OpenAI client, unapplied patch files, and unbudgeted pool increase are not implementation templates.

