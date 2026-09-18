import { createContext, lazy, memo, Profiler, useCallback, useEffect, useId, useMemo, useRef, useState, useContext } from "react";
import { useEvent } from "../../hooks/useEvent";
import { createFrameRepeater } from "../../frameRepeater";
import {
  flushPendingHomeFormWrites,
  useHomeFormIdentityFences,
  useHomeFormLifecycle,
} from "../../hooks/useHomeFormLifecycle";
import { useRunLifecycleManager } from "../../hooks/useRunLifecycleManager";
import {
  coordinateForegroundAdoption,
  createForegroundSyncTodayRequest,
  initialResetRequiresReload,
  releaseCancelledForegroundRecovery,
  releaseForegroundRecovery,
  useHomeSyncCoordination,
} from "../../hooks/useHomeSyncCoordination";
import { consumeForegroundRecoveryResponse } from "../../foregroundRecoveryResponse";
import { closeTopmostImportDialog, useHomeImportDialogs } from "../../hooks/useHomeImportDialogs";
import {
  applyTemporaryOverrides,
  computeAutomaticFrontlineSupply,
  computeAutomaticSauceSupply,
  computeFrontlineRunRequirement,
  computeSauceRunRequirement,
  type AutoTrackSchedule,
  type Calc,
  type OperationalProjection,
} from "@workspace/live-calc";
import { HomeCtx, useHomeCtx } from "../../contexts/HomeCtx";
import { HomeTabCtx, useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { WarehouseTabCtx, type WarehouseTabContextValue } from "../../contexts/WarehouseTabCtx";
import { InventoryTabCtx, type InventoryTabContextValue } from "../../contexts/InventoryTabCtx";
import { MixesTabCtx, type MixesTabContextValue } from "../../contexts/MixesTabCtx";
import { SetupTabCtx, type SetupTabContextValue } from "../../contexts/SetupTabCtx";
import WarehouseTabContent from "../../components/WarehouseTabContent";
import { FreezerSurplusPanel } from "../../components/FreezerSurplusPanel";
import InventoryTabContent from "../../components/InventoryTabContent";
import MixesTabContent from "../../components/MixesTabContent";
import SetupContent from "../../components/SetupContent";
import SummaryToolsContent from "../../components/SummaryToolsContent";
import ScreenModeView from "../../components/ScreenModeView";
import { ForegroundRecoveryStatus } from "../../components/ForegroundRecoveryStatus";
import { VisibleTabScheduler } from "../../visibleTabScheduler";
import { incrementFloorCaseCount } from "../../floorPackagingCorrection";
import {
  hasAutomaticUpdateReloadBlockingSurface,
  isAutomaticUpdateReloadSafe,
  reportAutomaticUpdateReloadSafety,
  useAutomaticUpdateReloadBlocker,
} from "../../updateReloadSafety";
import {
  browserIsOnline,
  resolveForegroundStopIntent,
  type ForegroundStopIntent,
} from "../../foregroundLifecycleIntent";
import GlanceOverlay from "../../components/GlanceOverlay";
import { useAccessibleDialogStack } from "../../components/useAccessibleDialog";
import CompactRunStrip from "../../components/CompactRunStrip";
import { ManualOverrideBanner, manualOverrideBannerShow } from "../../components/ManualOverrideBanner";
import { LiveSauceTabContent } from "../../components/live-stations/LiveSauceTabContent";
import { LiveFrontlineTabContent } from "../../components/live-stations/LiveFrontlineTabContent";
import { LivePackagingTabContent } from "../../components/live-stations/LivePackagingTabContent";
import { LiveDoughTabContent } from "../../components/live-stations/LiveDoughTabContent";
import { AUTO_SUPPRESS_MS, fmtMS } from "../../components/live-stations/stationShared";
import { MixAlreadyMadeInput } from "../../components/MixAlreadyMadeInput";
import { PrepMixMissingAmountsWarning } from "../../components/PrepMixMissingAmountsWarning";
import { useForm, useFieldArray } from "react-hook-form";
import type { Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  formSchema,
  type FormValues,
  type RecipeRow,
  type Stoppage,
  type RunMeta,
  type DayState,
  type SyncPayload,
  type HistoryDay,
  DEFAULT_VALUES,
  PACKAGING_FIELDS,
  STOP_REASONS_KEY,
  SUPERVISOR_PIN_KEY,
  DEFAULT_STOP_REASONS,
  DEFAULT_SUPERVISOR_PIN,
  DEFAULT_PEP_TYPES,
  PEP_TYPE_RENAMES,
  RETIRED_PEP_TYPES,
  INGREDIENT_RENAMES,
  DEFAULT_DIE_TYPES,
  CIRCLES_KEY,
  DEFAULT_CIRCLES,
  SHIPPER_KEY,
  DEFAULT_SHIPPERS,
  SKID_STACKING_KEY,
  DEFAULT_SKID_STACKING,
  GRIP_SHEETS_KEY,
  DEFAULT_GRIP_SHEETS,
  SHIFT_START_TIME_KEY,
  PRODUCTION_START_TIME_KEY,
  isCartonedValue,
  labelPositionLabel,
  LABEL_POSITION_OPTIONS,
  PACKAGING_TYPE_OPTIONS,
  DEFAULT_INGREDIENT_TYPES,
  DEFAULT_CHEESE_INGREDIENTS,
  DEFAULT_MIX_INGREDIENTS,
  DEFAULT_DOUGH_INGREDIENTS,
  DEFAULT_DOUGH_RECIPE_NAMES,
  DEFAULT_FRONTLINE_INGREDIENTS,
  DEFAULT_FRONTLINE_RECIPE_NAMES,
  INGREDIENT_TYPES_KEY,
  PEP_TYPES_KEY,
  DIE_TYPES_KEY,
  CHEESE_INGREDIENTS_KEY,
  MIX_INGREDIENTS_KEY,
  DOUGH_INGREDIENTS_KEY,
  DOUGH_RECIPE_NAMES_KEY,
  FRONTLINE_INGREDIENTS_KEY,
  FRONTLINE_RECIPE_NAMES_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  MIX_RECIPE_NAMES_KEY,
  MAX_RUNS,
  BRANDS_KEY,
  HISTORY_KEY,
  MAX_HISTORY_DAYS,
  type MasterDataChange,
  type MasterDataChangeType,
  type IngredientSubstitution,
  type SubstitutionLogEntry,
  type PrepPhase,
  withTempOverrides,
  PRE_POST_TUNNEL_DEFAULT_MIN,
  DOUGH_TRAY_SECTION_CAPACITY,
  DOUGH_TRAY_SECTION_COUNT,
  DOUGH_TRAY_ADVISORY_TOTAL,
} from "../../types";
import {
  fmtElapsed,
  fmtTime,
  fmtNum,
  fmtComma,
  fmtClock,
  fmtMins,
  fmtCountdownParts,
  computeSummaryStats,
  computeCheesePull,
  computeCheesePerPizzaOz,
  applyResumeToRun,
  sauceBarrelBreakdown,
  genId,
  todayStr,
  writeDayResetAt,
  runLabel,
} from "../../utils";
import { normalizeScheduledDays, type ScheduledDay } from "../../scheduledDays";
import { calculateDayTimeline, estimatedRunDurationSec } from "../../dayTimeline";
import { fetchWithTimeout } from "../../fetchWithTimeout";
import { deriveFrontlineNeedRows } from "../../frontlineRows";
import {
  isSharedRecipeRefreshEligible,
  orchestrateSharedRecipeRefresh,
  refreshNamedRecipeProfilesAndPropagate,
  runSharedRecipeRefresh,
} from "../../profileRecipeRefresh";
import { clearActiveSubstitutions, setActiveSubstitutions, withTodaySubstitutions } from "../../substitutionState";
import { brandTagLabels } from "@workspace/name-match";
import { computeLinePhases, pickMostActivePhase, computeEndedRunElapsedSec, type PhaseInfo } from "../../linePhases";
import {
  pauseDecisionRemainingMs,
  canChoosePauseTunnelPolicy,
  shouldClosePauseDecision,
} from "../../pausePolicy";
import {
  PackagingSpeedNudgeFeedback,
} from "../../components/PackagingSpeedNudgeFeedback";
import {
  loadDayState,
  saveDayState,
  loadHistory,
  filterMeaningfulHistory,
  overlayRunMetaStamps,
  removeRunByIdFromDayState,
  dropTombstonedPresetKeys,
  dropTombstonesForAliveNames,
  clearRecipeNameSelections,
  loadProfile,
  loadRawProfile,
  profileHasRealData,
  backfillFromProfile,
  saveProfile,
  mergeProfileIntoOpenForm,
  markProfileRemotelyDeleted,
  recipeRowsEqual,
  normalizeRecipeRowsForCompare,
  refreshProfilesFromNamedRecipes,
  refreshCheeseOrMixProfileRows,
  type NamedRecipePoolPatch,
  resolvePep1Combined,
  loadBrandFlavors,
  saveBrandFlavors,
  loadList,
  saveList,
  loadDoughRecipePresets,
  saveDoughRecipePresets,
  loadFrontlineRecipePresets,
  saveFrontlineRecipePresets,
  loadCheeseRecipePresets,
  saveCheeseRecipePresets,
  applyPepTaxonomyMigrationIfNeeded,
  applyIngredientDedupeMigrationIfNeeded,
  applyMachineTimeDefaultsHealIfNeeded,
  applyStrayMixRecategorizeIfNeeded,
  applyMixSlotRecategorizeIfNeeded,
  setProfileWritesAllowed,
  applyPoolAwareSlotHealIfNeeded,
  loadPendingServerMixPushes,
  clearPendingServerMixPushes,
  applyMixCheeseOverlapDedupeIfNeeded,
  purgeOrphanedProfilesIfNeeded,
  applyProfileCleanupIfNeeded,
  deleteProfilesForBrand,
  deleteProfileEntry,
  applyIngredientMerge,
  applyRecipeNameMerge,
  removeStaleRecipeReference,
  loadMergedAway,
  saveMergedAway,
  dropMergedAway,
  clearMergedAway,
  loadDeletedItems,
  saveDeletedItems,
  tombstoneDeleted,
  clearDeleted,
  unionDeletedItems,
  dropDeleted,
  loadDeletedStamps,
  loadUndeletedStamps,
  saveDeletedStamps,
  saveUndeletedStamps,
  mergeStampMaps,
  flavorNamespace,
  setKvMutationHook,
  captureMasterDataSnapshot,
  recordMasterDataChange,
  loadChangeHistory,
  undoChange,
  STALE_BRANDS,
  SEED_MIX_RECIPE_NAMES,
  migrateIngredientListsToCatalogIfNeeded,
  hydrateRecipeRowsWithCatalog,
  existingRecipeNamesForImport,
  specImportCheeseRecipeIsMix,
  healDieTypesFromProfiles,
  scanProfileDieTypes,
  normalizePackagingFields,
  rewriteDieTypeInProfiles,
  rewritePepTypeInProfiles,
  rewriteAppTypeInProfiles,
  rewriteRecipeNameInProfiles,
  saveProfileSubTab,
  loadProfileSubTab,
  type SpecImportDisplayKind,
} from "../../storage";
import { COMPLETED_HISTORY_OUTBOX_EVENT, flushCompletedHistoryOutbox, hydrateCompletedHistory, loadCompletedHistoryForActiveScope, pendingCompletedHistoryCount, queueCompletedRun, setCompletedHistoryScope, startRunAndQueueCompetingCompletions } from "../../completedHistorySync";
import { applyResetWipe, applyRolloverEpoch, getStoredResetEpoch } from "../../adapters/browserResetPersistence";
import {
  loadRunValues,
} from "../../adapters/browserRunPersistence";
import {
  acceptRemoteRunValueOnSync,
  adoptStrictlyNewerRemoteLifecycles,
  deepEqual,
  freshDayState,
  isBlankRemovableRun,
  isEmptyOverPopulated,
  isPristineSeedRun,
  pickCurrentRunPushValue,
  reconcileOperationalIntentCanonical,
  selectInboundRunLifecycles,
  shouldAcceptSyncDaySnapshot,
  shouldAtomicallyAdoptFirstSnapshot,
  shouldHealFormFromStored,
  shouldKeepLocalRunLifecycle,
  shouldResetFormOnRunSwitch,
} from "../../domain/runSyncPolicy";
import {
  loadPackagingProgress,
  overlayPackagingProgress,
  reconcilePackagingProgress,
  recordAutomaticPackagingProgress,
  recordManualPackagingProgress,
  savePackagingProgress,
} from "../../packagingProgress";
import { isolatePendingRunPackagingProgress } from "../../runProgressIsolation";
import {
  consumeSyncWriteResponse,
  isCanonicalRecoverySyncPayload,
  isUnchangedSyncResponse,
  isValidSyncSnapshotId,
  persistedSyncPayload,
  readCurrentRecoveryJson,
  reconstructPartialSyncPayload,
  syncPayloadMatchesSnapshot,
} from "../../syncWriteResponse";
import {
  canonicalProfileKey,
  flushProfileQueueStrict,
  markProfileForceEdited,
  reconcileProfilesFromServer,
  reconcileProfilesFromServerDetailed,
  seedProfilesFromServer,
  type ProfileReconcileResult,
} from "../../profileServerSync";
import {
  fetchFactoryData,
  hydrateFromServer,
  putFactoryKey,
  getStopReasons,
  getPackagingSettings,
  getShiftStartTime,
  getProductionStartTime,
  stampLocalWrite,
  flushFactoryQueue,
  FACTORY_KV_CACHED_KEYS,
  runFactoryKvMigration,
} from "../../factoryDataSync";
import {
  useRunTemplates,
  saveRunTemplateApi,
  deleteRunTemplatesApi,
  runTemplatesQueryKey,
  RUN_TEMPLATES_QUERY_KEY,
} from "../../hooks/useRunTemplates";
import {
  resolveDieLineDefaultsOnSwitch,
  resolveCrustLineDefaults,
  dieDefaultsKey,
  dieLineDefaultsFor,
} from "../../dieDefaults";
import { saveDieLineDefaults } from "../../dieLineDefaultsServer";
import { DIE_LINE_DEFAULTS_QUERY_KEY } from "../../hooks/useDieLineDefaults";
import RunInsightsCard from "../../components/RunInsightsCard";
import {
  reportRunInsightsAfterFinalize,
  buildTunnelDieDefaultEntry,
  type RunSuggestion,
} from "../../runInsights";
import {
  fetchServerDieTypes,
  pushDieTypesToServer,
  deleteDieTypesOnServer,
  reconcileDieTypes,
  DIE_TYPES_SERVER_MIGRATED_KEY,
} from "../../dieTypesServer";
import { findMixPresets, type MixPreset } from "../../mixPresets";
import { MIX_SEED } from "../../mixSeed";
import { groupWarehouseNeedRows, type WarehouseArea } from "../../warehouseGrouping";
import FactoryResetCard from "../../components/FactoryResetCard";
import AuditLogCard from "../../components/AuditLogCard";
import SyncConflictStatsCard from "../../components/SyncConflictStatsCard";
import DataHealthWorkspace from "../../components/DataHealthWorkspace";
import SyncStatusPopover, { type SyncStatus } from "../../components/SyncStatusPopover";
import {
  buildSyncDiagnosticReport,
  loadSyncDiagnostics,
  loadSyncMeasurements,
  recordSyncDiagnostic,
  recordSyncMeasurement,
  type SyncDiagnostic,
  type SyncDiagnosticKind,
  type SyncMeasurementTrigger,
} from "../../syncDiagnostics";
import ProfileDataHealthCard from "../../components/ProfileDataHealthCard";
import ProfileNameLinkCleanupCard from "../../components/ProfileNameLinkCleanupCard";
import AiCorrectionsCard from "../../components/AiCorrectionsCard";
import ManageRunsPanel from "../../components/ManageRunsPanel";
import ReorderCard from "../../components/ReorderCard";
import UseFirstCard from "../../components/UseFirstCard";
import ScheduledRecipeWarningCard from "../../components/ScheduledRecipeWarningCard";
import ManagerAttentionDialog, {
  buildManagerAttentionItems,
  managerAttentionCount,
  type ManagerAttentionItem,
} from "../../components/ManagerAttentionDialog";
import ApplicatorEvidenceReview from "../../components/ApplicatorEvidenceReview";
import { RecipeShareButtons } from "../../components/RecipeShareButtons";
import AlertSettingsDialog from "../../components/AlertSettingsDialog";
import { SetupRecipesRoleGate } from "../../components/SetupRecipesRoleGate";
import { TickBar } from "../../components/TickBar";
import { LineSetupRoleGate } from "../../components/LineSetupRoleGate";
import { DoughRoleGate } from "../../components/DoughRoleGate";
import { useFreezerPullItems } from "../../hooks/useFreezerPullItems";
import { useDropdownScrollKeeper } from "../../hooks/useDropdownScrollKeeper";
import { useSupervisorPin } from "../../hooks/useSupervisorPin";
import { updateSupervisorPin } from "../../supervisorPinApi";
import {
  buildFreezerPullPlan,
  isMatchingSurplusProduct,
  summarizeSurplusForRun,
  type FreezerSurplusLedger,
} from "@workspace/freezer-pull";
import {
  confirmFreezerSurplus,
  fetchFreezerSurplus,
  getFreezerSurplusRemainingMs,
  replaceFreezerSurplusAllocation,
} from "../../freezerSurplus";
import { useMixes } from "../../hooks/useMixes";
import { useOptimisticMixUpdates } from "../../hooks/useOptimisticMixUpdates";
import { useIngredients } from "../../hooks/useIngredients";
import {
  invalidateMasterDataBootstrap,
  invalidateMasterDataSlice,
  setMasterDataSlice,
  shouldRefreshMasterData,
} from "../../masterData";
import {
  saveIngredients as saveIngredientsRemote,
  deleteIngredients as deleteIngredientsRemote,
  mergeIngredientsRemote,
  mergeCatalogEntriesByName,
  findOrBuildIngredient,
} from "../../ingredients";
import { buildIngredientUniverse, type IngredientCategory } from "@workspace/ingredient-catalog";
import {
  buildMixPlan,
  OZ_PER_LB,
  repointMixesForBrandMerge,
  repointMixesForFlavorMerge,
  repointMixIngredients,
  backfillMixFromMergedSources,
  addSpecMixesIfAbsent,
  type Mix,
} from "@workspace/mixes";
import { specMixDraftToMix } from "@workspace/premix-import";
import { fetchMixes, saveMixes, deleteMixes } from "@/mixes";
import { createSwipeState, updateSwipeAxis, resolveSwipe, isSwipeExcludedTarget, type SwipeState as SwipeGestureState } from "@/swipeGesture";
import {
  buildCycleCountDueList,
  DEFAULT_CYCLE_COUNT_SECTIONS,
} from "@workspace/cycle-count";
import { useCycleCountSchedules } from "../../hooks/useCycleCountSchedules";
import { markCycleCountCounted } from "../../cycleCount";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cachedProfileKeys } from "../../profileCache";
import ChangePasswordCard from "../../components/ChangePasswordCard";
import RecipeSubstitutionBadge from "../../components/RecipeSubstitutionBadge";
import { describeSubstitution } from "../../components/SubstitutionsManager";
import MixReconcilePanel from "../../components/MixReconcilePanel";
import ImportHistoryPanel from "../../components/ImportHistoryPanel";
import { recordImportHistory, setImportHistoryIdentity, type ImportHistoryImportType, type ImportHistoryItem, type ImportHistoryReopenRequest } from "../../importHistory";
import { resetSandboxRequest, reportUnauthorized } from "../../inventoryShared";
import {
  fetchIngredientBatchWeights,
  saveIngredientBatchWeights,
  normalizeBatchWeightChanges,
  buildBatchWeightMap,
  lookupBatchWeight,
  collectBatchWeightCandidatesFromProfile,
  filterStillCurrentBatchWeightEntries,
  enqueueBatchWeightPropagation,
  executeBatchWeightPropagation,
  type BatchWeightCandidate,
  type IngredientBatchWeightRow,
  type BatchWeightPropagationProfile,
} from "../../ingredientBatchWeights";
import FillMissingPanel from "../../components/FillMissingPanel";
import OperationalReportPanel, { type OperationalReportDetailRange } from "../../components/OperationalReportPanel";
import ManagerActionQueue from "../../components/ManagerActionQueue";
import ShiftHandoffDigest from "../../components/ShiftHandoffDigest";
import ReportIssueDialog from "../../components/ReportIssueDialog";
import GetStartedDialog from "../../components/GetStartedDialog";
import { useGetStartedOverview } from "@workspace/onboarding";
import GuidedTour from "../../components/GuidedTour";
import { moveEntries, relocateValues } from "@workspace/schedule-move";
import { findScheduledRecipeIssues } from "@workspace/scheduled-recipe-check";
import {
  applyRecipeSuggestion as applyRecipeSuggestionShared,
  type RecipeFieldId,
  type RecipeSuggestionLike,
} from "@workspace/recipe-apply";
import { buildDaySummaryInput, buildWeekSummaryInput } from "../../aiSummary";
import { buildAnomalyInput } from "../../aiAnomaly";
import { buildScheduleInput } from "../../aiSchedule";
import { BehindPaceAlertBanner } from "../../components/BehindPaceAlertBanner";
import {
  findFirstUnreadyScheduledRun,
  getStartRunReadiness,
} from "../../startRunReadiness";
import { computeCasesInFreezer } from "@workspace/inventory-math";
import {
  computeRunConsumptionLines,
  consumeRun,
  consumeSauceBarrel,
  deriveCandidateItems,
  scoreNameMatch,
  type ConsumeLine,
  type RunConsumptionSource,
} from "../../inventoryShared";
import {
  applyRecipeSubstitutions,
  applySubstitutions,
  computeSummaryStats as computeSummaryStatsShared,
} from "@workspace/inventory-math";
import {
  buildMergeMap,
  countMergeReferences,
  mapName,
  type MergeMap,
} from "../../mergeIngredients";
import {
  type RecipeNameMergeCategory,
  RECIPE_NAME_FIELDS_BY_CATEGORY,
  countRecipeNameReferences,
  isStrayMixName,
  collectStaleRecipeLinkNames,
  buildStaleCleanupSuggestions,
} from "../../mergeRecipeNames";
import { collectMergeAliases, type MergeSuggestion } from "@workspace/merge-suggest";
import {
  allergenMeta,
  allergenOptions,
  allergenSequenceWarnings,
  isAllergen,
  normalizeAllergen,
  type Allergen,
  type AllergenSequenceItem,
} from "@workspace/allergen";
import {
  suggestMerges,
  saveMergeAliases,
  denyMerge,
  fetchMergedAwayNames,
  saveMergedAwayNames,
  deleteMergedAwayNames,
  fetchPendingDuplicateReviews,
  savePendingDuplicateReviews,
  resolvePendingDuplicateReview,
  duplicateReviewGroupKey,
  isCurrentMergeSuggestionRequest,
  type ReviewedMergeSuggestion,
  type MergeSuggestCategory,
} from "../../mergeSuggest";
import { saveAiCorrections } from "../../aiCorrections";
import { AppSlotMathBadge } from "../../components/AppSlotMathBadge";
import { detectAppSlotConflicts } from "@workspace/setup-math-check";
import { recordMemorySample, recordPerformance } from "../../performanceDiagnostics";
import {
  buildActiveRunIds,
  buildPersistedRunValues,
  buildRunSummarySnapshot,
  overlayCurrentRunValues,
} from "../../homePerformance";
import { syncRetryDelay } from "../../syncRetry";

