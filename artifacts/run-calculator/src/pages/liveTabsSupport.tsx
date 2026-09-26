import { createContext, lazy, memo, Profiler, useCallback, useEffect, useId, useMemo, useRef, useState, useContext } from "react";
import { useEvent } from "../hooks/useEvent";
import { useIsTouchDevice } from "../hooks/use-mobile";
import { createFrameRepeater } from "../frameRepeater";
import {
  flushPendingHomeFormWrites,
  useHomeFormIdentityFences,
  useHomeFormLifecycle,
} from "../hooks/useHomeFormLifecycle";
import { useRunLifecycleManager } from "../hooks/useRunLifecycleManager";
import {
  coordinateForegroundAdoption,
  createForegroundSyncTodayRequest,
  initialResetRequiresReload,
  releaseCancelledForegroundRecovery,
  releaseForegroundRecovery,
  useHomeSyncCoordination,
} from "../hooks/useHomeSyncCoordination";
import { consumeForegroundRecoveryResponse } from "../foregroundRecoveryResponse";
import { closeTopmostImportDialog, useHomeImportDialogs } from "../hooks/useHomeImportDialogs";
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
import { HomeCtx, useHomeCtx } from "../contexts/HomeCtx";
import { HomeTabCtx, useHomeTabCtx } from "../contexts/HomeTabCtx";
import { WarehouseTabCtx, type WarehouseTabContextValue } from "../contexts/WarehouseTabCtx";
import { InventoryTabCtx, type InventoryTabContextValue } from "../contexts/InventoryTabCtx";
import { MixesTabCtx, type MixesTabContextValue } from "../contexts/MixesTabCtx";
import { SetupTabCtx, type SetupTabContextValue } from "../contexts/SetupTabCtx";
import WarehouseTabContent from "../components/WarehouseTabContent";
import { FreezerSurplusPanel } from "../components/FreezerSurplusPanel";
import InventoryTabContent from "../components/InventoryTabContent";
import MixesTabContent from "../components/MixesTabContent";
import SetupContent from "../components/SetupContent";
import SummaryToolsContent from "../components/SummaryToolsContent";
import ScreenModeView from "../components/ScreenModeView";
import { ForegroundRecoveryStatus } from "../components/ForegroundRecoveryStatus";
import { VisibleTabScheduler } from "../visibleTabScheduler";
import { incrementFloorCaseCount } from "../floorPackagingCorrection";
import {
  hasAutomaticUpdateReloadBlockingSurface,
  isAutomaticUpdateReloadSafe,
  reportAutomaticUpdateReloadSafety,
  useAutomaticUpdateReloadBlocker,
} from "../updateReloadSafety";
import {
  browserIsOnline,
  resolveForegroundStopIntent,
  type ForegroundStopIntent,
} from "../foregroundLifecycleIntent";
import GlanceOverlay from "../components/GlanceOverlay";
import { useAccessibleDialogStack } from "../components/useAccessibleDialog";
import CompactRunStrip from "../components/CompactRunStrip";
import { ManualOverrideBanner, manualOverrideBannerShow } from "../components/ManualOverrideBanner";
import { LiveSauceTabContent } from "../components/live-stations/LiveSauceTabContent";
import { LiveFrontlineTabContent } from "../components/live-stations/LiveFrontlineTabContent";
import { LivePackagingTabContent } from "../components/live-stations/LivePackagingTabContent";
import { LiveDoughTabContent } from "../components/live-stations/LiveDoughTabContent";
import { AUTO_SUPPRESS_MS, fmtMS } from "../components/live-stations/stationShared";
import { MixAlreadyMadeInput } from "../components/MixAlreadyMadeInput";
import { TouchOptionPicker, TouchSelect } from "../components/TouchOptionPicker";
import { PrepMixMissingAmountsWarning } from "../components/PrepMixMissingAmountsWarning";
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
} from "../types";
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
} from "../utils";
import { normalizeScheduledDays, type ScheduledDay } from "../scheduledDays";
import { fetchWithTimeout } from "../fetchWithTimeout";
import { deriveFrontlineNeedRows } from "../frontlineRows";
import {
  isSharedRecipeRefreshEligible,
  orchestrateSharedRecipeRefresh,
  refreshNamedRecipeProfilesAndPropagate,
  runSharedRecipeRefresh,
} from "../profileRecipeRefresh";
import { clearActiveSubstitutions, setActiveSubstitutions, withTodaySubstitutions } from "../substitutionState";
import { brandTagLabels } from "@workspace/name-match";
import { computeLinePhases, pickMostActivePhase, computeEndedRunElapsedSec, type PhaseInfo } from "../linePhases";
import {
  pauseDecisionRemainingMs,
  canChoosePauseTunnelPolicy,
  shouldClosePauseDecision,
} from "../pausePolicy";
import {
  PackagingSpeedNudgeFeedback,
} from "../components/PackagingSpeedNudgeFeedback";
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
} from "../storage";
import { COMPLETED_HISTORY_OUTBOX_EVENT, flushCompletedHistoryOutbox, hydrateCompletedHistory, loadCompletedHistoryForActiveScope, pendingCompletedHistoryCount, queueCompletedRun, setCompletedHistoryScope, startRunAndQueueCompetingCompletions } from "../completedHistorySync";
import { applyResetWipe, applyRolloverEpoch, getStoredResetEpoch } from "../adapters/browserResetPersistence";
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
} from "../domain/runSyncPolicy";
import {
  loadPackagingProgress,
  overlayPackagingProgress,
  reconcilePackagingProgress,
  recordAutomaticPackagingProgress,
  recordManualPackagingProgress,
  savePackagingProgress,
} from "../packagingProgress";
import { isolatePendingRunPackagingProgress } from "../runProgressIsolation";
import {
  consumeSyncWriteResponse,
  isCanonicalRecoverySyncPayload,
  isUnchangedSyncResponse,
  isValidSyncSnapshotId,
  persistedSyncPayload,
  readCurrentRecoveryJson,
  reconstructPartialSyncPayload,
  syncPayloadMatchesSnapshot,
} from "../syncWriteResponse";
import {
  canonicalProfileKey,
  flushProfileQueueStrict,
  markProfileForceEdited,
  reconcileProfilesFromServer,
  reconcileProfilesFromServerDetailed,
  seedProfilesFromServer,
  type ProfileReconcileResult,
} from "../profileServerSync";
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
} from "../factoryDataSync";
import {
  useRunTemplates,
  saveRunTemplateApi,
  deleteRunTemplatesApi,
  runTemplatesQueryKey,
  RUN_TEMPLATES_QUERY_KEY,
} from "../hooks/useRunTemplates";
import {
  resolveDieLineDefaultsOnSwitch,
  resolveCrustLineDefaults,
  dieDefaultsKey,
  dieLineDefaultsFor,
} from "../dieDefaults";
import { saveDieLineDefaults } from "../dieLineDefaultsServer";
import { DIE_LINE_DEFAULTS_QUERY_KEY } from "../hooks/useDieLineDefaults";
import RunInsightsCard from "../components/RunInsightsCard";
import {
  reportRunInsightsAfterFinalize,
  buildTunnelDieDefaultEntry,
  type RunSuggestion,
} from "../runInsights";
import {
  fetchServerDieTypes,
  pushDieTypesToServer,
  deleteDieTypesOnServer,
  reconcileDieTypes,
  DIE_TYPES_SERVER_MIGRATED_KEY,
} from "../dieTypesServer";
import { findMixPresets, type MixPreset } from "../mixPresets";
import { MIX_SEED } from "../mixSeed";
import { groupWarehouseNeedRows, type WarehouseArea } from "../warehouseGrouping";
import FactoryResetCard from "../components/FactoryResetCard";
import AuditLogCard from "../components/AuditLogCard";
import SyncConflictStatsCard from "../components/SyncConflictStatsCard";
import DataHealthWorkspace from "../components/DataHealthWorkspace";
import SyncStatusPopover, { type SyncStatus } from "../components/SyncStatusPopover";
import {
  buildSyncDiagnosticReport,
  loadSyncDiagnostics,
  loadSyncMeasurements,
  recordSyncDiagnostic,
  recordSyncMeasurement,
  type SyncDiagnostic,
  type SyncDiagnosticKind,
  type SyncMeasurementTrigger,
} from "../syncDiagnostics";
import ProfileDataHealthCard from "../components/ProfileDataHealthCard";
import ProfileNameLinkCleanupCard from "../components/ProfileNameLinkCleanupCard";
import AiCorrectionsCard from "../components/AiCorrectionsCard";
import ManageRunsPanel from "../components/ManageRunsPanel";
import ReorderCard from "../components/ReorderCard";
import UseFirstCard from "../components/UseFirstCard";
import ScheduledRecipeWarningCard from "../components/ScheduledRecipeWarningCard";
import ManagerAttentionDialog, {
  buildManagerAttentionItems,
  managerAttentionCount,
  type ManagerAttentionItem,
} from "../components/ManagerAttentionDialog";
import ApplicatorEvidenceReview from "../components/ApplicatorEvidenceReview";
import { RecipeShareButtons } from "../components/RecipeShareButtons";
import AlertSettingsDialog from "../components/AlertSettingsDialog";
import { SetupRecipesRoleGate } from "../components/SetupRecipesRoleGate";
import { TickBar } from "../components/TickBar";
import { LineSetupRoleGate } from "../components/LineSetupRoleGate";
import { DoughRoleGate } from "../components/DoughRoleGate";
import { useFreezerPullItems } from "../hooks/useFreezerPullItems";
import { useDropdownScrollKeeper } from "../hooks/useDropdownScrollKeeper";
import { useSupervisorPin } from "../hooks/useSupervisorPin";
import { updateSupervisorPin } from "../supervisorPinApi";
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
} from "../freezerSurplus";
import { useMixes } from "../hooks/useMixes";
import { useOptimisticMixUpdates } from "../hooks/useOptimisticMixUpdates";
import { useIngredients } from "../hooks/useIngredients";
import {
  invalidateMasterDataBootstrap,
  invalidateMasterDataSlice,
  setMasterDataSlice,
  shouldRefreshMasterData,
} from "../masterData";
import {
  saveIngredients as saveIngredientsRemote,
  deleteIngredients as deleteIngredientsRemote,
  mergeIngredientsRemote,
  mergeCatalogEntriesByName,
  findOrBuildIngredient,
} from "../ingredients";
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
import { useCycleCountSchedules } from "../hooks/useCycleCountSchedules";
import { markCycleCountCounted } from "../cycleCount";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cachedProfileKeys } from "../profileCache";
import ChangePasswordCard from "../components/ChangePasswordCard";
import RecipeSubstitutionBadge from "../components/RecipeSubstitutionBadge";
import { describeSubstitution } from "../components/SubstitutionsManager";
import MixReconcilePanel from "../components/MixReconcilePanel";
import ImportHistoryPanel from "../components/ImportHistoryPanel";
import { recordImportHistory, setImportHistoryIdentity, type ImportHistoryImportType, type ImportHistoryItem, type ImportHistoryReopenRequest } from "../importHistory";
import { resetSandboxRequest, reportUnauthorized } from "../inventoryShared";
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
} from "../ingredientBatchWeights";
import FillMissingPanel from "../components/FillMissingPanel";
import OperationalReportPanel, { type OperationalReportDetailRange } from "../components/OperationalReportPanel";
import ManagerActionQueue from "../components/ManagerActionQueue";
import ShiftHandoffDigest from "../components/ShiftHandoffDigest";
import ReportIssueDialog from "../components/ReportIssueDialog";
import GetStartedDialog from "../components/GetStartedDialog";
import { useGetStartedOverview } from "@workspace/onboarding";
import GuidedTour from "../components/GuidedTour";
import { moveEntries, relocateValues } from "@workspace/schedule-move";
import { findScheduledRecipeIssues } from "@workspace/scheduled-recipe-check";
import {
  applyRecipeSuggestion as applyRecipeSuggestionShared,
  type RecipeFieldId,
  type RecipeSuggestionLike,
} from "@workspace/recipe-apply";
import { buildDaySummaryInput, buildWeekSummaryInput } from "../aiSummary";
import { buildAnomalyInput } from "../aiAnomaly";
import { buildScheduleInput } from "../aiSchedule";
import { BehindPaceAlertBanner } from "../components/BehindPaceAlertBanner";
import {
  findFirstUnreadyScheduledRun,
  getStartRunReadiness,
} from "../startRunReadiness";
import { computeCasesInFreezer } from "@workspace/inventory-math";
import {
  computeRunConsumptionLines,
  consumeRun,
  consumeSauceBarrel,
  deriveCandidateItems,
  scoreNameMatch,
  type ConsumeLine,
  type RunConsumptionSource,
} from "../inventoryShared";
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
} from "../mergeIngredients";
import {
  type RecipeNameMergeCategory,
  RECIPE_NAME_FIELDS_BY_CATEGORY,
  countRecipeNameReferences,
  isStrayMixName,
  collectStaleRecipeLinkNames,
  buildStaleCleanupSuggestions,
} from "../mergeRecipeNames";
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
} from "../mergeSuggest";
import { saveAiCorrections } from "../aiCorrections";
import { AppSlotMathBadge } from "../components/AppSlotMathBadge";
import { detectAppSlotConflicts } from "@workspace/setup-math-check";
import { recordMemorySample, recordPerformance } from "../performanceDiagnostics";
import {
  buildActiveRunIds,
  buildPersistedRunValues,
  buildRunSummarySnapshot,
  overlayCurrentRunValues,
} from "../homePerformance";
import { syncRetryDelay } from "../syncRetry";

