# Updated Canvas vs. Production Run Calculator Audit

**Task:** #1411 (Audit app against updated canvas)  
**Audit date:** 2026-09-01  
**Scope:** Read-only comparison of the updated canvas, current web app, and existing regression coverage. No application behavior was changed by this audit.

## Executive conclusion

The current app already keeps the physical tunnel calculation separate from warehouse freezer-pull and freezer-surplus data. The updated **Warehouse cooler** and **Warehouse freezer** boxes therefore do **not** require an app change merely because they were added to the canvas.

There are three bounded follow-up areas:

1. **Presentation gap:** the live app exposes three aggregate phases rather than the complete station map and its physical lane rules.
2. **Terminology gap (addressed):** physical line timing and WIP are now labeled **Freeze Tunnel Time**, **Freeze Tunnel Draining**, and **Freeze tunnel WIP**. Warehouse freezer-pull and freezer-surplus data retain their distinct names.
3. **Tray-capacity gap:** the canvas describes three tray sections with a maximum of 20 trays each, while the app tracks one aggregate `traysOnLine` counter and currently allows automatic production up to 74. The canvas alone is not enough to safely redesign this persisted counter, so this should be treated as a product clarification and bounded domain follow-up rather than an immediate fix.

No schema, sync, inventory-consumption, permission, or warehouse-location change is justified by the canvas update alone.

## Canvas baseline

The updated canvas defines:

- Main physical flow, right to left: **Press → Oven → Sauce app → App 1 → App 2 → Pep 1 → Pep 2 → App 3 → App 4**.
- Downstream flow: **App 4 → Freeze tunnel → Wrapper → Packaging**.
- Side-by-side movement only at **Press/Oven** and the **Freeze tunnel**.
- Single-file movement everywhere else.
- Upstream prep: **Standby dough → Dough mixer → Dough hopper**.
- Tray lifecycle: **Filling dough trays → Standby dough trays → Using dough trays**.
- Maximum capacity of 20 trays per tray section.
- A separate **Warehouse** area containing **Warehouse cooler** and **Warehouse freezer** zones.

The terminology boundary is explicit: the Freeze tunnel is line equipment; freezer pulls, freezer surplus, freezer inventory, and freezer-pull recovery are warehouse/inventory workflows.

## Mapping and findings

| Canvas concept | Current app representation | Classification | Decision |
|---|---|---|---|
| Full station sequence | `computeLinePhases` exposes only `Press · Oven · Frontline`, `Freeze tunnel`, and `Wrapper · Packaging`. The live Home surface renders those three phase rows and does not render individual station nodes, arrows, colors, or lane widths. | Presentation | Candidate follow-up: add a non-invasive station map or explicitly document the aggregate phase strip as intentional. Do not reverse calculation or operator workflow direction. |
| Right-to-left physical direction | The app’s material calculations include sauce, App 1–4, and Pep 1/Pep 2 inputs, but the live UI has no physical direction indicator. | Presentation / test | Candidate follow-up: add direction and accessible station-order assertions if the station map is approved. |
| Press/Oven and Freeze tunnel are two-wide | The phase model knows the tunnel as a distinct stage, and shared math computes line/tunnel WIP, but there is no lane-width metadata or visible two-wide representation. | Presentation / test | Candidate follow-up only; do not change throughput, occupancy, or timing math without a separate physical-capacity decision. |
| App 4 → Freeze tunnel → Wrapper → Packaging | Stage 2 is named `Freeze tunnel`; Stage 3 is `Wrapper · Packaging`; packaging progress is an independent register with its own reconciliation behavior. | No change needed for current behavior | Preserve the existing separation between tunnel timing, packaging progress, and finalization. |
| Press/Oven/Frontline pre-tunnel segment | Stage 1 groups these into one timing phase. This is consistent with the current aggregate timing model, but not a complete station map. | Presentation | Keep the aggregate timing model unless a future task explicitly adds station-level state. |
| Upstream dough and sauce prep | Dough/tray/batch counters and the Sauce/Frontline surfaces exist. The current source has a single `traysOnLine` field, not separate counters for filling, standby, and using sections. | Calculation/state / product clarification | The canvas identifies physical sections, but does not define how existing aggregate counters should be split or persisted. Do not change this in the audit. |
| 20 trays per tray section | Current automatic tray production clamps the aggregate counter at 74 and tests use values above 20. No sectioned 20-tray model was found. | Calculation/state / test | Requires explicit product decision before implementation. A future task must define migration, manual entry, auto-track, sync, and how three sections map to the existing counter. |
| Warehouse cooler and Warehouse freezer | Warehouse UI is a separate department. Inventory locations are generic named locations with one `isOnsite` flag; the inventory model has no typed cooler/freezer zone. | No change needed for current canvas use | Treat the boxes as conceptual layout context. Only add typed storage zones if warehouse operations explicitly require cooler/freezer-specific behavior. |
| Warehouse staging and pulls | Warehouse needs are grouped as Dough, Sauce, Frontline, and Packaging. Freezer-pull items are server-backed master data and excluded from per-day sync. | Inventory / persistence | Correctly separate from the physical Freeze tunnel. Existing behavior should remain unchanged. |
| Freezer surplus | Freezer-surplus lots and allocations are server-backed and independently persisted/reloaded. | Inventory / persistence | Correctly separate from tunnel WIP. The surplus expiration clock uses the run’s tunnel-time field, which needs clearer naming but not a new warehouse inventory meaning. |

