// ── homeTabCtxValue dep-field registry ─────────────────────────────────────────
//
// This file is the canonical list of state-field names that appear in
// homeTabCtxValue's useMemo dep array (home.tsx).
//
// PURPOSE:
//   LiveTabMemo.snappy.test.tsx Suite 4 imports HOME_TAB_CTX_DEP_FIELDS and
//   checks that none of the DIALOG_REGISTRY fields appear in it.  If a dialog
//   field is accidentally added to homeTabCtxValue's deps AND reflected here,
//   the test fails immediately — preventing the manage-dialog freeze regression
//   from shipping.
//
// KEEP IN SYNC WITH home.tsx:
//   When you add or remove a dep from the homeTabCtxValue useMemo dep array,
//   mirror the change here.  The two lists must stay identical.
//   (React requires the dep list to be inline, so this file is the paired
//   source-of-truth for tooling and tests.)
//
//   RULE: Dialog/manage/merge/import fields must NOT appear in this list.
//   The freeze-guard test will fail if they do.

export const HOME_TAB_CTX_DEP_FIELDS = [
  // ── Production / run state ──
  "activeCasts", "activeStopId", "activeTab", "allergenWarnings", "allMixRecipeOptions",
  "batchWeightsLoaded", "blankRunIds", "blockingViolations", "brandFlavors", "brands",
  "canApproveResets", "canEditRules", "canManageInventory", "canManageStaff",
  "caseUpdateAccepted", "caseUpdatePrompt", "castSupported", "changeHistory",
  "checklistAcks", "checklistSatisfied",
  "cheese1Fields", "cheese2Fields", "cheese3Fields", "cheese4Fields",
  "cheeseIngredients", "cheeseNameBrandTags", "cheeseNamesForRun", "cheeseRecipeNames", "cheeseRecipesList",
  "circles", "circlesList", "currentMixPresets", "currentRun", "currentRunId",
  "customAllergens", "cycleCountQc", "cycleCountSchedules", "dayState",
  "dieLineDefaultOverrides", "dieTypes", "doughFields", "doughIngredients", "doughPoolDrift",
  "doughRecipeNameOptions", "doughRecipeNames", "doughRecipesList", "doughSubTab", "doughVariantPick",
  "downtimeDays", "editingStop", "enabledCheeseRecipes",
  "exportSelection", "exporting", "flashSaved", "flexibleViolations", "floorDimmed", "floorModeEnabled",
  "frontlineFields", "frontlineIngredients", "frontlineRecipeNameOptions", "frontlineRecipeNames",
  "gripSheets", "gripSheetsList", "histBenchmarkPpm", "history",
  "ingredientCatalog", "ingredientTypeOptions", "ingredientTypes",
  "isFullscreen", "isManager", "isOnline", "isSupervisor",
  "lastEndedRun", "lastRunRecall", "learnedBatchWeightRows", "learnedBatchWeights",
  "me", "mixIngredients", "mixMakeDay", "mixNameBrandTags", "mixRecipeNames", "mixes",
  "newReasonInput", "nextRunDieType",
  "pep1ShowB", "pep2ShowB", "pepTypes", "proactiveAlert", "productionRules",
  "promotingRecipeKind", "role", "ruleViolations", "runStatus", "runToTime",
  "saucePoolDrift", "sauceRecipesList", "sauceWeightsOpen", "scheduledDays",
  "screenMode", "serverCheeseByName", "serverCheeseNames", "serverCheeseRowsByName",
  "serverDoughNames", "serverDoughRowsByName", "serverDoughTrayByName",
  "serverDoughVariantsByName", "serverDoughWeightByName",
  "serverMixNames", "serverMixRowsByName", "serverSauceNames", "serverSauceRowsByName",
  "serverTemplates", "setupEditorBrand", "setupEditorFlavor", "setupEditorOpen", "sheetListSignal",
  // ── Dialog/show state IS needed by live production tabs ──
  // (showManageDialog, showImportDialog, merge*, *Import* are intentionally absent)
  "showAlertSettings", "showFloorMode", "showGetStarted", "showGlance",
  "showManualStopDialog", "showReorderDialog", "showReportIssue", "showStopDialog",
  "skidStacking", "skidStackingList",
  "staleCleanupSuggestions", "stopNotes", "stopReason", "stopReasonsList", "strictViolations",
  "swipeCue", "syncConnected", "syncPushFailed",
  "templatesLoaded", "undoBusy", "unifiedIngredientUniverse", "unreviewedIncidentCount",
  "upcomingRunLabels", "v", "ve", "writeError",
] as const;

export type HomeTabCtxDepField = (typeof HOME_TAB_CTX_DEP_FIELDS)[number];