import { usePresentationCast } from "../hooks/usePresentationCast";
import {
  getAutoTrackTiming,
  suggestedDoughStaging,
  type AutoTrackEventClaim,
  type AutoTrackEventResult,
} from "../hooks/useAutoTrack";
import {
  publishAutoTrackCoordination,
  publishAutoTrackSchedule,
  subscribeAutoTrackCoordination,
  DOUGH_TIMER_CONTROL_EVENT,
  DOUGH_TIMER_CONTROL_ADOPT_EVENT,
} from "../autoTrackCoordinationClient";
import { capturePreEndLifecycle, fenceActiveManualSectionValues, fencePendingEndSnapshots, fencePendingOperationalValues, flushOperationalIntentOutbox, operationalIntentBlocksLifecycle, queueOperationalIntent, setOperationalIntentCanonicalAdopter, setOperationalIntentIdentity, submitManualSection } from "../operationalIntentOutbox";
import { MANUAL_SECTION_FIELDS, manualSectionForField } from "@workspace/sync-contract";
import { claimManualSectionLock, getManualSectionLock, releaseManualSectionLock, useManualControlConflict, useManualControlLock } from "../manualSectionLocks";
import { consumeOperationalMutationCursor } from "../operationalMutationCursor";
import { useBackButtonTrap } from "../hooks/useBackButtonTrap";
import { HOME_TABS, useHomeNavigation, type HomeTab } from "../hooks/useHomeNavigation";
import { useHomeRunIdentity } from "../hooks/useHomeRunIdentity";
import { useLiveRun, LiveRunProvider } from "../contexts/LiveRunContext";
import { calcRef } from "../liveRunCalc";
import { computeEffectiveLineSpeed } from "../lineSpeed";
import { createPackagingControlAdapter, createPackagingManager, runUnlockedManualSectionAction } from "../packagingManager";
import {
  type OperationalSnapshotReceipt,
} from "../operationalState";
import { HomeStationTabs } from "../components/HomeStationTabs";
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
} from "../departments";
// showAppNotification is imported from useNotifications to fire sauce push alerts
import { showAppNotification } from "../hooks/useNotifications";
import { getSauceBarrelEntry, mirrorSauceBarrelProgress } from "../sauceBarrelStore";
import { usePendingResetSummary } from "../hooks/usePendingResetCount";
import { useUnreviewedIncidentSummary } from "../hooks/useUnreviewedIncidentCount";
import { useProductionRules } from "../hooks/useProductionRules";
import { usePrepPhase, mergePrepPhaseClient, getPrepPhase, FRESH_PREP_PHASE } from "../hooks/usePrepPhase";
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
import { saveProductionRules, deleteProductionRules } from "../productionRules";
import { useMe } from "../useRole";
import { getImportAccess } from "../importAccess";
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
import { useDieLineDefaults } from "../hooks/useDieLineDefaults";
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
import { DeferredSurface } from "../departments/DeferredDepartmentSurface";

type NeedRow = { label: string; value: string; sub?: string; area?: WarehouseArea };
export function aggregatePackagingNeeds(valsList: FormValues[]): NeedRow[] {
  const circleMap = new Map<string, number>();
  const shipperMap = new Map<string, number>();
  let cartonCases = 0;
  let labelRolls = 0;
  let topLabelRolls = 0;
  let bottomLabelRolls = 0;
  for (const vals of valsList) {
    const cartonedVal = ((vals.cartoned as string) ?? "").trim().toLowerCase();
    if (cartonedVal === "labeled") {
      // Labeled runs need label rolls staged: rolls = total pizzas / labels
      // per roll, per position (top+bottom separately) when position is Both.
      const ls = computeSummaryStats(vals);
      if (ls.totalPizzas > 0) {
        const pos = ((vals.labelPosition as string) ?? "").trim().toLowerCase();
        if (pos === "both") {
          const top = Number(vals.topLabelsPerRoll) || 0;
          const bottom = Number(vals.bottomLabelsPerRoll) || 0;
          if (top > 0) topLabelRolls += ls.totalPizzas / top;
          if (bottom > 0) bottomLabelRolls += ls.totalPizzas / bottom;
        } else {
          const single = Number(vals.labelsPerRoll) || 0;
          if (single > 0) labelRolls += ls.totalPizzas / single;
        }
      }
      continue;
    }
    // Only cartoned runs contribute to the remaining packaging needs; "n-a"
    // runs are excluded entirely. Accepts legacy "yes" for pre-migration data.
    if (!isCartonedValue(vals.cartoned)) continue;
    const s = computeSummaryStats(vals);
    // Cartons are bought by the case: cases = total pizzas / cartons per case.
    const perCase = Number(vals.cartonsPerCase) || 0;
    if (perCase > 0 && s.totalPizzas > 0) cartonCases += s.totalPizzas / perCase;
    const circle = (vals.circles ?? "").trim();
    if (circle && circle.toLowerCase() !== "none" && s.totalPizzas > 0) {
      circleMap.set(circle, (circleMap.get(circle) ?? 0) + s.totalPizzas);
    }
    const shipper = (vals.shipper ?? "").trim();
    if (shipper && shipper.toLowerCase() !== "none" && s.totalCases > 0) {
      shipperMap.set(shipper, (shipperMap.get(shipper) ?? 0) + s.totalCases);
    }
  }
  const rows: NeedRow[] = [];
  for (const [type, n] of circleMap) rows.push({ label: `Circles — ${type}`, value: fmtNum(n, 0), sub: "circles", area: "Packaging" });
  for (const [type, n] of shipperMap) rows.push({ label: `Shippers — ${type}`, value: fmtNum(n, 0), sub: "shippers", area: "Packaging" });
  if (cartonCases > 0) rows.push({ label: "Cartons", value: fmtNum(Math.ceil(cartonCases), 0), sub: "cases", area: "Packaging" });
  if (labelRolls > 0) rows.push({ label: "Label Rolls", value: fmtNum(Math.ceil(labelRolls), 0), sub: "rolls", area: "Packaging" });
  if (topLabelRolls > 0) rows.push({ label: "Label Rolls — Top", value: fmtNum(Math.ceil(topLabelRolls), 0), sub: "rolls", area: "Packaging" });
  if (bottomLabelRolls > 0) rows.push({ label: "Label Rolls — Bottom", value: fmtNum(Math.ceil(bottomLabelRolls), 0), sub: "rolls", area: "Packaging" });
  return rows;
}