import { usePresentationCast } from "../../hooks/usePresentationCast";
import {
  getAutoTrackTiming,
  suggestedDoughStaging,
  type AutoTrackEventClaim,
  type AutoTrackEventResult,
} from "../../hooks/useAutoTrack";
import {
  publishAutoTrackCoordination,
  publishAutoTrackSchedule,
  subscribeAutoTrackCoordination,
  DOUGH_TIMER_CONTROL_EVENT,
  DOUGH_TIMER_CONTROL_ADOPT_EVENT,
} from "../../autoTrackCoordinationClient";
import { capturePreEndLifecycle, fenceActiveManualSectionValues, fencePendingEndSnapshots, fencePendingOperationalValues, flushOperationalIntentOutbox, operationalIntentBlocksLifecycle, queueOperationalIntent, setOperationalIntentCanonicalAdopter, setOperationalIntentIdentity, submitManualSection } from "../../operationalIntentOutbox";
import { MANUAL_SECTION_FIELDS, manualSectionForField } from "@workspace/sync-contract";
import { claimManualSectionLock, getManualSectionLock, releaseManualSectionLock, useManualControlConflict, useManualControlLock } from "../../manualSectionLocks";
import { consumeOperationalMutationCursor } from "../../operationalMutationCursor";
import { useBackButtonTrap } from "../../hooks/useBackButtonTrap";
import { HOME_TABS, useHomeNavigation, type HomeTab } from "../../hooks/useHomeNavigation";
import { useHomeRunIdentity } from "../../hooks/useHomeRunIdentity";
import { useLiveRun, LiveRunProvider } from "../../contexts/LiveRunContext";
import { calcRef } from "../../liveRunCalc";
import { computeEffectiveLineSpeed } from "../../lineSpeed";
import { createPackagingControlAdapter, createPackagingManager, runUnlockedManualSectionAction } from "../../packagingManager";
import {
  type OperationalSnapshotReceipt,
} from "../../operationalState";
import { HomeStationTabs } from "../../components/HomeStationTabs";
import {
  DepartmentProvider,
  DeferredCheeseRecipesManager,
  DeferredCycleCountManager,
  DeferredDieLineDefaultsManager,
  DeferredFreezerPullItemsManager,
  DeferredInventoryTab,
  DeferredMixesManager,
  DeferredNamedRecipesManager,
  DeferredProductionRulesManager,
  DeferredStaffManagementSurface,
  ManagementDepartment,
  preloadManagementEditors,
  preloadStaffManagementSurface,
  ProductionLineDepartment,
  QcDowntimeSurface,
  QcIncidentsSurface,
  QcQualitySurface,
  WarehouseInventoryDepartment,
  preloadWarehouseInventorySurface,
  type DepartmentAppContext,
} from "../../departments";
// showAppNotification is imported from useNotifications to fire sauce push alerts
import { showAppNotification } from "../../hooks/useNotifications";
import { getSauceBarrelEntry, mirrorSauceBarrelProgress } from "../../sauceBarrelStore";
import { usePendingResetSummary } from "../../hooks/usePendingResetCount";
import { useUnreviewedIncidentSummary } from "../../hooks/useUnreviewedIncidentCount";
import { useProductionRules } from "../../hooks/useProductionRules";
import { usePrepPhase, mergePrepPhaseClient, getPrepPhase, FRESH_PREP_PHASE } from "../../hooks/usePrepPhase";
import {
  evaluateRules,
  newRule,
  defaultRuleName,
  ruleFieldDef,
  RULE_FIELDS,
  RULE_ATTRIBUTES,
  ruleAttributeDef,
  type ProductionRule,
  type RuleType,
  type RuleSequenceItem,
} from "@workspace/production-rules";
import { saveProductionRules, deleteProductionRules } from "../../productionRules";
import { useMe } from "../../useRole";
import { getImportAccess } from "../../importAccess";
import {
  Factory,
  Layers,
  Clock,
  Droplets,
  ClipboardList,
  LifeBuoy,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Check,
  CheckSquare,
  Play,
  Pause,
  Square,
  Timer,
  Trash2,
  Eraser,
  X,
  BarChart2,
  CheckCircle2,
  Lock,
  KeyRound,
  ShieldCheck,
  Settings,
  Download,
  Upload,
  FileSpreadsheet,
  Printer,
  History,
  FileText,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  GripVertical,
  Maximize2,
  Minimize2,
  TrendingUp,
  MessageSquare,
  Monitor,
  ExternalLink,
  OctagonX,
  TrendingDown,
  CircleDot,
  Sparkles,
  CalendarPlus,
  Compass,
  RotateCcw,
  FlaskConical,
  CalendarDays,
  ListChecks,
  PauseCircle,
  Share2,
  Copy,
  Activity,
  Package,
  Warehouse,
  Boxes,
  Menu,
  LogOut,
  Bell,
  Snowflake,
  Zap,
  MoveDown,
  Blend,
  ClipboardCheck,
  Users,
  Truck,
  RefreshCw,
  MapPin,
} from "lucide-react";
import { useAuth } from "@/useAuth";
import type { ImportParseResult } from "@/utils/runExcel";
import { loadWorkbookWorkflow } from "@/workbookWorkflow";
import { buildCaseUpdateOffers, defaultCaseUpdateAccepted, caseUpdateWarningLine, type CaseUpdateOffer } from "@/importCaseUpdates";
import {
  PENDING_DUPLICATE_REVIEW_SCAN,
  loadPendingDuplicateReview,
  pendingDuplicateReviewAfterResolution,
  savePendingDuplicateReview,
} from "@/pendingDuplicateReview";
import type { ImportCommit } from "@/components/ExcelImportDialog";
import { CameraFilePicker } from "@/components/CameraFilePicker";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import type { SpecImportPrepared } from "@/specImport";
import { requestParseSpecImages } from "@/parseSpecSheet";
import type { ExportSelection } from "@/specExport";
import { mergeSpecAliases, cleanSpecNamedRecipeName, findSpecImportNamedRecipeFamilyMatch, specImportNamedRecipeNamesEqual, specImportRecipeHasUsablePoolData, type ParsedSpecImport, type SpecImportAlias } from "@workspace/spec-import";
import type { PremixImportPrepared } from "@/premixImport";
import type { ShippingImportPrepared } from "@/shippingImport";
import type { SauceGuideImportPrepared, DoughGuideImportPrepared } from "@/recipeGuideImport";
import type { ShippingPatch } from "@workspace/shipping-import";
import { saveShippingGuide, buildShippingGuideLabel } from "@/savedShippingGuides";
import { deriveSourceKey, fetchSavedSpecSheets } from "@/savedSpecSheets";
import type { PremixFreezerPull } from "@workspace/premix-import";
import CheeseReconcilePanel from "@/components/CheeseReconcilePanel";
import { useDieLineDefaults } from "../../hooks/useDieLineDefaults";
import type { CheeseImportPrepared } from "@/cheeseImport";
import { useCheeseRecipes } from "@/hooks/useCheeseRecipes";
import type { CheeseRecipe, CheeseComponent } from "@workspace/cheese-recipes";
import {
  cheesePerFlavorComponentOz,
  repointCheeseRecipesForBrandMerge,
  repointCheeseRecipesForFlavorMerge,
  repointCheeseRecipeIngredients,
  backfillCheeseRecipeFromMergedSources,
  specCheeseDraftToRecipe,
  addCheeseRecipesIfAbsentByName,
} from "@workspace/cheese-recipes";
import { fetchCheeseRecipes, saveCheeseRecipes, deleteCheeseRecipes } from "@/cheeseRecipes";
import { useNamedRecipes } from "@/hooks/useNamedRecipes";
import { addNamedRecipesToServerIfAbsent, fetchNamedRecipes, saveNamedRecipes, deleteNamedRecipes } from "@/namedRecipes";
import { namedRecipeFromDraft, repointNamedRecipeIngredients, backfillNamedRecipeFromMergedSources, planNameConsolidation, matchDoughballVariant, normalizeDoughballVariants, applyDoughCustomerAssignmentsToVariants, doughballVariantLabelKey, SPEC_STATIC_CUSTOMER_ASSIGNMENTS, type DoughballVariant, type NamedRecipe, type NamedRecipeTag } from "@workspace/named-recipes";
import { fetchSpecImportAliases, saveSpecImportAliases, learnSpecImportAliasesForNameChange, learnRecipeNameChangeAliases, learnIngredientChangeAliases, maybeLearnIngredientRename, maybeLearnTypeRename } from "@/specImportAliases";
import { refreshPhotoAliasesCache } from "@/photoAliasesStore";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import SetupProfileEditor from "@/components/SetupProfileEditor";
import LineMapDashboard from "@/components/LineMapDashboard";
import { noteBreadcrumb, getLastActionBeforeLoad } from "@/reloadBreadcrumbs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeferredSurface } from "../../departments/DeferredDepartmentSurface";