## Freeze tunnel versus freezer terminology

The current implementation is behaviorally coherent:

- `linePhases.ts` defines `freezerTime` as total line time and calculates the middle phase as **Freeze tunnel**.
- `LiveRunContext.tsx` passes the same duration into `computeCasesOnLine` and `computeCasesInFreezer`; the latter represents live tunnel WIP, not warehouse inventory.
- Press completion intentionally counts completed cases plus live tunnel WIP.
- Post-end tracking drains tunnel WIP into packaging over the same physical line window.
- `freezerPull.ts` manages warehouse pull rules through separate server endpoints.
- `freezerSurplus.ts` manages warehouse surplus lots and allocations through separate server endpoints.
- Packaging progress is a separate persisted/reconciled register.

The risk is operator-facing terminology, not a demonstrated data-path collision:

- Setup and die-default surfaces call the physical duration **Freeze Tunnel Time**.
- Run status surfaces say **Freeze Tunnel Draining** and **Freeze Tunnel Empty**.
- Comments and tests identify live WIP and drain timing as belonging to the Freeze tunnel.
- A future reader could incorrectly infer that these labels refer to warehouse freezer stock or freezer-pull actions.

Completed bounded terminology work:

- Prefer **Tunnel time** or **Freeze tunnel time** in user-facing setup and run surfaces.
- Prefer **Freeze tunnel draining** for the physical post-run transition.
- Keep `freezerTime` as a compatibility-preserved storage/wire field unless a separately planned migration changes it.
- Keep `casesInFreezer` compatible if required by existing contracts, but document it as **live Freeze tunnel WIP**.
- Add non-interference tests proving tunnel timing/drain does not create, consume, or mutate freezer-pull items or surplus lots.

Do not replace the tunnel clock with warehouse storage time. Do not make warehouse lots participate in line-phase calculations.

## Safety and parity assessment

| Area | Audit result |
|---|---|
| Live timing | Existing line phases, pause policy, resume propagation, and ended-run drain are physical line timing. Any presentation-only map must not change them. |
| Packaging progress | Packaging progress has an independent local register and sync reconciliation. It must not be replaced with a new freezer handoff register based only on the canvas. |
| Inventory consumption | Warehouse inventory consumption and freezer-surplus allocation are separate from tunnel WIP. No new consumption behavior is warranted. |
| Persistence and sync | Freezer-pull items are server master data; surplus is server-backed; day-state and packaging progress have separate sync paths. No sync/schema change follows from the canvas update. |
| Permissions | Inventory management uses `manage-inventory`; no new zone permission is needed for conceptual canvas boxes. |
| Responsive behavior | Existing phone-layout coverage visits Warehouse and Packaging, but no station-map layout exists to verify. A future station-map task must cover phone, tablet, and desktop without horizontal overflow. |
| Accessibility | Existing smoke coverage checks operational Warehouse surfaces, but no accessible station-order, direction, lane-width, or physical/warehouse terminology assertions exist. |
| Web parity | The current app is web-only per project direction. The physical reference should inform this web app; it does not justify adding a native artifact. |

## Bounded implementation plan

### Follow-up A — physical station map

