# Server Migration — Warehouse Coverage Adopts Streamed Consumption Lines: Plan

**Goal:** Inventory-tab warehouse coverage uses server-canonical per-run
`runLines` when online; local derivation stays as the offline/absent fallback.

**Spec:** `docs/superpowers/specs/2026-09-14-server-warehouse-coverage-runlines-design.md`

## Task 1: Coverage consumes per-run sources + server lines
- [x] `inventoryShared.ts`: add `RunConsumptionSource`; extend
      `computeWarehouseCoverage(runSources, items, productionIngredients,
      serverConsumptionLinesByRunId?)` with per-run server-line preference.
- [x] `warehouseCoverage.test.ts`: update call sites; add server-lines
      preference + unmatched-id tests (7/7).
- [x] Commit: `feat(inventory): warehouse coverage adopts server run lines`.

## Task 2: Wire the stream through the Inventory tab
- [x] `home.tsx`: `inventoryRunSources` + `inventoryServerRunLines` memos;
      ctx value exposes both (dep registry updated in step-lock).
- [x] `InventoryTabCtx.ts`, `InventoryTabContent.tsx`, `InventoryTab.tsx`:
      props thread through; coverage memo passes server lines.
- [x] Regressions 93/93 (warehouseCoverage, warehouseGrouping,
      inventoryFinalizationCoverage, incidentReporting, LiveTabMemo.snappy);
      run-calculator typecheck clean.
- [x] Commit: `feat(web): inventory coverage consumes streamed run lines`.

## Task 3: Docs + merge
- [x] Slice-7 spec + plan; backlog §13; `.agents/memory/codex-fixes.md`.
- [ ] Commit: `docs: mark server-warehouse-runlines migration done`.
- [ ] Push `feat/warehouse-coverage-server-runlines`, merge to `main`.
