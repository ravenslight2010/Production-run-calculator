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
export const LiveRunTabContent = memo(function LiveRunTabContent() {
  const hx = useHomeCtx();
  const doughLock = useManualControlLock(hx.currentRun?.id, "dough-trays");
  const packagingLock = useManualControlLock(hx.currentRun?.id, "packaging-skids");
  const {
    ackKey, activeStopId, addBrand, addFlavor, addRun, allergenWarnings,
    autoSuppressUntilRef, blankRunIds, blockingViolations, brandFlavors,
    brandInput, brandScrollKeep, brands, checklistAcks, checklistSatisfied,
    confirmDeleteBrand, confirmDeleteBrandRef, confirmDeleteFlavor,
    confirmDeleteFlavorRef, confirmRemoveBlanks, confirmRemoveRun,
    currentRun, customAllergens, dayState, dieLineDefaultOverrides, dieTypes,
    doughSubTab, endRun, endStop, flavorInput, flavorScrollKeep, form,
    initialFinishTimestampRef, isSupervisor, lastEndedRun, lastRunRecall,
    logStop, nextRunDieType, openSetupEditor, pauseRun, removeBlankRuns, removeBrand,
    removeFlavor, removeRun, pauseDecisionRunId, pendingForegroundStopRunId, resumeRun, ruleViolations,
    runStatus, setBrandInput, setConfirmDeleteBrand, setConfirmDeleteFlavor,
    setConfirmRemoveBlanks, setConfirmRemoveRun, setDayState, setDoughSubTab,
    setFlavorInput, setManageCategory, setManageInput, setPinChangeMsg,
    setPauseDecisionRunId, setPauseTunnelPolicy, setRunBrandFlavor, setShowBrandDrop, setShowFlavorDrop,
    setShowGlance, setShowManageDialog, setShowReorderDialog, setShowStopDialog,
    setStopNotes, setStopReason, showBrandDrop, showFlavorDrop, startRun, swipeCue,
    switchToRun, toggleAck, upcomingRunLabels, v, ve,
  } = hx;

  const {
    calc, nowTime, liveFreezerMin, elapsedBatchSec, linePhases, currentRunDowntimeMs,
    casesPct, casesFreezerPct, casesPctWithFreezer,
    currentBatchNum, secUntilNextBatch, totalBatchesNeeded,
    showBatchDue, setShowBatchDue,
    autoTrackProgress, setAutoTrackProgress, autoTrackSuggestion,
    fireAutoTrackNow, tickDueRefs, packagingDrainActive,
    stallPrompt, setStallPrompt, stallCheck,
    showPaceAlert, setShowPaceAlert, paceAlertMsg,
    operationalDisplayState, operationalSnapshotReceipt,
  } = useLiveRun();
  const [showLineMap, setShowLineMap] = useState(false);
  useAutomaticUpdateReloadBlocker(
    "live-run-operational-alert",
    Boolean(stallPrompt || showPaceAlert || showBatchDue),
  );

  // Confirm before starting a run that is not the next unstarted run in the
  // schedule, so an accidental tap on the wrong run can be caught before it
  // stamps a start time and forces a redo.
  //
  // Only named runs (brand or flavor set) count as "pending" for the purposes
  // of the check — blank placeholder runs have no meaningful order and should
  // not trigger a false-positive warning.
  function handleStartRun() {
    const readiness = getStartRunReadiness(v);
    if (!readiness.ready) {
      toast({
        title: "Run not ready — Pizzas Per Case is missing",
        description:
          "Enter a positive Pizzas Per Case value in this product's setup before starting a run that requests cases.",
        variant: "destructive",
      });
      openSetupEditor(currentRun?.brand || undefined, currentRun?.flavor || undefined);
      return;
    }
    const firstPendingIdx = dayState.runs.findIndex(
      (r: RunMeta) => !r.startedAt && (r.brand || r.flavor),
    );
    if (firstPendingIdx !== -1 && firstPendingIdx !== dayState.currentIndex) {
      const nextRun = dayState.runs[firstPendingIdx];
      const nextLabel =
        [nextRun.brand, nextRun.flavor].filter(Boolean).join(" – ") ||
        `Run ${firstPendingIdx + 1}`;
      const thisRun = dayState.runs[dayState.currentIndex];
      const thisLabel =
        [thisRun?.brand, thisRun?.flavor].filter(Boolean).join(" – ") ||
        `Run ${dayState.currentIndex + 1}`;
      if (
        !window.confirm(
          `"${nextLabel}" is next in the schedule.\n\nStart "${thisLabel}" out of order instead?`,
        )
      )
        return;
    }
    startRun();
  }

  return (
    <>
                <OperationalStateBadge
                  displayState={operationalDisplayState}
                  receipt={operationalSnapshotReceipt}
                />
                {/* ─── Line Map toggle ─── */}
                <div className="flex justify-end mb-1">
                  <button
                    type="button"
                    onClick={() => setShowLineMap(prev => !prev)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                      showLineMap
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted/60"
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Line Map</span>
                  </button>
                </div>
                {showLineMap && <LineMapDashboard />}
                {/* Blank-run sweep confirmation dialog */}
                {confirmRemoveBlanks && (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setConfirmRemoveBlanks(false)}>
                    <div className="bg-card border border-border rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
                      <h2 className="text-base font-bold">Remove {blankRunIds.length} blank run{blankRunIds.length > 1 ? "s" : ""}?</h2>
                      <p className="text-sm text-muted-foreground">
                        {blankRunIds.length > 1 ? "These runs have" : "This run has"} no brand, flavor, or data. Removing{" "}
                        {blankRunIds.length > 1 ? "them" : "it"} clears{" "}
                        {blankRunIds.length > 1 ? "them" : "it"} from all devices and can't be undone.
                      </p>
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setConfirmRemoveBlanks(false)} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/40 transition-colors">Cancel</button>
                        <button type="button" onClick={removeBlankRuns} className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors">Remove</button>
                      </div>
                    </div>
                  </div>
                )}
                {/* ─── Run cockpit — identity, status & KPIs (graduated ManagerHub mockup) ─── */}
                <div className="space-y-4 mb-4">
                  {/* Top bar: run position + last-run recall + run actions */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider bg-muted/40 px-2 py-1 rounded border border-border/50 w-fit">
                        Run {dayState.currentIndex + 1} of {dayState.runs.length}
                      </span>
            {lastRunRecall && (
              <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/70 -mt-1">
                <History className="w-3 h-3 shrink-0" />
                <span>
                  Last ran {lastRunRecall.date}
                  {lastRunRecall.actualCases != null && <span> · <span className="font-semibold text-muted-foreground">{fmtComma(lastRunRecall.actualCases)} cases</span></span>}
                  {lastRunRecall.casesNeeded != null && lastRunRecall.actualCases == null && <span> · <span className="font-semibold text-muted-foreground">{fmtComma(lastRunRecall.casesNeeded)} planned</span></span>}
                  {lastRunRecall.wasteLbs != null && lastRunRecall.wasteLbs > 0 && <span> · <span className="text-amber-400/80">{fmtNum(lastRunRecall.wasteLbs, 1)} lbs waste</span></span>}
                </span>
              </div>
            )}
                    </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground tabular-nums">{dayState.runs.length}/{MAX_RUNS}</span>
                {dayState.runs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowReorderDialog(true)}
                    title="Reorder runs"
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </button>
                )}
                {(runStatus === "running" || runStatus === "paused") && (
                  <button
                    type="button"
                    onClick={() => setShowGlance(true)}
                    title="Glance view — large numbers for distance viewing"
                    className="h-6 w-6 flex items-center justify-center rounded border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                )}
                {isSupervisor && blankRunIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveBlanks(true)}
                    title={`Remove ${blankRunIds.length} blank run${blankRunIds.length > 1 ? "s" : ""}`}
                    className="h-6 flex items-center gap-1 text-xs font-bold text-destructive/70 bg-destructive/10 px-2 rounded border border-destructive/20 hover:bg-destructive/20 transition-colors"
                  >
                    <Eraser className="w-3 h-3" />
                    <span className="hidden sm:inline">{blankRunIds.length} Blank</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={addRun}
                  disabled={dayState.runs.length >= MAX_RUNS}
                  className="h-6 flex items-center gap-1 text-xs font-bold text-amber-500 bg-amber-500/10 px-2 rounded border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Plus className="w-3 h-3" />
                  <span className="hidden sm:inline">New Run</span>
                </button>
              </div>
                  </div>

                  {/* Run setup — brand / flavor / target cases */}
                  <div className="rounded-xl border-2 border-border/70 bg-card p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1">Run Setup <Pencil className="w-3 h-3 ml-1" /></div>
                      <div className="flex items-center gap-1.5">
              {v.dieType && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted/40 border border-border/50 text-muted-foreground tabular-nums">
                  {v.dieType}
                </span>
              )}
              {isAllergen(normalizeAllergen(v.allergen)) && (() => {
                const m = allergenMeta(normalizeAllergen(v.allergen));
                return (
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
                    style={{ backgroundColor: m.color, color: m.textColor }}
                  >
                    {m.label}
                  </span>
                );
              })()}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-stretch gap-3">
                      <div className="relative flex-1 min-w-[240px] bg-background/60 border border-border/60 rounded-lg p-2.5 pr-8">
                        <div className="text-[10px] text-muted-foreground uppercase font-medium mb-0.5">Brand &amp; Flavor</div>
                        <div className="flex items-center gap-1">
              <div className="relative">
                <div className="relative">
                  <input
                    value={showBrandDrop ? brandInput : (currentRun?.brand ?? "")}
                    placeholder="Brand…"
                    className="w-28 bg-transparent border-none text-base font-bold outline-none cursor-pointer p-0"
                    readOnly={!showBrandDrop}
                    onClick={() => {
                      setBrandInput(currentRun?.brand ?? "");
                      setShowBrandDrop(true);
                      setShowFlavorDrop(false);
                    }}
                    onChange={(e: any) => setBrandInput(e.target.value)}
                    onKeyDown={(e: any) => {
                      if (e.key === "Enter") {
                        const b = addBrand(brandInput);
                        setRunBrandFlavor(b, currentRun?.flavor ?? "");
                        setShowBrandDrop(false);
                      }
                      if (e.key === "Escape") setShowBrandDrop(false);
                    }}
                    onBlur={() => setTimeout(() => { if (!confirmDeleteBrandRef.current) setShowBrandDrop(false); }, 150)}
                  />
                  {showBrandDrop && (
                    <div ref={brandScrollKeep.listRef} onScroll={brandScrollKeep.onScroll} className="absolute z-50 top-full mt-1 left-0 w-44 bg-popover border border-border rounded-md shadow-lg py-1 max-h-52 overflow-y-auto overscroll-contain">
                      {brands
                        .filter((b: any) => b.toLowerCase().includes(brandInput.toLowerCase()))
                        .map((b: any) =>
                          confirmDeleteBrand === b ? (
                            <div key={b} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                              <span className="text-[10px] text-destructive font-semibold truncate">Remove "{b}"?</span>
                              <span className="flex gap-1 shrink-0">
                                <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { removeBrand(b); confirmDeleteBrandRef.current = null; setConfirmDeleteBrand(null); setShowBrandDrop(false); }}>Yes</button>
                                <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteBrandRef.current = null; setConfirmDeleteBrand(null); }}>No</button>
                              </span>
                            </div>
                          ) : (
                            <div key={b} className="flex items-center">
                              <button
                                type="button"
                                className={`flex-1 min-w-0 truncate text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${currentRun?.brand === b ? "text-primary font-semibold" : ""}`}
                                onMouseDown={() => { setRunBrandFlavor(b, currentRun?.flavor ?? ""); setShowBrandDrop(false); }}
                              >
                                {b}
                              </button>
                              <button
                                type="button"
                                tabIndex={-1}
                                className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                                onMouseDown={e => { e.stopPropagation(); confirmDeleteBrandRef.current = b; setConfirmDeleteBrand(b); }}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )
                        )}
                      {brandInput.trim() && !brands.includes(brandInput.trim()) && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm text-primary hover:bg-muted transition-colors flex items-center gap-1"
                          onMouseDown={() => {
                            const b = addBrand(brandInput);
                            setRunBrandFlavor(b, currentRun?.flavor ?? "");
                            setShowBrandDrop(false);
                          }}
                        >
                          <Plus className="w-3 h-3 shrink-0" /> <span className="min-w-0 truncate">Add "{brandInput.trim()}"</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
                        <span className="text-primary font-bold text-base mx-1">—</span>
              <div className="relative">
                <div className="relative">
                  <input
                    value={showFlavorDrop ? flavorInput : (currentRun?.flavor ?? "")}
                    placeholder="Flavor…"
                    className="w-28 bg-transparent border-none text-base font-bold outline-none cursor-pointer p-0"
                    readOnly={!showFlavorDrop}
                    onClick={() => {
                      setFlavorInput(currentRun?.flavor ?? "");
                      setShowFlavorDrop(true);
                      setShowBrandDrop(false);
                    }}
                    onChange={(e: any) => setFlavorInput(e.target.value)}
                    onKeyDown={(e: any) => {
                      if (e.key === "Enter") {
                        const f = addFlavor(flavorInput);
                        setRunBrandFlavor(currentRun?.brand ?? "", f);
                        setShowFlavorDrop(false);
                      }
                      if (e.key === "Escape") setShowFlavorDrop(false);
                    }}
                    onBlur={() => setTimeout(() => { if (!confirmDeleteFlavorRef.current) setShowFlavorDrop(false); }, 150)}
                  />
                  {showFlavorDrop && (
                    <div ref={flavorScrollKeep.listRef} onScroll={flavorScrollKeep.onScroll} className="absolute z-50 top-full mt-1 left-0 w-44 bg-popover border border-border rounded-md shadow-lg py-1 max-h-52 overflow-y-auto overscroll-contain">
                      {!(currentRun?.brand) && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">Pick a brand first</p>
                      )}
                      {(brandFlavors[currentRun?.brand ?? ""] ?? [])
                        .filter((f: any) => f.toLowerCase().includes(flavorInput.toLowerCase()))
                        .map((f: any) =>
                          confirmDeleteFlavor === f ? (
                            <div key={f} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                              <span className="text-[10px] text-destructive font-semibold truncate">Remove "{f}"?</span>
                              <span className="flex gap-1 shrink-0">
                                <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { removeFlavor(f); confirmDeleteFlavorRef.current = null; setConfirmDeleteFlavor(null); setShowFlavorDrop(false); }}>Yes</button>
                                <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteFlavorRef.current = null; setConfirmDeleteFlavor(null); }}>No</button>
                              </span>
                            </div>
                          ) : (
                            <div key={f} className="flex items-center">
                              <button
                                type="button"
                                className={`flex-1 min-w-0 truncate text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${currentRun?.flavor === f ? "text-primary font-semibold" : ""}`}
                                onMouseDown={() => { setRunBrandFlavor(currentRun?.brand ?? "", f); setShowFlavorDrop(false); }}
                              >
                                {f}
                              </button>
                              <button
                                type="button"
                                tabIndex={-1}
                                className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                                onMouseDown={e => { e.stopPropagation(); confirmDeleteFlavorRef.current = f; setConfirmDeleteFlavor(f); }}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )
                        )}
                      {currentRun?.brand && flavorInput.trim() && !(brandFlavors[currentRun.brand] ?? []).includes(flavorInput.trim()) && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm text-primary hover:bg-muted transition-colors flex items-center gap-1"
                          onMouseDown={() => {
                            const f = addFlavor(flavorInput);
                            setRunBrandFlavor(currentRun?.brand ?? "", f);
                            setShowFlavorDrop(false);
                          }}
                        >
                          <Plus className="w-3 h-3 shrink-0" /> <span className="min-w-0 truncate">Add "{flavorInput.trim()}"</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
                      </div>
                        <ChevronDown className="w-4 h-4 text-muted-foreground/50 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                      <div className="w-32 bg-background/60 border border-border/60 rounded-lg p-2.5">
              <div className="flex items-start justify-between gap-1 mb-0.5">
                <label className="text-[10px] text-muted-foreground uppercase font-medium">Target Cases</label>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              </div>
              <input
                type="number"
                min="0"
                step="1"
                data-testid="input-casesNeeded"
                value={v.casesNeeded === 0 ? "" : v.casesNeeded}
                onChange={e => form.setValue("casesNeeded", Number(e.target.value) || 0, { shouldDirty: true })}
                placeholder="0"
                className="w-full bg-transparent border-none p-0 text-lg font-black tabular-nums outline-none"
              />
              {Number(v.casesNeeded) === 0 && (
                <p className="mt-1 text-[10px] font-medium text-amber-400 flex items-center gap-1">
                  <span>⚠</span> Enter cases to enable calculations
                </p>
              )}
                      </div>
                    </div>
                  </div>

                  {/* Status controls — big touch targets */}
                  {runStatus === "pending" && (
                    <button
                      type="button"
                      onClick={handleStartRun}
                      disabled={blockingViolations.length > 0}
                      title={
                        blockingViolations.length > 0
                          ? `Blocked by production rule${blockingViolations.length > 1 ? "s" : ""}: ${blockingViolations.map((x: any) => x.name).join(", ")}`
                          : undefined
                      }
                      data-testid="button-start-run"
                      className="w-full bg-green-600 hover:bg-green-500 text-white font-black text-lg py-5 rounded-xl flex items-center justify-center gap-3 shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-600"
                    >
                      <Play className="w-6 h-6 fill-current" /> START RUN
                    </button>
                  )}
                  {runStatus === "running" && (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={pauseRun}
                        className="bg-amber-600 hover:bg-amber-500 text-white font-black text-base sm:text-lg py-5 rounded-xl flex items-center justify-center gap-2.5 shadow-lg transition-colors active:translate-y-0.5"
                      >
                        <Pause className="w-5 h-5 fill-current" /> PAUSE RUN
                      </button>
                      <button
                        type="button"
                        onClick={() => endRun()}
                        disabled={pendingForegroundStopRunId === currentRun?.id}
                        className="bg-red-700 hover:bg-red-600 text-white font-black text-base sm:text-lg py-5 rounded-xl flex items-center justify-center gap-2.5 shadow-lg transition-colors active:translate-y-0.5"
                      >
                        <Square className="w-5 h-5 fill-current" /> {pendingForegroundStopRunId === currentRun?.id ? "STOP REQUESTED" : "STOP RUN"}
                      </button>
                      {activeStopId ? (
                        <button
                          type="button"
                          onClick={endStop}
                          className="col-span-2 bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors animate-pulse"
                        >
                          <CircleDot className="w-4 h-4" /> END STOP
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid="button-log-stoppage"
                          onClick={() => { setStopReason(""); setStopNotes(""); setShowStopDialog(true); }}
                          className="col-span-2 border border-orange-700/60 text-orange-400 hover:bg-orange-950/40 font-bold text-sm py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
                        >
                          <OctagonX className="w-4 h-4" /> LOG STOPPAGE
                        </button>
                      )}
                    </div>
                  )}
                  {runStatus === "running" && currentRun?.startedAt ? (
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <div className="bg-card px-3 py-1.5 rounded-full border border-border/50 text-xs text-muted-foreground font-medium">
                        Elapsed Time:{" "}
                        <ElapsedTimeBadge
                          data-testid="elapsed-card-value"
                          className="text-foreground font-bold tabular-nums"
                          nowMs={nowTime.getTime()}
                          startedAt={currentRun.startedAt}
                          pausedAt={currentRun.pausedAt ?? null}
                        />
                      </div>
                      {(() => {
                        const casePeriodSec = calc.ppm > 0 && v.pizzasPerCase > 0 ? (v.pizzasPerCase / calc.ppm) * 60 : 0;
                        const suppressed = Date.now() < autoSuppressUntilRef.current;
                        const caseAutoActive = autoTrackProgress && !!autoTrackSuggestion && !suppressed &&
                          (runStatus === "running" || packagingDrainActive);
                        if (!caseAutoActive || casePeriodSec <= 0) return null;
                        const nowMs = nowTime.getTime();
                        const secLeft = tickDueRefs.case.current > 0
                          ? Math.min(casePeriodSec, Math.max(0, (tickDueRefs.case.current - nowMs) / 1000))
                          : casePeriodSec;
                        return (
                          <div className="bg-card px-3 py-1.5 rounded-full border border-orange-500/30 text-xs text-muted-foreground font-medium">
                            Next case in{" "}
                            <span className="text-orange-400 font-bold tabular-nums">{fmtMS(secLeft)}</span>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}
                  {runStatus === "paused" && (
                    <>
                      {pauseDecisionRunId === currentRun?.id && currentRun?.pausedAt && (
                        <PauseTunnelDecision
                          pausedAt={currentRun.pausedAt}
                          onChoose={setPauseTunnelPolicy}
                          onDismiss={() => setPauseDecisionRunId(null)}
                        />
                      )}
                      <button
                        type="button"
                        data-testid="resume-run"
                        onClick={resumeRun}
                        className="w-full bg-green-600 hover:bg-green-500 text-white font-black text-lg py-5 rounded-xl flex items-center justify-center gap-3 shadow-lg transition-colors"
                      >
                        <Play className="w-6 h-6 fill-current" /> RESUME RUN
                      </button>
                    </>
                  )}
                  {runStatus === "ended" && (
                    <div className="flex items-center justify-center py-1">
              {runStatus === "ended" && (() => {
                const freezerMin2 = Number(ve.freezerTime) || 0;
                const preTun2 = Number(ve.preTunnelMin) > 0 ? Number(ve.preTunnelMin) : PRE_POST_TUNNEL_DEFAULT_MIN;
                const postTun2 = Number(ve.postTunnelMin) > 0 ? Number(ve.postTunnelMin) : PRE_POST_TUNNEL_DEFAULT_MIN;
                const refEndedAt = lastEndedRun?.endedAt;
                const nowMs2 = nowTime.getTime();
                if (!refEndedAt || freezerMin2 <= 0) return (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                    Ended
                  </span>
                );
                // Compute actual virtual (pause-excluded) elapsed for the ended run.
                // computeEndedRunElapsedSec caps open/unclosed pause stoppages at
                // endedAt so auto-ended paused runs don't count the pause as production.
                const endedElapsedSec = computeEndedRunElapsedSec({
                  startedAt: lastEndedRun.startedAt,
                  endedAt: refEndedAt,
                  stoppages: lastEndedRun.stoppages,
                });
                const phases2 = lastEndedRun?.id === currentRun?.id
                  ? linePhases
                  : computeLinePhases({
                      elapsedBatchSec: endedElapsedSec,
                      pausedAt: null,
                      lastResumeWallMs: 0,
                      lastPauseStartWallMs: 0,
                      pauseStopsTunnel: true,
                      lastPauseStopsTunnel: true,
                      runStatus: "ended",
                      preTunnelMin: preTun2,
                      postTunnelMin: postTun2,
                      freezerTime: freezerMin2,
                      nowMs: nowMs2,
                      endedAt: refEndedAt,
                    });
                const activePhase = pickMostActivePhase(phases2);
                if (!activePhase) return (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                    Ended · Freeze tunnel clear
                  </span>
                );
                const mm2 = Math.floor(activePhase.remainMs / 60000);
                const ss2 = Math.floor((activePhase.remainMs % 60000) / 1000);
                return (
                  <span className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    {activePhase.label} draining{activePhase.remainMs > 0 ? ` · ${fmtCountdownParts(mm2, ss2)}` : ""}
                  </span>
                );
              })()}
                    </div>
                  )}
            {/* Auto-detected stall nudge (advisory — never writes on its own) */}
            {stallPrompt && (
              <div className="flex flex-wrap items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-semibold bg-amber-950/40 border border-amber-700/30 text-amber-400" data-testid="stall-banner">
                <span>⚠ Line looks stalled — about {fmtMins(stallCheck.behindMinutes)} behind with no stoppage logged</span>
                <button
                  type="button"
                  data-testid="button-stall-log"
                  className="px-2.5 py-1 rounded-md bg-amber-500 text-black font-bold hover-elevate active-elevate-2"
                  onClick={() => { logStop("Auto-detected stall", ""); setStallPrompt(false); }}
                >
                  Log stoppage
                </button>
                <button
                  type="button"
                  data-testid="button-stall-dismiss"
                  className="px-2.5 py-1 rounded-md border border-amber-700/40 hover-elevate"
                  onClick={() => setStallPrompt(false)}
                >
                  Dismiss
                </button>
              </div>
            )}
            {showPaceAlert && currentRun?.id && (
              <BehindPaceAlertBanner
                runId={currentRun.id}
                message={paceAlertMsg}
                onDismiss={() => setShowPaceAlert(false)}
              />
            )}
                  {/* 3-phase line status — filling at run start, draining only after
                      a persisted pause or stop.
                      Auto-hidden when all stages are in steady-state active. */}
                  {!currentRun?.endedAt && (runStatus === "running" || runStatus === "paused") && (() => {
                    const freezerMin = Number(ve.freezerTime) || 0;
                    if (freezerMin <= 0) return null;
                    if (calc.ppm <= 0 && runStatus === "running") return null;
                    // Thin display of the server-adopted context model (the
                    // context falls back locally when offline/lagging).
                    const phases = linePhases;
                    const rows = [phases.stage1, phases.stage2, phases.stage3] as PhaseInfo[];
                    // Hide the strip entirely when everything is in steady-state or empty.
                    const anyVisible = rows.some(r => r.state !== "active" && r.state !== "empty");
                    if (!anyVisible) return null;
                    function phaseRowStyle(state: PhaseInfo["state"]) {
                      if (state === "filling" || state === "resuming") return { text: "text-sky-400", dot: "bg-sky-400", badge: "bg-sky-950/40 border-sky-700/30" };
                      if (state === "draining") return { text: "text-amber-400", dot: "bg-amber-400 animate-pulse", badge: "bg-amber-950/40 border-amber-700/30" };
                      if (state === "paused") return { text: "text-muted-foreground", dot: "bg-muted-foreground", badge: "bg-muted/20 border-border/30" };
                      return { text: "text-muted-foreground", dot: "bg-muted-foreground/40", badge: "bg-muted/10 border-border/20" };
                    }
                    function phaseLabel(phase: PhaseInfo): string {
                      const mm = Math.floor(phase.remainMs / 60000);
                      const ss = Math.floor((phase.remainMs % 60000) / 1000);
                      const t = fmtCountdownParts(mm, ss);
                      if (phase.state === "filling") return `${phase.label} — filling → ${t}`;
                      if (phase.state === "draining") return phase.remainMs > 0 ? `${phase.label} — draining → ${t}` : `${phase.label} — draining`;
                      if (phase.state === "resuming") return `${phase.label} — product arriving in ${t}`;
                      if (phase.state === "paused") return `${phase.label} — stopped`;
                      return phase.label;
                    }
                    return (
                      <div className="mb-4 rounded-lg border border-border/40 bg-card/60 overflow-hidden divide-y divide-border/20">
                        {rows.filter(r => r.state !== "empty").map((phase, i) => {
                          const s = phaseRowStyle(phase.state);
                          return (
                            <div key={i} className={`flex items-center gap-2.5 px-4 py-2.5 ${s.badge}`}>
                              <span className={`h-2 w-2 rounded-full shrink-0 ${s.dot}`} />
                              <span className={`text-xs font-semibold ${s.text}`}>{phaseLabel(phase)}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* KPI tiles — completion, pace, estimated finish */}
                  {(v.casesNeeded > 0 || calc.paceStatus !== null || ((runStatus === "running" || runStatus === "paused") && calc.totalTimeSec > 0)) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {v.casesNeeded > 0 && (
                        <div className="rounded-xl border border-border/60 bg-card/60 p-5 flex flex-col items-center justify-center relative overflow-hidden shadow-lg">
                          <div className="absolute top-3 left-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Completion</div>
                          <div className="absolute top-3 right-3 flex items-center gap-1.5">
                            {runStatus === "running" ? (
                              <>
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                                </span>
                                <span className="text-xs font-bold text-emerald-500 uppercase tracking-wide">Running</span>
                              </>
                            ) : runStatus === "paused" ? (
                              <>
                                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                                <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">Paused</span>
                              </>
                            ) : runStatus === "ended" ? (
                              <>
                                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />
                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Ended</span>
                              </>
                            ) : (
                              <>
                                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />
                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Not started</span>
                              </>
                            )}
                          </div>
                          <div className="mt-7 mb-2 text-6xl font-black text-foreground tabular-nums tracking-tighter" data-testid="tile-cases-completed">
                            {fmtComma(calc.casesCompleted)}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap justify-center">
                            {calc.casesCompleted >= v.casesNeeded ? (
                              <div className="text-sm font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4" /> Target reached!
                              </div>
                            ) : (
                              <div className="text-sm font-bold text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20 tabular-nums">
                                {Math.round(Math.min(100, (calc.casesCompleted / v.casesNeeded) * 100))}% Done
                              </div>
                            )}
                            {calc.casesInFreezer > 0 && (
                              <div className="text-sm font-bold text-sky-400 bg-sky-500/10 px-3 py-1 rounded-full border border-sky-500/30 tabular-nums" data-testid="tile-cases-in-freezer">
                                +{fmtComma(calc.casesInFreezer)} in Freeze tunnel
                              </div>
                            )}
                          </div>
                          <div className="w-full h-3.5 rounded-full mt-5 bg-muted/30 border border-border/40 overflow-hidden shadow-inner flex">
                            <div
                              className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-500"
                              style={{ width: `${casesPct * 100}%` }}
                            />
                            {casesFreezerPct > 0 && (
                              <div
                                className="h-full bg-sky-400/40 transition-all duration-500"
                                style={{ width: `${casesFreezerPct * 100}%` }}
                              />
                            )}
                          </div>
                          <div className="w-full flex justify-between mt-2 text-xs text-muted-foreground font-medium tabular-nums">
                            <span>0</span>
                            <span>{fmtComma(Math.max(0, v.casesNeeded - calc.casesCompleted))} left</span>
                            <span>{fmtComma(v.casesNeeded)}</span>
                          </div>
                        </div>
                      )}
                      {(calc.paceStatus !== null || ((runStatus === "running" || runStatus === "paused") && calc.totalTimeSec > 0)) && (
                        <div className="flex flex-col gap-4">
                          {calc.paceStatus !== null && (
                            <div className="rounded-xl border border-border/60 bg-card/60 p-4 flex-1 flex flex-col justify-center shadow-lg">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pace</span>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded border tabular-nums ${
                                  calc.paceStatus === "behind"
                                    ? "text-red-400 bg-red-400/10 border-red-400/20"
                                    : "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                                }`}>
                                  {calc.paceStatus === "on-pace" ? "On Pace" : calc.paceStatus === "ahead" ? `${calc.paceDelta} cases ahead` : `${Math.abs(calc.paceDelta)} cases behind`}
                                </span>
                              </div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-black text-foreground tabular-nums tracking-tight">{calc.ppm}</span>
                                <span className="text-sm text-muted-foreground font-bold uppercase">PPM</span>
                              </div>
                              {calc.catchUpPpm !== null && (
                                <div className="text-xs font-medium text-muted-foreground mt-2">
                                  Need <strong className="text-amber-500">{calc.catchUpPpm} PPM</strong> to finish on time
                                </div>
                              )}
                              {(() => {
                                const dtSec = (currentRun?.stoppages ?? []).filter((s: any) => s.endedAt && s.type !== "pause").reduce((a: any, s: any) => a + (s.endedAt! - s.startedAt) / 1000, 0);
                                return dtSec > 0 ? (
                                  <div className="text-xs font-medium text-muted-foreground mt-1 flex items-center gap-1.5">
                                    <Clock className="w-3 h-3" />
                                    {fmtTime(dtSec)} downtime
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          )}
                          {(runStatus === "running" || runStatus === "paused") && calc.totalTimeSec > 0 && (() => {
                            const projectedFinish = Date.now() + calc.totalTimeSec * 1000;
                            const driftMs = initialFinishTimestampRef.current > 0
                              ? projectedFinish - initialFinishTimestampRef.current
                              : 0;
                            const driftSec = driftMs / 1000;
                            const showDrift = Math.abs(driftSec) >= 30;
                            const ahead = driftSec < 0;
                            return (
                              <div className="rounded-xl border border-border/60 bg-card/60 p-4 flex-1 flex flex-col justify-center shadow-lg">
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Est. Finish</div>
                                <div className="flex items-baseline gap-2">
                                  <span className="text-3xl font-black text-foreground tabular-nums tracking-tight">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                                  <div className="text-sm font-medium text-foreground tabular-nums">{fmtTime(calc.adjustedTimeSec)} remaining</div>
                                  {v.casesNeeded > 0 && currentRun?.startedAt && !currentRun?.endedAt && (
                                    <div className="text-xs font-semibold text-foreground/80 tabular-nums" data-testid="text-press-cases-left">
                                      {fmtComma(Math.ceil(calc.pressCasesLeft))} cases left to press (packing + Freeze tunnel counted done)
                                    </div>
                                  )}
                                  {Number(ve.freezerTime) > 0 && (
                                    <div className="text-xs font-semibold text-sky-400 tabular-nums" data-testid="text-line-clear-time">
                                      Freeze tunnel clear ~{fmtClock(Date.now() + (calc.adjustedTimeSec + Number(ve.freezerTime) * 60) * 1000)}
                                    </div>
                                  )}
                                  {showDrift && (
                                    <div className={`text-xs font-bold border px-1.5 py-0.5 rounded tabular-nums ${
                                      ahead
                                        ? "text-emerald-400 border-emerald-400/20 bg-emerald-400/10"
                                        : "text-red-400 border-red-400/20 bg-red-400/10"
                                    }`}>
                                      {ahead ? "−" : "+"}{fmtMins(Math.max(1, Math.round(Math.abs(driftSec) / 60)))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Ended-run banner */}
                {currentRun?.endedAt && (() => {
                  const emptyMs = Number(ve.freezerTime) * 60000;
                  const remainMs = emptyMs > 0
                    ? Math.max(0, currentRun.endedAt + emptyMs - nowTime.getTime())
                    : 0;
                  const draining = remainMs > 0;
                  const mm = Math.floor(remainMs / 60000);
                  const ss = Math.floor((remainMs % 60000) / 1000);
                  const pct = emptyMs > 0 ? Math.max(0, 1 - remainMs / emptyMs) : 1;
                  return (
                    <div className="mb-4 rounded-lg border overflow-hidden">
                      <div className={`flex items-start gap-2.5 px-4 py-3 ${draining ? "bg-amber-950/30 border-amber-700/30" : "bg-emerald-950/40 border-emerald-700/30"}`}>
                        {draining
                          ? <Timer className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                          : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${draining ? "text-amber-400" : "text-emerald-400"}`}>
                            {draining
                              ? `Freeze tunnel draining — ${fmtCountdownParts(mm, ss)} remaining`
                              : emptyMs > 0 ? "Freeze tunnel empty — run complete." : "Run ended."}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Run stopped at {fmtClock(currentRun.endedAt)}{emptyMs > 0 ? ` · ${fmtMins(Number(ve.freezerTime))} Freeze tunnel time` : ""} — switch to another run to continue.
                          </p>
                          {v.dieType && nextRunDieType && v.dieType !== nextRunDieType && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Die change: <span className="font-bold">{v.dieType}</span> → <span className="font-bold">{nextRunDieType}</span>
                            </div>
                          )}
                          {emptyMs > 0 && (
                            <div className="mt-2 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-1000 ${draining ? "bg-amber-500" : "bg-emerald-500"}`}
                                style={{ width: `${pct * 100}%` }}
                              />
                            </div>
                          )}
                          {/* Auto-advance to next run */}
                          {!draining && dayState.runs[dayState.currentIndex + 1] && (
                            <button
                              type="button"
                              onClick={() => switchToRun(dayState.currentIndex + 1)}
                              className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                            >
                              Switch to {runLabel(dayState.runs[dayState.currentIndex + 1])} →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Missing-setup nudge — a running run with no line-speed /
                    case / Freeze tunnel numbers can't compute anything: the count,
                    timing, and tunnel status all silently sit at 0. Tell the
                    operator exactly which numbers are missing instead. */}
                {!currentRun?.endedAt && runStatus === "running" && (() => {
                  const missing: string[] = [];
                  if (calc.ppm <= 0) {
                    if (doughSubTab === "crusts") {
                      missing.push("Approximate Line Speed");
                    } else {
                      if (!(Number(ve.crustsPerCycle) > 0)) missing.push("Crusts Per Cycle");
                      if (!(Number(ve.cycleSpeed) > 0)) missing.push("Cycle Speed");
                      if (!(Number(v.speedAdjustment) > 0)) missing.push("Speed Adjustment");
                    }
                  }
                   const summary = computeSummaryStats(v);
                   if (!summary.productionNeedsAvailable) missing.push("Pizzas Per Case");
                  const freezerMissing = !(Number(ve.freezerTime) > 0);
                  if (missing.length === 0 && !freezerMissing) return null;
                   const frontlineNeedsBlocked = !summary.productionNeedsAvailable;
                  const headline = frontlineNeedsBlocked
                    ? "Frontline quantities can't be calculated — Pizzas Per Case is not set"
                    : missing.length > 0
                    ? `Counts can't track yet — ${[...missing, ...(freezerMissing ? ["Total line time"] : [])].join(", ")} not set`
                    : "Line phase status can't show yet — Total line time not set";
                  const detail = frontlineNeedsBlocked
                    ? "Open Setup Profiles for this product, enter Pizzas Per Case, and save the setup. Sauce, Frontline, warehouse pulls, and tracking stay unavailable until it is corrected."
                    : missing.length > 0
                    ? "Scroll down on this tab and fill in those numbers under the line settings. The completed count, timing, and line phase status all start working once they're in."
                    : "If this run uses a Freeze tunnel, scroll down and enter Freeze tunnel time (min) under the line settings to see the 3-stage filling/emptying status.";
                  return (
                    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5" data-testid="banner-missing-line-setup">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{headline}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Warehouse switchover staging — measured at the PRESS (cased
                    product + Freeze tunnel contents count as done): frontline must be
                    staged 2 skids before the switchover, packaging 1 skid
                    before. Short runs (< 2 skids total) show it from the start
                    and tell warehouse to stage 2+ runs ahead. Mirrors the
                    notifications in useNotifications. */}
                {!currentRun?.endedAt && runStatus === "running" && (() => {
                  const cps = Number(v.casesPerSkid) || 0;
                  const needed = Number(v.casesNeeded) || 0;
                  if (calc.ppm <= 0 || cps <= 0 || needed <= 0) return null;
                  const pressLeft = calc.pressCasesLeft;
                  if (pressLeft <= 0 || pressLeft > 2 * cps) return null;
                  const shortRun = needed < 2 * cps;
                  const packagingStage = pressLeft <= cps;
                  const skidsLeft = pressLeft / cps;
                  const names = upcomingRunLabels.slice(0, shortRun ? 3 : 1);
                  const freezerMin = Number(ve.freezerTime) || 0;
                  return (
                    <div className="mb-4 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-3 flex items-start gap-2.5" data-testid="banner-warehouse-switchover">
                      <Truck className="w-4 h-4 shrink-0 mt-0.5 text-violet-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-violet-600 dark:text-violet-400">
                          {shortRun
                            ? `Warehouse: short run (under 2 skids) — stage frontline + packaging for the next 2+ runs now`
                            : `Warehouse: ${fmtNum(skidsLeft, 1)} skid${skidsLeft === 1 ? "" : "s"} to switchover — stage ${packagingStage ? "packaging" : "frontline"} for the next run`}
                        </p>
                        {!shortRun && packagingStage && (
                          <p className="text-xs font-semibold text-violet-400/90 mt-0.5" data-testid="text-switchover-packaging-stage">
                            Under 1 skid left at the press — frontline should already be staged; packaging goes now.
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fmtComma(Math.ceil(pressLeft))} cases left at the press (packing + Freeze tunnel counted done)
                          {calc.adjustedTimeSec > 0 ? ` — press stops ~${fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}` : ""}
                          {freezerMin > 0 && calc.adjustedTimeSec > 0 ? `, line clear ~${fmtClock(Date.now() + (calc.adjustedTimeSec + freezerMin * 60) * 1000)}` : ""}.
                          {names.length > 0 ? ` Next up: ${names.join(", ")}.` : " No upcoming runs scheduled yet."}
                        </p>
                      </div>
                    </div>
                  );
                })()}


                {/* Die change warning — before run ends */}
                {(runStatus === "running" || runStatus === "paused") && v.dieType && nextRunDieType && v.dieType !== nextRunDieType && (
                  <div className="mb-4 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-amber-950/30 border border-amber-600/40">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-amber-400">Die change required for next run</p>
                      <p className="text-xs text-amber-300/80 mt-0.5">
                        Current: <span className="font-semibold">{v.dieType}</span>
                        {" → "}
                        Next: <span className="font-semibold">{nextRunDieType}</span>
                        {" — prepare changeover before ending this run."}
                      </p>
                    </div>
                  </div>
                )}


                {/* Carry-over surplus feature removed (user request 2026-07-10):
                    dough crew works ahead of the press on the NEXT run's dough,
                    so surplus-carry prompts don't match how the floor works.
                    The `carryOverDone` form field is kept for stored-data/sync
                    compatibility but is no longer surfaced. */}

                {/* Run Details (moved from Dough tab) — sub-view aware */}
                {doughSubTab === "crusts" ? (
                  <div className="rounded-xl border border-border/60 bg-card/60 shadow-md mt-4 overflow-hidden">
                    <div className="bg-muted/30 px-4 py-3 border-b border-border/60">
                      <span className="text-sm font-bold uppercase tracking-wider text-foreground">Line Details</span>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-y divide-border/60">
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Cases Left to Run</span>
                        <span className="text-sm font-bold text-foreground tabular-nums" data-testid="output-crust-cases-left">{fmtNum(Math.max(0, calc.casesLeftToRun), 0)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Total Time Left</span>
                        <span className="text-sm font-bold text-foreground tabular-nums">{fmtTime(calc.totalTimeSec)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Approx. Cases on Line</span>
                        <span className="text-sm font-bold text-foreground tabular-nums" data-testid="cases-on-line-value">{fmtNum(calc.casesOnLine, 0)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Cases on Last Skid</span>
                        <span className="text-sm font-bold text-foreground tabular-nums">{fmtNum(calc.casesOnLastSkid, 0)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2 col-span-2">
                        <span className="text-xs text-muted-foreground font-medium">Crust Supply</span>
                        {calc.doughShortCases > 0 ? (
                          <span className="text-sm font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">SHORT {fmtNum(calc.doughShortCases, 1)} cases</span>
                        ) : calc.buffer > 0 ? (
                          <span className="text-sm font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">+{fmtNum(calc.buffer, 1)} cases ahead</span>
                        ) : (
                          <span className="text-sm font-bold text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/50">Balanced</span>
                        )}
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Stacks Per Skid</span>
                        <span className="text-sm font-bold text-foreground tabular-nums">{fmtNum(calc.traysPerSkid, 2)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Time Per Stack</span>
                        <span className="text-sm font-bold text-foreground tabular-nums">{fmtTime(calc.timePerTraySec)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Time Per Skid</span>
                        <span className="text-sm font-bold text-foreground tabular-nums">{fmtTime(calc.timePerSkidSec)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">PPM</span>
                        <span className="text-sm font-bold text-foreground tabular-nums" data-testid="output-ppm-crust">{fmtNum(calc.ppm, 1)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-card/60 shadow-md mt-4 overflow-hidden">
                    <div className="bg-muted/30 px-4 py-3 border-b border-border/60">
                      <span className="text-sm font-bold uppercase tracking-wider text-foreground">Line Details</span>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-y divide-border/60">
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Cases Left to Run</span>
                        <span className="text-sm font-bold text-foreground tabular-nums" data-testid="output-dough-cases-left">{fmtNum(Math.max(0, calc.casesLeftToRun), 0)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Approx. Cases on Line</span>
                        <span className="text-sm font-bold text-foreground tabular-nums" data-testid="cases-on-line-value">{fmtNum(calc.casesOnLine, 0)}</span>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2 col-span-2" data-testid="output-dough-status">
                        <span className="text-xs text-muted-foreground font-medium">Dough Status</span>
                        {calc.doughShortCases > 0 ? (
                          <span className="text-sm font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">SHORT {fmtNum(calc.doughShortCases, 1)} cases</span>
                        ) : calc.buffer > 0 ? (
                          <span className="text-sm font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">+{fmtNum(calc.buffer, 1)} cases ahead</span>
                        ) : (
                          <span className="text-sm font-bold text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/50">Balanced</span>
                        )}
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2 col-span-2">
                        <span className="text-xs text-muted-foreground font-medium">Cases on Last Skid</span>
                        <span className="text-sm font-bold text-foreground tabular-nums" data-testid="output-last-skid-cases">{fmtNum(calc.casesOnLastSkid, 0)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Temporary adjustments — this-run-only overrides of Setup values
                    (moved here from the Packaging tab; tile style from the graduated ManagerHub mockup) */}
                <div className="mt-6 pt-4 border-t border-border/60 space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-bold text-foreground">Temporary Adjustments</h3>
                      {(Number(v.tempFreezerTime) > 0 || Number(v.tempCrustsPerCycle) > 0 || Number(v.tempCycleSpeed) > 0) && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-600/20 border border-amber-600/40 text-amber-400 text-[10px] font-bold uppercase">Override active</span>
                      )}
                    </div>
                    <button
                      type="button"
                      data-testid="button-clear-temp-overrides"
                      onClick={() => {
                        form.setValue("tempFreezerTime", 0, { shouldDirty: true });
                        form.setValue("tempCrustsPerCycle", 0, { shouldDirty: true });
                        form.setValue("tempCycleSpeed", 0, { shouldDirty: true });
                      }}
                      className="text-[10px] font-bold text-amber-500 uppercase tracking-wider bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { name: "tempFreezerTime" as const, label: "Freeze Tunnel Time", setup: Number(v.freezerTime) > 0 ? fmtNum(Number(v.freezerTime), 0) : null, step: "1", testId: "input-temp-freezer-time" },
                      { name: "tempCrustsPerCycle" as const, label: "Crusts/Cycle", setup: Number(v.crustsPerCycle) > 0 ? fmtNum(Number(v.crustsPerCycle), 0) : null, step: "1", testId: "input-temp-crusts-per-cycle" },
                      { name: "tempCycleSpeed" as const, label: "Cycle Speed", setup: Number(v.cycleSpeed) > 0 ? fmtNum(Number(v.cycleSpeed), 1) : null, step: "0.1", testId: "input-temp-cycle-speed" },
                    ]).map((t: any) => (
                      <FormField
                        key={t.name}
                        control={form.control}
                        name={t.name}
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <div className={`bg-background/60 border rounded-lg p-3 relative transition-colors focus-within:border-amber-500/50 ${Number(v[t.name]) > 0 ? "border-amber-600/40" : "border-border/60 hover:border-border"}`}>
                              {Number(v[t.name]) > 0 && (
                                <div className="absolute top-0 right-0 w-2 h-2 bg-amber-500 rounded-full -mt-1 -mr-1 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
                              )}
                              <div className="flex justify-between items-start mb-1 gap-1">
                                <FormLabel className="text-[10px] text-muted-foreground uppercase font-bold leading-tight">
                                  {t.label}{t.setup != null && <span className="normal-case font-medium text-muted-foreground/60"> · setup {t.setup}</span>}
                                </FormLabel>
                                <Pencil className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                              </div>
                              <FormControl>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step={t.step}
                                  data-testid={t.testId}
                                  className="w-full bg-transparent border-0 p-0 text-lg font-black text-foreground tabular-nums focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  {...field}
                                  value={field.value as any}
                                  onChange={(e: any) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                                  onFocus={(e: any) => e.target.select()}
                                />
                              </FormControl>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    For this run only — leave at 0 to use the Setup value. Setup stays unchanged.
                  </p>
                </div>

                {/* Run navigation — prev / dots / next (graduated mockup) */}
                {dayState.runs.length > 1 && (
                  <div className="mt-4 rounded-xl border border-border/50 bg-card/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
              {dayState.currentIndex > 0 ? (
                <button
                  type="button"
                  onClick={() => switchToRun(dayState.currentIndex - 1)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                  <div className="text-left min-w-0">
                    <div className="text-[8px] uppercase tracking-widest opacity-50 font-semibold leading-none mb-0.5">Prev</div>
                    <div className="font-medium text-xs truncate max-w-[90px]">{runLabel(dayState.runs[dayState.currentIndex - 1])}</div>
                  </div>
                </button>
              ) : (
                <div className="w-16" />
              )}
            {dayState.runs.length > 1 && (() => {
              const total = dayState.runs.length;
              const cur = dayState.currentIndex;
              const MAX_DOTS = 7;
              if (total <= MAX_DOTS) {
                return (
                  <div className="flex items-center justify-center gap-1.5 py-1 min-w-0">
                    {dayState.runs.map((_: any, i: any) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Select run ${i + 1}`}
                        onClick={() => switchToRun(i)}
                        className={`rounded-full transition-all shrink-0 min-w-4 min-h-4 ${i === cur ? `w-4 h-2 bg-primary ${swipeCue ? "ring-2 ring-primary/50 ring-offset-1 ring-offset-background scale-125" : ""}` : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
                      />
                    ))}
                  </div>
                );
              }
              const half = Math.floor(MAX_DOTS / 2);
              let start = Math.max(0, cur - half);
              const end = Math.min(total, start + MAX_DOTS);
              start = Math.max(0, end - MAX_DOTS);
              return (
                <div className="flex items-center justify-center gap-1 py-1 min-w-0">
                  {start > 0 && <span className="text-[9px] text-muted-foreground/50 leading-none">…</span>}
                  {Array.from({ length: end - start }, (_, j) => start + j).map((i: number) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Select run ${i + 1}`}
                      onClick={() => switchToRun(i)}
                      className={`rounded-full transition-all shrink-0 min-w-4 min-h-4 ${i === cur ? `w-4 h-2 bg-primary ${swipeCue ? "ring-2 ring-primary/50 ring-offset-1 ring-offset-background scale-125" : ""}` : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
                    />
                  ))}
                  {end < total && <span className="text-[9px] text-muted-foreground/50 leading-none">…</span>}
                </div>
              );
            })()}
              {dayState.currentIndex < dayState.runs.length - 1 ? (
                <button
                  type="button"
                  onClick={() => switchToRun(dayState.currentIndex + 1)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0"
                >
                  <div className="text-right min-w-0">
                    <div className="text-[8px] uppercase tracking-widest opacity-50 font-semibold leading-none mb-0.5">Next</div>
                    <div className="font-medium text-xs truncate max-w-[90px]">{runLabel(dayState.runs[dayState.currentIndex + 1])}</div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              ) : (
                <div className="w-16" />
              )}
                    </div>
                  </div>
                )}

                {/* Upcoming runs */}
                {(() => {
                  const upcoming = dayState.runs.slice(dayState.currentIndex + 1);
                  if (upcoming.length === 0) return null;
                  return (
                    <div className="mt-4 rounded-xl border border-border/40 bg-card/60 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Upcoming Runs</p>
                      <div className="space-y-2">
                        {upcoming.map((r: any, i: any) => {
                          const idx = dayState.currentIndex + 1 + i;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => switchToRun(idx)}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/50 transition-colors text-left"
                            >
                              <span className="text-sm font-medium text-foreground truncate">{runLabel(r)}</span>
                              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <details className="group rounded-xl border border-border/50 bg-card/60 shadow-md overflow-hidden mb-4">
                    <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer list-none select-none">
                      <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Settings className="w-3.5 h-3.5" />
                        Line Setup
                        {!isSupervisor && <Lock className="w-3.5 h-3.5 text-muted-foreground/50" />}
                      </span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <div className={`border-t border-border/40 px-5 pb-5 pt-4 space-y-3${!isSupervisor ? " opacity-60 pointer-events-none" : ""}`}>
                    <LineSetupRoleGate isSupervisor={!!isSupervisor}>
                      {/* Dough / Crust toggle */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Line Type</label>
                        <div className="flex gap-1 p-1 bg-muted/40 rounded-lg w-fit">
                          <button
                            type="button"
                            onClick={() => {
                              setDoughSubTab("dough");
                              const newRuns = dayState.runs.map((r: any, i: any) => i === dayState.currentIndex ? { ...r, subTab: "dough" as const } : r);
                              const newDs = { ...dayState, runs: newRuns };
                              setDayState(newDs);
                              saveDayState(newDs);
                              saveProfileSubTab(currentRun?.brand ?? "", currentRun?.flavor ?? "", "dough");
                            }}
                            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${doughSubTab === "dough" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            Dough
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDoughSubTab("crusts");
                              const newRuns = dayState.runs.map((r: any, i: any) => i === dayState.currentIndex ? { ...r, subTab: "crusts" as const } : r);
                              const newDs = { ...dayState, runs: newRuns };
                              setDayState(newDs);
                              saveDayState(newDs);
                              saveProfileSubTab(currentRun?.brand ?? "", currentRun?.flavor ?? "", "crusts");
                              // Pre-fill crust-run line settings — blank-fill only,
                              // never overwriting a value the user already changed
                              // (see dieDefaults.ts). crustsPerCase/Stack stay 0.
                              const fills = resolveCrustLineDefaults(form.getValues());
                              for (const [k, val] of Object.entries(fills)) {
                                form.setValue(k as keyof typeof fills, val, { shouldDirty: true });
                              }
                            }}
                            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${doughSubTab === "crusts" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            Crust
                          </button>
                        </div>
                      </div>
                      {/* Die type selector */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Die Type</label>
                        <div className="flex flex-wrap gap-1.5">
                          {dieTypes.map((dt: any) => (
                            <button
                              key={dt}
                              type="button"
                              onClick={() => {
                                const selecting = v.dieType !== dt;
                                form.setValue("dieType", selecting ? dt : "", { shouldDirty: true });
                                if (selecting) {
                                  // Pre-fill the line settings for this die size.
                                  // Switch-aware: fields still blank OR still holding
                                  // another die's auto-filled defaults are replaced;
                                  // user-typed values are never overwritten
                                  // (see dieDefaults.ts).
                                  const fills = resolveDieLineDefaultsOnSwitch(dt, form.getValues(), dieLineDefaultOverrides);
                                  for (const [k, val] of Object.entries(fills)) {
                                    form.setValue(k as keyof typeof fills, val, { shouldDirty: true });
                                  }
                                }
                              }}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
                                v.dieType === dt
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground"
                              }`}
                            >
                              {dt}
                            </button>
                          ))}
                          {isSupervisor && (
                            <button
                              type="button"
                              onClick={() => { setManageCategory("dieTypes"); setManageInput(""); setPinChangeMsg(""); setShowManageDialog(true); }}
                              className="px-2 py-1 rounded-md text-xs border border-dashed border-border/50 text-muted-foreground/60 hover:text-muted-foreground hover:border-border transition-colors"
                              title="Add / remove die types"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Allergen selector — color-coded, food-safety advisory */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Allergen</label>
                        <div className="flex flex-wrap gap-1.5">
                          {allergenOptions([...customAllergens, v.allergen]).map((m: any) => {
                            const active = normalizeAllergen(v.allergen) === m.value;
                            return (
                              <button
                                key={m.value}
                                type="button"
                                onClick={() => form.setValue("allergen", m.value, { shouldDirty: true })}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors flex items-center gap-1.5"
                                style={active
                                  ? { backgroundColor: m.color, color: m.textColor, borderColor: m.color }
                                  : { borderColor: m.color, color: m.color, backgroundColor: "transparent" }}
                              >
                                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                                {m.label}
                              </button>
                            );
                          })}
                        </div>
                        {allergenWarnings.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1.5">
                            {allergenWarnings.map((w: any) => (
                              <div
                                key={`${w.fromId}-${w.toId}`}
                                className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border ${
                                  w.kind === "clean-not-advisable"
                                    ? "bg-red-950/40 border-red-700/40 text-red-300"
                                    : "bg-amber-950/30 border-amber-700/40 text-amber-300"
                                }`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>
                                  <span className="font-bold">{w.fromLabel} → {w.toLabel}:</span>{" "}
                                  {w.message}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {ruleViolations.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1.5">
                            {ruleViolations.map((rv: any) => {
                              const cl = rv.checklist ?? [];
                              const hasChecklist = rv.enforcement === "strict" && cl.length > 0;
                              const cleared = hasChecklist && checklistSatisfied(rv);
                              return (
                                <div
                                  key={rv.ruleId}
                                  className={`px-2.5 py-1.5 rounded-md text-xs border ${
                                    rv.enforcement === "strict"
                                      ? cleared
                                        ? "bg-green-950/40 border-green-700/40 text-green-300"
                                        : "bg-red-950/40 border-red-700/40 text-red-300"
                                      : "bg-amber-950/30 border-amber-700/40 text-amber-300"
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>
                                      <span className="font-bold">
                                        {rv.name}
                                        {rv.enforcement === "strict"
                                          ? hasChecklist
                                            ? cleared
                                              ? " (checklist complete)"
                                              : " (complete checklist to start)"
                                            : " (blocks start)"
                                          : ""}
                                        :
                                      </span>{" "}
                                      {rv.message}
                                    </span>
                                  </div>
                                  {hasChecklist && (
                                    <div className="mt-1.5 ml-5 flex flex-col gap-1">
                                      {cl.map((step: any, i: any) => {
                                        const checked = !!checklistAcks[ackKey(rv.ruleId, i)];
                                        return (
                                          <label
                                            key={i}
                                            className="flex items-start gap-1.5 cursor-pointer"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => toggleAck(rv.ruleId, i)}
                                              className="mt-0.5"
                                            />
                                            <span className={checked ? "line-through opacity-70" : ""}>
                                              {step}
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {doughSubTab === "crusts" ? (
                        <NumField
                          control={form.control}
                          name="approxLineSpeed"
                          label="Approximate Line Speed (ppm)"
                          step="0.1"
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <NumField
                            control={form.control}
                            name="crustsPerCycle"
                            label="Crusts Per Cycle"
                            step="1"
                          />
                          <NumField
                            control={form.control}
                            name="cycleSpeed"
                            label="Cycle Speed (cyc/min)"
                          />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="speedAdjustment"
                          label="Speed Adjustment"
                        />
                        <NumField
                          control={form.control}
                          name="freezerTime"
                          label="Freeze tunnel time (min)"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="preTunnelMin"
                          label="Pre-tunnel (min)"
                          step="0.5"
                        />
                        <NumField
                          control={form.control}
                          name="postTunnelMin"
                          label="Post-tunnel (min)"
                          step="0.5"
                        />
                      </div>
                      {(() => {
                        const total  = Number(v.freezerTime) || 0;
                        const pre    = Number(v.preTunnelMin)  > 0 ? Number(v.preTunnelMin)  : PRE_POST_TUNNEL_DEFAULT_MIN;
                        const post   = Number(v.postTunnelMin) > 0 ? Number(v.postTunnelMin) : PRE_POST_TUNNEL_DEFAULT_MIN;
                        const tunnel = Math.max(0, total - pre - post);
                        if (total <= 0) return null;
                        return (
                          <p className="text-[11px] text-muted-foreground">
                            Freeze tunnel set point:{" "}
                            <span className="font-semibold text-foreground">{fmtNum(tunnel, 1)} min</span>
                            {" "}({fmtNum(pre, 1)} pre + {fmtNum(tunnel, 1)} tunnel + {fmtNum(post, 1)} post = {fmtNum(total, 1)} total)
                          </p>
                        );
                      })()}
                      <Separator className="opacity-30" />
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="pizzasPerCase"
                          label="Pizzas Per Case"
                          step="1"
                        />
                        <NumField
                          control={form.control}
                          name="casesPerSkid"
                          label="Cases Per Skid"
                          step="1"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <NumField
                          control={form.control}
                          name="casesPerLayer"
                          label="Extra Case Buffer"
                          step="1"
                        />
                        {doughSubTab === "crusts" ? (
                          <NumField
                            control={form.control}
                            name="crustsPerStack"
                            label="Crusts Per Stack"
                            step="1"
                          />
                        ) : (
                          <NumField
                            control={form.control}
                            name="doughballsPerTray"
                            label="Doughballs Per Tray"
                            step="1"
                          />
                        )}
                      </div>
                      {doughSubTab === "crusts" ? (
                        <NumField
                          control={form.control}
                          name="crustsPerCase"
                          label="Crusts Per Case"
                          step="1"
                        />
                      ) : (() => {
                        const hasRecipe = (v.doughRecipe ?? []).some((r: any) => Number(r.lbs) > 0) && Number(v.targetDoughballWeight) > 0;
                        return hasRecipe ? null : (
                          <NumField
                            control={form.control}
                            name="doughBatchYield"
                            label="Dough Batch Yield (doughballs)"
                            step="1"
                          />
                        );
                      })()}
                    </LineSetupRoleGate>
                    </div>
                </details>
    </>
  );
});

/**
 * Lives here (not in LiveDoughTabContent) so the reset fires regardless of
 * which tab is currently visible. The idempotency guard is
 * `dayState.prepPhase.prepHandoffFromRunId === currentRunId`, stored durably in
 * dayState so it survives component remounts and tab switches.
 */
function LiveRunHandoffGuard() {
  const { nextRunPrepActive } = useLiveRun();
  const { currentRunId, dayState, dayStateRef, setDayState, schedulePush } =
    useHomeTabCtx();
  useEffect(() => {
    if (!nextRunPrepActive) return;
    if (dayState.prepPhase?.prepHandoffFromRunId === currentRunId) return;
    // First time nextRunPrepActive for this run: reset prep so the crew can log
    // next-run batches from zero with prepCarriedOver: false (so startRun will
    // carry them into the next run's batchesReady).
    const newPrepPhase = {
      prepStartedAt: Date.now(),
      prepBatchesDough: 0,
      prepBatchesSauce: 0,
      prepCarriedOver: false,
      prepHandoffFromRunId: currentRunId,
    };
    const newDs = { ...dayStateRef.current!, prepPhase: newPrepPhase };
    saveDayState(newDs, { stampMeta: false });
    setDayState(newDs);
    schedulePush(newDs, 0);
  }, [
    nextRunPrepActive,
    currentRunId,
    dayState.prepPhase?.prepHandoffFromRunId,
    dayStateRef,
    setDayState,
    schedulePush,
  ]);
  return null;
}