**Scope:** Presentation-only station map or equivalent operational reference surface.

**Acceptance criteria:**

- Shows the exact physical order from Press through Packaging.
- Makes right-to-left flow explicit without reversing calculations or navigation.
- Identifies Press/Oven and Freeze tunnel as side-by-side; identifies all other sections as single-file.
- Keeps Warehouse cooler/freezer context visually separate from the line.
- Is keyboard-accessible, screen-reader understandable, and usable at phone, tablet, and desktop widths.
- Does not subscribe additional non-live screens to the per-second clock unnecessarily.

**Regression coverage:**

- Component test for exact accessible station order and terminology.
- Browser checks at desktop and narrow phone width for overflow and visibility.
- Existing pause/resume, screen-off/wake, packaging, and Warehouse journeys remain unchanged.

### Follow-up B — tunnel terminology

**Scope:** User-facing naming and documentation only, with compatibility-preserved internal fields.

**Acceptance criteria:**

- Physical line duration is presented as Tunnel time or Freeze tunnel time.
- Physical drain notices say Freeze tunnel draining.
- Warehouse freezer pulls, freezer surplus, and warehouse freezer storage retain their distinct names.
- Existing saved runs, profiles, imports, sync payloads, and server contracts remain readable.

**Regression coverage:**

- Existing line-phase and drain tests continue to pass.
- New test demonstrates tunnel duration affects phase/WIP/drain timing only.
- New test demonstrates tunnel timing changes do not mutate freezer-pull items, surplus lots, allocations, or packaging progress.

### Follow-up C — tray-section capacity clarification

**Scope:** Product/domain decision before implementation.

**Decision required:**

- Is the canvas’s 20-tray limit a physical warning for each of three sections, or should the app persist three separate tray counts?
- If separate counts are required, how should the existing aggregate `traysOnLine` values, auto-track seed, manual overrides, sync, and historical runs migrate?

**Do not implement** a hard cap of 20 on the existing aggregate counter. That would silently change current production math and could discard valid staged dough state.

### Conditional Follow-up D — typed warehouse zones

Only create this work if operators need cooler/freezer-specific inventory behavior beyond the current generic named locations.

**Potential scope:** typed storage-zone metadata, server validation, UI grouping, transfer/pull semantics, permission review, and migration/backward compatibility. This must remain separate from Freeze tunnel stages and line WIP.

## No-change conclusions

- Do not resurrect the cancelled “freezer-to-packaging handoff” task from the earlier mapping pass.
- Do not add a warehouse freezer-to-packaging lifecycle merely because the canvas has a Freeze tunnel followed by packaging.
- Do not alter the six-tab navigation.
- Do not add a database column or sync field for the canvas itself.
- Do not replace current tunnel timing math with warehouse freezer inventory quantities.

## Verified source areas

- `artifacts/run-calculator/src/linePhases.ts:1-19,56-177`
- `artifacts/run-calculator/src/pages/home.tsx:20872-20936,22181-22224`
- `artifacts/run-calculator/src/contexts/LiveRunContext.tsx:248-381`
- `artifacts/run-calculator/src/hooks/useAutoTrack.ts:1150-1213`
- `artifacts/run-calculator/src/types.ts:17-127,376-417`
- `artifacts/run-calculator/src/departments/ProductionLineDepartment.tsx:5-41`
- `artifacts/run-calculator/src/departments/WarehouseInventoryDepartment.tsx:5-24`
- `artifacts/run-calculator/src/warehouseGrouping.ts:1-35`
- `artifacts/run-calculator/src/inventoryShared.ts:66-93`
- `artifacts/run-calculator/src/components/InventoryTab.tsx:161-271`
- `artifacts/run-calculator/src/freezerPull.ts:1-58`
- `artifacts/run-calculator/src/freezerSurplus.ts:1-148`
- `artifacts/run-calculator/src/packagingProgress.ts:11-157`
- `artifacts/run-calculator/e2e/department-workflow-navigation.spec.ts:171-224`
- `artifacts/run-calculator/e2e/freezer-surplus.spec.ts:182-333`
- `artifacts/run-calculator/e2e/phone-layout.spec.ts:557-568`
- `artifacts/run-calculator/e2e/accessibility-smoke.spec.ts:406-416`
- `.agents/memory/production-line-canvas-reference.md:6-39`