export function IngredientSelect({
  value,
  onChange,
  options,
  onAddOption,
  onRemoveOption,
  placeholder,
  optionLabels,
  ariaLabel,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption?: (v: string) => void;
  onRemoveOption?: (v: string) => void;
  placeholder?: string;
  // Optional display label per option value (e.g. brand tags for colliding
  // recipe names: "Taco Mix (Marco's)"). The VALUE stored stays the bare name.
  optionLabels?: ReadonlyMap<string, string>;
  ariaLabel?: string;
  testId?: string;
}) {
  const labelOf = (opt: string) => optionLabels?.get(opt) ?? opt;
  const isTouchDevice = useIsTouchDevice();
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const [rect, setRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollKeep = useDropdownScrollKeeper(open);
  const filtered = (options ?? []).filter(o =>
    labelOf(o).toLowerCase().includes(inputVal.toLowerCase())
  );

  function openDropdown() {
    setInputVal("");
    setConfirmDelete(null);
    confirmDeleteRef.current = null;
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const dropdownH = Math.min(filtered.length * 32 + 80, 280);
      setDropUp(spaceBelow < dropdownH && r.top > dropdownH);
      setRect({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
    }
    setOpen(true);
  }

  const dropStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.max(4, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 192) - 8)),
        width: Math.max(rect.width, 192),
        zIndex: 9999,
        ...(dropUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      }
    : {};

  if (isTouchDevice) {
    const accessibleLabel = (placeholder ?? "Select option").replace(/[.…]+$/, "").trim();
    return (
      <TouchOptionPicker
        value={value}
        options={(options ?? []).map((option) => ({
          value: option,
          label: labelOf(option),
        }))}
        onValueChange={onChange}
        placeholder={placeholder}
        title={ariaLabel ?? `Select ${accessibleLabel.toLocaleLowerCase()}`}
        aria-label={ariaLabel ?? placeholder ?? accessibleLabel}
        data-testid={testId}
        onAddOption={onAddOption}
        onRemoveOption={onRemoveOption}
      />
    );
  }

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={openDropdown}
        aria-label={ariaLabel}
        data-testid={testId}
        className="flex items-center gap-1 h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm hover:bg-muted/70 transition-colors w-full justify-between"
      >
        <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>
          {(value && labelOf(value)) || placeholder || "Select…"}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div
          style={dropStyle}
          className="bg-popover border border-border rounded-md shadow-xl py-1"
        >
          <input
            autoFocus
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && inputVal.trim() && onAddOption) {
                onAddOption(inputVal.trim());
                onChange(inputVal.trim());
                setOpen(false);
              }
              if (e.key === "Escape") setOpen(false);
            }}
            onBlur={() => setTimeout(() => { if (!confirmDeleteRef.current) setOpen(false); }, 150)}
            placeholder="Search or add…"
            className="w-full px-3 py-1.5 text-xs bg-transparent border-b border-border/50 outline-none"
          />
          <div ref={scrollKeep.listRef} onScroll={scrollKeep.onScroll} className="max-h-60 overflow-y-auto overscroll-contain">
            {filtered.map(opt =>
              confirmDelete === opt ? (
                <div key={opt} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                  <span className="text-[10px] text-destructive font-semibold truncate">Remove "{opt}"?</span>
                  <span className="flex gap-1 shrink-0">
                    <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { onRemoveOption?.(opt); confirmDeleteRef.current = null; setConfirmDelete(null); setOpen(false); }}>Yes</button>
                    <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteRef.current = null; setConfirmDelete(null); }}>No</button>
                  </span>
                </div>
              ) : (
                <div key={opt} className="flex items-center">
                  <button
                    type="button"
                    className={`flex-1 text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === opt ? "text-primary font-semibold" : ""}`}
                    onMouseDown={() => { onChange(opt); setOpen(false); }}
                  >
                    {labelOf(opt)}
                  </button>
                  {onRemoveOption && (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                      onMouseDown={e => { e.stopPropagation(); confirmDeleteRef.current = opt; setConfirmDelete(opt); }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )
            )}
            {inputVal.trim() && !(options ?? []).includes(inputVal.trim()) && onAddOption && (
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-muted transition-colors flex items-center gap-1"
                onMouseDown={() => { onAddOption(inputVal.trim()); onChange(inputVal.trim()); setOpen(false); }}
              >
                <Plus className="w-3 h-3" /> Add "{inputVal.trim()}"
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CheeseRecipeCard({
  label,
  batches,
  fields,
  recipe,
  fieldPrefix,
  recipeName,
  recipeNameOptions,
  register,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
  embedded,
}: {
  label: string;
  batches: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  fieldPrefix: string;
  recipeName: string;
  recipeNameOptions: string[];
  register: any;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  onAddRecipeName: (v: string) => void;
  onRemoveRecipeName: (v: string) => void;
  onRecipeNameChange: (v: string) => void;
  embedded?: boolean;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);

  const recipeSelector = (
    <div className="w-full sm:w-auto sm:flex-1 sm:max-w-xs">
      <IngredientSelect value={recipeName} onChange={onRecipeNameChange} options={recipeNameOptions} onAddOption={onAddRecipeName} onRemoveOption={onRemoveRecipeName} placeholder="Recipe name…" />
    </div>
  );

  const body = (
    <>
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-3">No ingredients yet. Add rows to build the blend.</p>
      ) : (
        <div className="w-full mb-3">
          <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_32px] gap-x-1 sm:grid-cols-[1fr_110px_110px_32px] sm:gap-x-2 mb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs<span className="hidden sm:inline"> / Batch</span></span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Total Lbs</span>
            <span />
          </div>
          <div className="space-y-1.5">
            {fields.map((field, idx) => {
              const rowLbs = Number(recipe[idx]?.lbs ?? 0);
              return (
                <div key={field.id} className={`grid gap-x-1 sm:gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[minmax(0,1fr)_76px_76px_auto] sm:grid-cols-[1fr_110px_110px_auto]" : "grid-cols-[minmax(0,1fr)_76px_76px_32px] sm:grid-cols-[1fr_110px_110px_32px]"}`}>
                  <IngredientSelect value={recipe[idx]?.ingredient ?? ""} onChange={val => onSetIngredient(idx, val)} options={ingredientOptions} onAddOption={onAddIngredient} onRemoveOption={onRemoveIngredient} />
                  <input {...register(`${fieldPrefix}.${idx}.lbs`, { valueAsNumber: true })} type="number" min="0" step="0.1" placeholder="0" onFocus={e => e.target.select()} className="h-8 px-1.5 sm:px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm text-right font-mono outline-none focus:border-primary/60 w-full" />
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(rowLbs * Math.max(1, batches), 1)}</div>
                  {confirmIdx === idx ? (
                    <div className="flex items-center gap-1">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmIdx(idx)} className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_32px] gap-x-1 sm:grid-cols-[1fr_110px_110px_32px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Total</span>
            <span className="text-xs font-mono text-right text-muted-foreground">{fmtNum(totalLbsPerBatch, 1)} lbs</span>
            <span className="text-xs font-mono text-right font-semibold text-foreground">{fmtNum(totalLbsPerBatch * Math.max(1, batches), 1)} lbs</span>
            <span />
          </div>
        </div>
      )}
      <button type="button" onClick={onAppend} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add Ingredient
      </button>
    </>
  );

  if (embedded) {
    return (
      <>
        <Separator className="my-3 opacity-30" />
        <div className="flex flex-wrap items-center gap-2 justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label} — Cheese Blend</span>
          {recipeSelector}
          <span className="text-xs text-muted-foreground shrink-0"><span className="font-mono text-foreground">{batches > 0 ? fmtNum(batches, 2) : "—"}</span> batches</span>
          <RecipeShareButtons recipe={{ title: `${label} — Cheese Blend`, name: recipeName, unit: "lbs/batch", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-amber-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label} — Cheese Blend Recipe</CardTitle>
          {recipeSelector}
          <span className="text-xs text-muted-foreground shrink-0"><span className="font-mono text-foreground">{batches > 0 ? fmtNum(batches, 2) : "—"}</span> batches</span>
          <RecipeShareButtons recipe={{ title: `${label} — Cheese Blend`, name: recipeName, unit: "lbs/batch", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

// Pick-only cheese card for the run applicators. Cheese blends are now
// factory-wide server master-data (managed on the Manage Lists → Cheese Recipes
// screen and imported from the "Cheese Mix Recipe Specs" workbook), so on the
// run the operator only PICKS one — its ingredient rows and shredder setting are
// read-only here. Picking hydrates the run's recipe rows so cheese still
// consumes exactly as before (cheese type → batches). Mirrors the mobile
// applicator cheese card (replit.md parity).
export function CheesePickCard({
  label,
  batches,
  ozPerPizza,
  recipe,
  substitutions,
  recipeName,
  recipeNameOptions,
  shredderSetting,
  cellulose,
  onRecipeNameChange,
  embedded,
  recipeMissing,
  poolComponents,
  optionLabels,
  recipePickerLabel,
  recipePickerTestId,
}: {
  label: string;
  batches: number;
  // The applicator's set Oz/Pizza for this blend. Drives the per-ingredient
  // "Oz / Pizza" column so its total lines up with what the operator entered.
  ozPerPizza: number;
  /** Today's temporary ingredient overlays. These affect display only here; the saved recipe stays untouched. */
  substitutions?: IngredientSubstitution[];
  recipe: RecipeRow[];
  // The picked recipe's components from the server cheese pool, when known.
  // Carries each ingredient's blend share (sharePct / ozPerPizza / lbs
  // priority — see @workspace/cheese-recipes), so the per-ingredient Oz/Pizza
  // column is target oz × share even when the hydrated rows only hold lbs.
  poolComponents?: CheeseComponent[];
  recipeName: string;
  recipeNameOptions: string[];
  shredderSetting: string;
  cellulose: string;
  onRecipeNameChange: (v: string) => void;
  embedded?: boolean;
  // True when a non-empty recipeName does NOT match any recipe in the server
  // cheese pool (e.g. a spec sheet referenced a blend name that was never
  // imported). Drives an inline "pick a real blend" warning instead of a
  // silent, confusing blank body.
  recipeMissing?: boolean;
  // Optional display label per recipe name (brand tags for colliding names).
  optionLabels?: ReadonlyMap<string, string>;
  recipePickerLabel?: string;
  recipePickerTestId?: string;
}) {
  const updateReloadBlockerId = useId();
  // A temporary substitution must be visible anywhere floor staff read the
  // blend. Apply it to this display copy rather than the form's saved rows, so
  // clearing tomorrow's overlay restores the original master recipe exactly.
  const effectiveRecipe = applyRecipeSubstitutions(recipe, substitutions);
  const displayRecipe = effectiveRecipe.rows;
  const totalLbsPerBatch = displayRecipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  // Scale each component up to the pounds to pull/mix for this run, using the
  // run's existing batch count so these numbers can never drift from the batch
  // and total-lbs figures on the card. Shared with mobile via @workspace/inventory-math.
  const pull = computeCheesePull(displayRecipe, batches);
  // Per-pizza ounces of each component: the applicator's target Oz/Pizza split
  // across ingredients by each one's SHARE of the blend, so the column total
  // equals the operator's set Oz/Pizza. When the server pool recipe is known
  // its components drive the shares (explicit sharePct first, then ozPerPizza,
  // then lbs proportions — @workspace/cheese-recipes); otherwise fall back to
  // the hydrated rows' lbs proportions (@workspace/inventory-math).
  const namedPool = (poolComponents ?? []).filter(c => c.ingredient.trim());
  const perPizzaOz =
    !effectiveRecipe.changed && namedPool.length > 0 && namedPool.length === displayRecipe.length
      ? cheesePerFlavorComponentOz(namedPool, ozPerPizza)
      : computeCheesePerPizzaOz(displayRecipe, ozPerPizza);
  // Always include the currently-picked name so a recipe assigned to another
  // brand/flavor (or since disabled) still shows instead of silently clearing.
  const options =
    recipeName.trim() && !recipeNameOptions.includes(recipeName)
      ? [recipeName, ...recipeNameOptions]
      : recipeNameOptions;

  const recipeSelector = (
    <div className="w-full sm:w-auto sm:flex-1 sm:max-w-xs">
      <TouchSelect
        value={recipeName}
        onChange={e => onRecipeNameChange(e.target.value)}
        aria-label={recipePickerLabel ?? "Pick a cheese recipe"}
        data-testid={recipePickerTestId}
        className="h-8 w-full px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm outline-none focus:border-primary/60"
      >
        <option value="">Pick a cheese recipe…</option>
        {options.map(name => (
          <option key={name} value={name}>{optionLabels?.get(name) ?? name}</option>
        ))}
      </TouchSelect>
    </div>
  );

  const showMissingWarning = recipeName.trim() !== "" && !!recipeMissing;
  useAutomaticUpdateReloadBlocker(
    `missing-cheese-recipe-${updateReloadBlockerId}`,
    showMissingWarning,
  );
  const body = (
    <>
      {effectiveRecipe.changed && (
        <div
          className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          data-testid="temporary-cheese-recipe-overlay"
        >
          Today&apos;s temporary substitution is reflected below. The saved cheese recipe is unchanged.
        </div>
      )}
      {showMissingWarning && (
        <div className="flex items-start gap-2 mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold text-amber-200">“{recipeName.trim()}”</span> isn't in Cheese Recipes — pick a blend above, or a manager can add it in Manage Lists.
          </span>
        </div>
      )}
      {(shredderSetting.trim() || cellulose.trim()) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-muted-foreground">
          {shredderSetting.trim() && (
            <span>Shredder setting: <span className="font-mono text-foreground">{shredderSetting}</span></span>
          )}
          {cellulose.trim() && (
            <span>Cellulose: <span className="font-mono text-foreground">{cellulose}</span></span>
          )}
        </div>
      )}
      {displayRecipe.length === 0 ? (
        showMissingWarning ? null : (
          <p className="text-xs text-muted-foreground mb-1">
            {recipeName.trim()
              ? "This cheese recipe has no ingredients yet. A manager can edit it under Manage Lists → Cheese Recipes."
              : "Pick a cheese recipe above to load its ingredients. Managers add recipes under Manage Lists → Cheese Recipes."}
          </p>
        )
      ) : (
        <div className="w-full mb-1">
          <div className="grid grid-cols-[minmax(0,1fr)_54px_54px_54px] gap-x-1 sm:grid-cols-[1fr_88px_88px_88px] sm:gap-x-2 mb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Oz<span className="hidden sm:inline"> / Pizza</span></span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs<span className="hidden sm:inline"> / Batch</span></span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Pull<span className="hidden sm:inline"> / Run</span></span>
          </div>
          <div className="space-y-1.5">
            {displayRecipe.map((row, idx) => {
              const rowLbs = Number(row.lbs ?? 0);
              return (
                <div key={idx} className="grid grid-cols-[minmax(0,1fr)_54px_54px_54px] gap-x-1 sm:grid-cols-[1fr_88px_88px_88px] sm:gap-x-2 items-center">
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm flex items-center truncate text-foreground/90">{row.ingredient || "—"}</div>
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(perPizzaOz.rows[idx] ?? 0, 2)}</div>
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(rowLbs, 1)}</div>
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(pull.rows[idx].lbs, 1)}</div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_54px_54px_54px] gap-x-1 sm:grid-cols-[1fr_88px_88px_88px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Total</span>
            <span className="text-xs font-mono text-right font-semibold text-foreground">{fmtNum(perPizzaOz.totalOz, 2)} oz</span>
            <span className="text-xs font-mono text-right text-muted-foreground">{fmtNum(totalLbsPerBatch, 1)} lbs</span>
            <span className="text-xs font-mono text-right text-muted-foreground">{fmtNum(pull.totalLbs, 1)} lbs</span>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <>
        <Separator className="my-3 opacity-30" />
        <div className="flex flex-wrap items-center gap-2 justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label} — Cheese Blend</span>
          {recipeSelector}
          <span className="text-xs text-muted-foreground shrink-0"><span className="font-mono text-foreground">{batches > 0 ? fmtNum(batches, 2) : "—"}</span> batches</span>
          <RecipeShareButtons recipe={{ title: `${label} — Cheese Blend`, name: recipeName, unit: "lbs/batch", rows: displayRecipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-amber-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label} — Cheese Blend Recipe</CardTitle>
          {recipeSelector}
          <span className="text-xs text-muted-foreground shrink-0"><span className="font-mono text-foreground">{batches > 0 ? fmtNum(batches, 2) : "—"}</span> batches</span>
          <RecipeShareButtons recipe={{ title: `${label} — Cheese Blend`, name: recipeName, unit: "lbs/batch", rows: displayRecipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

export function MixRecipeCard({
  label,
  totalRunLbs,
  fields,
  recipe,
  fieldPrefix,
  register,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  embedded,
  recipeName,
  recipeNameOptions,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
  recipeNameLabels,
  recipePickerLabel,
  recipePickerTestId,
}: {
  label: string;
  totalRunLbs: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  fieldPrefix: string;
  register: any;
  ingredientOptions: string[];
  onAddIngredient?: (v: string) => void;
  onRemoveIngredient?: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  embedded?: boolean;
  recipeName?: string;
  recipeNameOptions?: string[];
  onAddRecipeName?: (v: string) => void;
  onRemoveRecipeName?: (v: string) => void;
  onRecipeNameChange?: (v: string) => void;
  // Optional display label per recipe name (brand tags for colliding names).
  recipeNameLabels?: ReadonlyMap<string, string>;
  recipePickerLabel?: string;
  recipePickerTestId?: string;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const rowTotal = (rowLbs: number) =>
    totalLbsPerBatch > 0 ? (rowLbs / totalLbsPerBatch) * totalRunLbs : 0;

  const body = (
    <>
      {recipeNameOptions && onRecipeNameChange && (
        <div className="w-full sm:max-w-xs mb-3">
          <IngredientSelect value={recipeName ?? ""} onChange={onRecipeNameChange} options={recipeNameOptions} onAddOption={onAddRecipeName} onRemoveOption={onRemoveRecipeName} placeholder="Recipe name…" optionLabels={recipeNameLabels} ariaLabel={recipePickerLabel} testId={recipePickerTestId} />
        </div>
      )}
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-3">No ingredients yet. Add rows to build the mix.</p>
      ) : (
        <div className="w-full mb-3">
          <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_32px] gap-x-1 sm:grid-cols-[1fr_110px_110px_32px] sm:gap-x-2 mb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Oz<span className="hidden sm:inline"> / Pizza</span></span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Total Lbs</span>
            <span />
          </div>
          <div className="space-y-1.5">
            {fields.map((field, idx) => {
              const rowLbs = Number(recipe[idx]?.lbs ?? 0);
              return (
                <div key={field.id} className={`grid gap-x-1 sm:gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[minmax(0,1fr)_76px_76px_auto] sm:grid-cols-[1fr_110px_110px_auto]" : "grid-cols-[minmax(0,1fr)_76px_76px_32px] sm:grid-cols-[1fr_110px_110px_32px]"}`}>
                  <IngredientSelect value={recipe[idx]?.ingredient ?? ""} onChange={val => onSetIngredient(idx, val)} options={ingredientOptions} onAddOption={onAddIngredient} onRemoveOption={onRemoveIngredient} />
                  <input {...register(`${fieldPrefix}.${idx}.lbs`, { valueAsNumber: true })} type="number" min="0" step="0.1" placeholder="0" onFocus={e => e.target.select()} className="h-8 px-1.5 sm:px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm text-right font-mono outline-none focus:border-primary/60 w-full" />
                  <div className="h-8 px-1.5 sm:px-2 rounded bg-muted/20 border border-border/20 text-xs sm:text-sm text-right font-mono flex items-center justify-end text-foreground/80">{fmtNum(rowTotal(rowLbs), 1)}</div>
                  {confirmIdx === idx ? (
                    <div className="flex items-center gap-1">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmIdx(idx)} className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_32px] gap-x-1 sm:grid-cols-[1fr_110px_110px_32px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Total</span>
            <span className="text-xs font-mono text-right text-muted-foreground">{fmtNum(totalLbsPerBatch, 2)} oz</span>
            <span className="text-xs font-mono text-right font-semibold text-foreground">{fmtNum(totalRunLbs, 1)} lbs</span>
            <span />
          </div>
        </div>
      )}
      <button type="button" onClick={onAppend} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add Ingredient
      </button>
    </>
  );

  if (embedded) {
    return (
      <>
        <Separator className="my-3 opacity-30" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label} — Mix Recipe</span>
          <span className="text-xs text-muted-foreground"><span className="font-mono text-foreground">{fmtNum(totalRunLbs, 1)}</span> lbs needed</span>
          <RecipeShareButtons recipe={{ title: `${label} — Mix Recipe`, name: recipeName, unit: "oz/pizza", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-purple-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{label} — Mix Recipe</CardTitle>
          <span className="text-xs text-muted-foreground"><span className="font-mono text-foreground">{fmtNum(totalRunLbs, 1)}</span> lbs needed</span>
          <RecipeShareButtons recipe={{ title: `${label} — Mix Recipe`, name: recipeName, unit: "oz/pizza", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

export function DoughRecipeCard({
  batchesNeeded,
  fields,
  recipe,
  register,
  targetWeight,
  doughBatchYield,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  onTargetWeightChange,
  recipeName,
  recipeNameOptions,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
  recipePickerLabel,
  recipePickerTestId,
}: {
  batchesNeeded: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  register: any;
  targetWeight: number;
  doughBatchYield: number;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  onTargetWeightChange: (v: number) => void;
  recipeName: string;
  recipeNameOptions: string[];
  onAddRecipeName: (v: string) => void;
  onRemoveRecipeName: (v: string) => void;
  onRecipeNameChange: (v: string) => void;
  recipePickerLabel?: string;
  recipePickerTestId?: string;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const totalBatchWeight = totalLbsPerBatch * Math.max(1, batchesNeeded);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  // Recipe yield: how many doughballs does the batch make at the target weight?
  const recipeYield = targetWeight > 0 ? (totalLbsPerBatch * 16) / targetWeight : 0;
  // Run yield: what the line actually produced (from doughBatchYield field)
  const runYield = Number(doughBatchYield);
  const yieldDiff = runYield - recipeYield;

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-orange-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
            Dough Recipe
          </CardTitle>
          <div className="w-full sm:w-auto sm:flex-1 sm:max-w-xs">
            <IngredientSelect
              value={recipeName}
              onChange={onRecipeNameChange}
              options={recipeNameOptions}
              onAddOption={onAddRecipeName}
              onRemoveOption={onRemoveRecipeName}
              placeholder="Recipe name…"
              ariaLabel={recipePickerLabel}
              testId={recipePickerTestId}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            <span className="font-mono text-foreground">{batchesNeeded > 0 ? fmtNum(batchesNeeded, 2) : "—"}</span> batches needed
          </span>
          <RecipeShareButtons recipe={{ title: "Dough Recipe", name: recipeName, unit: "lbs/batch", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {/* Target weight + yield comparison */}
        <div className={`grid grid-cols-1 gap-3 mb-4 ${runYield > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div className="p-3 rounded-lg bg-muted/30">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
              Target Weight (oz)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={targetWeight || ""}
              onChange={e => onTargetWeightChange(Number(e.target.value))}
              onFocus={e => e.target.select()}
              placeholder="0.00"
              className="h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm font-mono outline-none focus:border-primary/60 w-full"
            />
          </div>
          <div className="p-3 rounded-lg bg-muted/30 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recipe Yield</p>
            <p className="text-xl font-mono font-bold text-foreground">
              {recipeYield > 0 ? fmtNum(recipeYield, 1) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">doughballs / batch</p>
          </div>
          {runYield > 0 && (
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Run Yield</p>
              <p className={`text-xl font-mono font-bold ${
                recipeYield > 0
                  ? Math.abs(yieldDiff) < 0.5 ? "text-green-400"
                    : yieldDiff < 0 ? "text-red-400"
                    : "text-amber-400"
                  : "text-foreground"
              }`}>
                {fmtNum(runYield, 1)}
              </p>
              {recipeYield > 0 && (
                <p className="text-[10px] text-muted-foreground font-mono">
                  {yieldDiff > 0 ? "+" : ""}{fmtNum(yieldDiff, 1)} vs recipe
                </p>
              )}
            </div>
          )}
        </div>

        {/* Ingredient rows */}
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">
            No ingredients yet. Add rows to build the recipe.
          </p>
        ) : (
          <div className="w-full mb-3">
            <div className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-x-1 sm:grid-cols-[1fr_120px_32px] sm:gap-x-2 mb-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs<span className="hidden sm:inline"> / Batch</span></span>
              <span />
            </div>
            <div className="space-y-1.5">
              {fields.map((field, idx) => (
                <div key={field.id} className={`grid gap-x-1 sm:gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[minmax(0,1fr)_88px_auto] sm:grid-cols-[1fr_120px_auto]" : "grid-cols-[minmax(0,1fr)_88px_32px] sm:grid-cols-[1fr_120px_32px]"}`}>
                  <IngredientSelect
                    value={recipe[idx]?.ingredient ?? ""}
                    onChange={val => onSetIngredient(idx, val)}
                    options={ingredientOptions}
                    onAddOption={onAddIngredient}
                    onRemoveOption={onRemoveIngredient}
                  />
                  <input
                    {...register(`doughRecipe.${idx}.lbs`, { valueAsNumber: true })}
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    onFocus={e => e.target.select()}
                    className="h-8 px-1.5 sm:px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm text-right font-mono outline-none focus:border-primary/60 w-full"
                  />
                  {confirmIdx === idx ? (
                    <div className="flex items-center gap-1">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmIdx(idx)}
                      className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-x-1 sm:grid-cols-[1fr_120px_32px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
              <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
              <span className="text-xs font-mono text-right font-semibold text-foreground">
                {fmtNum(totalLbsPerBatch, 1)} lbs
              </span>
              <span />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onAppend}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Ingredient
        </button>
      </CardContent>
    </Card>
  );
}

export function FrontlineRecipeCard({
  fields,
  recipe,
  register,
  ingredientOptions,
  onAddIngredient,
  onRemoveIngredient,
  onSetIngredient,
  onAppend,
  onRemove,
  recipeName,
  recipeNameOptions,
  onAddRecipeName,
  onRemoveRecipeName,
  onRecipeNameChange,
  embedded,
  recipePickerLabel,
  recipePickerTestId,
}: {
  fields: { id: string }[];
  recipe: RecipeRow[];
  register: any;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  recipeName: string;
  recipeNameOptions: string[];
  onAddRecipeName: (v: string) => void;
  onRemoveRecipeName: (v: string) => void;
  onRecipeNameChange: (v: string) => void;
  embedded?: boolean;
  recipePickerLabel?: string;
  recipePickerTestId?: string;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);

  const recipeSelector = (
    <div className="w-full sm:w-auto sm:flex-1 sm:max-w-xs">
      <IngredientSelect value={recipeName} onChange={onRecipeNameChange} options={recipeNameOptions} onAddOption={onAddRecipeName} onRemoveOption={onRemoveRecipeName} placeholder="Recipe name…" ariaLabel={recipePickerLabel} testId={recipePickerTestId} />
    </div>
  );

  const body = (
    <>
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-3">No ingredients yet. Add rows to build the recipe.</p>
      ) : (
        <div className="w-full mb-3">
          <div className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-x-1 sm:grid-cols-[1fr_120px_32px] sm:gap-x-2 mb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs<span className="hidden sm:inline"> / Batch</span></span>
            <span />
          </div>
          <div className="space-y-1.5">
            {fields.map((field, idx) => (
              <div key={field.id} className={`grid gap-x-1 sm:gap-x-2 items-center ${confirmIdx === idx ? "grid-cols-[minmax(0,1fr)_88px_auto] sm:grid-cols-[1fr_120px_auto]" : "grid-cols-[minmax(0,1fr)_88px_32px] sm:grid-cols-[1fr_120px_32px]"}`}>
                <IngredientSelect value={recipe[idx]?.ingredient ?? ""} onChange={val => onSetIngredient(idx, val)} options={ingredientOptions} onAddOption={onAddIngredient} onRemoveOption={onRemoveIngredient} />
                <input {...register(`frontlineRecipe.${idx}.lbs`, { valueAsNumber: true })} type="number" min="0" step="0.1" placeholder="0" onFocus={e => e.target.select()} className="h-8 px-1.5 sm:px-2 rounded bg-muted/40 border border-border/40 text-xs sm:text-sm text-right font-mono outline-none focus:border-primary/60 w-full" />
                {confirmIdx === idx ? (
                  <div className="flex items-center gap-1">
                    <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onClick={() => { onRemove(idx); setConfirmIdx(null); }}>Yes</button>
                    <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onClick={() => setConfirmIdx(null)}>No</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmIdx(idx)} className="h-8 w-8 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-x-1 sm:grid-cols-[1fr_120px_32px] sm:gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
            <span className="text-xs font-mono text-right font-semibold text-foreground">{fmtNum(totalLbsPerBatch, 1)} lbs</span>
            <span />
          </div>
        </div>
      )}
      <button type="button" onClick={onAppend} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add Ingredient
      </button>
    </>
  );

  if (embedded) {
    return (
      <>
        <Separator className="my-3 opacity-30" />
        <div className="flex flex-wrap items-center gap-2 justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Sauce Recipe</span>
          {recipeSelector}
          <RecipeShareButtons recipe={{ title: "Sauce Recipe", name: recipeName, unit: "lbs/batch", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-red-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Sauce Recipe</CardTitle>
          {recipeSelector}
          <RecipeShareButtons recipe={{ title: "Sauce Recipe", name: recipeName, unit: "lbs/batch", rows: recipe.map(r => ({ ingredient: r.ingredient ?? "", amount: Number(r.lbs ?? 0) })) }} />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 mt-5 first:mt-0">
      {children}
    </p>
  );
}

// useDropdownScrollKeeper lives in src/hooks/useDropdownScrollKeeper.ts
// (moved out of home.tsx so Fast Refresh is not broken by a hook export)

export function TypeDropdown({
  label,
  value,
  onChange,
  options,
  onAddOption,
  onRemoveOption,
  allowClear,
  ariaLabel,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption: (v: string) => void;
  onRemoveOption: (v: string) => void;
  allowClear?: boolean;
  ariaLabel?: string;
  testId?: string;
}) {
  const isTouchDevice = useIsTouchDevice();
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const [rect, setRect] = useState<{ top: number; bottom: number; right: number } | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollKeep = useDropdownScrollKeeper(open);
  const filtered = options.filter(o =>
    o.toLowerCase().includes(inputVal.toLowerCase())
  );

  const MENU_W = 176;
  function openDropdown() {
    setInputVal("");
    setConfirmDelete(null);
    confirmDeleteRef.current = null;
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const dropdownH = Math.min(filtered.length * 32 + 80, 240);
      setDropUp(spaceBelow < dropdownH && r.top > dropdownH);
      setRect({ top: r.top, bottom: r.bottom, right: r.right });
    }
    setOpen(true);
  }

  const dropStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.max(4, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8)),
        width: MENU_W,
        zIndex: 9999,
        ...(dropUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      }
    : {};

  if (isTouchDevice) {
    const touchOptions = [
      ...(allowClear && value ? [{ value: "", label: "— None" }] : []),
      ...options.map((option) => ({ value: option, label: option })),
    ];
    const accessibleLabel = ariaLabel ?? label;
    return (
      <TouchOptionPicker
        value={value}
        options={touchOptions}
        onValueChange={onChange}
        placeholder="Select…"
        title={accessibleLabel}
        aria-label={accessibleLabel}
        data-testid={testId}
        onAddOption={onAddOption}
        onRemoveOption={onRemoveOption}
      />
    );
  }

  return (
    <div className="flex items-center justify-between mb-2 mt-5 first:mt-0">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={openDropdown}
          aria-label={ariaLabel}
          data-testid={testId}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted/40 border border-border/40 text-xs font-semibold hover:bg-muted/70 transition-colors min-w-[110px] justify-between"
        >
          <span className={value ? "text-foreground" : "text-muted-foreground/50"}>
            {value || "Select…"}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>
        {open && (
          <div
            style={dropStyle}
            className="bg-popover border border-border rounded-md shadow-lg py-1"
          >
            <input
              autoFocus
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && inputVal.trim()) {
                  onAddOption(inputVal.trim());
                  onChange(inputVal.trim());
                  setOpen(false);
                }
                if (e.key === "Escape") setOpen(false);
              }}
              onBlur={() => setTimeout(() => { if (!confirmDeleteRef.current) setOpen(false); }, 150)}
              placeholder="Search or add…"
              className="w-full px-3 py-1.5 text-xs bg-transparent border-b border-border/50 outline-none"
            />
            <div ref={scrollKeep.listRef} onScroll={scrollKeep.onScroll} className="max-h-48 overflow-y-auto overscroll-contain">
              {allowClear && value && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors italic"
                  onMouseDown={() => { onChange(""); setOpen(false); }}
                >
                  — None
                </button>
              )}
              {filtered.map(opt =>
                confirmDelete === opt ? (
                  <div key={opt} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                    <span className="text-[10px] text-destructive font-semibold truncate">Remove "{opt}"?</span>
                    <span className="flex gap-1 shrink-0">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { onRemoveOption?.(opt); confirmDeleteRef.current = null; setConfirmDelete(null); setOpen(false); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteRef.current = null; setConfirmDelete(null); }}>No</button>
                    </span>
                  </div>
                ) : (
                  <div key={opt} className="flex items-center">
                    <button
                      type="button"
                      className={`flex-1 text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === opt ? "text-primary font-semibold" : ""}`}
                      onMouseDown={() => { onChange(opt); setOpen(false); }}
                    >
                      {opt}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                      onMouseDown={e => { e.stopPropagation(); confirmDeleteRef.current = opt; setConfirmDelete(opt); }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              )}
              {inputVal.trim() && !options.includes(inputVal.trim()) && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-muted transition-colors flex items-center gap-1"
                  onMouseDown={() => { onAddOption(inputVal.trim()); onChange(inputVal.trim()); setOpen(false); }}
                >
                  <Plus className="w-3 h-3" /> Add "{inputVal.trim()}"
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
export function NumField({
  control,
  name,
  label,
  step,
  testId,
  disabled,
  onCommit,
}: {
  control: any;
  name: keyof FormValues;
  label: string;
  step?: string;
  testId?: string;
  disabled?: boolean;
  onCommit?: (value: number) => void;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs text-muted-foreground">{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="decimal"
              step={step ?? "any"}
              className="font-mono bg-background/50 h-9 text-sm"
              data-testid={testId ?? `input-${name}`}
              disabled={disabled}
              {...field}
              onChange={(e) =>
                field.onChange(e.target.value === "" ? "" : Number(e.target.value))
              }
              onBlur={(e) => {
                field.onBlur();
                if (onCommit) {
                  const value = e.target.value === "" ? 0 : Number(e.target.value);
                  if (Number.isFinite(value) && value >= 0) onCommit(value);
                }
              }}
              onFocus={e => e.target.select()}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function NotesTextarea({ initialValue, onCommit, className }: { initialValue: string; onCommit: (v: string) => void; className?: string }) {
  const [local, setLocal] = useState(initialValue);
  const committed = useRef(initialValue);
  useEffect(() => { setLocal(initialValue); committed.current = initialValue; }, [initialValue]);
  return (
    <textarea
      rows={2}
      value={local}
      placeholder="Shift notes, line issues, observations…"
      className={className}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== committed.current) { committed.current = local; onCommit(local); } }}
    />
  );
}

// Format the sandbox "copied from live" ISO timestamp for the banner. Shows the
function PauseTunnelDecision({
  pausedAt,
  onChoose,
  onDismiss,
}: {
  pausedAt: number;
  onChoose: (stopTunnel: boolean) => void;
  onDismiss: () => void;
}) {
  const { nowTime } = useLiveRun();
  const remainingSec = Math.ceil(pauseDecisionRemainingMs(pausedAt, nowTime.getTime()) / 1000);
  return (
    <div
      className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-amber-600/40 bg-amber-950/20 py-3 px-4 flex-wrap"
      data-testid="pause-tunnel-decision"
    >
      <div className="min-w-[150px]">
        <p className="text-sm font-bold text-amber-300">Stopping freezer?</p>
        <p className="text-xs text-muted-foreground">
          Defaults to Yes in <span className="font-bold tabular-nums text-amber-300">{remainingSec}s</span>
        </p>
      </div>
      <button
        type="button"
        data-testid="pause-stop-tunnel-yes"
        className="px-4 py-1.5 rounded-md bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-colors"
        onClick={() => onChoose(true)}
      >Yes</button>
      <button
        type="button"
        data-testid="pause-stop-tunnel-no"
        className="px-4 py-1.5 rounded-md bg-muted hover:bg-muted/70 text-muted-foreground text-sm font-semibold transition-colors"
        onClick={() => onChoose(false)}
      >No</button>
      <button
        type="button"
        aria-label="Keep safe stop-tunnel default"
        className="text-xs text-muted-foreground hover:text-foreground underline"
        onClick={onDismiss}
      >Use default</button>
    </div>
  );
}

function OperationalStateBadge({
  overlay = false,
  displayState,
  receipt,
}: {
  overlay?: boolean;
  displayState: "confirmed" | "provisional" | "offline";
  receipt: OperationalSnapshotReceipt | null;
}) {
  const copy = displayState === "confirmed"
    ? "Confirmed server baseline"
    : displayState === "offline"
      ? "Offline — local projection"
      : "Provisional — awaiting server confirmation";
  const tone = displayState === "confirmed"
    ? "border-emerald-400/40 bg-emerald-950/40 text-emerald-200"
    : "border-amber-400/50 bg-amber-950/40 text-amber-100";
  return (
    <div
      className={`${overlay ? "pointer-events-none fixed bottom-3 left-3 z-20" : "w-fit"} rounded-full border px-3 py-1 text-[10px] font-semibold tracking-wide ${tone}`}
      data-testid="operational-state-badge"
      title={receipt
        ? `Server snapshot ${receipt.snapshotId.slice(0, 12)}`
        : "This device has not adopted a server calculation for the selected run"}
    >
      {copy}
    </div>
  );
}

function FloorModeView() {
  const {
    activeStopId, allergenWarnings, currentRun, doughSubTab,
    endRun, endStop, form, pauseDecisionRunId, pauseRun, resumeRun, runStatus,
    persistManualPackagingProgress,
    setPauseDecisionRunId, setPauseTunnelPolicy,
    setShowFloorMode, setShowStopDialog, setStopNotes, setStopReason,
    v, ve,
  } = useHomeCtx();

  const {
    calc, nowTime, liveFreezerMin, elapsedBatchSec, currentRunDowntimeMs,
    casesPct, casesFreezerPct, casesPctWithFreezer,
    currentBatchNum, secUntilNextBatch, totalBatchesNeeded,
    showBatchDue, setShowBatchDue,
    autoTrackProgress, setAutoTrackProgress, autoTrackSuggestion, tickDueRefs,
    stallPrompt, setStallPrompt, stallCheck,
    operationalDisplayState, operationalSnapshotReceipt,
  } = useLiveRun();
  const [confirmComplete, setConfirmComplete] = useState(false);
  const packagingLock = useManualControlLock(currentRun?.id, "floor-skid-done");
  const packagingConflict = useManualControlConflict(currentRun?.id, "floor-skid-done");
  const doughLock = useManualControlLock(currentRun?.id, "dough-trays");
  const sauceLock = useManualControlLock(currentRun?.id, "sauce-batches");
  const applicatorLocks = [
    useManualControlLock(currentRun?.id, "applicator-1-batches"),
    useManualControlLock(currentRun?.id, "applicator-2-batches"),
    useManualControlLock(currentRun?.id, "applicator-3-batches"),
    useManualControlLock(currentRun?.id, "applicator-4-batches"),
  ];
  const sectionLockedMessage = (lock: { peer?: boolean } | undefined) =>
    lock ? (lock.peer ? "This section is being updated on another device." : "Saving this section…") : undefined;

        const totalSkids = v.casesNeeded > 0 && v.casesPerSkid > 0 ? Math.ceil(v.casesNeeded / v.casesPerSkid) : 0;
        const floorStatus = runStatus === "ended" ? "paused" : runStatus === "pending" ? "paused" : runStatus;
        const hasActiveStop = !!activeStopId;
        const effectiveStatus: "running" | "paused" | "stopped" = hasActiveStop ? "stopped" : floorStatus === "paused" ? "paused" : "running";

        const bg = { running: "#071a0f", paused: "#1a1100", stopped: "#1a0707" }[effectiveStatus];
        const accentColor = { running: "#4ade80", paused: "#fbbf24", stopped: "#f87171" }[effectiveStatus];
        const accentBar = { running: "#22c55e", paused: "#f59e0b", stopped: "#ef4444" }[effectiveStatus];
        const badge = { running: "#14532d", paused: "#713f12", stopped: "#7f1d1d" }[effectiveStatus];
        const badgeText = { running: "#bbf7d0", paused: "#fef3c7", stopped: "#fee2e2" }[effectiveStatus];
        const statusLabel = hasActiveStop ? "STOPPAGE" : runStatus === "paused" ? "PAUSED" : runStatus === "running" ? "RUNNING" : runStatus === "ended" ? "ENDED" : "NOT STARTED";

        const pct = v.casesNeeded > 0 ? Math.min(1, calc.casesCompleted / v.casesNeeded) : 0;
        const mm = Math.floor(secUntilNextBatch / 60);
        const ss = Math.floor(secUntilNextBatch % 60);
        const batchStr = calc.timePerBatchSec > 0 && (runStatus === "running" || runStatus === "paused")
          ? `${fmtCountdownParts(mm, ss)}`
          : "—";
        const downtimeStr = currentRunDowntimeMs > 0 ? fmtTime(currentRunDowntimeMs / 1000) : "0m";
        const estFinish = calc.adjustedTimeSec > 0 && (runStatus === "running" || runStatus === "paused")
          ? fmtClock(Date.now() + calc.adjustedTimeSec * 1000)
          : "—";

        return (
          <div
            data-testid="floor-mode-overlay"
            className="fixed inset-0 z-[60] flex flex-col overflow-y-auto font-sans select-none"
            style={{ background: bg, color: "white" }}
          >
            <OperationalStateBadge
              overlay
              displayState={operationalDisplayState}
              receipt={operationalSnapshotReceipt}
            />
            {/* Header */}
            <header
                className="sticky top-0 z-10 flex justify-between items-center pb-2 shrink-0"
              style={{
                paddingTop: "calc(1.25rem + env(safe-area-inset-top))",
                paddingLeft: "calc(1.25rem + env(safe-area-inset-left))",
                paddingRight: "calc(1.25rem + env(safe-area-inset-right))",
              }}
            >
              <div className="flex flex-col gap-1.5">
                <span className="text-lg font-bold break-words min-w-0" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {currentRun ? runLabel(currentRun) : "No Active Run"}
                </span>
                <span className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest" style={{ background: badge, color: badgeText }}>
                  <span className="w-1.5 h-1.5 rounded-full motion-safe:animate-pulse" style={{ background: accentColor }} />
                  {statusLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowFloorMode(false)}
                aria-label="Exit Floor Mode and return to calculator"
                className="min-h-11 min-w-11 p-2.5 rounded-full transition-colors"
                style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}
                title="Exit floor mode"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="floor-drift flex min-h-full flex-1 flex-col">
            {/* Big three numbers */}
            <div className="flex-1 grid grid-cols-2 min-[700px]:grid-cols-3 items-center justify-items-center gap-4 min-h-[250px] px-4 py-3 sm:gap-7 sm:min-h-[360px]">
              <div className="flex flex-col items-center">
                <div className="text-6xl sm:text-8xl leading-none font-black tracking-tight tabular-nums">{fmtComma(calc.casesCompleted)}</div>
                <div className="text-sm font-bold tracking-[0.2em] mt-1.5" style={{ color: accentColor, opacity: 0.75 }}>CASES DONE</div>
                {calc.casesInFreezer > 0 && (
                  <div className="text-lg font-bold tabular-nums mt-1" style={{ color: "#7dd3fc" }}>+{fmtComma(calc.casesInFreezer)} IN FREEZE TUNNEL</div>
                )}
              </div>
              <div className="flex flex-col items-center">
                <div className="text-[76px] leading-none font-black tracking-tight tabular-nums" style={{ color: "rgba(255,255,255,0.85)" }}>
                  {v.skidsCompleted}{totalSkids > 0 ? ` / ${totalSkids}` : ""}
                </div>
                <div className="text-sm font-bold tracking-[0.2em] mt-1.5" style={{ color: accentColor, opacity: 0.75 }}>SKIDS</div>
              </div>
              {doughSubTab !== "crusts" && (
                <div className="flex flex-col items-center">
                  <div
                    className={`text-5xl sm:text-8xl leading-none font-black tracking-tight tabular-nums ${
                      mm === 0 && ss < 120 && runStatus === "running" ? "motion-safe:animate-pulse" : ""
                    }`}
                    style={{ color: accentColor }}
                  >
                    {batchStr}
                  </div>
                  <div className="text-sm font-bold tracking-[0.2em] mt-1.5" style={{ color: accentColor, opacity: 0.75 }}>NEXT BATCH</div>
                </div>
              )}
            </div>

            {/* Bottom */}
            <div className="sticky bottom-0 px-3 pt-3 space-y-3 shrink-0 sm:px-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))", background: `linear-gradient(transparent, ${bg} 12%)` }}>
              {/* Smarter insights: pace, ETA, supply + food-safety heads-up */}
              {(() => {
                type Chip = { key: string; label: string; bg: string; fg: string };
                const chips: Chip[] = [];
                if ((runStatus === "running" || runStatus === "paused") && calc.paceStatus) {
                  const paceMap = {
                    ahead: { label: `▲ ${Math.abs(calc.paceDelta)} ahead`, bg: "rgba(22,101,52,0.5)", fg: "#bbf7d0" },
                    behind: { label: `▼ ${Math.abs(calc.paceDelta)} behind`, bg: "rgba(127,29,29,0.5)", fg: "#fecaca" },
                    "on-pace": { label: "✓ On pace", bg: "rgba(255,255,255,0.08)", fg: "rgba(255,255,255,0.85)" },
                  } as const;
                  const p = paceMap[calc.paceStatus];
                  chips.push({ key: "pace", label: p.label, bg: p.bg, fg: p.fg });
                }
                if (estFinish !== "—") {
                  chips.push({ key: "eta", label: `ETA ${estFinish}`, bg: "rgba(255,255,255,0.08)", fg: "rgba(255,255,255,0.85)" });
                }
                if (calc.doughShortCases > 0) {
                  chips.push({ key: "dough", label: `Dough short ${Math.ceil(calc.doughShortCases)} cases`, bg: "rgba(127,29,29,0.5)", fg: "#fecaca" });
                }
                if (allergenWarnings.length > 0) {
                  chips.push({ key: "allergen", label: `⚠ Allergen ×${allergenWarnings.length}`, bg: "rgba(113,63,18,0.6)", fg: "#fde68a" });
                }
                if (chips.length === 0) return null;
                return (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {chips.map((c: any) => (
                      <span key={c.key} className="px-3 py-1.5 rounded-full text-sm font-bold tabular-nums" style={{ background: c.bg, color: c.fg }}>
                        {c.label}
                      </span>
                    ))}
                  </div>
                );
              })()}
              {/* Progress */}
              <div className="px-1 space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                  <span>RUN PROGRESS</span>
                  <span>{Math.round(pct * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, background: accentBar }} />
                </div>
              </div>

              {/* Status strip */}
              <div className="text-center font-mono text-xs" style={{ color: "rgba(255,255,255,0.28)" }}>
                {estFinish !== "—" && <>Est. finish: {estFinish}<span style={{ color: "rgba(255,255,255,0.12)", margin: "0 8px" }}>·</span></>}
                {calc.ppm > 0 && <>PPM: {fmtComma(calc.ppm)}<span style={{ color: "rgba(255,255,255,0.12)", margin: "0 8px" }}>·</span></>}
                Downtime: {downtimeStr}
              </div>

              {/* Frontline reference */}
              {(() => {
                const s = calc;
                type FLItem = { label: string; oz: number; value: string };
                const items: FLItem[] = [];
                if (v.frontlineRecipeName.trim() && v.sauceOzPerPizza > 0) {
                  const bd = s.sauceBatches > 0 ? sauceBarrelBreakdown(s.sauceBatches, s.sauceEffBarrel) : null;
                  const valStr = s.sauceBatches > 0
                    ? (bd ? `${fmtNum(s.sauceBatches, 1)}bt · ${bd.totalBarrels}bbl` : `${fmtNum(s.sauceBatches, 1)} batches`)
                    : "";
                  items.push({ label: v.frontlineRecipeName, oz: v.sauceOzPerPizza, value: valStr });
                }
                const apps = [
                  { type: v.app1Type, oz: v.app1OzPerPizza, lbs: s.app1Lbs, batches: s.app1Batches, isMix: v.app1Type.trim().toLowerCase().includes("mix") },
                  { type: v.app2Type, oz: v.app2OzPerPizza, lbs: s.app2Lbs, batches: s.app2Batches, isMix: v.app2Type.trim().toLowerCase().includes("mix") },
                  { type: v.app3Type, oz: v.app3OzPerPizza, lbs: s.app3Lbs, batches: s.app3Batches, isMix: v.app3Type.trim().toLowerCase().includes("mix") },
                  { type: v.app4Type, oz: v.app4OzPerPizza, lbs: s.app4Lbs, batches: s.app4Batches, isMix: v.app4Type.trim().toLowerCase().includes("mix") },
                ];
                for (const a of apps) {
                  if (!a.type.trim() || a.oz <= 0) continue;
                  const valStr = a.isMix
                    ? (a.lbs > 0 ? `${fmtNum(a.lbs, 1)} lbs` : "")
                    : (a.batches > 0 ? `${fmtNum(a.batches, 1)} batches` : "");
                  items.push({ label: a.type, oz: a.oz, value: valStr });
                }
                if (items.length === 0) return null;
                return (
                  <details className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <summary className="min-h-11 flex cursor-pointer items-center text-sm font-bold tracking-wide">Frontline details</summary>
                    <div className="text-[9px] font-bold tracking-[0.18em] mb-2" style={{ color: "rgba(255,255,255,0.25)" }}>FRONTLINE</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)` }}>
                      {items.map((item: any, i: any) => (
                        <div key={i} className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-semibold truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{item.label}</span>
                          <span className="text-sm font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.85)" }}>{item.oz} oz</span>
                          {item.value && <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{item.value}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}

              {pauseDecisionRunId === currentRun?.id && currentRun?.pausedAt && (
                <PauseTunnelDecision
                  pausedAt={currentRun.pausedAt}
                  onChoose={setPauseTunnelPolicy}
                  onDismiss={() => setPauseDecisionRunId(null)}
                />
              )}
              {/* Action buttons */}
              {(runStatus === "running" || runStatus === "paused") && (
                <div className="grid grid-cols-3 gap-2" aria-label="Case corrections">
                  {(packagingLock || packagingConflict) && <p role="status" aria-live="polite" className="col-span-3 text-center text-xs text-amber-200">{packagingConflict ?? sectionLockedMessage(packagingLock)}</p>}
                  <button type="button" data-testid="floor-cases-minus" aria-label="Correct cases down by one" onClick={() => {
                    runUnlockedManualSectionAction(() => !!getManualSectionLock(currentRun?.id ?? "", "packaging")?.peer, () => {
                      const before = {
                        skidsCompleted: Number(form.getValues("skidsCompleted")) || 0,
                        casesOnCurrentSkid: Number(form.getValues("casesOnCurrentSkid")) || 0,
                      };
                      const nextCases = Math.max(0, before.casesOnCurrentSkid - 1);
                      persistManualPackagingProgress(currentRun?.id ?? "", before.skidsCompleted, nextCases, undefined, before);
                      form.setValue("casesOnCurrentSkid", nextCases, { shouldDirty: true });
                    });
                  }} disabled={!!packagingLock} className="min-h-12 rounded-xl text-lg font-bold disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "rgba(255,255,255,0.08)" }}>−1 case</button>
                  <div className="flex items-center justify-center text-center text-xs font-bold tracking-wide" style={{ color: "rgba(255,255,255,0.65)" }}>CORRECT<br />COUNT</div>
                  <button type="button" data-testid="floor-cases-plus" aria-label="Correct cases up by one" onClick={() => {
                    runUnlockedManualSectionAction(() => !!getManualSectionLock(currentRun?.id ?? "", "packaging")?.peer, () => {
                      const before = {
                        skidsCompleted: Number(form.getValues("skidsCompleted")) || 0,
                        casesOnCurrentSkid: Number(form.getValues("casesOnCurrentSkid")) || 0,
                      };
                      const nextCases = incrementFloorCaseCount(
                        before.casesOnCurrentSkid,
                        Number(form.getValues("casesPerSkid")) || 0,
                      );
                      persistManualPackagingProgress(currentRun?.id ?? "", before.skidsCompleted, nextCases, undefined, before);
                      form.setValue("casesOnCurrentSkid", nextCases, { shouldDirty: true });
                    });
                  }} disabled={!!packagingLock || (v.casesPerSkid > 0 && v.casesOnCurrentSkid >= v.casesPerSkid)} className="min-h-12 rounded-xl text-lg font-bold disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "rgba(255,255,255,0.08)" }}>+1 case</button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {hasActiveStop ? (
                  <button
                    type="button"
                    onClick={endStop}
                    className="min-h-[64px] rounded-2xl font-bold text-base flex items-center justify-center gap-2 motion-safe:animate-pulse transition-colors"
                    style={{ background: "rgba(234,88,12,0.5)", color: "#fed7aa", border: "1px solid rgba(234,88,12,0.4)" }}
                  >
                    <CircleDot className="w-5 h-5" /> End Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setStopReason(""); setStopNotes(""); setShowStopDialog(true); }}
                    className="min-h-[64px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: "rgba(127,29,29,0.45)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    🛑 Log Stop
                  </button>
                )}
                {runStatus === "running" && (
                  <button
                    type="button"
                    onClick={pauseRun}
                    data-testid="floor-pause-run"
                    className="min-h-[64px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#fbbf24", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    ⏸ Pause
                  </button>
                )}
                {runStatus === "paused" && (
                  <button
                    type="button"
                    onClick={resumeRun}
                    data-testid="floor-resume-run"
                    className="min-h-[64px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: "rgba(22,101,52,0.5)", color: "#86efac", border: "1px solid rgba(74,222,128,0.2)" }}
                  >
                    ▶ Resume
                  </button>
                )}
                {(runStatus === "running" || runStatus === "paused") && (
                  <button
                    type="button"
                    onClick={() => {
                      runUnlockedManualSectionAction(
                        () => !!getManualSectionLock(currentRun?.id ?? "", "packaging")?.peer,
                        () => {
                          navigator.vibrate?.(15);
                          const before = {
                            skidsCompleted: Number(form.getValues("skidsCompleted")) || 0,
                            casesOnCurrentSkid: Number(form.getValues("casesOnCurrentSkid")) || 0,
                          };
                          const nextSkids = before.skidsCompleted + 1;
                          persistManualPackagingProgress(currentRun?.id ?? "", nextSkids, 0, undefined, before);
                          form.setValue("skidsCompleted", nextSkids, { shouldDirty: true });
                          form.setValue("casesOnCurrentSkid", 0, { shouldDirty: true });
                        },
                      );
                    }}
                    data-testid="floor-skid-done"
                    disabled={!!packagingLock}
                    className="min-h-[64px] rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: accentBar, color: bg }}
                  >
                    ✅ Skid Done
                  </button>
                )}
                {(runStatus === "running" || runStatus === "paused") && (
                  <button
                    type="button"
                    data-testid="floor-complete-run"
                    onClick={() => setConfirmComplete(true)}
                    className="min-h-[64px] rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: "rgba(127,29,29,0.65)", color: "#fecaca", border: "1px solid rgba(248,113,113,0.35)" }}
                  >
                    <Square className="w-5 h-5 fill-current" /> Complete Run
                  </button>
                )}
              </div>
              <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Complete this run?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This ends production tracking for {currentRun ? runLabel(currentRun) : "the active run"} and advances to the next queued run.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep running</AlertDialogCancel>
                    <AlertDialogAction data-testid="floor-confirm-complete-run" className="bg-red-700 hover:bg-red-600" onClick={() => endRun(currentRun?.id)}>
                      Complete run
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            </div>
          </div>
        );
}

// GlanceOverlay is defined in src/components/GlanceOverlay.tsx and imported
// at the top of this file.  It lives in its own module so it can be tested in
// isolation (rendering the real component with real providers) without pulling
// the full home.tsx dependency tree into the test environment.

// CompactRunStrip is defined in src/components/CompactRunStrip.tsx and imported
// at the top of this file.  Same rationale as GlanceOverlay above.

// ─── ElapsedTimeBadge ────────────────────────────────────────────────────────
// Pure presentational helper: given the three clock values, computes the
// display-safe elapsed string (with forward-drift upper-bound cap) and renders
// it as a plain span.  Exported so component-level tests can render the REAL
// implementation rather than re-implementing the expression inline.
//
// Cap logic (both clamps applied):
//   lower: Math.max(0, nowMs - pausedAt)  — future pausedAt adds nothing
//   upper: Math.min(runAge, …)            — addend never exceeds the run's age
// This bounds the displayed total to [runAge, 2 × runAge] regardless of clock skew.
export function ElapsedTimeBadge({
  nowMs,
  startedAt,
  pausedAt,
  "data-testid": testId,
  className,
}: {
  nowMs: number;
  startedAt: number;
  pausedAt?: number | null;
  "data-testid"?: string;
  className?: string;
}) {
  const runAge = nowMs - startedAt;
  const addend = pausedAt != null
    ? Math.min(runAge, Math.max(0, nowMs - pausedAt))
    : 0;
  return <span data-testid={testId} className={className}>{fmtElapsed(runAge + addend)}</span>;
}

/**
 * SetupMathConflictBadge — aggregate math conflicts for the Setup header.
/**
/**
 *
 * The count is intentionally derived during render so edits to any applicator
 * slot are reflected immediately, including in-place recipe-row updates from
 * react-hook-form.
 */
export function SetupMathConflictBadge({
  slots,
}: {
  slots: Array<{
    rows?: RecipeRow[];
    ozPerPizza?: number;
  }>;
}) {
  const conflictCount = slots.reduce(
    (count, slot) =>
      count +
      detectAppSlotConflicts(
        (slot.rows ?? []) as { ingredient: string; lbs: number }[],
        Number(slot.ozPerPizza) || 0,
      ).length,
    0,
  );

  if (conflictCount === 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400"
      data-testid="setup-math-conflict-count"
      aria-label={`${conflictCount} math conflict${conflictCount === 1 ? "" : "s"}`}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {conflictCount} math conflict{conflictCount === 1 ? "" : "s"}
    </span>
  );
}

/**
 * PerRunMixSlotBadge — the math-check badge as it appears on the per-run
 * Setup tab in home.tsx (not the standalone Profile Editor).
 *
 * Encapsulates the isMix gate and AppSlotMathBadge mounting logic that
 * home.tsx applies for each of the four applicator slots. Exported so the
 * per-run Setup tab badge wiring can be directly render-tested without
 * mounting the full home.tsx form.
 *
 * home.tsx uses this for app1–app4 with:
 *   appType  = v.appNType
 *   rows     = v.appNCheeseRecipe ?? []
 *   ozPerPizza = Number(v.appNOzPerPizza) || 0
 *   onResolveByRowSum = (newOz) => form.setValue("appNOzPerPizza", newOz, { shouldDirty: true })
 *   onResolveByTotal  = (scaledRows) => { form.setValue("appNCheeseRecipe", scaledRows, ...); replaceCheeseN(scaledRows); }
 */
export function PerRunMixSlotBadge({
  appType,
  rows,
  ozPerPizza,
  onResolveByRowSum,
  onResolveByTotal,
}: {
  appType: string;
  rows: RecipeRow[];
  ozPerPizza: number;
  onResolveByRowSum: (newOz: number) => void;
  onResolveByTotal: (scaledRows: RecipeRow[]) => void;
}) {
  if (!appType.trim().toLowerCase().includes("mix")) return null;
  return (
    <AppSlotMathBadge
      rows={rows}
      ozPerPizza={ozPerPizza}
      onResolveByRowSum={onResolveByRowSum}
      onResolveByTotal={onResolveByTotal}
    />
  );
}

export { PauseTunnelDecision, OperationalStateBadge };
