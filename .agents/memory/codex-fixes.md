# Codex Fixes Log

Running log of fixes made by Codex. Read before modifying code to avoid re-applying fixes.

---

## Warehouse Snapshot — Server-authority migration (feat/warehouse-snapshot-server)

**Date**: 2026-09-12
**Branch**: `feat/warehouse-snapshot-server`
**Files changed**:
- `artifacts/api-server/src/lib/warehouseSnapshot.ts` (new — pure functions)
- `artifacts/api-server/src/routes/warehouseSnapshot.ts` (new — GET /inventory/warehouse-snapshot)
- `artifacts/api-server/src/routes/capabilities/inventoryOperations.ts` (mount new route)
- `artifacts/api-server/src/lib/warehouseSnapshot.test.ts` (new — 6 tests)
- `artifacts/run-calculator/src/warehouseSnapshotClient.ts` (new — shared cache + hook)
- `artifacts/run-calculator/src/inventoryShared.ts` (added WarehouseSnapshot type + fetch)
- `artifacts/run-calculator/src/components/ReorderCard.tsx` (prefer server snapshot when online)
- `artifacts/run-calculator/src/components/UseFirstCard.tsx` (prefer server snapshot when online)
- `artifacts/run-calculator/src/components/InventoryTab.tsx` (prefer server snapshot when online)
- `artifacts/run-calculator/src/reorderNudgeCardParity.test.ts` (fixed stale assertion)

**What was wrong**:
- Warehouse advisory lists (reorder, use-first, transfer warnings) were computed client-side on every device on every inventory SSE tick — CPU/battery waste, numbers could drift between devices.
- Previous model wrote `warehouseSnapshot.test.ts` with a fixture that lacked `casesPerLayer` and `app1OzPerPizza`, causing `computeSummaryStats` to produce NaN values → all demand lines empty.
- `computeWarehouseSnapshot` computed transfer warnings from **scheduled** (future) run values, but the web client's `InventoryTab` uses **today's** active runs as the transfer basis — parity bug.
- `reorderNudgeCardParity.test.ts` asserted `buildReorderDemandByKey(DEFAULT_VALUES) === {}` but DEFAULT_VALUES now defaults `cartoned: "cartoned"` which legitimately generates `packaging:shipper-labels:count` demand — assertion was stale.

**What the fix was**:
- Server: new `GET /inventory/warehouse-snapshot` endpoint pre-computes reorder (from scheduled future runs), use-first (from today's item keys + FEFO lots), and transfer warnings (from today's runs) using the same `@workspace/inventory-math` functions the client uses.
- Transfer computation corrected to use `todayRunValues` (matching InventoryTab parity) instead of `scheduledRunValues`.
- Tests: realistic fixture with `casesPerLayer: 1, app1OzPerPizza: 8` so `computeSummaryStats` produces valid demand lines; demand keys match `computeRunLines` parity (`ingredient:Cheese:batches` keyed by applicator type, not recipe ingredient name).
- Client: `useWarehouseSnapshot()` hook (React `useSyncExternalStore`), module-level shared cache + deduped in-flight fetch. Cards prefer server snapshot when online, fallback to local computation when offline (fetch failure → null → local). SSE handler triggers `refreshWarehouseSnapshot()` on remote inventory events.
- Parity test: updated missing-profile assertion to check CHEESE_KEY absence instead of total empty demand map, accounting for DEFAULT_VALUES packaging.

**Why it was needed**:
- "Server is boss when online, local is backup" — server migration step 3 of the recommended order.
- Battery savings: server pre-computes lists once per request; clients skip local recomputation when online.
- Device parity: identical numbers across all devices online.

**Key gotchas**:
- `computeRunLines` keys demand by applicator TYPE (e.g. `ingredient:Cheese:batches`), NOT by individual recipe ingredient names (Mozzarella). The recipe expansion to per-ingredient lbs only happens in the warehouse **display** roll-up (`aggregateNeedRows` in home.tsx with `warehouse: true`), NOT in inventory consumption keys.
- `casesPerLayer` must be present in run values — without it `totalPizzasForSauce` becomes NaN, zeroing ALL applicator/pep demand lines silently.
- DEFAULT_VALUES now defaults `cartoned: "cartoned"` — any `casesNeeded > 0` produces `packaging:shipper-labels:count` even without a real profile. This is correct behavior (packaging labels apply to all cartoned runs) but tests relying on DEFAULT_VALUES = no demand need updating.
- UseFirstCard test mocks `/api/inventory/*` broadly — the new `/api/inventory/warehouse-snapshot` route matches the prefix and returns `server.inventory` (an array), which the snapshot client correctly rejects via `isValidSnap` guard (shape mismatch → null → local fallback).