import { PauseTunnelDecision, OperationalStateBadge, ElapsedTimeBadge, PerRunMixSlotBadge, NumField, DoughRecipeCard, FrontlineRecipeCard, CheesePickCard, MixRecipeCard, TypeDropdown, NotesTextarea, aggregatePackagingNeeds } from "../../pages/liveTabsSupport";
export const LiveSummaryTabContent = memo(function LiveSummaryTabContent() {
  const hx = useHomeTabCtx();
  const {
    copiedSummary, currentRun, dayState, expandedHistoryDay,
    exportCSV, exportExcel, exportHistoryCSV, exportQuickBooks,
    histBenchmarkPpm, history, isSupervisor, printSummary, productionStartTime,
    runSummaryStatsById, runValuesById,
    setActiveTab, setCopiedSummary, setDayState, setExpandedHistoryDay,
    switchToRun, updateRunMeta, v,
  } = hx;

  const { isManager } = useMe();
  const { calc, liveFreezerMin } = useLiveRun();
  const dayTimeline = useMemo(() => calculateDayTimeline({
    date: dayState.date ?? todayStr(),
    productionStartTime,
    runs: dayState.runs.map((run: RunMeta) => ({
      run,
      durationSec: estimatedRunDurationSec(runValuesById.get(run.id)),
    })),
    breaks: dayState.breaks,
    currentRunId: currentRun?.startedAt && !currentRun.endedAt ? currentRun.id : undefined,
    currentRemainingSec: calc.totalTimeSec,
    nowMs: Date.now(),
  }), [calc.totalTimeSec, currentRun?.endedAt, currentRun?.id, currentRun?.startedAt, dayState, productionStartTime, runValuesById]);
  const dayTimelineById = useMemo(
    () => new Map(dayTimeline.runs.map(item => [item.runId, item])),
    [dayTimeline.runs],
  );
  const pendingHistoryUploads = pendingCompletedHistoryCount();
  const [ingredientDetailRunId, setIngredientDetailRunId] = useState<string | null>(null);
  useAutomaticUpdateReloadBlocker(
    "ingredient-detail-dialog",
    Boolean(ingredientDetailRunId),
  );
  return (
    <>
                <div className="mb-4 rounded-xl border border-border/50 bg-card/60 overflow-hidden" data-testid="day-timeline">
                  <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold">Day timeline</div>
                      <div className="text-xs text-muted-foreground">Estimated schedule; actual run and pause timestamps take precedence.</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Projected finish</div>
                      <div className="text-sm font-bold tabular-nums">{dayTimeline.projectedFinishMs ? fmtClock(dayTimeline.projectedFinishMs) : "—"}</div>
                    </div>
                  </div>
                  <div className="px-5 py-3 space-y-2">
                    {dayTimeline.runs.map((item, index) => {
                      const run = dayState.runs.find((candidate: RunMeta) => candidate.id === item.runId);
                      if (!run) return null;
                      return (
                        <div key={item.runId} className="flex items-center justify-between gap-3 text-xs">
                          <span className="truncate"><span className="font-semibold">Run {index + 1}</span> · {runLabel(run)}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {item.startMs ? fmtClock(item.startMs) : "—"} → {item.finishMs ? fmtClock(item.finishMs) : "—"}
                            {item.status === "current" && <span className="ml-1 text-primary">(live)</span>}
                          </span>
                        </div>
                      );
                    })}
                    {dayTimeline.breaks.filter(item => item.break.enabled).map(item => (
                      <div key={`break-${item.slot}`} className="flex items-center justify-between gap-3 text-xs text-amber-400">
                        <span>Break {item.slot} · 30 min</span>
                        <span className="tabular-nums">
                          {item.status === "unassigned" ? (item.reason === "missing-run" ? "Unassigned run" : "Needs a valid time")
                            : item.status === "pending" ? "Pending at pause boundary"
                            : `${fmtClock(item.startMs!)} → ${fmtClock(item.finishMs!)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Shift notes */}
                <div className="mb-4">
                  <label className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/70 block mb-1.5">Shift Notes</label>
                  <textarea
                    value={dayState.shiftNotes ?? ""}
                    onChange={e => {
                      const updated = { ...dayState, shiftNotes: e.target.value };
                      setDayState(updated);
                      saveDayState(updated);
                    }}
                    onFocus={e => e.target.select()}
                    placeholder="Handoff notes, issues, observations for this shift…"
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/50 text-sm resize-none outline-none focus:border-primary/60 placeholder:text-muted-foreground/40"
                  />
                </div>
                {/* ── Today's Shift Totals + Benchmark ── */}
                {(() => {
                  const todayFinished = dayState.runs.filter((r: any) => r.startedAt && r.endedAt);
                  if (todayFinished.length === 0 && histBenchmarkPpm === null) return null;
                  const todayTotalCases = todayFinished.reduce((acc: any, r: any) => {
                    const vals = loadRunValues(r.id);
                    return acc + (r.actualCases ?? computeSummaryStats(vals).totalCases);
                  }, 0);
                  const todayNetSec = todayFinished.reduce((acc: any, r: any) => {
                    const gross = (r.endedAt! - r.startedAt!) / 1000;
                    const dt = (r.stoppages ?? []).filter((s: any) => s.endedAt && s.type !== "pause").reduce((a: any, s: any) => a + (s.endedAt! - s.startedAt) / 1000, 0);
                    return acc + Math.max(0, gross - dt);
                  }, 0);
                  const todayDowntimeSec = todayFinished.reduce((acc: any, r: any) => {
                    return acc + (r.stoppages ?? []).filter((s: any) => s.endedAt && s.type !== "pause").reduce((a: any, s: any) => a + (s.endedAt! - s.startedAt) / 1000, 0);
                  }, 0);
                  const todayTotalPizzas = todayFinished.reduce((acc: any, r: any) => {
                    const vals = loadRunValues(r.id);
                    const cases = r.actualCases ?? computeSummaryStats(vals).totalCases;
                    return acc + cases * (vals.pizzasPerCase ?? 0);
                  }, 0);
                  const todayPpm = todayNetSec > 0 && todayTotalPizzas > 0 ? Math.round(todayTotalPizzas / (todayNetSec / 60)) : null;
                  const benchDiff = todayPpm !== null && histBenchmarkPpm !== null ? todayPpm - histBenchmarkPpm : null;
                  return (
                    <div className="mb-5 rounded-xl border border-border/50 bg-card/60 overflow-hidden">
                      <div className="px-5 py-3 border-b border-border/30 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm font-bold">Today's Shift</span>
                        {todayFinished.length > 0 && <span className="text-xs text-muted-foreground">{todayFinished.length} run{todayFinished.length !== 1 ? "s" : ""} finished</span>}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border/30">
                        <div className="px-5 py-4">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cases Made</div>
                          <div className="text-2xl font-black tabular-nums">{todayTotalCases > 0 ? fmtComma(todayTotalCases) : "—"}</div>
                        </div>
                        <div className="px-5 py-4">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Net Run Time</div>
                          <div className="text-2xl font-black tabular-nums">{todayNetSec > 0 ? fmtTime(todayNetSec) : "—"}</div>
                        </div>
                        <div className="px-5 py-4">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Downtime</div>
                          <div className={`text-2xl font-black tabular-nums ${todayDowntimeSec > 0 ? "text-orange-400" : "text-muted-foreground"}`}>{todayDowntimeSec > 0 ? fmtTime(todayDowntimeSec) : "—"}</div>
                        </div>
                        <div className="px-5 py-4">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Today's PPM</div>
                          <div className={`text-2xl font-black tabular-nums ${benchDiff === null ? "" : benchDiff >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {todayPpm !== null ? todayPpm : "—"}
                          </div>
                          {histBenchmarkPpm !== null && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              avg {histBenchmarkPpm} PPM
                              {benchDiff !== null && (
                                <span className={`ml-1 font-semibold ${benchDiff >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                  {benchDiff >= 0 ? `▲ +${benchDiff}` : `▼ ${benchDiff}`}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {histBenchmarkPpm !== null && todayPpm === null && (
                        <div className="px-5 py-3 border-t border-border/20 text-xs text-muted-foreground">
                          Historical average: <span className="font-bold text-foreground">{histBenchmarkPpm} PPM</span> across {history.reduce((a: any, d: any) => a + d.runs.filter((r: any) => r.startedAt && r.endedAt).length, 0)} finished runs
                        </div>
                      )}
                    </div>
                  );
                })()}


                {(() => {
                  const finishedRuns = dayState.runs.filter((r: any) => !!r.endedAt);
                  const upcomingRuns = dayState.runs.filter((r: any, i: any) => !r.endedAt && i !== dayState.currentIndex);

                  function SummaryCard({ run, isCurrent, readOnly, runVals, onShowDetail }: { run: RunMeta; isCurrent?: boolean; readOnly?: boolean; runVals?: FormValues; onShowDetail: () => void }) {
                    const vals = runVals ?? runValuesById.get(run.id) ?? DEFAULT_VALUES;
                    const s = runSummaryStatsById.get(run.id) ?? computeSummaryStats(vals);
                    const isFinished = !!run.endedAt;
                    const timelineItem = dayTimelineById.get(run.id);
                    const actualDurationSec = run.startedAt && run.endedAt
                      ? (run.endedAt - run.startedAt) / 1000
                      : null;


                    // ── Dough batch count (same formula as aggregateNeedRows) ──
                    const dRecipeLbs = (vals.doughRecipe ?? []).reduce((acc: number, r: { lbs?: string | number }) => acc + Number(r.lbs ?? 0), 0);
                    const effDoughYield = dRecipeLbs > 0 && vals.targetDoughballWeight > 0
                      ? (dRecipeLbs * 16) / vals.targetDoughballWeight
                      : vals.doughBatchYield;
                    const doughBatches = effDoughYield > 0 && vals.targetDoughballWeight > 0
                      ? Math.ceil(s.totalPizzas / effDoughYield)
                      : 0;
                    const doughName = (vals.doughRecipeName ?? "").trim() || "Dough";

                    const summaryFrontlineRows = deriveFrontlineNeedRows(vals, s);
                    const frontlineItems: { label: string; value: string }[] = [];
                    // Dough row first
                    if (doughBatches > 0) {
                      frontlineItems.push({ label: `Dough — ${doughName}`, value: `${fmtNum(doughBatches, 2)} batches` });
                    }
                    for (const row of summaryFrontlineRows) {
                      if (row.station === "sauce" && row.unit === "batches") {
                        const bd = sauceBarrelBreakdown(row.amount, s.sauceEffBarrel);
                        frontlineItems.push({
                          label: row.label,
                          value: bd
                            ? `${fmtNum(row.amount, 2)} batches · ${bd.totalBarrels} barrels`
                            : `${fmtNum(row.amount, 2)} batches`,
                        });
                      } else {
                        frontlineItems.push({
                          label: row.label,
                          value: `${fmtNum(row.amount, row.unit === "lbs" ? 1 : 2)} ${row.unit}`,
                        });
                      }
                    }

                    // ── Packaging for the detail modal ──


                    const canEdit = !readOnly && (isSupervisor || isCurrent);
                    const caseDelta = run.actualCases != null ? run.actualCases - s.totalCases : null;

                    return (

                      <Card
                        data-testid={`run-summary-${run.id}`}
                        className={`border-border/50 shadow-md ${!readOnly ? "cursor-pointer transition-colors hover:bg-accent/30" : ""} ${isCurrent ? "bg-primary/10 border-primary/40" : isFinished ? "bg-emerald-950/20 border-emerald-700/30" : "bg-card/60"}`}
                        onClick={readOnly ? undefined : () => { const idx = dayState.runs.indexOf(run); if (idx !== -1) { switchToRun(idx); setActiveTab("run"); } }}
                      >
                        <CardHeader className="pb-2 pt-4 px-5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-base font-semibold break-words min-w-0">{runLabel(run)}</CardTitle>
                          {vals.dieType && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted/50 border border-border/50 text-muted-foreground">
                              {vals.dieType}
                            </span>
                          )}
                        </div>
                            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${isCurrent ? "bg-primary/20 text-primary" : isFinished ? "bg-emerald-700/30 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                              {isCurrent ? "Current" : isFinished ? "Finished" : "Upcoming"}
                            </span>
                          </div>
                          {(run.startedAt || run.endedAt) && (
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
                              {run.startedAt && <span>{fmtClock(run.startedAt)}</span>}
                              {run.startedAt && run.endedAt && <ChevronRight className="w-3 h-3 shrink-0" />}
                              {run.endedAt && <span>{fmtClock(run.endedAt)}</span>}
                              {run.startedAt && run.endedAt && (
                                <span className="text-muted-foreground/50 ml-1">· {fmtTime((run.endedAt - run.startedAt) / 1000)}</span>
                              )}
                              {run.startedAt && !run.endedAt && (
                                <span className="text-primary/60 font-medium">→ running</span>
                              )}
                            </div>
                          )}
                        </CardHeader>
                        <CardContent className="px-5 pb-4 space-y-3" onClick={e => e.stopPropagation()}>
                          {/* Time & cases row */}
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-background/40 rounded-lg py-2 px-1">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Planned</div>
                              <div className="text-lg font-bold tabular-nums">{fmtComma(s.totalCases)}</div>
                              <div className="text-[10px] text-muted-foreground">cases</div>
                            </div>
                            <div className="bg-background/40 rounded-lg py-2 px-1">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Pizzas</div>
                              <div className="text-lg font-bold tabular-nums">{fmtComma(s.totalPizzas)}</div>
                              <div className="text-[10px] text-muted-foreground">&nbsp;</div>
                            </div>
                            <div className="bg-background/40 rounded-lg py-2 px-1">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                {isFinished ? "Duration" : isCurrent ? "Time Left" : "Est. Time"}
                              </div>
                              <div className="text-lg font-bold">
                                {isFinished && actualDurationSec !== null
                                  ? fmtTime(actualDurationSec)
                                  : isCurrent
                                    ? fmtTime(calc.totalTimeSec)
                                    : fmtTime(s.estimatedTimeSec)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">&nbsp;</div>
                            </div>
                          </div>
                          {!isFinished && !isCurrent && timelineItem?.startMs && timelineItem.finishMs && (
                            <div className="text-xs text-muted-foreground text-center -mt-1">
                              Estimated schedule: <span className="font-semibold text-foreground tabular-nums">{fmtClock(timelineItem.startMs)} – {fmtClock(timelineItem.finishMs)}</span>
                            </div>
                          )}

                          {/* Waste tracking — actual cases + waste lbs (finished or supervisor) */}
                          {(isFinished || isSupervisor) && !readOnly && (
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <div>
                                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Actual Cases</label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number" min="0" step="1"
                                    value={run.actualCases ?? ""}
                                    placeholder={String(s.totalCases)}
                                    disabled={!canEdit}
                                    onChange={e => updateRunMeta(run.id, { actualCases: e.target.value === "" ? undefined : Number(e.target.value) })}
                                    onFocus={e => e.target.select()}
                                    className="h-8 w-full px-2 rounded bg-muted/40 border border-border/40 text-sm font-mono outline-none focus:border-primary/60 disabled:opacity-50"
                                  />
                                  {caseDelta !== null && (
                                    <span className={`text-xs font-semibold tabular-nums shrink-0 ${caseDelta >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                                      {caseDelta >= 0 ? `+${caseDelta}` : caseDelta}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Waste (lbs)</label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number" min="0" step="0.1"
                                    value={run.wasteLbs ?? ""}
                                    placeholder="0"
                                    disabled={!canEdit}
                                    onChange={e => updateRunMeta(run.id, { wasteLbs: e.target.value === "" ? undefined : Number(e.target.value) })}
                                    onFocus={e => e.target.select()}
                                    className="h-8 w-full px-2 rounded bg-muted/40 border border-border/40 text-sm font-mono outline-none focus:border-primary/60 disabled:opacity-50"
                                  />
                                  {(run.wasteLbs ?? 0) > 0 && (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                  )}
                                </div>
                                {run.wasteLbs != null && run.wasteLbs > 0 && (run.actualCases ?? s.totalCases) > 0 && (
                                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 tabular-nums">
                                    {fmtNum(run.wasteLbs / (run.actualCases ?? s.totalCases), 2)} lbs/case
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                          {/* Read-only waste display for history */}
                          {readOnly && (run.actualCases != null || run.wasteLbs != null) && (
                            <div className="flex gap-4 text-xs">
                              {run.actualCases != null && <span className="text-muted-foreground">Actual: <span className="text-foreground font-semibold tabular-nums">{fmtComma(run.actualCases)} cases</span></span>}
                              {run.wasteLbs != null && run.wasteLbs > 0 && <span className="text-amber-400/80">Waste: <span className="font-semibold tabular-nums">{fmtNum(run.wasteLbs, 1)} lbs</span></span>}
                            </div>
                          )}

                          {/* Expected cases by now — only for running current run */}
                          {isCurrent && run.startedAt && !run.endedAt && (() => {
                            const ev = withTempOverrides(vals);
                            const ppm = computeEffectiveLineSpeed({
                              mode: run.subTab === "crusts" ? "crusts" : "dough",
                              approxLineSpeed: ev.approxLineSpeed,
                              crustsPerCycle: ev.crustsPerCycle,
                              cycleSpeed: ev.cycleSpeed,
                              speedAdjustment: ev.speedAdjustment,
                            });
                            const expectedCases = ppm > 0 && ev.pizzasPerCase > 0
                              ? Math.floor(ppm * liveFreezerMin / ev.pizzasPerCase)
                              : 0;
                            return (
                              <div className="flex items-center justify-between bg-primary/10 border border-primary/25 rounded-lg px-4 py-2">
                                <span className="text-xs text-primary/80 font-medium">Expected cases by now</span>
                                <span className="text-xl font-bold text-primary tabular-nums">{fmtComma(expectedCases)}</span>
                              </div>
                            );
                          })()}
                          {/* Actual vs expected duration — only for finished runs */}
                          {isFinished && actualDurationSec !== null && s.estimatedTimeSec > 0 && (() => {
                            const diffSec = actualDurationSec - s.estimatedTimeSec;
                            const ahead = diffSec < 0;
                            const absDiff = Math.abs(diffSec);
                            return (
                              <div className={`flex items-center justify-between rounded-lg px-4 py-2 border ${ahead ? "bg-emerald-950/30 border-emerald-700/30" : "bg-amber-950/30 border-amber-700/30"}`}>
                                <div className="space-y-0.5">
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Time Comparison</div>
                                  <div className="flex gap-3 text-xs">
                                    <span className="text-muted-foreground">Actual: <span className="text-foreground font-medium">{fmtTime(actualDurationSec)}</span></span>
                                    <span className="text-muted-foreground">Expected: <span className="text-foreground font-medium">{fmtTime(s.estimatedTimeSec)}</span></span>
                                  </div>
                                </div>
                                <div className={`text-right text-sm font-bold ${ahead ? "text-emerald-400" : "text-amber-400"}`}>
                                  {ahead ? `−${fmtTime(absDiff)}` : `+${fmtTime(absDiff)}`}
                                  <div className="text-[10px] font-normal">{ahead ? "ahead" : "over"}</div>
                                </div>
                              </div>
                            );
                          })()}
                          {/* Start / end times for started runs */}
                          {run.startedAt && (
                            <div className="flex gap-3 text-xs text-muted-foreground">
                              <span>Started: <span className="text-foreground font-medium">{fmtClock(run.startedAt)}</span></span>
                              {run.endedAt && <span>Ended: <span className="text-foreground font-medium">{fmtClock(run.endedAt)}</span></span>}
                            </div>
                          )}
                          {/* Frontline totals */}
                          {frontlineItems.length > 0 && (
                            <div className="pt-1 border-t border-border/30">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Frontline Totals</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                {frontlineItems.map((item: any) => (
                                  <div key={item.label} className="flex justify-between text-xs py-0.5">
                                    <span className="text-muted-foreground truncate mr-2">{item.label}</span>
                                    <span className="font-medium tabular-nums shrink-0">{item.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Notes / shift log */}
                          <div className="pt-1 border-t border-border/30">
                            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1 mb-1.5">
                              <FileText className="w-3 h-3" /> Notes
                            </label>
                            {canEdit ? (
                              <NotesTextarea
                                initialValue={run.notes ?? ""}
                                onCommit={text => updateRunMeta(run.id, { notes: text })}
                                className="w-full px-2 py-1.5 rounded bg-muted/40 border border-border/40 text-sm outline-none focus:border-primary/60 resize-none placeholder:text-muted-foreground/50"
                              />
                            ) : (
                              <p className="text-sm text-muted-foreground italic min-h-[2rem]">
                                {run.notes || "—"}
                              </p>
                            )}
                          </div>
                          {/* Ingredient Detail button */}
                          <div className="pt-2 border-t border-border/30 flex justify-end" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => onShowDetail()}
                              className="text-xs text-primary/80 hover:text-primary underline underline-offset-2 font-medium"
                            >
                              Ingredient Detail
                            </button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  }

                  // ── Day Totals ──────────────────────────────────────────
                  const allRunStats = dayState.runs.map((run: any) =>
                    runSummaryStatsById.get(run.id) ??
                    computeSummaryStats(runValuesById.get(run.id) ?? DEFAULT_VALUES),
                  );
                  const dayTotalCases = allRunStats.reduce((sum: any, s: any) => sum + s.totalCases, 0);
                  const dayTotalPizzas = allRunStats.reduce((sum: any, s: any) => sum + s.totalPizzas, 0);
                  const dayActualCases = dayState.runs.reduce((sum: any, r: any) => sum + (r.actualCases ?? 0), 0);

                  // ── Shopping List ─────────────────────────────────────────
                  // Aggregate ingredient quantities across all runs for today
                  type ShopItem = { name: string; totalQty: number; unit: string };
                  const shopMap = new Map<string, ShopItem>();
                  function shopAdd(name: string, qty: number, unit: string) {
                    if (!name || qty <= 0) return;
                    const key = `${name}__${unit}`;
                    const existing = shopMap.get(key);
                    if (existing) existing.totalQty += qty;
                    else shopMap.set(key, { name, totalQty: qty, unit });
                  }
                  for (const run of dayState.runs) {
                    const vals = runValuesById.get(run.id) ?? DEFAULT_VALUES;
                    const s = runSummaryStatsById.get(run.id) ?? computeSummaryStats(vals);
                    // Dough batches needed (calc inline from vals, same logic as Ingredient Needs)
                    const totalPizzas = s.totalPizzas;
                    const dRecipeLbs = (vals.doughRecipe ?? []).reduce((acc: number, r: { lbs: number }) => acc + Number(r.lbs ?? 0), 0);
                    const effYield = dRecipeLbs > 0 && vals.targetDoughballWeight > 0
                      ? (dRecipeLbs * 16) / vals.targetDoughballWeight
                      : vals.doughBatchYield;
                    const doughBatches = effYield > 0 ? Math.ceil(totalPizzas / effYield) : 0;
                    // Sauce
                    if (s.sauceBatches > 0) shopAdd("Sauce", s.sauceBatches, "barrels");
                    // Dough ingredients
                    for (const row of (vals.doughRecipe ?? [])) {
                      if (row.ingredient && row.lbs > 0 && doughBatches > 0) {
                        shopAdd(row.ingredient, row.lbs * doughBatches, "lbs");
                      }
                    }
                    // Per-applicator cheese/mix recipe
                    const allRecipes = [
                      ...(vals.app1CheeseRecipe ?? []),
                      ...(vals.app2CheeseRecipe ?? []),
                      ...(vals.app3CheeseRecipe ?? []),
                      ...(vals.app4CheeseRecipe ?? []),
                    ];
                    for (const row of allRecipes) {
                      if (row.ingredient && row.lbs > 0) shopAdd(row.ingredient, row.lbs, "lbs");
                    }
                    // Pep
                    if (s.pep1Type && s.pep1Lbs > 0) shopAdd(`Pep — ${s.pep1Type}`, s.pep1Lbs, "lbs");
                    if (s.pep1TypeB && s.pep1LbsB > 0) shopAdd(`Pep — ${s.pep1TypeB}`, s.pep1LbsB, "lbs");
                    if (s.pep2Type && s.pep2Lbs > 0) shopAdd(`Pep — ${s.pep2Type}`, s.pep2Lbs, "lbs");
                    if (s.pep2TypeB && s.pep2LbsB > 0) shopAdd(`Pep — ${s.pep2TypeB}`, s.pep2LbsB, "lbs");
                  }
                  const shopList = [...shopMap.values()].sort((a: any, b: any) => a.name.localeCompare(b.name));

                  return (
                    <div className="space-y-6">
                      {/* Export buttons */}
                      <div className="flex gap-2 justify-end print:hidden flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            const lines: string[] = [`Production Run Summary — ${todayStr()}`, ""];
                            for (const run of dayState.runs) {
                              const vals = run.id === currentRun.id ? v : loadRunValues(run.id);
                              const s = computeSummaryStats(vals);
                              lines.push(`${runLabel(run)} — ${fmtComma(s.totalCases)} cases / ${fmtComma(s.totalPizzas)} pizzas`);
                              if (run.startedAt) lines.push(`  Started: ${fmtClock(run.startedAt)}${run.endedAt ? `  Ended: ${fmtClock(run.endedAt)}` : ""}`);
                              if (s.sauceBatches > 0) {
                                const bd = sauceBarrelBreakdown(s.sauceBatches, s.sauceEffBarrel);
                                lines.push(bd
                                  ? `  Sauce: ${fmtNum(s.sauceBatches, 2)} batches (${bd.batchesPerBarrel}/barrel) → ${bd.totalBarrels} barrels`
                                  : `  Sauce: ${fmtNum(s.sauceBatches, 2)} barrels`);
                              }
                              if (s.app1Type) lines.push(`  ${s.app1Type}: ${fmtNum(s.app1Lbs, 1)} lbs`);
                              if (s.pep1Type) lines.push(`  Pep: ${fmtNum(s.pep1Lbs, 1)} lbs`);
                              if (s.pep1TypeB && s.pep1LbsB > 0) lines.push(`  Pep: ${fmtNum(s.pep1LbsB, 1)} lbs`);
                              if (s.pep2Type && s.pep2Lbs > 0) lines.push(`  Pep: ${fmtNum(s.pep2Lbs, 1)} lbs`);
                              if (s.pep2TypeB && s.pep2LbsB > 0) lines.push(`  Pep: ${fmtNum(s.pep2LbsB, 1)} lbs`);
                              if (run.notes) lines.push(`  Notes: ${run.notes}`);
                              lines.push("");
                            }
                            if (dayState.shiftNotes?.trim()) {
                              lines.push(`Shift Notes: ${dayState.shiftNotes.trim()}`);
                            }
                            const text = lines.join("\n");
                            const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
                            if (nav.share) {
                              nav.share({ title: "Run Summary", text }).catch(() => {});
                            } else {
                              navigator.clipboard?.writeText(text).then(() => {
                                setCopiedSummary(true);
                                setTimeout(() => setCopiedSummary(false), 2000);
                              }).catch(() => {});
                            }
                          }}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border/50 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {copiedSummary
                            ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> <span className="text-emerald-400">Copied!</span></>
                            : <><Share2 className="w-3.5 h-3.5" /> Share</>
                          }
                        </button>
                        <button
                          type="button"
                          onClick={printSummary}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border/50 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" /> Print
                        </button>
                        <button
                          type="button"
                          onClick={exportCSV}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border/50 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> Export CSV
                        </button>
                        <button
                          type="button"
                          onClick={exportExcel}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border/50 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
                        </button>
                        <button
                          type="button"
                          onClick={exportQuickBooks}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border/50 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> QuickBooks
                        </button>
                      </div>

                      {/* Day Totals banner */}
                      {dayState.runs.length > 1 && (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
                          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-primary">
                            <FileText className="w-4 h-4" />
                            Day Totals — {dayState.runs.length} runs
                          </div>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="flex flex-col items-center">
                              <span className="text-2xl font-bold tabular-nums">{fmtComma(dayTotalCases)}</span>
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Cases (est.)</span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="text-2xl font-bold tabular-nums">{fmtComma(dayTotalPizzas)}</span>
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Pizzas</span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className={`text-2xl font-bold tabular-nums ${dayActualCases > 0 ? (dayActualCases >= dayTotalCases ? "text-emerald-400" : "text-amber-400") : "text-muted-foreground"}`}>
                                {dayActualCases > 0 ? fmtComma(dayActualCases) : "—"}
                              </span>
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Cases (actual)</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Shift efficiency stats */}
                      {(() => {
                        const runs = dayState.runs;
                        const productiveMs = runs.reduce((sum: any, r: any) => sum + (r.startedAt && r.endedAt ? r.endedAt - r.startedAt : 0), 0);
                        const gapMs = runs.reduce((sum: any, r: any, i: any) => {
                          if (i === 0) return sum;
                          const prev = runs[i - 1];
                          return sum + (prev.endedAt && r.startedAt ? r.startedAt - prev.endedAt : 0);
                        }, 0);
                        const totalMs = productiveMs + gapMs;
                        if (productiveMs === 0) return null;
                        const utilPct = totalMs > 0 ? Math.round(productiveMs / totalMs * 100) : 100;
                        return (
                          <div className="rounded-xl border border-border/40 bg-card/40 px-5 py-4">
                            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-muted-foreground">
                              <TrendingUp className="w-4 h-4" />
                              Shift Efficiency
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                              <div>
                                <div className="text-lg font-bold tabular-nums text-emerald-400">{fmtElapsed(productiveMs)}</div>
                                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Productive</div>
                              </div>
                              <div>
                                <div className="text-lg font-bold tabular-nums text-amber-400/80">{gapMs > 0 ? fmtElapsed(gapMs) : "—"}</div>
                                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Gap / Down</div>
                              </div>
                              <div>
                                <div className={`text-lg font-bold tabular-nums ${utilPct >= 80 ? "text-emerald-400" : utilPct >= 60 ? "text-amber-400" : "text-red-400"}`}>{utilPct}%</div>
                                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Utilization</div>
                              </div>
                            </div>
                            <div className="mt-3 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-500 ${utilPct >= 80 ? "bg-emerald-500" : utilPct >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${utilPct}%` }} />
                            </div>
                          </div>
                        );
                      })()}

                      {/* Shopping List */}
                      {shopList.length > 0 && (
                        <div className="rounded-xl border border-border/40 bg-card/40 px-5 py-4">
                          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-muted-foreground">
                            <AlertTriangle className="w-4 h-4" />
                            Ingredient Totals (all runs today)
                          </div>
                          <div className="space-y-1.5">
                            {shopList.map((item: any) => (
                              <div key={`${item.name}__${item.unit}`} className="flex justify-between text-sm">
                                <span className="text-foreground/80">{item.name}</span>
                                <span className="font-semibold tabular-nums">{fmtNum(item.totalQty, 1)} {item.unit}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* All runs in order with gap connectors */}
                      {dayState.runs.map((run: any, idx: any) => {
                        const isCurrentRun = idx === dayState.currentIndex;
                        const prevRun = idx > 0 ? dayState.runs[idx - 1] : null;
                        const isUpcoming = !run.endedAt && !isCurrentRun;

                        // Gap connector between this run and the previous one
                        const gapMs = prevRun?.endedAt && run.startedAt
                          ? run.startedAt - prevRun.endedAt
                          : null;
                        const gapType = run.gapType ?? "switchover";
                        const BREAK_THRESHOLD_MS = 30 * 60 * 1000;
                        const displayMs = gapType === "switchover"
                          ? gapMs
                          : gapMs !== null ? Math.max(0, gapMs - BREAK_THRESHOLD_MS) : null;

                        return (
                          <div key={run.id} className="space-y-2">
                            {/* Gap connector — only between two runs where the previous ended */}
                            {prevRun && (
                              <div className="flex items-center gap-3 px-2 py-1">
                                <div className="flex flex-col items-center gap-0.5 shrink-0">
                                  <div className="w-px h-3 bg-border/50" />
                                  <div className="w-1.5 h-1.5 rounded-full bg-border/50" />
                                  <div className="w-px h-3 bg-border/50" />
                                </div>
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  {/* Type toggle */}
                                  <div className="flex rounded-md border border-border/40 overflow-hidden shrink-0 text-[10px] font-semibold">
                                    <button
                                      type="button"
                                      onClick={() => updateRunMeta(run.id, { gapType: "switchover" })}
                                      className={`px-2 py-1 transition-colors ${gapType === "switchover" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/40"}`}
                                    >Switchover</button>
                                    <button
                                      type="button"
                                      onClick={() => updateRunMeta(run.id, { gapType: "break" })}
                                      className={`px-2 py-1 border-l border-border/40 transition-colors ${gapType === "break" ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground hover:bg-muted/40"}`}
                                    >Break</button>
                                  </div>
                                  {/* Gap time */}
                                  {gapMs !== null ? (
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      {gapType === "switchover" ? (
                                        <span>{fmtElapsed(gapMs)}</span>
                                      ) : displayMs! > 0 ? (
                                        <span className="text-amber-400">+{fmtElapsed(displayMs!)} <span className="text-muted-foreground">over 30 min</span></span>
                                      ) : (
                                        <span className="text-emerald-400/70">within 30 min</span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground/50 italic">gap unknown</span>
                                  )}
                                  {/* Gap note */}
                                  <div className="flex items-center gap-1 ml-auto shrink-0">
                                    <MessageSquare className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                                    <input
                                      type="text"
                                      value={run.gapNote ?? ""}
                                      onChange={e => updateRunMeta(run.id, { gapNote: e.target.value || undefined })}
                                      placeholder="note…"
                                      className="w-24 text-[10px] bg-transparent border-b border-border/30 focus:border-primary/50 outline-none text-muted-foreground placeholder:text-muted-foreground/30 py-0.5 transition-colors"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                            {/* Run card */}
                            {isCurrentRun
                              ? <SummaryCard run={run} isCurrent onShowDetail={() => setIngredientDetailRunId(run.id)} />
                              : <SummaryCard run={run} readOnly={isUpcoming ? false : undefined} onShowDetail={() => setIngredientDetailRunId(run.id)} />
                            }
                          </div>
                        );
                      })}
                      {/* History — blank/unnamed placeholder runs (off-day
                          sign-ins) are filtered out, and days with nothing
                          meaningful are hidden entirely. */}
                      {(() => {
                        const displayHistory = filterMeaningfulHistory(history);
                        return displayHistory.length > 0 && (
                        <div className="space-y-3 pt-2 border-t border-border/30">
                          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                            <History className="w-4 h-4" />
                            History ({displayHistory.length} {displayHistory.length === 1 ? "day" : "days"})
                            {pendingHistoryUploads > 0 && (
                              <span className="text-xs font-normal text-amber-600">
                                {Math.min(pendingHistoryUploads, 99)}{pendingHistoryUploads > 99 ? "+" : ""} pending offline upload{pendingHistoryUploads === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                          {displayHistory.map((day: any) => {
                            const finishedRuns = day.runs.filter((r: any) => r.endedAt && r.startedAt);
                            const totalHistCases = finishedRuns.reduce((acc: any, r: any) => {
                              const vals = day.runValues[r.id] ?? DEFAULT_VALUES;
                              return acc + (r.actualCases ?? computeSummaryStats(vals as FormValues).totalCases);
                            }, 0);
                            const totalHistNetSec = finishedRuns.reduce((acc: any, r: any) => {
                              const gross = (r.endedAt! - r.startedAt!) / 1000;
                              const dt = (r.stoppages ?? []).filter((s: any) => s.endedAt && s.type !== "pause").reduce((a: any, s: any) => a + (s.endedAt! - s.startedAt) / 1000, 0);
                              return acc + Math.max(0, gross - dt);
                            }, 0);
                            const totalHistPizzas = finishedRuns.reduce((acc: any, r: any) => {
                              const vals = day.runValues[r.id] ?? DEFAULT_VALUES;
                              const cases = r.actualCases ?? computeSummaryStats(vals as FormValues).totalCases;
                              return acc + cases * ((vals as FormValues).pizzasPerCase ?? 0);
                            }, 0);
                            const histPpm = totalHistNetSec > 0 && totalHistPizzas > 0 ? Math.round(totalHistPizzas / (totalHistNetSec / 60)) : 0;
                            return (
                            <div key={day.date} className="rounded-lg border border-border/30 bg-card/30 overflow-hidden">
                              <button
                                type="button"
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-accent/20 transition-colors"
                                onClick={() => setExpandedHistoryDay(expandedHistoryDay === day.date ? null : day.date)}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold">{day.date}</span>
                                  <span className="text-xs text-muted-foreground">{day.runs.length} run{day.runs.length !== 1 ? "s" : ""} · {finishedRuns.length} finished</span>
                                  {totalHistCases > 0 && <span className="text-xs font-semibold text-foreground/70">{fmtComma(totalHistCases)} cases</span>}
                                  {histPpm > 0 && <span className="text-xs font-semibold text-primary/70">{histPpm} PPM</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); exportHistoryCSV(day); }}
                                    className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border border-border/40 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <Download className="w-3 h-3" /> CSV
                                  </button>
                                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expandedHistoryDay === day.date ? "rotate-180" : ""}`} />
                                </div>
                              </button>
                              {expandedHistoryDay === day.date && (
                                <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
                                  {day.runs.map((run: any) => (
                                    <div key={run.id} className="space-y-2">
                                      <SummaryCard
                                        run={run}
                                        readOnly
                                        runVals={day.runValues[run.id] as FormValues | undefined}
                                        onShowDetail={() => setIngredientDetailRunId(run.id)}
                                      />
                                      <ApplicatorEvidenceReview
                                        day={day}
                                        run={run}
                                        values={(day.runValues?.[run.id] ?? DEFAULT_VALUES) as FormValues}
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                          })}
                        </div>
                        );
                      })()}
                    </div>
                  );
                })()}
    {/* Ingredient Detail dialog — state lives here to survive parent re-renders */}
    {(() => {
      if (!ingredientDetailRunId) return null;
      // Find the run's values from today or history
      let detailRun: RunMeta | undefined;
      let detailVals: FormValues | undefined;
      const todayRun = dayState.runs.find((r: any) => r.id === ingredientDetailRunId);
      if (todayRun) {
        detailRun = todayRun;
        detailVals = todayRun.id === currentRun.id ? v : loadRunValues(todayRun.id);
      } else {
        for (const day of history) {
          if (day.runValues?.[ingredientDetailRunId]) {
            const hr = (day.runs as RunMeta[]).find((r: RunMeta) => r.id === ingredientDetailRunId);
            if (hr) { detailRun = hr; detailVals = day.runValues[ingredientDetailRunId] as FormValues; }
            break;
          }
        }
      }
      if (!detailRun || !detailVals) return null;
      // Ingredient Detail must use the same effective recipe as today's
      // consumption math. Apply the day-state overlay directly here instead
      // of relying on the module-level mirror effect: opening the dialog in
      // the same render as a substitution change must not show stale rows.
      // Historical runs are intentionally left untouched by today's overlay.
      const dv = withTodaySubstitutions(
        detailVals,
        Boolean(todayRun),
        dayState.substitutions,
      );
      const ds = computeSummaryStatsShared(dv, DEFAULT_PEP_TYPES);
      const ddrLbs = (dv.doughRecipe ?? []).reduce((acc: number, r: any) => acc + Number(r.lbs ?? 0), 0);
      const effYld = ddrLbs > 0 && dv.targetDoughballWeight > 0
        ? (ddrLbs * 16) / dv.targetDoughballWeight : dv.doughBatchYield;
      const dBatches = effYld > 0 && dv.targetDoughballWeight > 0 ? Math.ceil(ds.totalPizzas / effYld) : 0;
      const dName = (dv.doughRecipeName ?? "").trim() || "Dough";
      const pkgRows = aggregatePackagingNeeds([dv]);
      return (
        <Dialog open={!!ingredientDetailRunId} onOpenChange={open => { if (!open) setIngredientDetailRunId(null); }}>
          <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Ingredient Detail — {runLabel(detailRun)}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              {dBatches > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Dough</div>
                  <div className="flex justify-between py-0.5 font-medium">
                    <span>{dName}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtNum(dBatches, 2)} batches</span>
                  </div>
                  {(dv.doughRecipe ?? []).filter((r: any) => (r.ingredient ?? "").trim() && Number(r.lbs ?? 0) > 0).map((r: any, i: number) => (
                    <div key={i} className="flex justify-between py-0.5 pl-3 text-muted-foreground">
                      <span>{r.ingredient}</span>
                      <span className="tabular-nums">{fmtNum(Number(r.lbs) * dBatches, 1)} lbs</span>
                    </div>
                  ))}
                </div>
              )}
              {ds.sauceBatches > 0 && (() => {
                const sNm = (dv.frontlineRecipeName ?? "").trim() || "Sauce";
                const sRows = (dv.frontlineRecipe ?? []).filter((r: any) => (r.ingredient ?? "").trim() && Number(r.lbs ?? 0) > 0);
                return (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Sauce</div>
                    <div className="flex justify-between py-0.5 font-medium">
                      <span>{sNm}</span>
                      <span className="tabular-nums text-muted-foreground">{fmtNum(ds.sauceBatches, 2)} batches</span>
                    </div>
                    {sRows.map((r: any, i: number) => (
                      <div key={i} className="flex justify-between py-0.5 pl-3 text-muted-foreground">
                        <span>{r.ingredient}</span>
                          <span className="tabular-nums">{fmtNum(Number(r.lbs) * ds.sauceBatches, 1)} lbs</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                type AppBlock = {
                  key: string;
                  label: string;
                  value: string;
                  recipeName?: string;
                  ingredientRows?: { ingredient: string; lbs: number }[];
                };
                const appBlocks: AppBlock[] = [];
                const addAppBlock = (
                  type: string, lbs: number, batches: number, prefix: string,
                  recipeName?: string, recipe?: readonly any[]
                ) => {
                  if (!type) return;
                  const lower = type.trim().toLowerCase();
                  const isMix = lower.includes("mix");
                  const isCheese = lower.includes("cheese");
                  const blendName = (recipeName ?? "").trim();
                  if (isMix && lbs > 0) {
                    // Mix recipe rows store oz/pizza per component (despite the field name "lbs").
                    // rowTotal = (componentOzPerPizza / sumOzPerPizza) * totalRunLbs — mirrors MixRecipeCard.
                    const recipeRows = (recipe ?? []).filter((r: any) => (r.ingredient ?? "").trim() && Number(r.lbs ?? 0) > 0);
                    const sumOz = recipeRows.reduce((acc: number, r: any) => acc + Number(r.lbs), 0);
                    const ingRows = recipeRows.map((r: any) => ({
                      ingredient: (r.ingredient as string).trim(),
                      lbs: sumOz > 0 ? (Number(r.lbs) / sumOz) * lbs : 0,
                    })).filter((r: any) => r.lbs > 0);
                    appBlocks.push({
                      key: `${prefix}__${type}`,
                      label: `${prefix} — ${type}`,
                      value: fmtNum(lbs, 1) + " lbs",
                      recipeName: blendName || undefined,
                      ingredientRows: ingRows.length > 0 ? ingRows : undefined,
                    });
                  } else if (isCheese && batches > 0) {
                    // Use computeCheesePull so fractional batches get the same
                    // Math.max(1, batches) floor that the Cheese Blend card applies.
                    const pull = computeCheesePull(recipe as any, batches);
                    const ingRows = pull.rows
                      .filter((r: any) => (r.ingredient ?? "").trim() && r.lbs > 0)
                      .map((r: any) => ({ ingredient: (r.ingredient as string).trim(), lbs: r.lbs }));
                    appBlocks.push({
                      key: `${prefix}__${type}`,
                      label: `${prefix} — ${type}`,
                      value: fmtNum(batches, 2) + " batches",
                      recipeName: blendName || undefined,
                      ingredientRows: ingRows.length > 0 ? ingRows : undefined,
                    });
                  } else if (!isMix && !isCheese && batches > 0) {
                    appBlocks.push({ key: `${prefix}__${type}`, label: `${prefix} — ${type}`, value: fmtNum(batches, 2) + " batches" });
                  }
                };
                addAppBlock(ds.app1Type, ds.app1Lbs, ds.app1Batches, "App 1", dv.app1CheeseRecipeName, dv.app1CheeseRecipe);
                addAppBlock(ds.app2Type, ds.app2Lbs, ds.app2Batches, "App 2", dv.app2CheeseRecipeName, dv.app2CheeseRecipe);
                const pepCL = dv.pep1Combined === true ? "1 & 2" : "1";
                if (ds.pep1Type && ds.pep1Lbs > 0) appBlocks.push({ key: `pep1__${ds.pep1Type}`, label: `Pep ${pepCL} — ${ds.pep1Type}`, value: DEFAULT_PEP_TYPES.includes(ds.pep1Type) ? fmtNum(ds.pep1Lbs, 2) + " lbs" : fmtNum(ds.pep1Batches, 2) + " batches" });
                if (ds.pep1TypeB && ds.pep1LbsB > 0) appBlocks.push({ key: `pep1b__${ds.pep1TypeB}`, label: `Pep ${pepCL} — ${ds.pep1TypeB}`, value: DEFAULT_PEP_TYPES.includes(ds.pep1TypeB) ? fmtNum(ds.pep1LbsB, 2) + " lbs" : fmtNum(ds.pep1BatchesB, 2) + " batches" });
                if (dv.pep1Combined !== true && ds.pep2Type && ds.pep2Lbs > 0) appBlocks.push({ key: `pep2__${ds.pep2Type}`, label: `Pep 2 — ${ds.pep2Type}`, value: DEFAULT_PEP_TYPES.includes(ds.pep2Type) ? fmtNum(ds.pep2Lbs, 2) + " lbs" : fmtNum(ds.pep2Batches, 2) + " batches" });
                if (dv.pep1Combined !== true && ds.pep2TypeB && ds.pep2LbsB > 0) appBlocks.push({ key: `pep2b__${ds.pep2TypeB}`, label: `Pep 2 — ${ds.pep2TypeB}`, value: DEFAULT_PEP_TYPES.includes(ds.pep2TypeB) ? fmtNum(ds.pep2LbsB, 2) + " lbs" : fmtNum(ds.pep2BatchesB, 2) + " batches" });
                addAppBlock(ds.app3Type, ds.app3Lbs, ds.app3Batches, "App 3", dv.app3CheeseRecipeName, dv.app3CheeseRecipe);
                addAppBlock(ds.app4Type, ds.app4Lbs, ds.app4Batches, "App 4", dv.app4CheeseRecipeName, dv.app4CheeseRecipe);
                if (appBlocks.length === 0) return null;
                return (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Applicators</div>
                    {appBlocks.map((b) => (
                      <div key={b.key} className="mb-1">
                        <div className="flex justify-between py-0.5">
                          <span className="text-muted-foreground">{b.label}</span>
                          <span className="tabular-nums font-medium">{b.value}</span>
                        </div>
                        {b.recipeName && (
                          <div className="pl-3 text-xs text-foreground/70 font-medium py-0.5">{b.recipeName}</div>
                        )}
                        {b.ingredientRows && b.ingredientRows.map((r, i) => (
                          <div key={i} className="flex justify-between py-0.5 pl-5 text-muted-foreground">
                            <span>{r.ingredient}</span>
                            <span className="tabular-nums">{fmtNum(r.lbs, 1)} lbs</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {pkgRows.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Packaging</div>
                  {pkgRows.map((r, i) => (
                    <div key={i} className="flex justify-between py-0.5">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="tabular-nums font-medium">{r.value} <span className="text-muted-foreground font-normal">{r.sub}</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      );
    })()}
    </>
  );
});
