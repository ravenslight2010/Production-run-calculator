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
export const LiveStoppagesTabContent = memo(function LiveStoppagesTabContent() {
  const hx = useHomeTabCtx();
  const {
    activeStopId, confirmDeleteStopId, currentRun, dayState,
    deleteStop, endStop, runStatus, setConfirmDeleteStopId,
    setEditingStop, setManualStopEnd, setManualStopNotes, setManualStopReason,
    setManualStopStart, setManualStopType, setShowManualStopDialog, setShowStopDialog,
    setStopNotes, setStopReason,
  } = hx;

  const { nowTime } = useLiveRun();
  return (
    <>
                {/* ── Stoppage Log ──
                    Shows the WHOLE day's events across ALL runs (grouped per
                    run), not just the current run — otherwise a pause logged on
                    a run that has since ended silently disappears from this
                    screen and it looks like nothing was recorded. */}
                {currentRun && (() => {
                  const runGroups = dayState.runs
                    .map((r: any, i: any) => ({ run: r, idx: i, stops: r.stoppages ?? [] }))
                    .filter((g: any) => g.stops.length > 0);
                  const allStops = runGroups.flatMap((g: any) => g.stops);
                  const hasActiveRun = !!currentRun.startedAt && !currentRun.endedAt;
                  if (allStops.length === 0 && !hasActiveRun) return null;
                  const stopOnlyMs = allStops.filter((s: any) => s.endedAt && s.type !== "pause").reduce((acc: any, s: any) => acc + (s.endedAt! - s.startedAt), 0);
                  const noReasonCount = allStops.filter((s: any) => !s.reason.trim()).length;
                  return (
                    <div
                      data-testid="stoppage-log"
                      className="mb-5 rounded-lg border border-border/50 bg-card/40 overflow-hidden"
                    >
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                        <div className="flex items-center gap-2">
                          <OctagonX className="w-4 h-4 text-orange-400 shrink-0" />
                          <span className="text-sm font-semibold">Stoppage Log</span>
                          {allStops.length > 0 && <span className="text-xs text-muted-foreground">{allStops.length} event{allStops.length !== 1 ? "s" : ""}</span>}
                          {noReasonCount > 0 && (
                            <span className="text-xs font-semibold text-amber-400 animate-pulse">{noReasonCount} need reason</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {stopOnlyMs > 0 && (
                            <span className="text-xs text-orange-400 font-semibold">
                              {fmtTime(stopOnlyMs / 1000)} down
                            </span>
                          )}
                          {activeStopId && (runStatus === "running" || runStatus === "paused") && (
                            <button
                              type="button"
                              onClick={endStop}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold transition-colors animate-pulse"
                            >
                              <CircleDot className="w-3 h-3" /> End Stop
                            </button>
                          )}
                          {!activeStopId && (
                            <button
                              type="button"
                              onClick={() => { setStopReason(""); setStopNotes(""); setShowStopDialog(true); }}
                              className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-orange-700/60 text-orange-400 hover:bg-orange-950/40 text-xs font-semibold transition-colors"
                            >
                              <Plus className="w-3 h-3" /> Log Stop
                            </button>
                          )}
                          {hasActiveRun && (
                            <button
                              type="button"
                              onClick={() => {
                                const now = new Date();
                                const pad = (n: number) => String(n).padStart(2, "0");
                                const local = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                                setManualStopType("stop");
                                setManualStopReason("");
                                setManualStopNotes("");
                                setManualStopStart(local);
                                setManualStopEnd("");
                                setShowManualStopDialog(true);
                              }}
                              className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/60 text-muted-foreground hover:bg-muted/50 text-xs font-semibold transition-colors"
                              title="Add a past event you couldn't log at the time"
                            >
                              <CalendarPlus className="w-3 h-3" /> Add Past
                            </button>
                          )}
                        </div>
                      </div>
                      {allStops.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">No events recorded yet. Pauses and stops are logged automatically.</p>
                      ) : (
                        <div>
                          {runGroups.map((group: any) => (
                          <div key={group.run.id}>
                          <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/30 border-y border-border/20">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                              {(`${group.run.brand ?? ""}${group.run.flavor ? ` – ${group.run.flavor}` : ""}`.trim()) || `Run ${group.idx + 1}`}
                            </span>
                            {group.idx === dayState.currentIndex && (
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary shrink-0">Current</span>
                            )}
                          </div>
                          <div className="divide-y divide-border/20">
                          {[...group.stops].reverse().map((stop: any) => {
                            const isPause = stop.type === "pause";
                            const isManual = stop.type === "manual";
                            const dur = stop.endedAt ? (stop.endedAt - stop.startedAt) / 1000 : null;
                            const isActive = !stop.endedAt;
                            const noReason = !stop.reason.trim();
                            const rowBackground = isActive && !isPause
                              ? "bg-orange-100/70 dark:bg-orange-950/20"
                              : !isActive && isManual
                                ? "bg-violet-50/70 dark:bg-transparent"
                                : !isActive && !isPause
                                  ? "bg-orange-50/70 dark:bg-transparent"
                                  : isActive
                                    ? "bg-blue-100/70 dark:bg-blue-950/20"
                                    : "";
                            return (
                              <div key={stop.id} className={`flex items-start gap-3 px-4 py-2.5 text-sm ${rowBackground}`}>
                                <div className="mt-0.5 shrink-0">
                                  {isPause
                                    ? <PauseCircle className={`w-3.5 h-3.5 ${isActive ? "text-blue-400 animate-pulse" : "text-blue-400"}`} />
                                    : <OctagonX className={`w-3.5 h-3.5 ${isActive ? "text-orange-800 dark:text-orange-400 animate-pulse" : "text-orange-800 dark:text-orange-400"}`} />
                                  }
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${isPause ? "text-blue-400" : isManual ? "text-violet-700 dark:text-violet-300" : "text-orange-800 dark:text-orange-400/70"}`}>
                                      {isPause ? "Pause" : isManual ? "Manual" : "Stop"}
                                    </span>
                                    {noReason ? (
                                      <button
                                        type="button"
                                        onClick={() => setEditingStop({ ...stop })}
                                        className="text-xs italic text-amber-400 hover:text-amber-300 transition-colors"
                                      >
                                        No reason — tap to add
                                      </button>
                                    ) : (
                                      <span className="text-xs font-medium">{stop.reason}</span>
                                    )}
                                    {stop.notes && <span className="text-xs text-muted-foreground">— {stop.notes}</span>}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground mt-0.5">
                                    {fmtClock(stop.startedAt)}{stop.endedAt ? ` → ${fmtClock(stop.endedAt)}` : " (ongoing)"}
                                  </div>
                                </div>
                                <span className={`text-xs font-semibold tabular-nums shrink-0 mt-0.5 ${isActive ? (isPause ? "text-blue-400" : "text-orange-400") : "text-muted-foreground"}`}>
                                  {dur !== null ? fmtTime(dur) : fmtElapsed(nowTime.getTime() - stop.startedAt)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setEditingStop({ ...stop })}
                                  className="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0 mt-0.5"
                                  title="Edit"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                {confirmDeleteStopId === stop.id ? (
                                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                                    <button
                                      type="button"
                                      onClick={() => { deleteStop(stop.id); setConfirmDeleteStopId(null); }}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/80 hover:bg-destructive text-white font-semibold transition-colors"
                                    >Del</button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteStopId(null)}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-muted-foreground font-semibold transition-colors"
                                    >No</button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteStopId(stop.id)}
                                    className="text-muted-foreground/30 hover:text-destructive transition-colors shrink-0 mt-0.5"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          </div>
                          </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
    </>
  );
});
