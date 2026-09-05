// ── inventoryTabCtxValue dep-field registry ───────────────────────────────────
//
// This file is the canonical list of state-field names that appear in
// inventoryTabCtxValue's useMemo dep array (home.tsx).
//
// PURPOSE:
//   LiveTabMemo.snappy.test.tsx Suite 4 imports INVENTORY_TAB_CTX_DEP_FIELDS
//   and checks that none of the DIALOG_REGISTRY fields appear in it.  If a
//   dialog field is accidentally added to inventoryTabCtxValue's deps AND
//   reflected here, the test fails immediately — preventing the
//   manage-dialog freeze regression from spreading to the Inventory panel.
//
// KEEP IN SYNC WITH home.tsx:
//   When you add or remove a dep from the inventoryTabCtxValue useMemo dep
//   array, mirror the change here.  The two lists must stay identical.
//   (React requires the dep list to be inline, so this file is the paired
//   source-of-truth for tooling and tests.)
//
//   RULE: Dialog/manage/merge/import fields must NOT appear in this list.
//   The freeze-guard test will fail if they do.

export const INVENTORY_TAB_CTX_DEP_FIELDS = [
  // ── Inventory production data ──
  "dayState",
  "inventoryCandidates", "inventoryRunValues", "inventorySubstitutionOptions",
] as const;

export type InventoryTabCtxDepField = (typeof INVENTORY_TAB_CTX_DEP_FIELDS)[number];
