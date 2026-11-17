// ── setupTabCtxValue dep-field registry ──────────────────────────────────────
//
// This file is the canonical list of state-field names that appear in
// setupTabCtxValue's useMemo dep array (home.tsx).
//
// PURPOSE:
//   LiveTabMemo.snappy.test.tsx Suite 4 imports SETUP_TAB_CTX_DEP_FIELDS
//   and checks that none of the DIALOG_REGISTRY fields appear in it.  If a
//   dialog field is accidentally added to setupTabCtxValue's deps AND
//   reflected here, the test fails immediately — preventing the
//   manage-dialog freeze regression from spreading to the Setup panel.
//
// KEEP IN SYNC WITH home.tsx:
//   When you add or remove a dep from the setupTabCtxValue useMemo dep
//   array, mirror the change here.  The two lists must stay identical.
//   (React requires the dep list to be inline, so this file is the paired
//   source-of-truth for tooling and tests.)
//
//   RULE: Dialog/manage/merge/import fields must NOT appear in this list.
//   The freeze-guard test will fail if they do. Note: `form` and the
//   callbacks (commitMissingField / applyRunSuggestion /
//   getRunSuggestionAcceptWarning) are intentionally OMITTED — they are
//   stable or fresh-via-ref, and their reactive closes (v, currentRun,
//   currentRunId) are listed here instead.

export const SETUP_TAB_CTX_DEP_FIELDS = [
  // ── Setup panel data ──
  "v",
  "circles", "shipper", "skidStacking", "gripSheets",
  "isManager", "isSupervisor",
  "currentRun",
  "doughSubTab",
] as const;

export type SetupTabCtxDepField = (typeof SETUP_TAB_CTX_DEP_FIELDS)[number];
