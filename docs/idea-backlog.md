# Idea Backlog

Master list of improvement ideas for the Production Run Calculator. Each idea includes what it is, why it matters, and key code references.

---

## 1. QC Department (Comprehensive)

**Status**: Planning  
**Full plan**: [docs/qc-department-plan.md](qc-department-plan.md)  
**Priority**: High — Phase 1 first

### Summary
Full QC department with own section in the app, like managers have. Consolidates scattered QC features (quality photo checks, incidents, downtime) into one place. Adds lot tracking, weight checks, component checks, label/date verification, import approval queue, recipe approval, future planning, and a unified QC dashboard.

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

## 2. Production Line Map Dashboard

**Status**: Built, pending merge  
**Branch**: `feature/line-map-dashboard`

### Summary
Visual 7-zone production line map in the Run tab showing all physical zones in U-shaped flow layout matching the facility photo. Color-coded status badges, real-time metrics, click-to-navigate to tabs.

### Zones
Dough (stone) → Sauce (red) → Press/Oven (gray) → Frontline (amber) → Freeze Tunnel (sky) → Packaging (emerald) → Warehouse (stone)

### What's Done
- `LineMapDashboard.tsx` component created and integrated into Run tab
- Toggle button (MapPin icon) in run tab header
- All 7 TS errors fixed
- Typecheck passes

### What's Left
- Merge PR: https://github.com/ravenslight2010/Production-run-calculator/pull/new/feature/line-map-dashboard
- Verify on Render after merge

### Code References
- `artifacts/run-calculator/src/components/LineMapDashboard.tsx` — new component
- `artifacts/run-calculator/src/pages/home.tsx:18994` — showLineMap state + toggle
- `lib/live-calc/src/linePhases.ts` — line phase model

---

## 3. Line Station Expansion

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

## 4. AI Improvements

**Status**: Ideas only  
**Priority**: Medium

### Summary
Expand AI capabilities beyond current spec/premix/cheese/shipping import parsing.

### Ideas
- **AI-powered QC assistant** — photo-based defect detection, ingredient verification
- **Predictive maintenance** — based on downtime trends
- **Smart scheduling** — AI-optimized run order
- **Anomaly detection** — real-time flagging of unusual patterns
- **Natural language queries** — "how many cases did we make yesterday?"
- **Voice commands** — for hands-free operation on the production floor
- **AI model fallback** — OpenRouter integration for rate limit resilience

### Code References
- `artifacts/api-server/src/routes/ai*.ts` — AI route handlers
- `lib/ai-memory/` — shared AI memory system
- `lib/integrations-openai-ai-server/` — AI server integration
- `artifacts/run-calculator/src/components/ai/` — AI UI components

---

## 5. Battery & Performance

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

## 6. Server-Side Migration

**Status**: In progress (Replit working on it)  
**Priority**: High

### Summary
Move more logic from client to server to improve consistency, reduce battery, and enable cross-device sync.

### What's Moved So Far
- Auto-track schedule computation (server-owned)
- Wall-clock bootstrap (server-side timing)
- Client skip-latch (reduces redundant network ticks)

### What's Left
- Move form calculations to server (yield, batch needs, dough supply)
- Move ingredient math to server
- Move run timing calculations to server
- Client becomes thin display layer + input collector

### Code References
- `lib/live-calc/src/index.ts` — core calculation engine
- `artifacts/run-calculator/src/liveRunCalc.ts` — client-side calc (to be migrated)
- `artifacts/api-server/src/routes/run-calc.ts` — server calc endpoint (new)

---

## 7. Responsive Design & Visual Quality

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

## 8. Import System Improvements

**Status**: Ideas only  
**Priority**: Medium

### Summary
Improve the import pipeline for spec sheets, premix, cheese, and shipping guides.

### Ideas
- **Batch import** — import multiple files at once
- **Import preview** — show diff before applying
- **Rollback** — undo last import
- **Import history** — browse past imports, re-apply
- **Template download** — download blank template for manual entry
- **Validation rules** — pre-check data quality before import
- **Import scheduling** — queue imports for specific times
- **Cross-import linking** — auto-link ingredients across import types

### Code References
- `artifacts/run-calculator/src/components/SpecImportDialog.tsx`
- `artifacts/run-calculator/src/components/PremixImportDialog.tsx`
- `artifacts/run-calculator/src/components/CheeseImportDialog.tsx`
- `artifacts/run-calculator/src/components/ShippingImportDialog.tsx`
- `lib/spec-import/src/index.ts` — spec import parser

---

## 9. Sync System Improvements

**Status**: Ideas only  
**Priority**: Medium

### Summary
Improve cross-device synchronization reliability and reduce conflicts.

### Ideas
- **Conflict resolution UI** — visual diff when two devices edit same thing
- **Optimistic locking** — prevent stale writes
- **Sync health dashboard** — show sync status per device
- **Offline queue** — queue changes when offline, sync when back
- **Selective sync** — sync only active run data, not everything
- **Compression** — reduce sync payload size
- **Delta sync** — only send changes, not full state

### Code References
- `artifacts/api-server/src/routes/sync.ts` — sync endpoint
- `artifacts/run-calculator/src/contexts/SyncContext.tsx` — sync context
- `.agents/memory/sync-convergence-soak.md` — sync stability notes

