// ── warehouseTabCtxValue dep-field registry ───────────────────────────────────
//
// This file is the canonical list of state-field names that appear in
// warehouseTabCtxValue's useMemo dep array (home.tsx).
//
// PURPOSE:
//   LiveTabMemo.snappy.test.tsx Suite 4 imports WAREHOUSE_TAB_CTX_DEP_FIELDS
//   and checks that none of the DIALOG_REGISTRY fields appear in it.  If a
//   dialog field is accidentally added to warehouseTabCtxValue's deps AND
//   reflected here, the test fails immediately — preventing the
//   manage-dialog freeze regression from spreading to the Warehouse panel.
//
// KEEP IN SYNC WITH home.tsx:
//   When you add or remove a dep from the warehouseTabCtxValue useMemo dep
//   array, mirror the change here.  The two lists must stay identical.
//   (React requires the dep list to be inline, so this file is the paired
//   source-of-truth for tooling and tests.)
//
//   RULE: Dialog/manage/merge/import fields must NOT appear in this list.
//   The freeze-guard test will fail if they do.

export const WAREHOUSE_TAB_CTX_DEP_FIELDS = [
  // ── Warehouse production data ──
  "activeRunNeedDetails", "activeRunValues", "activeRuns",
  "activeWarehouseRows", "activePackagingRows",
  "cycleCountSchedules", "dayState",
  "freezerPullPlan",
  "freezerSurplus", "freezerSurplusBusy", "freezerSurplusError", "freezerSurplusLoaded",
  "isSupervisor",
  "markCountedMutation",
  "runValuesById",
  "scheduledDays", "scheduledValues", "todayScheduledValues",
] as const;

export type WarehouseTabCtxDepField = (typeof WAREHOUSE_TAB_CTX_DEP_FIELDS)[number];
