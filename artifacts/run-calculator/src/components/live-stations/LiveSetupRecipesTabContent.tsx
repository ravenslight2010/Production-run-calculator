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
export const LiveSetupRecipesTabContent = memo(function LiveSetupRecipesTabContent() {
  const hx = useHomeTabCtx();
  const {
    addDoughIngredient, addDoughRecipeName, addFrontlineIngredient, addFrontlineRecipeName,
    addIngredientType, addPepType, appendCheese1, appendCheese2,
    appendCheese3, appendCheese4, appendDough, appendFrontline,
    applyLearnedBatchLbs, canManageInventory, cheese1Fields, cheese2Fields, commitBatchWeightField,
    cheese3Fields, cheese4Fields, cheeseNameBrandTags, cheeseNamesForRun, dayState,
    currentRun, doughFields, doughPoolDrift, doughRecipeNameOptions,
    doughVariantPick, form, frontlineFields, frontlineRecipeNameOptions,
    ingredientTypeOptions, isSupervisor, mixNameBrandTags, pep1ShowB,
    pep2ShowB, pepTypes, promoteFormRecipeToShared, promotingRecipeKind,
    removeCheese1, removeCheese2, removeCheese3, removeCheese4,
    removeDough, removeDoughIngredient, removeDoughRecipeName, removeFrontline,
    removeFrontlineIngredient, removeFrontlineRecipeName, removeIngredientType, removePepType,
    replaceCheese1, replaceCheese2, replaceCheese3, replaceCheese4,
    replaceDough, replaceFrontline, saucePoolDrift, sauceWeightsOpen,
    serverCheeseByName, serverCheeseRowsByName, serverDoughRowsByName, serverDoughTrayByName,
    serverDoughVariantsByName, serverDoughWeightByName, serverMixNames, serverMixRowsByName,
    serverSauceRowsByName, setDoughVariantPick, setPep1ShowB, setPep2ShowB,
    setSauceWeightsOpen, unifiedIngredientUniverse, v,
  } = hx;

  const { calc } = useLiveRun();
  return (
    <>
                <SetupRecipesRoleGate isSupervisor={!!isSupervisor}>
                <div className="space-y-5">
                  <DoughRecipeCard
                    recipePickerLabel="Dough recipe"
                    recipePickerTestId="setup-recipe-picker-dough"
                    batchesNeeded={calc.batchesNeeded}
                    fields={doughFields}
                    recipe={v.doughRecipe ?? []}
                    register={form.register}
                    targetWeight={Number(v.targetDoughballWeight ?? 0)}
                    doughBatchYield={Number(v.doughBatchYield)}
                    ingredientOptions={unifiedIngredientUniverse}
                    onAddIngredient={addDoughIngredient}
                    onRemoveIngredient={removeDoughIngredient}
                    onSetIngredient={(idx: any, val: any) => form.setValue(`doughRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendDough({ ingredient: "", lbs: 0 })}
                    onRemove={removeDough}
                    onTargetWeightChange={val => form.setValue("targetDoughballWeight", val, { shouldDirty: true })}
                    recipeName={v.doughRecipeName ?? ""}
                    recipeNameOptions={doughRecipeNameOptions}
                    onAddRecipeName={addDoughRecipeName}
                    onRemoveRecipeName={removeDoughRecipeName}
                    onRecipeNameChange={val => {
                      form.setValue("doughRecipeName", val, { shouldDirty: true });
                      // Any recipe change invalidates a pending variant prompt —
                      // it is re-armed below only if the NEW pick is ambiguous.
                      setDoughVariantPick(null);
                      if (val.trim()) {
                        const key = val.trim().toLowerCase();
                        const poolRows = serverDoughRowsByName.get(key) ?? loadDoughRecipePresets()[val.trim()]?.rows;
                        if (poolRows) {
                          // Clone — RHF mutates rows in place, and sharing references
                          // with the pool map would corrupt the drift comparison.
                          const rows = poolRows.map((row: any) => ({ ...row }));
                          form.setValue("doughRecipe", rows, { shouldDirty: true }); replaceDough(rows);
                        }
                        // Weight/per-tray are per-flavor (one dough family, many
                        // flavor specs) — the pool value only fills a blank field,
                        // never overwrites the flavor's own value. The family
                        // recipe's VARIANT list wins over the recipe-level value:
                        // auto-match by die size (or the only variant), else fall
                        // back and offer a manual variant pick below.
                        const variants = serverDoughVariantsByName.get(key) ?? [];
                        const matched = matchDoughballVariant(variants, { dieType: String(form.getValues("dieType") ?? "") });
                        const ballOz = matched?.weightOz ?? serverDoughWeightByName.get(key) ?? loadDoughRecipePresets()[val.trim()]?.doughballWeightOz ?? 0;
                        const weightBlank = !(Number(form.getValues("targetDoughballWeight") ?? 0) > 0);
                        if (ballOz > 0 && weightBlank) form.setValue("targetDoughballWeight", ballOz, { shouldDirty: true });
                        const perTray = matched?.perTray ?? serverDoughTrayByName.get(key) ?? 0;
                        if (perTray > 0 && !(Number(form.getValues("doughballsPerTray") ?? 0) > 0)) form.setValue("doughballsPerTray", perTray, { shouldDirty: true });
                        // Manual backup: several variants, none auto-matched and
                        // the weight was blank — let the operator pick which
                        // variant this run uses.
                        if (!matched && variants.length > 1 && weightBlank) {
                          setDoughVariantPick({ recipeName: val.trim(), variants });
                        }
                      }
                    }}
                  />
                  {doughPoolDrift && (
                    <div className="flex flex-wrap items-center gap-2 -mt-3 px-1 text-xs text-amber-500" data-testid="dough-pool-drift">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span><span className="font-semibold">"{doughPoolDrift.name}"</span> — edited for this run only.</span>
                      {canManageInventory && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          disabled={promotingRecipeKind !== null}
                          onClick={() => promoteFormRecipeToShared("dough")}
                          data-testid="button-promote-dough-recipe"
                        >
                          {promotingRecipeKind === "dough" ? "Updating…" : "Update shared recipe"}
                        </Button>
                      )}
                    </div>
                  )}
                  {doughVariantPick && (
                    <div className="flex flex-col gap-1.5 -mt-3 px-1" data-testid="dough-variant-pick">
                      <div className="flex items-center gap-2 text-xs text-amber-500">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span><span className="font-semibold">"{doughVariantPick.recipeName}"</span> — pick this run's doughball variant:</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {doughVariantPick.variants.length > 5 ? (
                          <select
                            className="h-8 w-full sm:max-w-xs px-2 rounded bg-muted/40 border border-amber-500/40 text-xs outline-none focus:border-primary/60"
                            defaultValue=""
                            data-testid="select-dough-variant"
                            onChange={e => {
                              const variant = doughVariantPick.variants.find((x: any) => x.label === e.target.value);
                              if (!variant) return;
                              // Blank-fill only — same invariant as the auto path.
                              if ((variant.weightOz ?? 0) > 0 && !(Number(form.getValues("targetDoughballWeight") ?? 0) > 0)) form.setValue("targetDoughballWeight", variant.weightOz!, { shouldDirty: true });
                              if ((variant.perTray ?? 0) > 0 && !(Number(form.getValues("doughballsPerTray") ?? 0) > 0)) form.setValue("doughballsPerTray", variant.perTray!, { shouldDirty: true });
                              setDoughVariantPick(null);
                            }}
                          >
                            <option value="" disabled>Pick a variant…</option>
                            {doughVariantPick.variants.map((variant: any) => (
                              <option key={variant.label} value={variant.label}>
                                {variant.label}
                                {(variant.weightOz ?? 0) > 0 ? ` — ${variant.weightOz} oz` : ""}
                                {(variant.perTray ?? 0) > 0 ? ` / ${variant.perTray} per tray` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          doughVariantPick.variants.map((variant: any) => (
                            <Button
                              key={variant.label}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              data-testid={`button-dough-variant-${variant.label}`}
                              onClick={() => {
                                // Blank-fill only — same invariant as the auto path.
                                if ((variant.weightOz ?? 0) > 0 && !(Number(form.getValues("targetDoughballWeight") ?? 0) > 0)) form.setValue("targetDoughballWeight", variant.weightOz!, { shouldDirty: true });
                                if ((variant.perTray ?? 0) > 0 && !(Number(form.getValues("doughballsPerTray") ?? 0) > 0)) form.setValue("doughballsPerTray", variant.perTray!, { shouldDirty: true });
                                setDoughVariantPick(null);
                              }}
                            >
                              {variant.label}
                              {(variant.weightOz ?? 0) > 0 ? ` — ${variant.weightOz} oz` : ""}
                              {(variant.perTray ?? 0) > 0 ? ` / ${variant.perTray} per tray` : ""}
                            </Button>
                          ))
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px] text-muted-foreground"
                          onClick={() => setDoughVariantPick(null)}
                          data-testid="button-dough-variant-dismiss"
                        >
                          Not now
                        </Button>
                      </div>
                    </div>
                  )}
                  <Card className="bg-card/60 border-border/50 shadow-md">
                    <button
                      type="button"
                      onClick={() => setSauceWeightsOpen((o: any) => !o)}
                      className="w-full text-left"
                    >
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                          Sauce & Applicator Weights
                          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${sauceWeightsOpen ? "rotate-180" : ""}`} />
                        </CardTitle>
                      </CardHeader>
                    </button>
                    {sauceWeightsOpen && <CardContent className="px-5 pb-5 space-y-4">
                      <TypeDropdown
                        label="Sauce"
                        ariaLabel="Sauce recipe"
                        testId="setup-recipe-picker-sauce"
                        value={v.frontlineRecipeName}
                        onChange={val => { form.setValue("frontlineRecipeName", val, { shouldDirty: true }); if (!val) { form.setValue("sauceOzPerPizza", 0, { shouldDirty: true }); form.setValue("sauceBarrelLbs", 0, { shouldDirty: true }); } else { const poolRows = serverSauceRowsByName.get(val.trim().toLowerCase()) ?? loadFrontlineRecipePresets()[val.trim()]; const rows = poolRows?.map((row: any) => ({ ...row })); if (rows) { form.setValue("frontlineRecipe", rows, { shouldDirty: true }); replaceFrontline(rows); } if (!(rows ?? []).some((r: any) => Number(r.lbs) > 0)) { applyLearnedBatchLbs(val, "sauceBarrelLbs"); } } }}
                        options={frontlineRecipeNameOptions}
                        onAddOption={addFrontlineRecipeName}
                        onRemoveOption={removeFrontlineRecipeName}
                        allowClear
                      />
                      {v.frontlineRecipeName.trim() && (() => {
                        const hasRecipe = (v.frontlineRecipe ?? []).some((r: any) => Number(r.lbs) > 0);
                        return (
                          <div className={hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField
                              control={form.control}
                              name="sauceOzPerPizza"
                              label="Oz Per Pizza"
                            />
                            {!hasRecipe && (
                              <NumField
                                control={form.control}
                                name="sauceBarrelLbs"
                                label="Barrel Weight (lbs)"
                                onCommit={(lbs) => commitBatchWeightField(v.frontlineRecipeName, lbs)}
                              />
                            )}
                          </div>
                        );
                      })()}
                      <FrontlineRecipeCard
                        embedded
                        recipePickerLabel="Sauce recipe ingredients"
                        recipePickerTestId="setup-recipe-picker-sauce-ingredients"
                        fields={frontlineFields}
                        recipe={v.frontlineRecipe ?? []}
                        register={form.register}
                        ingredientOptions={unifiedIngredientUniverse}
                        onAddIngredient={addFrontlineIngredient}
                        onRemoveIngredient={removeFrontlineIngredient}
                        onSetIngredient={(idx: any, val: any) => form.setValue(`frontlineRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                        onAppend={() => appendFrontline({ ingredient: "", lbs: 0 })}
                        onRemove={removeFrontline}
                        recipeName={v.frontlineRecipeName ?? ""}
                        recipeNameOptions={frontlineRecipeNameOptions}
                        onAddRecipeName={addFrontlineRecipeName}
                        onRemoveRecipeName={removeFrontlineRecipeName}
                        onRecipeNameChange={val => {
                          form.setValue("frontlineRecipeName", val, { shouldDirty: true });
                          if (val.trim()) {
                            const poolRows = serverSauceRowsByName.get(val.trim().toLowerCase()) ?? loadFrontlineRecipePresets()[val.trim()];
                            const rows = poolRows?.map((row: any) => ({ ...row }));
                            if (rows) { form.setValue("frontlineRecipe", rows, { shouldDirty: true }); replaceFrontline(rows); }
                          }
                        }}
                      />
                      {saucePoolDrift && (
                        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-amber-500" data-testid="sauce-pool-drift">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span><span className="font-semibold">"{saucePoolDrift.name}"</span> — edited for this run only.</span>
                          {canManageInventory && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px]"
                              disabled={promotingRecipeKind !== null}
                              onClick={() => promoteFormRecipeToShared("sauce")}
                              data-testid="button-promote-sauce-recipe"
                            >
                              {promotingRecipeKind === "sauce" ? "Updating…" : "Update shared recipe"}
                            </Button>
                          )}
                        </div>
                      )}

                      <div className="border-t border-border/60" aria-hidden="true" />
                      <TypeDropdown
                        label="Applicator 1"
                        value={v.app1Type}
                        onChange={val => { form.setValue("app1Type", val, { shouldDirty: true }); if (!val) { form.setValue("app1OzPerPizza", 0, { shouldDirty: true }); form.setValue("app1BatchLbs", 0, { shouldDirty: true }); } else if (!val.trim().toLowerCase().includes("mix")) { applyLearnedBatchLbs(val, "app1BatchLbs"); } }}
                        options={ingredientTypeOptions}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app1Type.trim() && (() => {
                        const isMix = v.app1Type.trim().toLowerCase().includes("mix");
                        const hasRecipe = !isMix && (v.app1CheeseRecipe ?? []).some((r: any) => Number(r.lbs) > 0);
                        return (
                          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="app1OzPerPizza" label="Oz Per Pizza" />
                            {!isMix && !hasRecipe && (
                              <NumField control={form.control} name="app1BatchLbs" label="Batch Weight (lbs)" onCommit={(lbs) => commitBatchWeightField(v.app1Type, lbs)} />
                            )}
                          </div>
                        );
                      })()}
                      <PerRunMixSlotBadge
                        appType={v.app1Type}
                        rows={v.app1CheeseRecipe ?? []}
                        ozPerPizza={Number(v.app1OzPerPizza) || 0}
                        onResolveByRowSum={(newOz) => form.setValue("app1OzPerPizza", newOz, { shouldDirty: true })}
                        onResolveByTotal={(scaledRows) => { form.setValue("app1CheeseRecipe", scaledRows as any, { shouldDirty: true }); replaceCheese1(scaledRows as any); }}
                      />
                      {v.app1Type.trim().toLowerCase() === "cheese" && (
                        <CheesePickCard
                          embedded
                          label={v.app1Type || "Applicator 1"}
                          recipePickerLabel="Applicator 1 cheese recipe"
                          recipePickerTestId="setup-recipe-picker-app-1-cheese"
                          batches={calc.app1Batches}
                          ozPerPizza={v.app1OzPerPizza}
                          recipe={v.app1CheeseRecipe ?? []}
                          substitutions={dayState.substitutions ?? []}
                          recipeName={v.app1CheeseRecipeName ?? ""}
                          recipeNameOptions={cheeseNamesForRun(currentRun?.brand ?? "", currentRun?.flavor ?? "")}
                          optionLabels={cheeseNameBrandTags}
                          recipeMissing={(v.app1CheeseRecipeName ?? "").trim() !== "" && !serverCheeseByName.has((v.app1CheeseRecipeName ?? "").trim().toLowerCase())}
                          shredderSetting={serverCheeseByName.get((v.app1CheeseRecipeName ?? "").trim().toLowerCase())?.shredderSetting ?? ""}
                          cellulose={serverCheeseByName.get((v.app1CheeseRecipeName ?? "").trim().toLowerCase())?.cellulose ?? ""}
                          poolComponents={serverCheeseByName.get((v.app1CheeseRecipeName ?? "").trim().toLowerCase())?.components}
                          onRecipeNameChange={val => {
                            form.setValue("app1CheeseRecipeName", val, { shouldDirty: true });
                            const rows = val.trim() ? serverCheeseRowsByName.get(val.trim().toLowerCase()) : undefined;
                            const copy = (rows ?? []).map((r: any) => ({ ...r }));
                            form.setValue("app1CheeseRecipe", copy, { shouldDirty: true });
                            replaceCheese1(copy);
                          }}
                        />
                      )}
                      {v.app1Type.trim().toLowerCase().includes("mix") && (
                        <MixRecipeCard
                          embedded
                          label={v.app1Type || "Applicator 1"}
                          recipePickerLabel="Applicator 1 mix recipe"
                          recipePickerTestId="setup-recipe-picker-app-1-mix"
                          totalRunLbs={calc.app1Lbs}
                          fields={cheese1Fields}
                          recipe={v.app1CheeseRecipe ?? []}
                          fieldPrefix="app1CheeseRecipe"
                          register={form.register}
                          ingredientOptions={unifiedIngredientUniverse}
                          onSetIngredient={(idx: any, val: any) => form.setValue(`app1CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese1({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese1}
                          recipeName={v.app1CheeseRecipeName ?? ""}
                          recipeNameOptions={serverMixNames}
                          recipeNameLabels={mixNameBrandTags}
                          onRecipeNameChange={val => {
                            form.setValue("app1CheeseRecipeName", val, { shouldDirty: true });
                            const serverMix = serverMixRowsByName.get(val.trim().toLowerCase());
                            if (serverMix) { const rows = serverMix.map((r: any) => ({ ...r })); form.setValue("app1CheeseRecipe", rows, { shouldDirty: true }); replaceCheese1(rows); }
                          }}
                        />
                      )}

                      <div className="border-t border-border/60" aria-hidden="true" />
                      <TypeDropdown
                        label="Applicator 2"
                        value={v.app2Type}
                        onChange={val => { form.setValue("app2Type", val, { shouldDirty: true }); if (!val) { form.setValue("app2OzPerPizza", 0, { shouldDirty: true }); form.setValue("app2BatchLbs", 0, { shouldDirty: true }); } else if (!val.trim().toLowerCase().includes("mix")) { applyLearnedBatchLbs(val, "app2BatchLbs"); } }}
                        options={ingredientTypeOptions}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app2Type.trim() && (() => {
                        const isMix = v.app2Type.trim().toLowerCase().includes("mix");
                        const hasRecipe = !isMix && (v.app2CheeseRecipe ?? []).some((r: any) => Number(r.lbs) > 0);
                        return (
                          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="app2OzPerPizza" label="Oz Per Pizza" />
                            {!isMix && !hasRecipe && (
                              <NumField control={form.control} name="app2BatchLbs" label="Batch Weight (lbs)" onCommit={(lbs) => commitBatchWeightField(v.app2Type, lbs)} />
                            )}
                          </div>
                        );
                      })()}
                      <PerRunMixSlotBadge
                        appType={v.app2Type}
                        rows={v.app2CheeseRecipe ?? []}
                        ozPerPizza={Number(v.app2OzPerPizza) || 0}
                        onResolveByRowSum={(newOz) => form.setValue("app2OzPerPizza", newOz, { shouldDirty: true })}
                        onResolveByTotal={(scaledRows) => { form.setValue("app2CheeseRecipe", scaledRows as any, { shouldDirty: true }); replaceCheese2(scaledRows as any); }}
                      />
                      {v.app2Type.trim().toLowerCase() === "cheese" && (
                        <CheesePickCard
                          embedded
                          label={v.app2Type || "Applicator 2"}
                          recipePickerLabel="Applicator 2 cheese recipe"
                          recipePickerTestId="setup-recipe-picker-app-2-cheese"
                          batches={calc.app2Batches}
                          ozPerPizza={v.app2OzPerPizza}
                          recipe={v.app2CheeseRecipe ?? []}
                          substitutions={dayState.substitutions ?? []}
                          recipeName={v.app2CheeseRecipeName ?? ""}
                          recipeNameOptions={cheeseNamesForRun(currentRun?.brand ?? "", currentRun?.flavor ?? "")}
                          optionLabels={cheeseNameBrandTags}
                          recipeMissing={(v.app2CheeseRecipeName ?? "").trim() !== "" && !serverCheeseByName.has((v.app2CheeseRecipeName ?? "").trim().toLowerCase())}
                          shredderSetting={serverCheeseByName.get((v.app2CheeseRecipeName ?? "").trim().toLowerCase())?.shredderSetting ?? ""}
                          cellulose={serverCheeseByName.get((v.app2CheeseRecipeName ?? "").trim().toLowerCase())?.cellulose ?? ""}
                          poolComponents={serverCheeseByName.get((v.app2CheeseRecipeName ?? "").trim().toLowerCase())?.components}
                          onRecipeNameChange={val => {
                            form.setValue("app2CheeseRecipeName", val, { shouldDirty: true });
                            const rows = val.trim() ? serverCheeseRowsByName.get(val.trim().toLowerCase()) : undefined;
                            const copy = (rows ?? []).map((r: any) => ({ ...r }));
                            form.setValue("app2CheeseRecipe", copy, { shouldDirty: true });
                            replaceCheese2(copy);
                          }}
                        />
                      )}
                      {v.app2Type.trim().toLowerCase().includes("mix") && (
                        <MixRecipeCard
                          embedded
                          label={v.app2Type || "Applicator 2"}
                          recipePickerLabel="Applicator 2 mix recipe"
                          recipePickerTestId="setup-recipe-picker-app-2-mix"
                          totalRunLbs={calc.app2Lbs}
                          fields={cheese2Fields}
                          recipe={v.app2CheeseRecipe ?? []}
                          fieldPrefix="app2CheeseRecipe"
                          register={form.register}
                          ingredientOptions={unifiedIngredientUniverse}
                          onSetIngredient={(idx: any, val: any) => form.setValue(`app2CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese2({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese2}
                          recipeName={v.app2CheeseRecipeName ?? ""}
                          recipeNameOptions={serverMixNames}
                          recipeNameLabels={mixNameBrandTags}
                          onRecipeNameChange={val => {
                            form.setValue("app2CheeseRecipeName", val, { shouldDirty: true });
                            const serverMix = serverMixRowsByName.get(val.trim().toLowerCase());
                            if (serverMix) { const rows = serverMix.map((r: any) => ({ ...r })); form.setValue("app2CheeseRecipe", rows, { shouldDirty: true }); replaceCheese2(rows); }
                          }}
                        />
                      )}

                      <div className="border-t border-border/60" aria-hidden="true" />
                      <TypeDropdown
                        label={v.pep1Combined === true ? "Pep Applicator 1 & 2" : "Pep Applicator 1"}
                        value={v.pep1Type}
                        onChange={val => { form.setValue("pep1Type", val, { shouldDirty: true }); if (!val || DEFAULT_PEP_TYPES.includes(val)) { form.setValue("pep1BatchLbs", 0, { shouldDirty: true }); } else { applyLearnedBatchLbs(val, "pep1BatchLbs"); } if (!val) { form.setValue("pep1Sticks", 0, { shouldDirty: true }); form.setValue("pep1OzPerPizza", 0, { shouldDirty: true }); } }}
                        options={pepTypes}
                        onAddOption={addPepType}
                        onRemoveOption={removePepType}
                        allowClear
                      />
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={v.pep1Combined === true}
                          onChange={e => form.setValue("pep1Combined", e.target.checked, { shouldDirty: true })}
                          className="accent-primary"
                        />
                        <span>Run this pep through both applicators 1 &amp; 2 (doubles stick buffer)</span>
                      </label>
                      {(v.pep1Type ?? "").trim() && (
                        <>
                          <NumField
                            control={form.control}
                            name="pep1Sticks"
                            label="Number of Sticks"
                          />
                          {DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") ? (
                            <NumField
                              control={form.control}
                              name="pep1OzPerPizza"
                              label="Oz Per Pizza"
                            />
                          ) : (
                            <div className="grid grid-cols-2 gap-3">
                              <NumField
                                control={form.control}
                                name="pep1OzPerPizza"
                                label="Oz Per Pizza"
                              />
                              <NumField
                                control={form.control}
                                name="pep1BatchLbs"
                                label="Batch Weight (lbs)"
                                onCommit={(lbs) => commitBatchWeightField(v.pep1Type, lbs)}
                              />
                            </div>
                          )}
                        </>
                      )}

                      {/* Optional additional pep type on applicator 1 */}
                      {(pep1ShowB || (v.pep1TypeB ?? "").trim()) ? (
                        <div className="rounded-md border border-border/50 p-3 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-muted-foreground">Additional Pep Type (Applicator 1)</span>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
                              onClick={() => { setPep1ShowB(false); form.setValue("pep1TypeB", "", { shouldDirty: true }); form.setValue("pep1SticksB", 0, { shouldDirty: true }); form.setValue("pep1OzPerPizzaB", 0, { shouldDirty: true }); form.setValue("pep1BatchLbsB", 0, { shouldDirty: true }); }}
                              aria-label="Remove additional pep type"
                            >×</button>
                          </div>
                          <TypeDropdown
                            label="Pep Type"
                            value={v.pep1TypeB ?? ""}
                            onChange={val => { form.setValue("pep1TypeB", val, { shouldDirty: true }); if (!val || DEFAULT_PEP_TYPES.includes(val)) { form.setValue("pep1BatchLbsB", 0, { shouldDirty: true }); } else { applyLearnedBatchLbs(val, "pep1BatchLbsB"); } if (!val) { form.setValue("pep1SticksB", 0, { shouldDirty: true }); form.setValue("pep1OzPerPizzaB", 0, { shouldDirty: true }); } }}
                            options={pepTypes}
                            onAddOption={addPepType}
                            onRemoveOption={removePepType}
                            allowClear
                          />
                          {(v.pep1TypeB ?? "").trim() && (
                            <>
                              <NumField control={form.control} name="pep1SticksB" label="Number of Sticks" />
                              {DEFAULT_PEP_TYPES.includes(v.pep1TypeB ?? "") ? (
                                <NumField control={form.control} name="pep1OzPerPizzaB" label="Oz Per Pizza" />
                              ) : (
                                <div className="grid grid-cols-2 gap-3">
                                  <NumField control={form.control} name="pep1OzPerPizzaB" label="Oz Per Pizza" />
                                  <NumField control={form.control} name="pep1BatchLbsB" label="Batch Weight (lbs)" onCommit={(lbs) => commitBatchWeightField(v.pep1TypeB ?? "", lbs)} />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-sm text-primary hover:underline self-start"
                          onClick={() => setPep1ShowB(true)}
                        >+ Add pep type</button>
                      )}

                      {v.pep1Combined !== true && (
                        <>
                          <div className="border-t border-border/60" aria-hidden="true" />
                          <TypeDropdown
                            label="Pep Applicator 2"
                            value={v.pep2Type}
                            onChange={val => { form.setValue("pep2Type", val, { shouldDirty: true }); if (!val || DEFAULT_PEP_TYPES.includes(val)) { form.setValue("pep2BatchLbs", 0, { shouldDirty: true }); } else { applyLearnedBatchLbs(val, "pep2BatchLbs"); } if (!val) { form.setValue("pep2Sticks", 0, { shouldDirty: true }); form.setValue("pep2OzPerPizza", 0, { shouldDirty: true }); } }}
                            options={pepTypes}
                            onAddOption={addPepType}
                            onRemoveOption={removePepType}
                            allowClear
                          />
                          {(v.pep2Type ?? "").trim() && (
                            <>
                              <NumField
                                control={form.control}
                                name="pep2Sticks"
                                label="Number of Sticks"
                              />
                              {DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") ? (
                                <NumField
                                  control={form.control}
                                  name="pep2OzPerPizza"
                                  label="Oz Per Pizza"
                                />
                              ) : (
                                <div className="grid grid-cols-2 gap-3">
                                  <NumField
                                    control={form.control}
                                    name="pep2OzPerPizza"
                                    label="Oz Per Pizza"
                                  />
                                  <NumField
                                    control={form.control}
                                    name="pep2BatchLbs"
                                    label="Batch Weight (lbs)"
                                    onCommit={(lbs) => commitBatchWeightField(v.pep2Type, lbs)}
                                  />
                                </div>
                              )}
                            </>
                          )}

                          {/* Optional additional pep type on applicator 2 */}
                          {(pep2ShowB || (v.pep2TypeB ?? "").trim()) ? (
                            <div className="rounded-md border border-border/50 p-3 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-muted-foreground">Additional Pep Type (Applicator 2)</span>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
                                  onClick={() => { setPep2ShowB(false); form.setValue("pep2TypeB", "", { shouldDirty: true }); form.setValue("pep2SticksB", 0, { shouldDirty: true }); form.setValue("pep2OzPerPizzaB", 0, { shouldDirty: true }); form.setValue("pep2BatchLbsB", 0, { shouldDirty: true }); }}
                                  aria-label="Remove additional pep type"
                                >×</button>
                              </div>
                              <TypeDropdown
                                label="Pep Type"
                                value={v.pep2TypeB ?? ""}
                                onChange={val => { form.setValue("pep2TypeB", val, { shouldDirty: true }); if (!val || DEFAULT_PEP_TYPES.includes(val)) { form.setValue("pep2BatchLbsB", 0, { shouldDirty: true }); } else { applyLearnedBatchLbs(val, "pep2BatchLbsB"); } if (!val) { form.setValue("pep2SticksB", 0, { shouldDirty: true }); form.setValue("pep2OzPerPizzaB", 0, { shouldDirty: true }); } }}
                                options={pepTypes}
                                onAddOption={addPepType}
                                onRemoveOption={removePepType}
                                allowClear
                              />
                              {(v.pep2TypeB ?? "").trim() && (
                                <>
                                  <NumField control={form.control} name="pep2SticksB" label="Number of Sticks" />
                                  {DEFAULT_PEP_TYPES.includes(v.pep2TypeB ?? "") ? (
                                    <NumField control={form.control} name="pep2OzPerPizzaB" label="Oz Per Pizza" />
                                  ) : (
                                    <div className="grid grid-cols-2 gap-3">
                                      <NumField control={form.control} name="pep2OzPerPizzaB" label="Oz Per Pizza" />
                                      <NumField control={form.control} name="pep2BatchLbsB" label="Batch Weight (lbs)" onCommit={(lbs) => commitBatchWeightField(v.pep2TypeB ?? "", lbs)} />
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="text-sm text-primary hover:underline self-start"
                              onClick={() => setPep2ShowB(true)}
                            >+ Add pep type</button>
                          )}
                        </>
                      )}

                      <div className="border-t border-border/60" aria-hidden="true" />
                      <TypeDropdown
                        label="Applicator 3"
                        value={v.app3Type}
                        onChange={val => { form.setValue("app3Type", val, { shouldDirty: true }); if (!val) { form.setValue("app3OzPerPizza", 0, { shouldDirty: true }); form.setValue("app3BatchLbs", 0, { shouldDirty: true }); } else if (!val.trim().toLowerCase().includes("mix")) { applyLearnedBatchLbs(val, "app3BatchLbs"); } }}
                        options={ingredientTypeOptions}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app3Type.trim() && (() => {
                        const isMix = v.app3Type.trim().toLowerCase().includes("mix");
                        const hasRecipe = !isMix && (v.app3CheeseRecipe ?? []).some((r: any) => Number(r.lbs) > 0);
                        return (
                          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="app3OzPerPizza" label="Oz Per Pizza" />
                            {!isMix && !hasRecipe && (
                              <NumField control={form.control} name="app3BatchLbs" label="Batch Weight (lbs)" onCommit={(lbs) => commitBatchWeightField(v.app3Type, lbs)} />
                            )}
                          </div>
                        );
                      })()}
                      <PerRunMixSlotBadge
                        appType={v.app3Type}
                        rows={v.app3CheeseRecipe ?? []}
                        ozPerPizza={Number(v.app3OzPerPizza) || 0}
                        onResolveByRowSum={(newOz) => form.setValue("app3OzPerPizza", newOz, { shouldDirty: true })}
                        onResolveByTotal={(scaledRows) => { form.setValue("app3CheeseRecipe", scaledRows as any, { shouldDirty: true }); replaceCheese3(scaledRows as any); }}
                      />
                      {v.app3Type.trim().toLowerCase() === "cheese" && (
                        <CheesePickCard
                          embedded
                          label={v.app3Type || "Applicator 3"}
                          recipePickerLabel="Applicator 3 cheese recipe"
                          recipePickerTestId="setup-recipe-picker-app-3-cheese"
                          batches={calc.app3Batches}
                          ozPerPizza={v.app3OzPerPizza}
                          recipe={v.app3CheeseRecipe ?? []}
                          substitutions={dayState.substitutions ?? []}
                          recipeName={v.app3CheeseRecipeName ?? ""}
                          recipeNameOptions={cheeseNamesForRun(currentRun?.brand ?? "", currentRun?.flavor ?? "")}
                          optionLabels={cheeseNameBrandTags}
                          recipeMissing={(v.app3CheeseRecipeName ?? "").trim() !== "" && !serverCheeseByName.has((v.app3CheeseRecipeName ?? "").trim().toLowerCase())}
                          shredderSetting={serverCheeseByName.get((v.app3CheeseRecipeName ?? "").trim().toLowerCase())?.shredderSetting ?? ""}
                          cellulose={serverCheeseByName.get((v.app3CheeseRecipeName ?? "").trim().toLowerCase())?.cellulose ?? ""}
                          poolComponents={serverCheeseByName.get((v.app3CheeseRecipeName ?? "").trim().toLowerCase())?.components}
                          onRecipeNameChange={val => {
                            form.setValue("app3CheeseRecipeName", val, { shouldDirty: true });
                            const rows = val.trim() ? serverCheeseRowsByName.get(val.trim().toLowerCase()) : undefined;
                            const copy = (rows ?? []).map((r: any) => ({ ...r }));
                            form.setValue("app3CheeseRecipe", copy, { shouldDirty: true });
                            replaceCheese3(copy);
                          }}
                        />
                      )}
                      {v.app3Type.trim().toLowerCase().includes("mix") && (
                        <MixRecipeCard
                          embedded
                          label={v.app3Type || "Applicator 3"}
                          recipePickerLabel="Applicator 3 mix recipe"
                          recipePickerTestId="setup-recipe-picker-app-3-mix"
                          totalRunLbs={calc.app3Lbs}
                          fields={cheese3Fields}
                          recipe={v.app3CheeseRecipe ?? []}
                          fieldPrefix="app3CheeseRecipe"
                          register={form.register}
                          ingredientOptions={unifiedIngredientUniverse}
                          onSetIngredient={(idx: any, val: any) => form.setValue(`app3CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese3({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese3}
                          recipeName={v.app3CheeseRecipeName ?? ""}
                          recipeNameOptions={serverMixNames}
                          recipeNameLabels={mixNameBrandTags}
                          onRecipeNameChange={val => {
                            form.setValue("app3CheeseRecipeName", val, { shouldDirty: true });
                            const serverMix = serverMixRowsByName.get(val.trim().toLowerCase());
                            if (serverMix) { const rows = serverMix.map((r: any) => ({ ...r })); form.setValue("app3CheeseRecipe", rows, { shouldDirty: true }); replaceCheese3(rows); }
                          }}
                        />
                      )}

                      <div className="border-t border-border/60" aria-hidden="true" />
                      <TypeDropdown
                        label="Applicator 4"
                        value={v.app4Type}
                        onChange={val => { form.setValue("app4Type", val, { shouldDirty: true }); if (!val) { form.setValue("app4OzPerPizza", 0, { shouldDirty: true }); form.setValue("app4BatchLbs", 0, { shouldDirty: true }); } else if (!val.trim().toLowerCase().includes("mix")) { applyLearnedBatchLbs(val, "app4BatchLbs"); } }}
                        options={ingredientTypeOptions}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app4Type.trim() && (() => {
                        const isMix = v.app4Type.trim().toLowerCase().includes("mix");
                        const hasRecipe = !isMix && (v.app4CheeseRecipe ?? []).some((r: any) => Number(r.lbs) > 0);
                        return (
                          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="app4OzPerPizza" label="Oz Per Pizza" />
                            {!isMix && !hasRecipe && (
                              <NumField control={form.control} name="app4BatchLbs" label="Batch Weight (lbs)" onCommit={(lbs) => commitBatchWeightField(v.app4Type, lbs)} />
                            )}
                          </div>
                        );
                      })()}
                      <PerRunMixSlotBadge
                        appType={v.app4Type}
                        rows={v.app4CheeseRecipe ?? []}
                        ozPerPizza={Number(v.app4OzPerPizza) || 0}
                        onResolveByRowSum={(newOz) => form.setValue("app4OzPerPizza", newOz, { shouldDirty: true })}
                        onResolveByTotal={(scaledRows) => { form.setValue("app4CheeseRecipe", scaledRows as any, { shouldDirty: true }); replaceCheese4(scaledRows as any); }}
                      />
                      {v.app4Type.trim().toLowerCase() === "cheese" && (
                        <CheesePickCard
                          embedded
                          label={v.app4Type || "Applicator 4"}
                          recipePickerLabel="Applicator 4 cheese recipe"
                          recipePickerTestId="setup-recipe-picker-app-4-cheese"
                          batches={calc.app4Batches}
                          ozPerPizza={v.app4OzPerPizza}
                          recipe={v.app4CheeseRecipe ?? []}
                          substitutions={dayState.substitutions ?? []}
                          recipeName={v.app4CheeseRecipeName ?? ""}
                          recipeNameOptions={cheeseNamesForRun(currentRun?.brand ?? "", currentRun?.flavor ?? "")}
                          optionLabels={cheeseNameBrandTags}
                          recipeMissing={(v.app4CheeseRecipeName ?? "").trim() !== "" && !serverCheeseByName.has((v.app4CheeseRecipeName ?? "").trim().toLowerCase())}
                          shredderSetting={serverCheeseByName.get((v.app4CheeseRecipeName ?? "").trim().toLowerCase())?.shredderSetting ?? ""}
                          cellulose={serverCheeseByName.get((v.app4CheeseRecipeName ?? "").trim().toLowerCase())?.cellulose ?? ""}
                          poolComponents={serverCheeseByName.get((v.app4CheeseRecipeName ?? "").trim().toLowerCase())?.components}
                          onRecipeNameChange={val => {
                            form.setValue("app4CheeseRecipeName", val, { shouldDirty: true });
                            const rows = val.trim() ? serverCheeseRowsByName.get(val.trim().toLowerCase()) : undefined;
                            const copy = (rows ?? []).map((r: any) => ({ ...r }));
                            form.setValue("app4CheeseRecipe", copy, { shouldDirty: true });
                            replaceCheese4(copy);
                          }}
                        />
                      )}
                      {v.app4Type.trim().toLowerCase().includes("mix") && (
                        <MixRecipeCard
                          embedded
                          label={v.app4Type || "Applicator 4"}
                          recipePickerLabel="Applicator 4 mix recipe"
                          recipePickerTestId="setup-recipe-picker-app-4-mix"
                          totalRunLbs={calc.app4Lbs}
                          fields={cheese4Fields}
                          recipe={v.app4CheeseRecipe ?? []}
                          fieldPrefix="app4CheeseRecipe"
                          register={form.register}
                          ingredientOptions={unifiedIngredientUniverse}
                          onSetIngredient={(idx: any, val: any) => form.setValue(`app4CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese4({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese4}
                          recipeName={v.app4CheeseRecipeName ?? ""}
                          recipeNameOptions={serverMixNames}
                          recipeNameLabels={mixNameBrandTags}
                          onRecipeNameChange={val => {
                            form.setValue("app4CheeseRecipeName", val, { shouldDirty: true });
                            const serverMix = serverMixRowsByName.get(val.trim().toLowerCase());
                            if (serverMix) { const rows = serverMix.map((r: any) => ({ ...r })); form.setValue("app4CheeseRecipe", rows, { shouldDirty: true }); replaceCheese4(rows); }
                          }}
                        />
                      )}
                    </CardContent>}
                  </Card>
                </div>
                </SetupRecipesRoleGate>
    </>
  );
});
