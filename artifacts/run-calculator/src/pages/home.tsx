import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
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
  type RunTemplate,
  DEFAULT_VALUES,
  PACKAGING_FIELDS,
  DAY_KEY,
  STOP_REASONS_KEY,
  SUPERVISOR_PIN_KEY,
  DEFAULT_STOP_REASONS,
  DEFAULT_SUPERVISOR_PIN,
  DEFAULT_PEP_TYPES,
  PEP_TYPE_RENAMES,
  RETIRED_PEP_TYPES,
  INGREDIENT_RENAMES,
  DEFAULT_DIE_TYPES,
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
  MAX_TEMPLATES,
  BRANDS_KEY,
  HISTORY_KEY,
  MAX_HISTORY_DAYS,
  type MasterDataChange,
  type MasterDataChangeType,
  type IngredientSubstitution,
  type SubstitutionLogEntry,
} from "../types";
import {
  fmtElapsed,
  fmtTime,
  fmtNum,
  fmtComma,
  fmtClock,
  computeSummaryStats,
  sauceBarrelBreakdown,
  genId,
  todayStr,
  runLabel,
} from "../utils";
import { setActiveSubstitutions } from "../substitutionState";
import {
  freshDayState,
  loadDayState,
  saveDayState,
  loadHistory,
  archiveDayToHistory,
  loadRunValues,
  saveRunValues,
  loadRunValuesUpdated,
  saveRunValuesUpdated,
  markRunValuesUpdated,
  deepEqual,
  pickCurrentRunPushValue,
  isEmptyOverPopulated,
  loadTemplates,
  saveTemplates,
  loadProfile,
  saveProfile,
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
  applyMixSeedIfNeeded,
  applyMixSeedV14IfNeeded,
  applyMixSeedV15IfNeeded,
  applyPepTaxonomyMigrationIfNeeded,
  applyIngredientDedupeMigrationIfNeeded,
  applySpecProfilesSeedIfNeeded,
  applyDieTypesSeedIfNeeded,
  applyDoughSpecsSeedIfNeeded,
  applySauceSpecsSeedIfNeeded,
  applyCheeseSpecsSeedIfNeeded,
  applyIngredientMerge,
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
  flavorNamespace,
  captureMasterDataSnapshot,
  recordMasterDataChange,
  loadChangeHistory,
  undoChange,
  STALE_BRANDS,
  SEED_MIX_RECIPE_NAMES,
} from "../storage";
import { findMixPresets, type MixPreset } from "../mixPresets";
import { MIX_SEED } from "../mixSeed";
import InventoryTab from "../components/InventoryTab";
import RolesManager from "../components/RolesManager";
import ProductionRulesManager from "../components/ProductionRulesManager";
import FreezerPullItemsManager from "../components/FreezerPullItemsManager";
import CycleCountManager from "../components/CycleCountManager";
import ReorderCard from "../components/ReorderCard";
import UseFirstCard from "../components/UseFirstCard";
import ScheduledRecipeWarningCard from "../components/ScheduledRecipeWarningCard";
import { useFreezerPullItems } from "../hooks/useFreezerPullItems";
import { useRunTemplates } from "../hooks/useRunTemplates";
import { useSupervisorPin } from "../hooks/useSupervisorPin";
import { saveRunTemplates, deleteRunTemplates } from "../runTemplatesApi";
import { updateSupervisorPin } from "../supervisorPinApi";
import { buildFreezerPullPlan } from "@workspace/freezer-pull";
import MixesManager from "../components/MixesManager";
import { useMixes } from "../hooks/useMixes";
import { buildMixPlan, type Mix } from "@workspace/mixes";
import {
  buildCycleCountDueList,
  DEFAULT_CYCLE_COUNT_SECTIONS,
} from "@workspace/cycle-count";
import { useCycleCountSchedules } from "../hooks/useCycleCountSchedules";
import { markCycleCountCounted } from "../cycleCount";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import StaffRolesCard from "../components/StaffRolesCard";
import ChangePasswordCard from "../components/ChangePasswordCard";
import RecipeSubstitutionBadge from "../components/RecipeSubstitutionBadge";
import { describeSubstitution } from "../components/SubstitutionsManager";
import AssistantTab from "../components/AssistantTab";
import SpecReconcilePanel from "../components/SpecReconcilePanel";
import MixReconcilePanel from "../components/MixReconcilePanel";
import MixAssistChat from "../components/MixAssistChat";
import {
  dispatchVoiceCommand,
  type VoiceCommandAction,
  type VoiceCommandHandlers,
  type VoiceCommandResult,
} from "@workspace/voice-commands";
import { restockInventory, adjustInventory, resetSandboxRequest } from "../inventoryShared";
import FillMissingPanel from "../components/FillMissingPanel";
import IncidentsTab from "../components/IncidentsTab";
import QualityHistoryTab from "../components/QualityHistoryTab";
import ReportIssueDialog from "../components/ReportIssueDialog";
import GetStartedDialog from "../components/GetStartedDialog";
import QRCode from "react-qr-code";
import { useGetStartedOverview } from "@workspace/onboarding";
import GuidedTour from "../components/GuidedTour";
import { buildOptimizeInput, type OptimizeAction } from "../aiOptimize";
import {
  buildRecipeAssistContext,
  type RecipeAssistSuggestion,
  type RecipeFieldId,
} from "../aiRecipe";
import { applyRecipeSuggestion as applyRecipeSuggestionShared } from "@workspace/recipe-apply";
import { moveEntries, relocateValues } from "@workspace/schedule-move";
import { buildForecastInput, buildForecastAccuracyInput, type ForecastPlan } from "../aiForecast";
import { buildDaySummaryInput, buildWeekSummaryInput } from "../aiSummary";
import { buildAnomalyInput } from "../aiAnomaly";
import { buildScheduleInput } from "../aiSchedule";
import { useProactiveAlert } from "../aiProactive";
import ProactiveAlertBanner from "../components/ProactiveAlertBanner";
import {
  computeRunConsumptionLines,
  deriveCandidateItems,
  consumeRun,
  fetchInventory,
  mergeInventory,
  scoreNameMatch,
  buildReorderDemandByKey,
  type MergeInventoryLine,
} from "../inventoryShared";
import {
  buildMergeMap,
  countMergeReferences,
  mapName,
  type MergeMap,
} from "../mergeIngredients";
import { collectMergeAliases, type MergeSuggestion } from "@workspace/merge-suggest";
import {
  ALLERGENS,
  allergenMeta,
  allergenSequenceWarnings,
  isAllergen,
  normalizeAllergen,
  type Allergen,
  type AllergenSequenceItem,
} from "@workspace/allergen";
import { suggestMerges, saveMergeAliases, denyMerge, fetchMergedAwayNames, saveMergedAwayNames, deleteMergedAwayNames, type ReviewedMergeSuggestion } from "../mergeSuggest";
import { saveAiCorrections } from "../aiCorrections";
import ReviewBadge from "../components/ReviewBadge";

import { useClock } from "../hooks/useClock";
import { useAutoTrack } from "../hooks/useAutoTrack";
import { useNotifications } from "../hooks/useNotifications";
import { usePendingResetCount } from "../hooks/usePendingResetCount";
import { useUnreviewedIncidentCount } from "../hooks/useUnreviewedIncidentCount";
import { useProductionRules } from "../hooks/useProductionRules";
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
  Bookmark,
  BookmarkCheck,
  OctagonX,
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
  Smartphone,
  Snowflake,
  Blend,
  ClipboardCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/AuthContext";
import * as XLSX from "xlsx";
import {
  buildRunExportRow,
  buildRunWorkbook,
  buildQuickBooksCsv,
  parseRunWorkbook,
  filterImportFromDate,
  type ImportParseResult,
} from "@/utils/runExcel";
import ExcelImportDialog, { type ImportCommit } from "@/components/ExcelImportDialog";
import SpecImportDialog from "@/components/SpecImportDialog";
import { prepareSpecImport, prepareSpecImportMulti, commitSpecImport, MAX_SPEC_IMPORT_FILES, type SpecImportPrepared } from "@/specImport";
import PremixImportDialog from "@/components/PremixImportDialog";
import { preparePremixImport, commitPremixImport, MAX_PREMIX_IMPORT_FILES, type PremixImportPrepared } from "@/premixImport";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

applyMixSeedIfNeeded();
applyMixSeedV14IfNeeded();
applyMixSeedV15IfNeeded();
applySpecProfilesSeedIfNeeded();
applyPepTaxonomyMigrationIfNeeded();
applyIngredientDedupeMigrationIfNeeded();
applyDieTypesSeedIfNeeded();
applyDoughSpecsSeedIfNeeded();
applySauceSpecsSeedIfNeeded();
applyCheeseSpecsSeedIfNeeded();

type NeedRow = { label: string; value: string; sub?: string };

function buildNeedRows(vals: FormValues): {
  dough: NeedRow[];
  sauce: NeedRow[];
  applicators: NeedRow[];
  pep: NeedRow[];
  all: NeedRow[];
} {
  const s = computeSummaryStats(vals);
  const dough: NeedRow[] = [];
  const sauce: NeedRow[] = [];
  const applicators: NeedRow[] = [];
  const pep: NeedRow[] = [];
  {
    const dRecipeLbs = (vals.doughRecipe ?? []).reduce((acc, r) => acc + Number(r.lbs ?? 0), 0);
    const effYield =
      dRecipeLbs > 0 && vals.targetDoughballWeight > 0
        ? (dRecipeLbs * 16) / vals.targetDoughballWeight
        : vals.doughBatchYield;
    if (effYield > 0 && vals.targetDoughballWeight > 0) {
      const batches = Math.ceil(s.totalPizzas / effYield);
      if (batches > 0) dough.push({ label: "Dough", value: fmtNum(batches, 1), sub: "batches" });
    }
  }
  if (s.sauceBatches > 0) {
    const bd = sauceBarrelBreakdown(s.sauceBatches, s.sauceEffBarrel);
    sauce.push(bd
      ? { label: "Sauce", value: fmtNum(s.sauceBatches, 2), sub: `batches · ${bd.totalBarrels} barrels` }
      : { label: "Sauce", value: fmtNum(s.sauceBatches, 2), sub: "barrels" });
  }
  const apps = [
    { type: s.app1Type, lbs: s.app1Lbs, batches: s.app1Batches },
    { type: s.app2Type, lbs: s.app2Lbs, batches: s.app2Batches },
    { type: s.app3Type, lbs: s.app3Lbs, batches: s.app3Batches },
    { type: s.app4Type, lbs: s.app4Lbs, batches: s.app4Batches },
  ];
  for (const a of apps) {
    if (!a.type) continue;
    const isMix = a.type.trim().toLowerCase().includes("mix");
    if (isMix && a.lbs > 0) applicators.push({ label: a.type, value: fmtNum(a.lbs, 1), sub: "lbs" });
    else if (!isMix && a.batches > 0) applicators.push({ label: a.type, value: fmtNum(a.batches, 2), sub: "batches" });
  }
  if (s.pep1Type && s.pep1Lbs > 0) {
    const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep1Type);
    pep.push({ label: s.pep1Type, value: isPepStd ? fmtNum(s.pep1Lbs, 1) : fmtNum(s.pep1Batches, 2), sub: isPepStd ? "lbs" : "batches" });
  }
  if (s.pep2Type && s.pep2Lbs > 0) {
    const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep2Type);
    pep.push({ label: s.pep2Type, value: isPepStd ? fmtNum(s.pep2Lbs, 1) : fmtNum(s.pep2Batches, 2), sub: isPepStd ? "lbs" : "batches" });
  }
  return { dough, sauce, applicators, pep, all: [...dough, ...sauce, ...applicators, ...pep] };
}

function NeedsList({ rows }: { rows: NeedRow[] }) {
  if (rows.length === 0)
    return <p className="text-xs text-muted-foreground italic">No data</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground truncate">{row.label}</span>
          <span className="font-bold tabular-nums text-foreground whitespace-nowrap">
            {row.value} <span className="font-normal text-muted-foreground">{row.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function aggregateNeedRows(valsList: FormValues[]): NeedRow[] {
  const map = new Map<string, { num: number; unit: string; order: number }>();
  let order = 0;
  const add = (label: string, num: number, unit: string) => {
    const key = `${label}__${unit}`;
    const ex = map.get(key);
    if (ex) ex.num += num;
    else map.set(key, { num, unit, order: order++ });
  };
  for (const vals of valsList) {
    const s = computeSummaryStats(vals);
    const dRecipeLbs = (vals.doughRecipe ?? []).reduce((acc, r) => acc + Number(r.lbs ?? 0), 0);
    const effYield =
      dRecipeLbs > 0 && vals.targetDoughballWeight > 0
        ? (dRecipeLbs * 16) / vals.targetDoughballWeight
        : vals.doughBatchYield;
    if (effYield > 0 && vals.targetDoughballWeight > 0) {
      const batches = Math.ceil(s.totalPizzas / effYield);
      if (batches > 0) add("Dough", batches, "batches");
    }
    if (s.sauceBatches > 0) add("Sauce", s.sauceBatches, "batches");
    const apps = [
      { type: s.app1Type, lbs: s.app1Lbs, batches: s.app1Batches },
      { type: s.app2Type, lbs: s.app2Lbs, batches: s.app2Batches },
      { type: s.app3Type, lbs: s.app3Lbs, batches: s.app3Batches },
      { type: s.app4Type, lbs: s.app4Lbs, batches: s.app4Batches },
    ];
    for (const a of apps) {
      if (!a.type) continue;
      const isMix = a.type.trim().toLowerCase().includes("mix");
      if (isMix && a.lbs > 0) add(a.type, a.lbs, "lbs");
      else if (!isMix && a.batches > 0) add(a.type, a.batches, "batches");
    }
    if (s.pep1Type && s.pep1Lbs > 0) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep1Type);
      if (isPepStd) add(s.pep1Type, s.pep1Lbs, "lbs");
      else add(s.pep1Type, s.pep1Batches, "batches");
    }
    if (s.pep2Type && s.pep2Lbs > 0) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep2Type);
      if (isPepStd) add(s.pep2Type, s.pep2Lbs, "lbs");
      else add(s.pep2Type, s.pep2Batches, "batches");
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, val]) => ({
      label: key.slice(0, key.lastIndexOf("__")),
      value: fmtNum(val.num, val.unit === "batches" ? 2 : 1),
      sub: val.unit,
    }));
}

// Roll up packaging consumables across the given runs: circles are 1 per pizza
// and shippers are 1 per case, each grouped by the run's selected type. "none"
// / unset selections contribute nothing.
function aggregatePackagingNeeds(valsList: FormValues[]): NeedRow[] {
  const circleMap = new Map<string, number>();
  const shipperMap = new Map<string, number>();
  let cartonCases = 0;
  for (const vals of valsList) {
    // Only cartoned runs contribute to packaging needs; "labeled" (cartoned !==
    // "yes") runs are excluded entirely.
    if ((vals.cartoned ?? "").trim().toLowerCase() !== "yes") continue;
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
  for (const [type, n] of circleMap) rows.push({ label: `Circles — ${type}`, value: fmtNum(n, 0), sub: "circles" });
  for (const [type, n] of shipperMap) rows.push({ label: `Shippers — ${type}`, value: fmtNum(n, 0), sub: "shippers" });
  if (cartonCases > 0) rows.push({ label: "Cartons", value: fmtNum(Math.ceil(cartonCases), 0), sub: "cases" });
  return rows;
}

function StatRow({
  label,
  value,
  testId,
  highlight,
}: {
  label: string;
  value: string;
  testId?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between py-1.5 border-b border-border/40 last:border-0 ${highlight ? "text-primary" : ""}`}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`font-mono font-semibold text-sm tabular-nums ${highlight ? "text-primary text-base" : "text-foreground"}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}

function IngredientSelect({
  value,
  onChange,
  options,
  onAddOption,
  onRemoveOption,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption: (v: string) => void;
  onRemoveOption: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const [rect, setRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filtered = (options ?? []).filter(o =>
    o.toLowerCase().includes(inputVal.toLowerCase())
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

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={openDropdown}
        className="flex items-center gap-1 h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm hover:bg-muted/70 transition-colors w-full justify-between"
      >
        <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground/50"}`}>
          {value || placeholder || "Select…"}
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
          <div className="max-h-60 overflow-y-auto overscroll-contain">
            {filtered.map(opt =>
              confirmDelete === opt ? (
                <div key={opt} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                  <span className="text-[10px] text-destructive font-semibold truncate">Remove "{opt}"?</span>
                  <span className="flex gap-1 shrink-0">
                    <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { onRemoveOption(opt); confirmDeleteRef.current = null; setConfirmDelete(null); setOpen(false); }}>Yes</button>
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
            {inputVal.trim() && !(options ?? []).includes(inputVal.trim()) && (
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
    <div className="flex-1 max-w-xs">
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
        <div className="flex items-center gap-2 justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label} — Cheese Blend</span>
          {recipeSelector}
          <span className="text-xs text-muted-foreground shrink-0"><span className="font-mono text-foreground">{batches > 0 ? fmtNum(batches, 2) : "—"}</span> batches</span>
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-amber-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center gap-3 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label} — Cheese Blend Recipe</CardTitle>
          {recipeSelector}
          <span className="text-xs text-muted-foreground shrink-0"><span className="font-mono text-foreground">{batches > 0 ? fmtNum(batches, 2) : "—"}</span> batches</span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

function MixRecipeCard({
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
}: {
  label: string;
  totalRunLbs: number;
  fields: { id: string }[];
  recipe: RecipeRow[];
  fieldPrefix: string;
  register: any;
  ingredientOptions: string[];
  onAddIngredient: (v: string) => void;
  onRemoveIngredient: (v: string) => void;
  onSetIngredient: (idx: number, val: string) => void;
  onAppend: () => void;
  onRemove: (idx: number) => void;
  embedded?: boolean;
  recipeName?: string;
  recipeNameOptions?: string[];
  onAddRecipeName?: (v: string) => void;
  onRemoveRecipeName?: (v: string) => void;
  onRecipeNameChange?: (v: string) => void;
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const rowTotal = (rowLbs: number) =>
    totalLbsPerBatch > 0 ? (rowLbs / totalLbsPerBatch) * totalRunLbs : 0;

  const body = (
    <>
      {recipeNameOptions && onRecipeNameChange && (
        <div className="flex-1 max-w-xs mb-3">
          <IngredientSelect value={recipeName ?? ""} onChange={onRecipeNameChange} options={recipeNameOptions} onAddOption={onAddRecipeName ?? (() => {})} onRemoveOption={onRemoveRecipeName ?? (() => {})} placeholder="Recipe name…" />
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
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-purple-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{label} — Mix Recipe</CardTitle>
          <span className="text-xs text-muted-foreground"><span className="font-mono text-foreground">{fmtNum(totalRunLbs, 1)}</span> lbs needed</span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

function DoughRecipeCard({
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
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-orange-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center gap-3 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
            Dough Recipe
          </CardTitle>
          <div className="flex-1 max-w-xs">
            <IngredientSelect
              value={recipeName}
              onChange={onRecipeNameChange}
              options={recipeNameOptions}
              onAddOption={onAddRecipeName}
              onRemoveOption={onRemoveRecipeName}
              placeholder="Recipe name…"
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            <span className="font-mono text-foreground">{batchesNeeded > 0 ? fmtNum(batchesNeeded, 2) : "—"}</span> batches needed
          </span>
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

function FrontlineRecipeCard({
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
}) {
  const totalLbsPerBatch = recipe.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);

  const recipeSelector = (
    <div className="flex-1 max-w-xs">
      <IngredientSelect value={recipeName} onChange={onRecipeNameChange} options={recipeNameOptions} onAddOption={onAddRecipeName} onRemoveOption={onRemoveRecipeName} placeholder="Recipe name…" />
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
        <div className="flex items-center gap-2 justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Sauce Recipe</span>
          {recipeSelector}
        </div>
        {body}
      </>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
      <div className="h-1 bg-red-500/70 w-full" />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center gap-3 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Sauce Recipe</CardTitle>
          {recipeSelector}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{body}</CardContent>
    </Card>
  );
}

function ReadOnlyRecipeCard({
  title,
  subtitle,
  recipe,
  accent,
  scalable = false,
}: {
  title: string;
  subtitle?: string;
  recipe: RecipeRow[];
  accent: string;
  scalable?: boolean;
}) {
  const rows = (recipe ?? []).filter(
    r => (r.ingredient ?? "").trim() !== "" || Number(r.lbs ?? 0) > 0
  );
  const total = rows.reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  // Batch-size scaler: shows the recipe weights at a different batch size.
  // "4" is the base recipe (1×); other sizes scale the displayed weights.
  const SCALE_OPTIONS: { label: string; value: number }[] = [
    { label: "½", value: 0.5 },
    { label: "4", value: 1 },
    { label: "5", value: 1.25 },
    { label: "6", value: 1.5 },
  ];
  const [scale, setScale] = useState(1);
  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mb-4">
      <div className={`h-1 ${accent} w-full`} />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center gap-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ClipboardList className="w-4 h-4" /> {title}
          </CardTitle>
          {subtitle ? (
            <span className="text-xs text-muted-foreground font-mono truncate max-w-[55%] text-right">{subtitle}</span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recipe configured. Add ingredients in Setup.</p>
        ) : (
          <div className="w-full">
            {scalable && (
              <div className="flex items-center flex-wrap gap-2 mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Batch Size</span>
                <div className="flex gap-1 rounded-lg bg-muted/30 p-1">
                  {SCALE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setScale(opt.value)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                        scale === opt.value
                          ? "bg-orange-500 text-white"
                          : "text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {scale !== 1 && (
                  <span className="text-[10px] text-muted-foreground">
                    ×{scale} — view only
                  </span>
                )}
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 mb-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs / Batch</span>
            </div>
            <div className="space-y-0.5">
              {rows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 items-center py-1.5 px-1 rounded odd:bg-muted/20">
                  <span className="text-sm text-foreground">{r.ingredient || "—"}</span>
                  <span className="text-sm font-mono text-right text-foreground tabular-nums">{fmtNum(Number(r.lbs ?? 0) * scale, 1)}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
              <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
              <span className="text-xs font-mono text-right font-semibold text-foreground tabular-nums">{fmtNum(total * scale, 1)} lbs</span>
            </div>
          </div>
        )}
      </CardContent>
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

function TypeDropdown({
  label,
  value,
  onChange,
  options,
  onAddOption,
  onRemoveOption,
  allowClear,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption: (v: string) => void;
  onRemoveOption: (v: string) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const filtered = options.filter(o =>
    o.toLowerCase().includes(inputVal.toLowerCase())
  );
  return (
    <div className="flex items-center justify-between mb-2 mt-5 first:mt-0">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="relative">
        <button
          type="button"
          onClick={() => { setInputVal(""); setConfirmDelete(null); confirmDeleteRef.current = null; setOpen(true); }}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted/40 border border-border/40 text-xs font-semibold hover:bg-muted/70 transition-colors min-w-[110px] justify-between"
        >
          <span className={value ? "text-foreground" : "text-muted-foreground/50"}>
            {value || "Select…"}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>
        {open && (
          <div className="absolute z-50 top-full mt-1 right-0 w-44 bg-popover border border-border rounded-md shadow-lg py-1">
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
            <div className="max-h-48 overflow-y-auto overscroll-contain">
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
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { onRemoveOption(opt); confirmDeleteRef.current = null; setConfirmDelete(null); setOpen(false); }}>Yes</button>
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

function NumField({
  control,
  name,
  label,
  step,
  testId,
  disabled,
}: {
  control: any;
  name: keyof FormValues;
  label: string;
  step?: string;
  testId?: string;
  disabled?: boolean;
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
              onFocus={e => e.target.select()}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

const AUTO_SUPPRESS_MS = 10 * 60 * 1000;

function StepperField({
  control,
  name,
  label,
  min = 0,
  max,
  step = 1,
  disabled,
  suggestion,
  onSuggest,
  onManualChange,
}: {
  control: any;
  name: keyof FormValues;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  suggestion?: number | null;
  onSuggest?: () => void;
  onManualChange?: () => void;
}) {
  const repeatRef = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const fieldRef = useRef<any>(null);
  useEffect(() => () => { clearTimeout(repeatRef.current.t); clearInterval(repeatRef.current.i); }, []);
  const startRepeat = (fn: () => void) => {
    fn();
    repeatRef.current.t = setTimeout(() => { repeatRef.current.i = setInterval(fn, 80); }, 400);
  };
  const stopRepeat = () => { clearTimeout(repeatRef.current.t); clearInterval(repeatRef.current.i); };
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        fieldRef.current = field;
        const current = Number(field.value) || 0;
        const atMax = max !== undefined && current >= max;
        const decrement = () => {
          const cur = Number(fieldRef.current?.value) || 0;
          navigator.vibrate?.(8);
          onManualChange?.();
          fieldRef.current?.onChange(Math.max(min, cur - step));
        };
        const increment = () => {
          const cur = Number(fieldRef.current?.value) || 0;
          if (max !== undefined && cur >= max) return;
          navigator.vibrate?.(8);
          onManualChange?.();
          fieldRef.current?.onChange(max !== undefined ? Math.min(max, cur + step) : cur + step);
        };
        return (
          <FormItem>
            <div className="flex items-center justify-between gap-2">
              <FormLabel className="text-xs text-muted-foreground">{label}</FormLabel>
              {suggestion !== null && suggestion !== undefined && suggestion !== current && onSuggest && (
                <button
                  type="button"
                  onClick={() => { navigator.vibrate?.(8); onSuggest(); }}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors shrink-0"
                  title={`Set to expected value: ${suggestion}`}
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  Expected: {suggestion}
                </button>
              )}
            </div>
            <FormControl>
              <div className={`flex items-stretch${disabled ? " opacity-50 pointer-events-none" : ""}`}>
                <button
                  type="button"
                  onPointerDown={() => startRepeat(decrement)}
                  onPointerUp={stopRepeat}
                  onPointerLeave={stopRepeat}
                  className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none"
                  data-testid={`btn-dec-${name}`}
                  disabled={disabled}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  {...field}
                  onChange={(e) => {
                    onManualChange?.();
                    const val = e.target.value === "" ? "" : Number(e.target.value);
                    field.onChange(max !== undefined && typeof val === "number" ? Math.min(max, val) : val);
                  }}
                  onFocus={e => e.target.select()}
                  className={`h-12 flex-1 border border-input bg-background/50 text-center font-mono text-2xl font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-0${atMax ? " text-amber-400" : ""}`}
                  data-testid={`input-${name}`}
                  disabled={disabled}
                />
                <button
                  type="button"
                  onPointerDown={() => startRepeat(increment)}
                  onPointerUp={stopRepeat}
                  onPointerLeave={stopRepeat}
                  className={`h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none${atMax ? " opacity-30 cursor-not-allowed" : ""}`}
                  data-testid={`btn-inc-${name}`}
                  disabled={disabled || atMax}
                >
                  +
                </button>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

function NotesTextarea({ initialValue, onCommit, className }: { initialValue: string; onCommit: (v: string) => void; className?: string }) {
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
// local date + time; falls back to the raw value if it can't be parsed.
function fmtSandboxCopiedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Home() {
  const { signOut, forceSignedOut, revalidate, me, markOnboardingSeen, markTourCompleted } =
    useAuth();
  // Automatic sandbox refresh: when the server reports the sandbox copy is stale
  // (older than its cutoff, or never copied), re-copy live → sandbox and reload —
  // the same flow as the manual "Reset sandbox" button, minus the confirm. This
  // keeps the demo/training space trustworthy without anyone remembering to reset
  // it. Guarded so it fires at most once per mount, and only for the sandbox
  // account (sandboxStale is always false otherwise).
  const autoSandboxResetRef = useRef(false);
  useEffect(() => {
    if (!me?.sandbox || !me.sandboxStale || autoSandboxResetRef.current) return;
    autoSandboxResetRef.current = true;
    resetSandboxRequest()
      .then(() => window.location.reload())
      .catch(() => {
        // Best-effort; if the re-copy fails we leave the stale data in place and
        // let the next load (or a manual reset) try again.
        autoSandboxResetRef.current = false;
      });
  }, [me?.sandbox, me?.sandboxStale]);
  const [dayState, setDayState] = useState<DayState>(() => loadDayState());
  const currentRun = dayState.runs[dayState.currentIndex] ?? dayState.runs[0];
  const currentRunId = currentRun?.id ?? "";
  // Latest current-run id, readable from the [] rollover effects without going
  // stale when the user switches runs after the effect first ran.
  const currentRunIdRef = useRef(currentRunId);
  currentRunIdRef.current = currentRunId;
  const currentMixPresets = useMemo<MixPreset[]>(
    () => findMixPresets(currentRun?.brand ?? "", currentRun?.flavor ?? ""),
    [currentRun?.brand, currentRun?.flavor]
  );
  // Most recently ended run across the whole day — used for freezer-drain countdown
  // regardless of which run is currently being viewed.
  const lastEndedRun = dayState.runs.reduce<RunMeta | undefined>((best, r) => {
    if (!r.endedAt) return best;
    if (!best?.endedAt || r.endedAt > best.endedAt) return r;
    return best;
  }, undefined);

  const [history, setHistory] = useState<HistoryDay[]>(() => loadHistory());
  const [expandedHistoryDay, setExpandedHistoryDay] = useState<string | null>(null);
  const [sauceWeightsOpen, setSauceWeightsOpen] = useState(false);
  // Bumped on each write to a non-active draining run so the Packaging
  // "Finishing — Freezer Draining" panel re-renders immediately (its values are
  // read from persisted run storage, not the live form).
  const [, setDrainBump] = useState(0);

  // ── Historical PPM benchmark (average of finished runs across all days) ───
  const histBenchmarkPpm = useMemo(() => {
    const ppms: number[] = [];
    for (const day of history) {
      for (const run of day.runs) {
        if (!run.startedAt || !run.endedAt) continue;
        const grossSec = (run.endedAt - run.startedAt) / 1000;
        const dtSec = (run.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((a, s) => a + (s.endedAt! - s.startedAt) / 1000, 0);
        const netSec = Math.max(0, grossSec - dtSec);
        if (netSec < 60) continue;
        const vals = day.runValues[run.id] as FormValues | undefined;
        const cases = run.actualCases ?? (vals ? computeSummaryStats(vals).totalCases : 0);
        const ppc = vals?.pizzasPerCase ?? 0;
        if (cases > 0 && ppc > 0) ppms.push(Math.round((cases * ppc) / (netSec / 60)));
      }
    }
    if (ppms.length === 0) return null;
    return Math.round(ppms.reduce((a, b) => a + b, 0) / ppms.length);
  }, [history]);

  const [brands, setBrands] = useState<string[]>(() =>
    [...loadList(BRANDS_KEY, ["Lucia's"])].filter(b => !STALE_BRANDS.includes(b)).sort((a, b) => a.localeCompare(b))
  );
  const [brandFlavors, setBrandFlavors] = useState<Record<string, string[]>>(loadBrandFlavors);
  const [ingredientTypes, setIngredientTypes] = useState<string[]>(() =>
    [...loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES)].sort((a, b) => a.localeCompare(b))
  );

  // Re-adding a previously merged-away name must resurrect it everywhere: clear
  // it from the LOCAL tombstone AND the DURABLE factory-wide one, otherwise the
  // load-time/sync prune would strip it right back out on the next device.
  function clearMergedAwayBoth(name: string) {
    clearMergedAway(name);
    void deleteMergedAwayNames([name]).catch(() => {});
  }

  function addIngredientType(name: string) {
    const trimmed = name.trim();
    if (!trimmed || ingredientTypes.includes(trimmed)) return;
    const updated = [...ingredientTypes, trimmed].sort((a, b) => a.localeCompare(b));
    setIngredientTypes(updated);
    saveList(INGREDIENT_TYPES_KEY, updated);
    clearMergedAwayBoth(trimmed);
    clearDeleted("ingredientTypes", trimmed);
    schedulePush(dayStateRef.current);
  }

  function removeIngredientType(name: string) {
    const updated = ingredientTypes.filter(t => t !== name);
    setIngredientTypes(updated);
    saveList(INGREDIENT_TYPES_KEY, updated);
    tombstoneDeleted("ingredientTypes", name);
    schedulePush(dayStateRef.current);
  }

  function renameIngredientType(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || ingredientTypes.includes(trimmed)) return;
    const updated = ingredientTypes.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setIngredientTypes(updated);
    saveList(INGREDIENT_TYPES_KEY, updated);
    schedulePush(dayStateRef.current);
  }

  const [pepTypes, setPepTypes] = useState<string[]>(() => {
    const LEGACY_PEP_TYPES = ["Natural", "Cured"];
    const saved = loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES);
    const cleaned = saved
      .map(t => PEP_TYPE_RENAMES[t] ?? t)
      .filter(t => !LEGACY_PEP_TYPES.includes(t) && !RETIRED_PEP_TYPES.includes(t));
    const merged = [...new Set([...DEFAULT_PEP_TYPES, ...cleaned])].sort((a, b) => a.localeCompare(b));
    return merged;
  });

  function addPepType(name: string) {
    const trimmed = name.trim();
    if (!trimmed || pepTypes.includes(trimmed)) return;
    const updated = [...pepTypes, trimmed].sort((a, b) => a.localeCompare(b));
    setPepTypes(updated);
    saveList(PEP_TYPES_KEY, updated);
    clearMergedAwayBoth(trimmed);
    clearDeleted("pepTypes", trimmed);
    schedulePush(dayStateRef.current);
  }

  function removePepType(name: string) {
    if (DEFAULT_PEP_TYPES.includes(name)) return;
    const updated = pepTypes.filter(t => t !== name);
    setPepTypes(updated);
    saveList(PEP_TYPES_KEY, updated);
    tombstoneDeleted("pepTypes", name);
    schedulePush(dayStateRef.current);
  }

  const [dieTypes, setDieTypes] = useState<string[]>(() =>
    [...new Set([...DEFAULT_DIE_TYPES, ...loadList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES)])].sort((a, b) => a.localeCompare(b))
  );

  function addDieType(name: string) {
    const trimmed = name.trim();
    if (!trimmed || dieTypes.includes(trimmed)) return;
    const updated = [...dieTypes, trimmed].sort((a, b) => a.localeCompare(b));
    setDieTypes(updated);
    saveList(DIE_TYPES_KEY, updated);
    clearMergedAwayBoth(trimmed);
    clearDeleted("dieTypes", trimmed);
    schedulePush(dayStateRef.current);
  }

  function removeDieType(name: string) {
    if (DEFAULT_DIE_TYPES.includes(name)) return;
    const updated = dieTypes.filter(t => t !== name);
    setDieTypes(updated);
    saveList(DIE_TYPES_KEY, updated);
    tombstoneDeleted("dieTypes", name);
    schedulePush(dayStateRef.current);
  }

  const [cheeseIngredients, setCheeseIngredients] = useState<string[]>(() =>
    [...loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS)].sort((a, b) => a.localeCompare(b))
  );

  function addCheeseIngredient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || cheeseIngredients.includes(trimmed)) return;
    const updated = [...cheeseIngredients, trimmed].sort((a, b) => a.localeCompare(b));
    setCheeseIngredients(updated);
    saveList(CHEESE_INGREDIENTS_KEY, updated);
    clearMergedAwayBoth(trimmed);
    clearDeleted("cheeseIngredients", trimmed);
    schedulePush(dayStateRef.current);
  }

  function removeCheeseIngredient(name: string) {
    const updated = cheeseIngredients.filter(t => t !== name);
    setCheeseIngredients(updated);
    saveList(CHEESE_INGREDIENTS_KEY, updated);
    tombstoneDeleted("cheeseIngredients", name);
    schedulePush(dayStateRef.current);
  }

  const [mixIngredients, setMixIngredients] = useState<string[]>(() =>
    [...loadList(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS)].sort((a, b) => a.localeCompare(b))
  );

  function addMixIngredient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || mixIngredients.includes(trimmed)) return;
    const updated = [...mixIngredients, trimmed].sort((a, b) => a.localeCompare(b));
    setMixIngredients(updated);
    saveList(MIX_INGREDIENTS_KEY, updated);
    clearMergedAwayBoth(trimmed);
    clearDeleted("mixIngredients", trimmed);
    schedulePush(dayStateRef.current);
  }

  function removeMixIngredient(name: string) {
    const updated = mixIngredients.filter(t => t !== name);
    setMixIngredients(updated);
    saveList(MIX_INGREDIENTS_KEY, updated);
    tombstoneDeleted("mixIngredients", name);
    schedulePush(dayStateRef.current);
  }

  const [doughIngredients, setDoughIngredients] = useState<string[]>(() =>
    [...loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS)].sort((a, b) => a.localeCompare(b))
  );

  function addDoughIngredient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || doughIngredients.includes(trimmed)) return;
    const updated = [...doughIngredients, trimmed].sort((a, b) => a.localeCompare(b));
    setDoughIngredients(updated);
    saveList(DOUGH_INGREDIENTS_KEY, updated);
    clearMergedAwayBoth(trimmed);
    clearDeleted("doughIngredients", trimmed);
    schedulePush(dayStateRef.current);
  }

  function removeDoughIngredient(name: string) {
    const updated = doughIngredients.filter(t => t !== name);
    setDoughIngredients(updated);
    saveList(DOUGH_INGREDIENTS_KEY, updated);
    tombstoneDeleted("doughIngredients", name);
    schedulePush(dayStateRef.current);
  }

  const [doughRecipeNames, setDoughRecipeNames] = useState<string[]>(() =>
    [...loadList(DOUGH_RECIPE_NAMES_KEY, DEFAULT_DOUGH_RECIPE_NAMES)].sort((a, b) => a.localeCompare(b))
  );

  function addDoughRecipeName(name: string) {
    const trimmed = name.trim();
    if (!trimmed || doughRecipeNames.includes(trimmed)) return;
    const updated = [...doughRecipeNames, trimmed].sort((a, b) => a.localeCompare(b));
    setDoughRecipeNames(updated);
    saveList(DOUGH_RECIPE_NAMES_KEY, updated);
    clearDeleted("doughRecipeNames", trimmed);
    schedulePush(dayStateRef.current);
  }

  function removeDoughRecipeName(name: string) {
    const updated = doughRecipeNames.filter(t => t !== name);
    setDoughRecipeNames(updated);
    saveList(DOUGH_RECIPE_NAMES_KEY, updated);
    tombstoneDeleted("doughRecipeNames", name);
    schedulePush(dayStateRef.current);
  }

  const [frontlineIngredients, setFrontlineIngredients] = useState<string[]>(() =>
    [...loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS)].sort((a, b) => a.localeCompare(b))
  );
  function addFrontlineIngredient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || frontlineIngredients.includes(trimmed)) return;
    const updated = [...frontlineIngredients, trimmed].sort((a, b) => a.localeCompare(b));
    setFrontlineIngredients(updated);
    saveList(FRONTLINE_INGREDIENTS_KEY, updated);
    clearMergedAwayBoth(trimmed);
    clearDeleted("frontlineIngredients", trimmed);
    schedulePush(dayStateRef.current);
  }
  function removeFrontlineIngredient(name: string) {
    const updated = frontlineIngredients.filter(t => t !== name);
    setFrontlineIngredients(updated);
    saveList(FRONTLINE_INGREDIENTS_KEY, updated);
    tombstoneDeleted("frontlineIngredients", name);
    schedulePush(dayStateRef.current);
  }

  const [frontlineRecipeNames, setFrontlineRecipeNames] = useState<string[]>(() =>
    [...loadList(FRONTLINE_RECIPE_NAMES_KEY, DEFAULT_FRONTLINE_RECIPE_NAMES)].filter(n => !SEED_MIX_RECIPE_NAMES.has(n)).sort((a, b) => a.localeCompare(b))
  );
  function addFrontlineRecipeName(name: string) {
    const trimmed = name.trim();
    if (!trimmed || frontlineRecipeNames.includes(trimmed)) return;
    const updated = [...frontlineRecipeNames, trimmed].sort((a, b) => a.localeCompare(b));
    setFrontlineRecipeNames(updated);
    saveList(FRONTLINE_RECIPE_NAMES_KEY, updated);
    clearDeleted("frontlineRecipeNames", trimmed);
    schedulePush(dayStateRef.current);
  }
  function removeFrontlineRecipeName(name: string) {
    const updated = frontlineRecipeNames.filter(t => t !== name);
    setFrontlineRecipeNames(updated);
    saveList(FRONTLINE_RECIPE_NAMES_KEY, updated);
    tombstoneDeleted("frontlineRecipeNames", name);
    schedulePush(dayStateRef.current);
  }

  const [cheeseRecipeNames, setCheeseRecipeNames] = useState<string[]>(() =>
    [...loadList(CHEESE_RECIPE_NAMES_KEY, [])].sort((a, b) => a.localeCompare(b))
  );
  function addCheeseRecipeName(name: string) {
    const trimmed = name.trim();
    if (!trimmed || cheeseRecipeNames.includes(trimmed)) return;
    const updated = [...cheeseRecipeNames, trimmed].sort((a, b) => a.localeCompare(b));
    setCheeseRecipeNames(updated);
    saveList(CHEESE_RECIPE_NAMES_KEY, updated);
    clearDeleted("cheeseRecipeNames", trimmed);
    schedulePush(dayStateRef.current);
  }
  function removeCheeseRecipeName(name: string) {
    const updated = cheeseRecipeNames.filter(t => t !== name);
    setCheeseRecipeNames(updated);
    saveList(CHEESE_RECIPE_NAMES_KEY, updated);
    tombstoneDeleted("cheeseRecipeNames", name);
    schedulePush(dayStateRef.current);
  }

  // Re-read all master-data lists from storage into state. Used after the
  // spec-sheet importer writes brand/flavor/type/ingredient/recipe-name lists
  // directly to storage, so the Setup dropdowns reflect the new options
  // immediately without a reload. Mirrors each list's initializer above.
  function reloadMasterData() {
    setBrands([...loadList(BRANDS_KEY, ["Lucia's"])].filter(b => !STALE_BRANDS.includes(b)).sort((a, b) => a.localeCompare(b)));
    setBrandFlavors(loadBrandFlavors());
    setIngredientTypes([...loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES)].sort((a, b) => a.localeCompare(b)));
    setPepTypes(() => {
      const LEGACY_PEP_TYPES = ["Natural", "Cured"];
      const saved = loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES);
      const cleaned = saved
        .map(t => PEP_TYPE_RENAMES[t] ?? t)
        .filter(t => !LEGACY_PEP_TYPES.includes(t) && !RETIRED_PEP_TYPES.includes(t));
      return [...new Set([...DEFAULT_PEP_TYPES, ...cleaned])].sort((a, b) => a.localeCompare(b));
    });
    setDieTypes([...new Set([...DEFAULT_DIE_TYPES, ...loadList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES)])].sort((a, b) => a.localeCompare(b)));
    setCheeseIngredients([...loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS)].sort((a, b) => a.localeCompare(b)));
    setDoughIngredients([...loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS)].sort((a, b) => a.localeCompare(b)));
    setDoughRecipeNames([...loadList(DOUGH_RECIPE_NAMES_KEY, DEFAULT_DOUGH_RECIPE_NAMES)].sort((a, b) => a.localeCompare(b)));
    setFrontlineIngredients([...loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS)].sort((a, b) => a.localeCompare(b)));
    setFrontlineRecipeNames([...loadList(FRONTLINE_RECIPE_NAMES_KEY, DEFAULT_FRONTLINE_RECIPE_NAMES)].filter(n => !SEED_MIX_RECIPE_NAMES.has(n)).sort((a, b) => a.localeCompare(b)));
    setCheeseRecipeNames([...loadList(CHEESE_RECIPE_NAMES_KEY, [])].sort((a, b) => a.localeCompare(b)));
    setMixIngredients([...loadList(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS)].sort((a, b) => a.localeCompare(b)));
    setMixRecipeNames([...loadList(MIX_RECIPE_NAMES_KEY, [])].sort((a, b) => a.localeCompare(b)));
  }

  // Re-sync every React surface a merge rewrites in localStorage, in place, so the
  // Merge panel (and its remaining suggestions) stays open instead of being torn
  // down by a full-page reload. Mirrors mobile, which merges via in-place state.
  // Must also reset the current run's form: it holds the live values for the open
  // run, and its autosave effects would otherwise write the pre-merge names back
  // to storage and silently undo the merge.
  function refreshAfterMerge() {
    reloadMasterData();
    setTemplates(loadTemplates());
    setHistory(loadHistory());
    const ds = loadDayState();
    setDayState(ds);
    if (ds.runToTime) setRunToTime(ds.runToTime);
    const curId = ds.runs[ds.currentIndex]?.id ?? "";
    const vals = { ...DEFAULT_VALUES, ...loadRunValues(curId) };
    form.reset(vals);
    resetFieldArrays(vals);
  }

  const [mixRecipeNames, setMixRecipeNames] = useState<string[]>(() =>
    [...loadList(MIX_RECIPE_NAMES_KEY, [])].sort((a, b) => a.localeCompare(b))
  );
  function addMixRecipeName(name: string) {
    const trimmed = name.trim();
    if (!trimmed || mixRecipeNames.includes(trimmed)) return;
    const updated = [...mixRecipeNames, trimmed].sort((a, b) => a.localeCompare(b));
    setMixRecipeNames(updated);
    saveList(MIX_RECIPE_NAMES_KEY, updated);
    clearDeleted("mixRecipeNames", trimmed);
    schedulePush(dayStateRef.current);
  }
  function removeMixRecipeName(name: string) {
    const updated = mixRecipeNames.filter(t => t !== name);
    setMixRecipeNames(updated);
    saveList(MIX_RECIPE_NAMES_KEY, updated);
    tombstoneDeleted("mixRecipeNames", name);
    schedulePush(dayStateRef.current);
  }
  // Merged mix recipe name options: factory presets (xlsx) + user-added names, deduped + sorted
  const allMixRecipeOptions = useMemo(
    () => [...new Set([...currentMixPresets.map(p => p.name), ...mixRecipeNames])].sort((a, b) => a.localeCompare(b)),
    [currentMixPresets, mixRecipeNames]
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: (() => {
      const ds = loadDayState();
      return loadRunValues(ds.runs[ds.currentIndex]?.id ?? "");
    })(),
    mode: "onChange",
  });

  const v = form.watch();

  // Food-safety advisory: allergen transitions across the day's run sequence.
  // The current run uses the live form value; others read persisted run values.
  const allergenWarnings = useMemo(() => {
    const seq: AllergenSequenceItem[] = dayState.runs.map((run, i) => ({
      id: run.id,
      label: `Run ${i + 1} · ${runLabel(run)}`,
      allergen: normalizeAllergen(
        run.id === currentRunId ? (v.allergen as Allergen) : loadRunValues(run.id).allergen,
      ),
    }));
    return allergenSequenceWarnings(seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayState.runs, currentRunId, v.allergen]);

  // Manager-defined production rules (factory-wide, server-persisted). Evaluated
  // against the current run + the day's sequence. "flexible" rules warn inline
  // (alongside the allergen advisory); "strict" rules block starting the run.
  const { rules: productionRules } = useProductionRules();
  const ruleViolations = useMemo(() => {
    const fields = {
      brand: currentRun?.brand,
      flavor: currentRun?.flavor,
      casesNeeded: v.casesNeeded,
      lineSpeed: v.approxLineSpeed,
      targetDoughballWeight: v.targetDoughballWeight,
      sauceOzPerPizza: v.sauceOzPerPizza,
      dieType: v.dieType,
    };
    const seq: RuleSequenceItem[] = dayState.runs.map((run, i) => ({
      id: run.id,
      label: `Run ${i + 1} · ${runLabel(run)}`,
      attributes: {
        allergen: normalizeAllergen(
          run.id === currentRunId ? (v.allergen as Allergen) : loadRunValues(run.id).allergen,
        ),
      },
    }));
    const current = dayState.runs.find(r => r.id === currentRunId);
    return evaluateRules(productionRules, {
      fields,
      runLabel: current ? runLabel(current) : undefined,
      sequence: seq,
      currentRunId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    productionRules,
    dayState.runs,
    currentRunId,
    currentRun?.brand,
    currentRun?.flavor,
    v.casesNeeded,
    v.approxLineSpeed,
    v.targetDoughballWeight,
    v.sauceOzPerPizza,
    v.dieType,
    v.allergen,
  ]);
  const flexibleViolations = ruleViolations.filter(x => x.enforcement === "flexible");
  const strictViolations = ruleViolations.filter(x => x.enforcement === "strict");

  // Per-run acknowledgement of strict-rule checklists. Keyed by
  // `${runId}#${ruleId}#${stepIndex}` so checks reset per run yet stay satisfied
  // when returning to a run. A strict violation with a checklist blocks Start
  // until every step is checked; a strict violation without one blocks outright.
  const [checklistAcks, setChecklistAcks] = useState<Record<string, boolean>>({});
  const ackKey = (ruleId: string, i: number) => `${currentRunId}#${ruleId}#${i}`;
  const toggleAck = (ruleId: string, i: number) =>
    setChecklistAcks(prev => {
      const k = ackKey(ruleId, i);
      return { ...prev, [k]: !prev[k] };
    });
  const checklistSatisfied = (rv: { ruleId: string; checklist?: string[] }) => {
    const cl = rv.checklist ?? [];
    if (cl.length === 0) return false;
    return cl.every((_, i) => checklistAcks[ackKey(rv.ruleId, i)]);
  };
  const blockingViolations = strictViolations.filter(rv => !checklistSatisfied(rv));

  const { fields: cheese1Fields, append: appendCheese1, remove: removeCheese1, replace: replaceCheese1 } = useFieldArray({ control: form.control, name: "app1CheeseRecipe" });
  const { fields: cheese2Fields, append: appendCheese2, remove: removeCheese2, replace: replaceCheese2 } = useFieldArray({ control: form.control, name: "app2CheeseRecipe" });
  const { fields: cheese3Fields, append: appendCheese3, remove: removeCheese3, replace: replaceCheese3 } = useFieldArray({ control: form.control, name: "app3CheeseRecipe" });
  const { fields: cheese4Fields, append: appendCheese4, remove: removeCheese4, replace: replaceCheese4 } = useFieldArray({ control: form.control, name: "app4CheeseRecipe" });
  const { fields: doughFields, append: appendDough, remove: removeDough, replace: replaceDough } = useFieldArray({ control: form.control, name: "doughRecipe" });
  const { fields: frontlineFields, append: appendFrontline, remove: removeFrontline, replace: replaceFrontline } = useFieldArray({ control: form.control, name: "frontlineRecipe" });

  const [activeTab, setActiveTab] = useState("run");
  // Manager-only nav badge: pending password reset requests awaiting approval.
  const pendingResetCount = usePendingResetCount();
  // Manager-only nav badge: reported issues / crashes not yet reviewed.
  const unreviewedIncidentCount = useUnreviewedIncidentCount();
  // Factory-wide freezer-pull items (open to all signed-in users) — drives the
  // Warehouse "Pull Out Freezer" notices.
  const { items: freezerPullItems } = useFreezerPullItems();
  // Facility-wide run templates + supervisor PIN (server-side master-data, open
  // to all signed-in users for reads). These used to live in this device's local
  // storage, so they never followed the facility; the server is now the source
  // of truth, with localStorage kept only as an offline fallback / migration
  // seed.
  const { templates: serverTemplates, isSuccess: templatesLoaded } = useRunTemplates();
  const { pin: serverPin } = useSupervisorPin();
  // Factory-wide mixes (open to all signed-in users) — drives the Mixes
  // make-day plan and the manager Mixes editor.
  const { items: mixes } = useMixes();
  // The make-day chosen on the Mixes tab (defaults to today).
  const [mixMakeDay, setMixMakeDay] = useState<string>(() => todayStr());
  // Factory-wide cycle-count schedules (open to all signed-in users) — drives the
  // Warehouse "Time to Count" card. Marking a section counted is open to any
  // signed-in user (floor staff perform the counts).
  const { schedules: cycleCountSchedules } = useCycleCountSchedules();
  const cycleCountQc = useQueryClient();
  const markCountedMutation = useMutation({
    mutationFn: (id: string) => markCycleCountCounted(id),
    onSuccess: (saved) =>
      cycleCountQc.setQueryData(["cycleCountSchedules"], saved),
  });
  // Server-side role (distinct from the local supervisor PIN toggle below).
  const { isManager, hasCapability } = useMe();
  const canEditRules = hasCapability("edit-production-rules");
  const canManageInventory = hasCapability("manage-inventory");
  const canManageStaff = hasCapability("manage-staff");
  const canApproveResets = hasCapability("approve-password-resets");
  const [showReportIssue, setShowReportIssue] = useState(false);
  // First-login "Get Started" overview. Auto-opens once when the server says
  // this user hasn't seen it yet; reopenable any time from the header menu.
  // Latch + dismiss behavior lives in a shared hook kept at web/mobile parity.
  const {
    open: showGetStarted,
    setOpen: setShowGetStarted,
    dismiss: dismissGetStarted,
  } = useGetStartedOverview(me, markOnboardingSeen);
  // Multi-step guided tour that walks through each tab; opened on demand from
  // the Get Started overview or the header menu (never auto-shown).
  const [showTour, setShowTour] = useState(false);
  const [doughSubTab, setDoughSubTab] = useState<"dough" | "crusts">("dough");
  const [runToTime, setRunToTime] = useState(() => loadDayState().runToTime ?? "19:15");

  // Brand/flavor picker state
  const [brandInput, setBrandInput] = useState("");
  const [flavorInput, setFlavorInput] = useState("");
  const [showBrandDrop, setShowBrandDrop] = useState(false);
  const [showFlavorDrop, setShowFlavorDrop] = useState(false);
  const [confirmDeleteBrand, setConfirmDeleteBrand] = useState<string | null>(null);
  const [confirmDeleteFlavor, setConfirmDeleteFlavor] = useState<string | null>(null);
  const confirmDeleteBrandRef = useRef<string | null>(null);
  const confirmDeleteFlavorRef = useRef<string | null>(null);
  const [confirmRemoveRun, setConfirmRemoveRun] = useState(false);
  const [resumeDialog, setResumeDialog] = useState(false);
  const savedFlashRef = useRef<HTMLSpanElement>(null);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeTouchStart = useRef<{ x: number; y: number } | null>(null);

  // ── Role / Access ──────────────────────────────────────────────────────────
  const [role, setRole] = useState<"operator" | "supervisor">("operator");
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  // Managers (server role) always have supervisor access without entering the
  // PIN; the PIN remains for operators on shared, logged-in devices. An empty
  // facility PIN ("") means "no gate" — every signed-in user is a supervisor
  // (mirrors the mobile no-PIN unlocked state for parity). We resolve from the
  // live server value when loaded, else the offline cache, so a cleared PIN
  // unlocks here even before the query resolves (matching mobile's local read).
  const resolvedPin =
    typeof serverPin === "string"
      ? serverPin
      : (typeof window !== "undefined"
          ? localStorage.getItem(SUPERVISOR_PIN_KEY)
          : null);
  const noFacilityPin = resolvedPin === "";
  const isSupervisor = isManager || role === "supervisor" || noFacilityPin;

  // ── Glance overlay ────────────────────────────────────────────────────────
  const [showGlance, setShowGlance] = useState(false);
  const [showFloorMode, setShowFloorMode] = useState(false);
  // Floor Mode can be turned off entirely for users who don't want the big-number
  // monitor (manual launch + idle auto-activate both gated on this). Device-local
  // preference (not synced) so a floor TV and an office laptop can differ.
  const [floorModeEnabled, setFloorModeEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("run-calc-floor-mode") !== "0"; } catch { return true; }
  });
  function toggleFloorModeEnabled() {
    setFloorModeEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem("run-calc-floor-mode", next ? "1" : "0"); } catch { /* ignore */ }
      if (!next) setShowFloorMode(false);
      return next;
    });
  }
  // Floor Mode monitor hygiene: dim the panel after a stretch of no interaction
  // so a screen left on all shift doesn't sit at full brightness (burn-in / glare).
  const [floorDimmed, setFloorDimmed] = useState(false);


  // ── Templates ─────────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<RunTemplate[]>(() => loadTemplates());
  const [showTemplatesDialog, setShowTemplatesDialog] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [templateSaveMode, setTemplateSaveMode] = useState(false);
  // Server is the source of truth for templates. Once the list loads, reflect it
  // into local display + cache. One-time migration: if the server has none but
  // this device has local templates, seed the server from local (best-effort).
  const templatesMigratedRef = useRef(false);
  useEffect(() => {
    if (!templatesLoaded) return;
    if (!templatesMigratedRef.current) {
      templatesMigratedRef.current = true;
      const local = loadTemplates();
      if (serverTemplates.length === 0 && local.length > 0) {
        saveRunTemplates(local)
          .then((saved) => {
            setTemplates(saved);
            saveTemplates(saved);
            cycleCountQc.setQueryData(["runTemplates"], saved);
          })
          .catch(() => {});
        return;
      }
    }
    setTemplates((prev) =>
      JSON.stringify(prev) === JSON.stringify(serverTemplates) ? prev : serverTemplates,
    );
    saveTemplates(serverTemplates);
  }, [templatesLoaded, serverTemplates, cycleCountQc]);
  // Keep the local PIN cache fresh as an offline fallback for checkPin(). We
  // persist an empty string too: "" is a valid facility value ("no gate"), so a
  // PIN cleared on another device must survive a reload/offline session here, or
  // the stale non-empty cache would wrongly re-lock this device.
  useEffect(() => {
    if (typeof serverPin === "string") {
      try { localStorage.setItem(SUPERVISOR_PIN_KEY, serverPin); } catch {}
    }
  }, [serverPin]);

  // ── Downtime / stoppage log ───────────────────────────────────────────────
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [stopReason, setStopReason] = useState("");
  const [stopNotes, setStopNotes] = useState("");
  const [activeStopId, setActiveStopId] = useState<string | null>(() => {
    // Restore from any open (no endedAt) stoppage on the current run at startup
    const ds = loadDayState();
    const run = ds.runs[ds.currentIndex] ?? ds.runs[0];
    return run?.stoppages?.find(s => !s.endedAt)?.id ?? null;
  });
  const [confirmDeleteStopId, setConfirmDeleteStopId] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [stopReasonsList, setStopReasonsList] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STOP_REASONS_KEY) ?? "null") ?? DEFAULT_STOP_REASONS; }
    catch { return DEFAULT_STOP_REASONS; }
  });
  const [editingStop, setEditingStop] = useState<Stoppage | null>(null);
  const [showManualStopDialog, setShowManualStopDialog] = useState(false);
  const [showEditReasonsDialog, setShowEditReasonsDialog] = useState(false);
  const [newReasonInput, setNewReasonInput] = useState("");
  const [manualStopType, setManualStopType] = useState<"stop" | "pause">("stop");
  const [manualStopReason, setManualStopReason] = useState("");
  const [manualStopNotes, setManualStopNotes] = useState("");
  const [manualStopStart, setManualStopStart] = useState("");
  const [manualStopEnd, setManualStopEnd] = useState("");

  // ── Screen casting mode ────────────────────────────────────────────────────
  const screenMode = useMemo(() => new URLSearchParams(window.location.search).get("screen"), []);
  const [showScreensDialog, setShowScreensDialog] = useState(false);
  const [showMobileQrDialog, setShowMobileQrDialog] = useState(false);

  // ── Fullscreen / kiosk mode ────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // ── Online / offline ───────────────────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Server-write failure surface ───────────────────────────────────────────
  // The sync push and the inventory-consume write are both best-effort/optimistic
  // (they retry then give up). Previously a final failure was swallowed silently,
  // so the user had no idea their work wasn't saved server-side. Track the two
  // failure modes and surface a clear, dismissible banner + a red status dot.
  const [syncPushFailed, setSyncPushFailed] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  // ── Fetch scheduled future days for badge ──────────────────────────────────
  useEffect(() => {
    fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[])).catch(() => {});
  }, []);

  // ── Reorder runs dialog ────────────────────────────────────────────────────
  const [showReorderDialog, setShowReorderDialog] = useState(false);

  // ── Manage Lists dialog ────────────────────────────────────────────────────
  const mergeFormRef = useRef<HTMLDivElement | null>(null);
  const [showManageDialog, setShowManageDialog] = useState(false);
  const [manageCategory, setManageCategory] = useState("brands");
  const [manageBrandFilter, setManageBrandFilter] = useState("");
  const [manageInput, setManageInput] = useState("");
  const [mgNamesInput, setMgNamesInput] = useState("");
  const [mgIngInput, setMgIngInput] = useState("");
  const [mgStandaloneInput, setMgStandaloneInput] = useState("");
  const [mgSelectedPreset, setMgSelectedPreset] = useState<string | null>(null);
  const [mgPresetRows, setMgPresetRows] = useState<RecipeRow[]>([]);
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [pinChangeMsg, setPinChangeMsg] = useState("");

  // ── Merge ingredients ───────────────────────────────────────────────────────
  const [mergeSources, setMergeSources] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeConfirming, setMergeConfirming] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState("");
  // AI + learned-memory merge suggestions (groups of duplicates, each with a
  // recommended canonical name). Reviewed before applying — merge is destructive.
  const [mergeSuggestions, setMergeSuggestions] = useState<ReviewedMergeSuggestion[]>([]);
  const [mergeSuggestBusy, setMergeSuggestBusy] = useState(false);
  const [mergeSuggestError, setMergeSuggestError] = useState("");
  const [mergeSuggestNote, setMergeSuggestNote] = useState("");
  const [mergeSuggestRan, setMergeSuggestRan] = useState(false);
  // Bumped after a recipe/spec import so an effect can auto-run the merge check
  // (imported recipe ingredients can duplicate standalone individual ones).
  const [mergeCheckRequest, setMergeCheckRequest] = useState(0);
  // Bumped after a spec sheet import so SpecReconcilePanel auto-runs the
  // cross-reference against the newly saved sheet.
  const [specReconcileSignal, setSpecReconcileSignal] = useState(0);
  // True when the merge review was opened automatically by an import, so we can
  // show a one-line explainer of why the user landed here.
  const [mergeFromImport, setMergeFromImport] = useState(false);

  // Local (per-device) master-data change history for the undo trail.
  const [changeHistory, setChangeHistory] = useState<MasterDataChange[]>(() => loadChangeHistory());
  const [undoBusy, setUndoBusy] = useState(false);
  // Record a change (snapshot already taken before the edit) and refresh the list.
  const noteChange = useCallback(
    (type: MasterDataChangeType, description: string, before: Record<string, string>) => {
      recordMasterDataChange(type, description, before);
      setChangeHistory(loadChangeHistory());
    },
    [],
  );

  // The mergeable universe: every master-data list whose values get rewritten by
  // a merge — ingredient names plus die types (the `dieType` selection field is
  // rewritten too). Brands/flavors are excluded (they have their own rename path).
  const mergeUniverse = useMemo(() => {
    const all = [
      ...ingredientTypes,
      ...cheeseIngredients,
      ...doughIngredients,
      ...frontlineIngredients,
      ...mixIngredients,
      ...pepTypes,
      ...dieTypes,
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of all) {
      const key = n.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(n); }
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [ingredientTypes, cheeseIngredients, doughIngredients, frontlineIngredients, mixIngredients, pepTypes, dieTypes]);

  // Same universe, ordered closest-match-first so likely duplicates surface at the
  // top. When sources are selected, rank by best similarity to any selected
  // source; otherwise fall back to similarity against the typed target; otherwise
  // alphabetical. Reuses the shared name-similarity helper.
  const mergeUniverseRanked = useMemo(() => {
    const probes = [...mergeSources, mergeTarget.trim()].filter(Boolean);
    if (probes.length === 0) return mergeUniverse;
    return mergeUniverse
      .map((name, i) => ({
        name,
        i,
        s: Math.max(...probes.map((p) => scoreNameMatch(p, name))),
      }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.name);
  }, [mergeUniverse, mergeSources, mergeTarget]);

  // Gather every value surface a merge would touch, so the confirmation preview
  // can count affected references. Mirrors buildSyncPayload's localStorage scan.
  function collectMergeSurfaces() {
    const lists = [
      ingredientTypes,
      cheeseIngredients,
      doughIngredients,
      frontlineIngredients,
      mixIngredients,
      pepTypes,
      dieTypes,
    ];
    const settingsObjects: Record<string, unknown>[] = [];
    for (const run of dayStateRef.current.runs) {
      const vals = run.id === currentRunId ? form.getValues() : loadRunValues(run.id);
      settingsObjects.push(vals as unknown as Record<string, unknown>);
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("run-calc-profile-") || key.startsWith("run-calc-crust-profile-")) {
        try {
          const obj = JSON.parse(localStorage.getItem(key) ?? "null");
          if (obj && typeof obj === "object") settingsObjects.push(obj as Record<string, unknown>);
        } catch {}
      }
    }
    for (const t of loadTemplates()) {
      if (t.values) settingsObjects.push(t.values as unknown as Record<string, unknown>);
    }
    for (const day of loadHistory()) {
      for (const vals of Object.values(day.runValues ?? {})) {
        settingsObjects.push(vals as unknown as Record<string, unknown>);
      }
    }
    const doughPresets = loadDoughRecipePresets();
    const doughRows: Record<string, { ingredient?: unknown }[]> = {};
    for (const [n, p] of Object.entries(doughPresets)) doughRows[n] = p.rows ?? [];
    const presetMaps = [doughRows, loadFrontlineRecipePresets(), loadCheeseRecipePresets()];
    return { lists, settingsObjects, presetMaps };
  }

  const mergeMap: MergeMap = buildMergeMap(mergeSources, mergeTarget);
  const mergePreviewCount = useMemo(() => {
    if (Object.keys(mergeMap).length === 0) return 0;
    try { return countMergeReferences(mergeMap, collectMergeSurfaces()); } catch { return 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeSources, mergeTarget]);

  function toggleMergeSource(name: string) {
    setMergeError("");
    setMergeConfirming(false);
    setMergeSources(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name],
    );
  }

  function resetMergeForm() {
    setMergeSources([]);
    setMergeTarget("");
    setMergeConfirming(false);
    setMergeBusy(false);
    setMergeError("");
  }

  // Ask for duplicate-group suggestions: combines AI clustering with learned
  // "previously merged" aliases. Results are reviewed (never auto-applied);
  // each group's "Load" pre-fills the manual merge form for inspection, while
  // "Apply" merges it directly through the same destructive merge path.
  async function handleSuggestMerges(fromImport = false) {
    if (!fromImport) setMergeFromImport(false);
    setMergeSuggestBusy(true);
    setMergeSuggestError("");
    setMergeSuggestNote("");
    setMergeSuggestRan(true);
    try {
      const { suggestions, usedAi, error } = await suggestMerges(mergeUniverse);
      setMergeSuggestions(suggestions);
      if (!usedAi && error) {
        setMergeSuggestError(
          `AI unavailable (${error}). Showing previously-merged suggestions only.`,
        );
      }
      if (usedAi && suggestions.length === 0) {
        setMergeSuggestNote("No duplicate groups found.");
      }
    } catch (e) {
      setMergeSuggestions([]);
      setMergeSuggestError(e instanceof Error ? e.message : "Couldn't get suggestions.");
    } finally {
      setMergeSuggestBusy(false);
    }
  }

  // After a spec/recipe import that added recipes, auto-run the merge check:
  // imported cheese/mix recipe ingredients can duplicate standalone individual
  // ingredients. We navigate to the Merge review and scan once (fire-and-forget,
  // never blocks the already-committed import). The effect re-runs only when the
  // request counter is bumped, so by then `mergeUniverse` reflects the new lists.
  useEffect(() => {
    if (mergeCheckRequest === 0) return;
    setActiveTab("setup");
    setManageCategory("merge");
    setMergeFromImport(true);
    void handleSuggestMerges(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeCheckRequest]);

  // Pre-fill the manual merge form from a suggested group so the user can review
  // and tweak the source selection before confirming. Names are snapped to the
  // universe's exact spelling so the source checkboxes actually tick (AI/learned
  // suggestion names can differ in case), and the form (which sits below the
  // suggestion list) is scrolled into view so it's obvious Load did something.
  function loadMergeSuggestion(s: MergeSuggestion) {
    setMergeError("");
    setMergeConfirming(false);
    setMergeFromImport(false);
    const canon = (n: string) =>
      mergeUniverse.find((u) => u.toLowerCase() === n.trim().toLowerCase()) ?? n.trim();
    const tgt = canon(s.target);
    const seen = new Set<string>();
    const srcs: string[] = [];
    for (const raw of s.sources) {
      const n = canon(raw);
      const key = n.toLowerCase();
      if (n.toLowerCase() === tgt.toLowerCase() || seen.has(key)) continue;
      seen.add(key);
      srcs.push(n);
    }
    setMergeTarget(tgt);
    setMergeSources(srcs);
    requestAnimationFrame(() =>
      mergeFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  // Apply a suggested group directly through the destructive merge path. On
  // success drop just this suggestion so the user can keep working through the
  // rest of the list (the panel stays open — no reload).
  async function applyMergeSuggestion(s: ReviewedMergeSuggestion) {
    const sources = s.sources.filter((n) => n !== s.target);
    if (sources.length === 0) return;
    setMergeFromImport(false);
    const ok = await handleApplyMerge(sources, s.target);
    if (ok) setMergeSuggestions((prev) => prev.filter((x) => x !== s));
  }

  // Ignore a suggested group: persist the {target, source} pairs as denied so
  // the suggester never proposes them again (factory-wide), then drop it from
  // the open list. Persisting is best-effort — even if the POST fails the user
  // still gets the suggestion out of their way for this session.
  async function ignoreMergeSuggestion(s: ReviewedMergeSuggestion) {
    const sources = s.sources.filter((n) => n !== s.target);
    if (sources.length === 0) return;
    setMergeFromImport(false);
    setMergeSuggestions((prev) => prev.filter((x) => x !== s));
    try {
      await denyMerge(s.target, sources);
    } catch {
      // Non-fatal: the suggestion is already hidden for this session; it may
      // reappear on a later scan if the deny didn't persist.
    }
  }

  async function handleApplyMerge(sourcesArg?: string[], targetArg?: string): Promise<boolean> {
    const srcs = sourcesArg ?? mergeSources;
    const tgt = targetArg ?? mergeTarget;
    const map = buildMergeMap(srcs, tgt);
    if (Object.keys(map).length === 0) {
      setMergeError("Pick at least one source and a different target.");
      return false;
    }
    setMergeBusy(true);
    setMergeError("");
    // Snapshot master-data BEFORE the merge rewrites localStorage, so the change
    // can be recorded for undo on success. (Undo restores names/lists but does
    // NOT reverse the server-side inventory fold — the undo confirm warns about
    // this.)
    const mergeBefore = captureMasterDataSnapshot();
    try {
      // Fold inventory stock first (server). If we can't read or fold inventory,
      // abort BEFORE touching localStorage so the two stores can't drift apart.
      let inv: import("../inventoryShared").InventoryItem[];
      try {
        inv = await fetchInventory();
      } catch {
        setMergeBusy(false);
        setMergeError("Couldn't verify inventory state — merge cancelled. Check your connection and try again.");
        return false;
      }
      const lines: MergeInventoryLine[] = [];
      for (const item of inv) {
        if (item.category !== "ingredient") continue; // sizes/packaging not merged
        const toName = mapName(item.name, map);
        if (toName === item.name) continue; // not a source
        lines.push({
          fromKey: item.key,
          toKey: `ingredient:${toName}:${item.unit}`,
          toName,
          category: item.category,
          unit: item.unit,
        });
      }
      // Surface any inventory folds the server skipped (e.g. an item deleted
      // between the fetch above and the merge). All lines here come from tracked
      // inventory, so a skip is unexpected and worth flagging.
      const skipped = lines.length > 0 ? (await mergeInventory(lines)).results.filter(r => r.status === "skipped") : [];
      if (skipped.length > 0) {
        const summary = skipped
          .map(s => `• ${s.fromKey} → ${s.toKey} (${s.reason ?? "unknown"})`)
          .join("\n");
        window.alert(
          `Some inventory stock wasn't folded into the target:\n\n${summary}\n\n` +
            "Ingredient names were still merged everywhere else. Check these items' stock in Inventory.",
        );
      }
      // Rewrite every localStorage surface, then refresh React state in place so
      // the merged data shows immediately and the live-sync push carries the
      // merged lists — without tearing down the open Merge panel via a reload.
      applyIngredientMerge(map);
      // Persist the merged-away source names to the DURABLE factory-wide
      // tombstone (best effort). Unlike the per-day sync blob, this survives a
      // day boundary and reaches a device that was offline during the merge, so
      // the merged names never resurface. Targets (a source mapping to itself)
      // are never tombstoned.
      {
        const tombTargets = new Set(Object.values(map).map(t => t.trim().toLowerCase()));
        const tombSources = Object.keys(map).filter(s => !tombTargets.has(s.trim().toLowerCase()));
        void saveMergedAwayNames(tombSources).catch(() => {});
      }
      // Persist the confirmed merge as factory-wide learned aliases (best
      // effort): feeds the AI suggester next time and powers "previously
      // merged" suggestions. Awaited so the POST completes before we push.
      try {
        await saveMergeAliases(collectMergeAliases(srcs, tgt));
      } catch {
        // Non-fatal: the merge itself already succeeded; learning is additive.
      }
      // Also record each confirmed source→target as a factory-wide correction
      // (ingredient domain) so every other name-resolving AI helper honors it.
      void saveAiCorrections(
        srcs
          .filter((src) => src.trim() && src.trim().toLowerCase() !== tgt.trim().toLowerCase())
          .map((src) => ({ domain: "ingredient", fromText: src, toText: tgt })),
      );
      // Refresh all React surfaces the merge rewrote, in place, BEFORE pushing.
      // This resets the current-run form to the merged values, so the sync
      // payload below (which serializes the active run from form.getValues())
      // ships merged names rather than the stale pre-merge ones.
      refreshAfterMerge();
      // Push the merged payload (with its mergedAway tombstones) to the server
      // immediately. Otherwise an incoming sync-pull could race ahead of the
      // debounced push and the additive list-union re-adds the merged-away names
      // from the still-stale server copy. Best-effort: the local tombstone filter
      // is the backstop if this push fails.
      try {
        await fetch(`/api/sync/today?today=${todayStr()}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderId: clientId.current,
            payload: buildSyncPayload(loadDayState()),
          }),
        });
      } catch {
        // Non-fatal: tombstones are persisted locally.
      }
      // Clear the merge form. The panel stays open so the user can apply more
      // suggestions.
      resetMergeForm();
      // Record the merge in the local undo trail (no-op-safe: skipped if nothing
      // actually changed). Recorded last so a failed merge above never logs.
      noteChange(
        "merge",
        `Merged ${srcs.filter((s) => s.trim()).map((s) => `"${s}"`).join(", ")} into "${tgt}"`,
        mergeBefore,
      );
      setMergeBusy(false);
      return true;
    } catch (e) {
      setMergeBusy(false);
      setMergeError(e instanceof Error ? e.message : "Merge failed. Please try again.");
      return false;
    }
  }

  // Undo a master-data change (and every change made after it). Restores the
  // entry's before-snapshot, refreshes every React surface, and re-pushes the
  // restored master data to the server so the rollback propagates (and merged-
  // away names don't get resurrected by the additive sync union).
  async function handleUndoChange(entry: MasterDataChange) {
    const list = loadChangeHistory();
    const idx = list.findIndex((e) => e.id === entry.id);
    const discarded = idx === -1 ? [] : list.slice(0, idx + 1);
    const hasMerge = discarded.some((e) => e.type === "merge");
    const warn = hasMerge
      ? "\n\nNote: this reverses the ingredient names and lists, but does NOT un-fold any inventory stock that was combined by a merge. Re-check stock in Inventory."
      : "";
    const extra = discarded.length - 1;
    const tail = extra > 0 ? ` and ${extra} later change${extra === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Undo "${entry.description}"${tail}?${warn}`)) return;
    setUndoBusy(true);
    try {
      const ok = undoChange(entry.id);
      if (!ok) {
        setChangeHistory(loadChangeHistory());
        return;
      }
      refreshAfterMerge();
      setChangeHistory(loadChangeHistory());
      try {
        await fetch(`/api/sync/today?today=${todayStr()}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderId: clientId.current,
            payload: buildSyncPayload(loadDayState()),
          }),
        });
      } catch {
        // Non-fatal: the local restore already happened; tombstones back it up.
      }
    } finally {
      setUndoBusy(false);
    }
  }

  // ── Schedule future days ────────────────────────────────────────────────────
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importResult, setImportResult] = useState<ImportParseResult | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleImportInputRef = useRef<HTMLInputElement | null>(null);
  // ── Spec-sheet importer (AI-interpreted brand/flavor profiles + recipes) ──
  const [showSpecImport, setShowSpecImport] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [specImportLoading, setSpecImportLoading] = useState(false);
  const [specImportApplying, setSpecImportApplying] = useState(false);
  const [specImportError, setSpecImportError] = useState<string | null>(null);
  const [specImportPrepared, setSpecImportPrepared] = useState<SpecImportPrepared | null>(null);
  const [specImportProgress, setSpecImportProgress] = useState<{ done: number; total: number } | null>(null);
  const specImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showPremixImport, setShowPremixImport] = useState(false);
  const [premixImportLoading, setPremixImportLoading] = useState(false);
  const [premixImportApplying, setPremixImportApplying] = useState(false);
  const [premixImportError, setPremixImportError] = useState<string | null>(null);
  const [premixImportPrepared, setPremixImportPrepared] = useState<PremixImportPrepared | null>(null);
  const [premixImportProgress, setPremixImportProgress] = useState<{ done: number; total: number } | null>(null);
  const premixImportInputRef = useRef<HTMLInputElement | null>(null);
  const [importIntoEditor, setImportIntoEditor] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importDefaultDate, setImportDefaultDate] = useState(todayStr());
  const [scheduledDays, setScheduledDays] = useState<{date: string; runCount: number; runs?: {id: string; brand: string; flavor: string; casesNeeded: number; dieType: string}[]}[]>([]);
  const [expandedScheduleDay, setExpandedScheduleDay] = useState<string | null>(null);
  const [scheduleView, setScheduleView] = useState<"list" | "editor" | "advanced">("list");
  const [scheduleEditorDate, setScheduleEditorDate] = useState("");
  const [scheduleEditorRuns, setScheduleEditorRuns] = useState<{id: string; brand: string; flavor: string; casesNeeded: number}[]>([]);
  const [scheduleEditorRunValues, setScheduleEditorRunValues] = useState<Record<string, FormValues>>({});
  const [scheduleAdvancedRunId, setScheduleAdvancedRunId] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleDeleteConfirm, setScheduleDeleteConfirm] = useState<string | null>(null);
  const [scheduleMove, setScheduleMove] = useState<{ from: string; runId: string | null } | null>(null);
  const [scheduleMoveDate, setScheduleMoveDate] = useState("");
  const [scheduleMoving, setScheduleMoving] = useState(false);
  function tomorrowStr() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  async function openScheduleEditor(date?: string) {
    setScheduleAdvancedRunId(null);
    if (date) {
      try {
        const res = await fetch(`/api/sync/${date}`);
        if (res.ok) {
          const payload = await res.json() as SyncPayload | null;
          if (payload?.dayState) {
            const storedVals = (payload.runValues ?? {}) as Record<string, FormValues>;
            setScheduleEditorRunValues(storedVals);
            setScheduleEditorDate(date);
            setScheduleEditorRuns(
              payload.dayState.runs.map(r => {
                const v = storedVals[r.id] ?? {} as Partial<FormValues>;
                return { id: r.id, brand: r.brand, flavor: r.flavor, casesNeeded: v.casesNeeded ?? 0 };
              })
            );
            setScheduleView("editor");
            return;
          }
        }
      } catch {}
    }
    const newId = genId();
    setScheduleEditorRunValues({ [newId]: { ...DEFAULT_VALUES } });
    setScheduleEditorDate(todayStr());
    setScheduleEditorRuns([{ id: newId, brand: "", flavor: "", casesNeeded: 0 }]);
    setScheduleView("editor");
  }
  async function saveScheduledDay() {
    if (!scheduleEditorDate) return;
    setScheduleSaving(true);
    try {
      const runs: RunMeta[] = scheduleEditorRuns.map(r => ({ id: r.id, brand: r.brand, flavor: r.flavor }));
      const runValues: Record<string, FormValues> = {};
      for (const r of scheduleEditorRuns) {
        // Merge in priority: editor-set values > saved profile > defaults
        const stored = scheduleEditorRunValues[r.id];
        const profile = r.brand ? loadProfile(r.brand, r.flavor) : null;
        const base: FormValues = stored ?? profile ?? DEFAULT_VALUES;
        runValues[r.id] = { ...base, casesNeeded: r.casesNeeded };
      }
      const payload: SyncPayload = {
        dayState: { runs, date: scheduleEditorDate, resetAt: Date.now() },
        runValues,
        brands: loadList(BRANDS_KEY, []).filter(b => !STALE_BRANDS.includes(b)),
        brandFlavors: loadBrandFlavors(),
        deletedItems: loadDeletedItems(),
      };
      const res = await fetch(`/api/sync/${scheduleEditorDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      if (res.ok) {
        fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[])).catch(() => {});
        setScheduleView("list");
      }
    } catch {}
    setScheduleSaving(false);
  }
  async function deleteScheduledDay(date: string) {
    try {
      await fetch(`/api/sync/${date}?today=${todayStr()}`, { method: "DELETE" });
      setScheduledDays(prev => prev.filter(d => d.date !== date));
      setScheduleDeleteConfirm(null);
    } catch {}
  }
  async function fetchSchedulePayload(date: string): Promise<SyncPayload | null> {
    try {
      const res = await fetch(`/api/sync/${date}`);
      if (!res.ok) return null;
      return (await res.json()) as SyncPayload | null;
    } catch { return null; }
  }
  async function refreshScheduledDays() {
    try {
      const d = await fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json());
      setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[]);
    } catch {}
  }
  // Move a whole scheduled day (sel "all") or a single run (sel.runId) to another
  // future date. Web schedule pool is future days only — the live "today" runs are
  // never a move source or target (mobile allows today; see schedule-move memory).
  // Target is written before the source is trimmed/deleted, so a partial network
  // failure can only leave a duplicate (visible, user-fixable) — never lose runs.
  async function performScheduleMove(fromDate: string, sel: "all" | { runId: string }, toDate: string) {
    if (!toDate || toDate === fromDate) return;
    const src = await fetchSchedulePayload(fromDate);
    if (!src?.dayState) return;
    let ids: string[] | "all";
    if (sel === "all") ids = "all";
    else {
      if (!src.dayState.runs.some(r => r.id === sel.runId)) return;
      ids = [sel.runId];
    }
    const tgt = await fetchSchedulePayload(toDate);
    const { source, target, idMap } = moveEntries(src.dayState.runs, tgt?.dayState?.runs ?? [], ids, genId);
    if (idMap.length === 0) return;
    const vals = relocateValues(
      (src.runValues ?? {}) as Record<string, FormValues>,
      (tgt?.runValues ?? {}) as Record<string, FormValues>,
      idMap,
    );
    const base = tgt ?? src;
    const targetPayload: SyncPayload = {
      ...base,
      dayState: { ...(base.dayState ?? src.dayState), runs: target, date: toDate, resetAt: Date.now() },
      runValues: vals.target,
    };
    const tRes = await fetch(`/api/sync/${toDate}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: targetPayload }),
    });
    if (!tRes.ok) return;
    if (source.length === 0) {
      await fetch(`/api/sync/${fromDate}?today=${todayStr()}`, { method: "DELETE" });
    } else {
      const sourcePayload: SyncPayload = {
        ...src,
        dayState: { ...src.dayState, runs: source, date: fromDate },
        runValues: vals.source,
      };
      await fetch(`/api/sync/${fromDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: sourcePayload }),
      });
    }
    await refreshScheduledDays();
  }
  function updateAdvancedField<K extends keyof FormValues>(runId: string, field: K, value: FormValues[K]) {
    setScheduleEditorRunValues(prev => ({
      ...prev,
      [runId]: { ...(prev[runId] ?? DEFAULT_VALUES), [field]: value },
    }));
  }
  function updateAdvancedArray(runId: string, field: keyof FormValues, rows: {ingredient: string; lbs: number}[]) {
    setScheduleEditorRunValues(prev => ({
      ...prev,
      [runId]: { ...(prev[runId] ?? DEFAULT_VALUES), [field]: rows },
    }));
  }

  // ── Sync refs ──────────────────────────────────────────────────────────────
  const clientId = useRef<string>(
    (() => {
      let id = sessionStorage.getItem("run-calc-client-id");
      if (!id) { id = genId(); sessionStorage.setItem("run-calc-client-id", id); }
      return id;
    })()
  );
  const dayStateRef = useRef(dayState);
  const lastLocalEditRef = useRef(0);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncApplyingRef = useRef(false);
  const applySyncCallbackRef = useRef<(p: SyncPayload) => void>(() => {});
  const initialFinishTimestampRef = useRef<number>(0);
  const pushAcknowledgedRef = useRef(true);
  // Signature of the last payload we successfully pushed. Idle clients must not
  // re-broadcast an unchanged state (periodic 30s push / reconnect re-push),
  // otherwise a second open tab keeps overwriting another tab's live edits.
  // Mirrors the mobile app's lastSyncSigRef gate (web/mobile parity).
  const lastSyncSigRef = useRef<string>("");
  const [syncConnected, setSyncConnected] = useState(false);

  // Keep dayStateRef current
  useEffect(() => { dayStateRef.current = dayState; }, [dayState]);
  // Mirror today's substitution overlay into the shared-calc module so every
  // call site (calc useMemo, warehouse roll-up, consumeRun, schedule/history
  // totals) overlays it without threading it through each call. See
  // substitutionState.ts. Runs synchronously enough for the next render's calc.
  useEffect(() => { setActiveSubstitutions(dayState.substitutions ?? []); }, [dayState.substitutions]);

  // ── Proactive shift alerts ────────────────────────────────────────────────
  // Poll the server on a cadence for at most one timely, dismissible nudge.
  // Manager-only; runs even on an idle day so an expiring-stock heads-up can
  // surface before any run begins (the server gates behind-plan/break nudges to
  // an active day and skips the AI call when idle with no at-risk stock). The
  // hook owns cooldown + de-dup (see aiProactive.ts). Mirrors the mobile
  // provider in (tabs)/_layout.tsx (replit.md parity).
  const { alert: proactiveAlert, dismiss: dismissProactiveAlert } = useProactiveAlert({
    enabled: isManager,
    buildInput: () => {
      // Resolve upcoming scheduled runs to their FormValues (scheduled runs carry
      // no recipe rows) exactly like the warehouse "Reorder Now" card does, then
      // aggregate to a per-item demand map. Sent to the server so the proactive
      // reorder nudge subtracts the SAME projected demand as the card and the two
      // can never disagree (the server can't resolve this itself — profiles are
      // client-side). scheduledDays is already today-or-later (server-filtered).
      const scheduledValsList: FormValues[] = scheduledDays.flatMap((day) =>
        (day.runs ?? [])
          .filter((r) => r.brand)
          .map((r) => {
            const profile = loadProfile(r.brand, r.flavor);
            return {
              ...(profile ?? DEFAULT_VALUES),
              casesNeeded: r.casesNeeded,
              ...(r.dieType ? { dieType: r.dieType } : {}),
            } as FormValues;
          }),
      );
      return {
        ...buildOptimizeInput({
          date: todayStr(),
          nowMs: Date.now(),
          runToTime,
          runs: dayState.runs,
          runValuesFor: (id) => (id === currentRunId ? form.getValues() : loadRunValues(id)),
          history,
          scheduledDays: scheduledDays.map((d) => ({
            date: d.date,
            runs: (d.runs ?? []).map((r) => ({
              brand: r.brand,
              flavor: r.flavor,
              casesNeeded: r.casesNeeded,
              dieType: r.dieType,
            })),
          })),
        }),
        reorderDemandByKey: buildReorderDemandByKey(scheduledValsList),
      };
    },
  });

  // Update the apply-sync callback so it always captures fresh form/state refs
  useEffect(() => {
    applySyncCallbackRef.current = (payload: SyncPayload) => {
      isSyncApplyingRef.current = true;
      const arraysEqual = (a: string[], b: string[]) =>
        a.length === b.length && a.every((x, i) => x === b[i]);

      // ── Reset guard: only apply day state + run values if remote reset is at least as recent
      //    AND the remote date matches today (prevents yesterday's stale device from overwriting a fresh day) ──
      const remoteResetAt = payload.dayState.resetAt ?? 0;
      const localResetAt = dayStateRef.current.resetAt ?? 0;
      const remoteDate = payload.dayState.date;
      const remoteDateOk = !remoteDate || remoteDate === todayStr();
      const acceptRemoteDay = remoteDateOk && remoteResetAt >= localResetAt;

      // Per-run lost-update guard: compare each run's edit timestamp. We only
      // REJECT a remote run's values when our local edit is STRICTLY newer — so
      // unedited/imported runs (both ts 0) still adopt the remote exactly as
      // before. `rejectedStale` triggers a re-push so peers converge on our edit.
      const remoteUpd = payload.runValuesUpdatedAt ?? {};
      const localUpd = loadRunValuesUpdated();
      let rejectedStale = false;

      // ── Run values (only accept if we're taking the remote day) ──
      if (acceptRemoteDay) {
        const mergedUpd: Record<string, number> = { ...localUpd };
        for (const [id, vals] of Object.entries(payload.runValues)) {
          const rTs = remoteUpd[id] ?? 0;
          const lTs = localUpd[id] ?? 0;
          // Symmetric to the push guard (pickCurrentRunPushValue): NEVER accept an
          // all-default remote value over a populated local one, regardless of
          // stamp. The corruption pairs an empty value with a REAL, often EQUAL
          // stamp, so the lTs/rTs guard below would otherwise fall through to
          // saveRunValues(empty) and wipe good local data on every SSE reconnect /
          // refresh (the recurring "I refreshed and it vanished" loss). Keep ours
          // and BUMP our stamp to now so the heal re-push below strictly wins the
          // per-run guard on the server and every peer — the corrupted shared row
          // carries the run's real stamp, so a re-push at the same stamp couldn't
          // overwrite it.
          if (isEmptyOverPopulated(vals as FormValues, loadRunValues(id))) {
            mergedUpd[id] = Date.now();
            rejectedStale = true;
            continue;
          }
          if (lTs > rTs) {
            // Local edit is fresher than this remote — keep ours, re-push later.
            rejectedStale = true;
          } else {
            saveRunValues(id, vals as FormValues);
            if (rTs > lTs) mergedUpd[id] = rTs;
          }
        }
        saveRunValuesUpdated(mergedUpd);
      }

      // ── Merge tombstones (union remote+local) ──
      // A merge removes source names locally, but the additive list-union below
      // would resurrect them from a stale peer/server. Union the synced tombstone
      // set and strip those names from every list merge so a merge sticks.
      const mergedTomb = [...new Set([...loadMergedAway(), ...(payload.mergedAway ?? [])])];
      saveMergedAway(mergedTomb);
      const tombSet = new Set(mergedTomb.map(n => n.trim().toLowerCase()));

      // ── Deletion tombstones (union remote+local, per list namespace) ──
      // A plain delete removes an item locally, but the additive list-union below
      // would resurrect it from a stale peer. Union the synced per-list deletion
      // tombstones and strip each list's namespace from its merge so a delete sticks.
      const deletedMap = unionDeletedItems(loadDeletedItems(), payload.deletedItems);
      // Runs are per-day: on a true daily reset (resetAt strictly forward) drop the
      // run tombstones — those ids can never match today's fresh runs and would
      // otherwise accumulate forever.
      if (remoteResetAt > localResetAt) delete deletedMap["runs"];
      saveDeletedItems(deletedMap);
      const deletedBrandSet = new Set((deletedMap["brands"] ?? []).map(b => b.trim().toLowerCase()));
      const deletedRunSet = new Set((deletedMap["runs"] ?? []).map(id => id.trim().toLowerCase()));

      // ── Day state (runs + shiftNotes + runToTime) ──
      if (acceptRemoteDay) {
        setDayState(prev => {
          const isReset = remoteResetAt > localResetAt;
          // Runs are day-state and converge like the substitution/staging overlays
          // below: on a true daily reset adopt the remote runs wholesale (the reset's
          // empty set replaces ours); during same-day concurrent editing union by id
          // so a run just added on THIS device — not yet pushed — isn't clobbered by
          // an incoming payload that predates it. The run-deletion tombstone strips
          // ids deleted on a peer so the union can't resurrect them.
          const remoteRuns = payload.dayState.runs;
          const newRuns = isReset
            ? remoteRuns
            : (() => {
                const remoteIds = new Set(remoteRuns.map(r => r.id));
                const localOnly = prev.runs.filter(r => !remoteIds.has(r.id));
                return [...remoteRuns, ...localOnly].filter(
                  r => !deletedRunSet.has(r.id.trim().toLowerCase()),
                );
              })();
          const newIndex = Math.max(0, Math.min(prev.currentIndex, newRuns.length - 1));
          // A true daily reset bumps resetAt strictly forward: adopt the remote
          // day's overlays wholesale so the reset's empty maps clear ours. When
          // resetAt is EQUAL (normal same-day concurrent editing across devices)
          // we additively merge the staging checklist and substitution overlay
          // per key/id instead of clobbering, so two devices each ticking a
          // different item (or adding a different substitution) both survive —
          // the same convergence model as the master-data list unions. An
          // un-check / removal won't cross devices (the accepted union tradeoff,
          // and these reset daily anyway).
          const remoteStaged = payload.dayState.stagedItems ?? {};
          const mergedStaged: Record<string, boolean> = isReset
            ? remoteStaged
            : (() => {
                const out: Record<string, boolean> = { ...(prev.stagedItems ?? {}) };
                for (const [k, val] of Object.entries(remoteStaged)) {
                  out[k] = !!out[k] || !!val;
                }
                return out;
              })();
          const unionById = <T extends { id: string }>(a: readonly T[], b: readonly T[]): T[] => {
            const byId = new Map<string, T>();
            for (const x of a) byId.set(x.id, x);
            for (const x of b) byId.set(x.id, x); // remote wins for the same id
            return [...byId.values()];
          };
          const remoteSubs = payload.dayState.substitutions ?? [];
          const remoteSubLog = payload.dayState.substitutionLog ?? [];
          const mergedSubs = isReset ? remoteSubs : unionById(prev.substitutions ?? [], remoteSubs);
          const mergedSubLog = isReset
            ? remoteSubLog
            : unionById(prev.substitutionLog ?? [], remoteSubLog).sort((x, y) => x.ts - y.ts);
          const newDs = {
            ...prev,
            runs: newRuns,
            currentIndex: newIndex,
            shiftNotes: payload.dayState.shiftNotes ?? prev.shiftNotes,
            runToTime: payload.dayState.runToTime ?? prev.runToTime,
            resetAt: remoteResetAt > 0 ? remoteResetAt : prev.resetAt,
            substitutions: mergedSubs,
            substitutionLog: mergedSubLog,
            stagedItems: mergedStaged,
          };
          // Skip the re-render when nothing actually changed (sync echoes its own
          // pushes ~every 10s); a fresh object every time reset open-menu scroll.
          if (JSON.stringify(newDs) === JSON.stringify(prev)) return prev;
          saveDayState(newDs);
          return newDs;
        });
        if (payload.dayState.runToTime) setRunToTime(payload.dayState.runToTime);
      }

      // ── Form reset for current run (if remote edit is newer, and we accepted the remote day) ──
      if (acceptRemoteDay) {
        const currentId = dayStateRef.current.runs[dayStateRef.current.currentIndex]?.id;
        const currentRunInPayload = payload.dayState.runs.find(r => r.id === currentId);
        if (currentRunInPayload?.subTab) setDoughSubTab(currentRunInPayload.subTab);
        // Never reset the live form to a remote value that is older than our own
        // edit for this run (per-run lost-update guard). Equal/absent timestamps
        // fall through to the prior time-quiet + push-ack behavior.
        const curLocalTs = currentId ? (localUpd[currentId] ?? 0) : 0;
        const curRemoteTs = currentId ? (remoteUpd[currentId] ?? 0) : 0;
        if (currentId && payload.runValues[currentId] && curLocalTs <= curRemoteTs && Date.now() - lastLocalEditRef.current > 2000 && pushAcknowledgedRef.current
          // Never blank the live form by resetting it to an all-default remote
          // value while our stored copy is still populated (the same
          // empty-over-populated corruption guarded on the run-values loop above).
          && !isEmptyOverPopulated(payload.runValues[currentId] as FormValues, loadRunValues(currentId))) {
          const merged = { ...DEFAULT_VALUES, ...(payload.runValues[currentId] as FormValues) };
          form.reset(merged);
          resetFieldArrays(merged);
        }
      }

      // ── Brands ──
      if (payload.brands && payload.brands.length > 0) {
        const local = loadList(BRANDS_KEY, []).filter((b: string) => !STALE_BRANDS.includes(b));
        const remoteSanitized = payload.brands.filter((b: string) => !STALE_BRANDS.includes(b));
        const merged = dropDeleted(
          [...new Set([...local, ...remoteSanitized])],
          deletedMap,
          "brands",
        ).sort((a, b) => a.localeCompare(b));
        saveList(BRANDS_KEY, merged);
        setBrands(prev => (arraysEqual(prev, merged) ? prev : merged));
      }

      // ── Brand flavors ──
      if (payload.brandFlavors) {
        const local = loadBrandFlavors();
        const merged: Record<string, string[]> = {};
        for (const [brand, flavors] of Object.entries(local)) {
          if (STALE_BRANDS.includes(brand)) continue;
          if (deletedBrandSet.has(brand.trim().toLowerCase())) continue;
          merged[brand] = dropDeleted(flavors, deletedMap, flavorNamespace(brand));
        }
        for (const [brand, flavors] of Object.entries(payload.brandFlavors)) {
          if (STALE_BRANDS.includes(brand)) continue;
          // A brand deleted on any peer takes its flavors with it — don't let an
          // incoming flavor list resurrect a deleted brand.
          if (deletedBrandSet.has(brand.trim().toLowerCase())) continue;
          merged[brand] = dropDeleted(
            [...new Set([...(merged[brand] ?? []), ...flavors])],
            deletedMap,
            flavorNamespace(brand),
          ).sort((a, b) => a.localeCompare(b));
        }
        saveBrandFlavors(merged);
        setBrandFlavors(prev =>
          JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged
        );
      }

      // ── Ingredient types ──
      // Rename legacy/near-duplicate names from incoming sync so an un-migrated
      // peer can't re-add old spellings to the list.
      if (payload.ingredientTypes && payload.ingredientTypes.length > 0) {
        const local = dropMergedAway(loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES), tombSet);
        const cleanedRemote = payload.ingredientTypes.map(t => INGREDIENT_RENAMES[t] ?? t);
        const merged = dropDeleted(
          dropMergedAway([...new Set([...local, ...cleanedRemote])], tombSet),
          deletedMap,
          "ingredientTypes",
        ).sort((a, b) => a.localeCompare(b));
        if (!arraysEqual(merged, loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES))) {
          saveList(INGREDIENT_TYPES_KEY, merged);
          setIngredientTypes(merged);
        }
      }

      // Templates are no longer reconciled from the sync payload — they are now
      // facility-wide server master-data (see useRunTemplates). Merging them out
      // of the additive day-state union here would resurrect server-deleted
      // templates, so we intentionally ignore payload.templates on receive.

      // ── Simple list merges (union, no deletions) ──
      // Skip the setState (and the re-render it triggers) when the merged result is
      // identical to what's already stored. Sync runs on every SSE message (~10s),
      // so unconditional setState caused a re-render storm that reset menu scroll.
      function mergeList(key: string, defaults: string[], remote: string[] | undefined, setter: (v: string[]) => void, namespace: string) {
        if (!remote || remote.length === 0) return;
        const local = dropMergedAway(loadList(key, defaults), tombSet);
        const merged = dropDeleted(
          dropMergedAway([...new Set([...local, ...remote])], tombSet),
          deletedMap,
          namespace,
        ).sort((a, b) => a.localeCompare(b));
        if (arraysEqual(merged, loadList(key, defaults))) return;
        saveList(key, merged);
        setter(merged);
      }
      // Drop retired pep names + rename legacy ones from incoming sync so a peer that
      // hasn't migrated yet can't re-add "Diced Pepperoni"/"Pep - Cured" to the list.
      const cleanedRemotePep = (payload.pepTypes ?? [])
        .map(t => PEP_TYPE_RENAMES[t] ?? t)
        .filter(t => !RETIRED_PEP_TYPES.includes(t));
      mergeList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES, cleanedRemotePep, setPepTypes, "pepTypes");
      mergeList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES, payload.dieTypes, setDieTypes, "dieTypes");
      const cleanedRemoteCheese = (payload.cheeseIngredients ?? []).map(t => INGREDIENT_RENAMES[t] ?? t);
      mergeList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS, cleanedRemoteCheese, setCheeseIngredients, "cheeseIngredients");
      mergeList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS, payload.doughIngredients, setDoughIngredients, "doughIngredients");
      // Strip topping items from incoming frontline payload — old server payloads may still carry them
      const toppingSet = new Set(MIX_SEED.frontlineIngredients);
      const cleanedIncomingFrontline = (payload.frontlineIngredients ?? []).filter((i: string) => !toppingSet.has(i));
      mergeList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS, cleanedIncomingFrontline, setFrontlineIngredients, "frontlineIngredients");
      // Redirect any toppings from the incoming frontline payload into mix ingredients
      const toppingsFromFrontline = (payload.frontlineIngredients ?? []).filter((i: string) => toppingSet.has(i));
      const incomingMix = [...new Set([...(payload.mixIngredients ?? []), ...toppingsFromFrontline])];
      mergeList(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS, incomingMix, setMixIngredients, "mixIngredients");
      mergeList(DOUGH_RECIPE_NAMES_KEY, [], payload.doughRecipeNames, setDoughRecipeNames, "doughRecipeNames");
      // Filter mix-category names out of the incoming frontline list (server may still have old data)
      // Pre-clean localStorage so mergeList doesn't re-add mix names from the local side
      const cleanedLocalFrontline = loadList(FRONTLINE_RECIPE_NAMES_KEY, []).filter((n: string) => !SEED_MIX_RECIPE_NAMES.has(n));
      saveList(FRONTLINE_RECIPE_NAMES_KEY, cleanedLocalFrontline);
      const incomingFrontline = (payload.frontlineRecipeNames ?? []).filter((n: string) => !SEED_MIX_RECIPE_NAMES.has(n));
      const incomingMixFromFrontline = (payload.frontlineRecipeNames ?? []).filter((n: string) => SEED_MIX_RECIPE_NAMES.has(n));
      mergeList(FRONTLINE_RECIPE_NAMES_KEY, [], incomingFrontline, setFrontlineRecipeNames, "frontlineRecipeNames");
      // Merge mix recipe names from both the redirected frontline names and the dedicated payload field
      const allIncomingMix = [...new Set([...incomingMixFromFrontline, ...(payload.mixRecipeNames ?? [])])];
      if (allIncomingMix.length > 0) {
        mergeList(MIX_RECIPE_NAMES_KEY, [], allIncomingMix, setMixRecipeNames, "mixRecipeNames");
      }
      mergeList(CHEESE_RECIPE_NAMES_KEY, [], payload.cheeseRecipeNames, setCheeseRecipeNames, "cheeseRecipeNames");

      // ── Recipe presets (remote wins for same name, local-only kept) ──
      if (payload.doughRecipePresets && Object.keys(payload.doughRecipePresets).length > 0) {
        const merged = { ...loadDoughRecipePresets(), ...payload.doughRecipePresets };
        saveDoughRecipePresets(merged);
      }
      if (payload.frontlineRecipePresets && Object.keys(payload.frontlineRecipePresets).length > 0) {
        const merged = { ...loadFrontlineRecipePresets(), ...payload.frontlineRecipePresets };
        saveFrontlineRecipePresets(merged);
      }
      if (payload.cheeseRecipePresets && Object.keys(payload.cheeseRecipePresets).length > 0) {
        const merged = { ...loadCheeseRecipePresets(), ...payload.cheeseRecipePresets };
        saveCheeseRecipePresets(merged);
      }

      // ── Brand+flavor profiles (remote wins for same brand/flavor combo) ──
      // Profiles are keyed `${brandLc}__${flavorLc}`. Like every other synced list
      // they must honor the deletion/merge tombstones, or a profile for a deleted
      // brand/flavor lingers in the blob and can resurrect (or seed) ghost data.
      const profileKeyIsTombstoned = (k: string): boolean => {
        const sep = k.indexOf("__");
        if (sep < 0) return false;
        const brandLc = k.slice(0, sep);
        const flavorLc = k.slice(sep + 2);
        if (deletedBrandSet.has(brandLc)) return true;
        if ((deletedMap[`flavor:${brandLc}`] ?? []).includes(flavorLc)) return true;
        if (tombSet.has(brandLc) || tombSet.has(flavorLc)) return true;
        return false;
      };
      if (payload.brandProfiles) {
        for (const [k, v] of Object.entries(payload.brandProfiles)) {
          if (profileKeyIsTombstoned(k)) continue;
          try {
            // Strip mix recipe names from the sauce fields before saving
            const cleaned = { ...v };
            if (cleaned.frontlineRecipeName && SEED_MIX_RECIPE_NAMES.has(cleaned.frontlineRecipeName)) {
              delete cleaned.frontlineRecipeName;
              delete cleaned.frontlineRecipe;
            }
            localStorage.setItem(`run-calc-profile-${k}`, JSON.stringify(cleaned));
          } catch {}
        }
      }
      if (payload.crustProfiles) {
        for (const [k, v] of Object.entries(payload.crustProfiles)) {
          if (profileKeyIsTombstoned(k)) continue;
          try { localStorage.setItem(`run-calc-crust-profile-${k}`, JSON.stringify(v)); } catch {}
        }
      }

      // ── History (merge by date, union of runs per day) ──
      if (payload.history && payload.history.length > 0) {
        const local = loadHistory();
        const byDate = new Map<string, HistoryDay>();
        for (const day of [...local, ...payload.history]) {
          const existing = byDate.get(day.date);
          if (!existing) {
            byDate.set(day.date, { ...day });
          } else {
            // Merge runs (de-dup by id, remote wins for same id)
            const runMap = new Map<string, RunMeta>();
            for (const r of [...existing.runs, ...day.runs]) runMap.set(r.id, r);
            const mergedRunValues = { ...existing.runValues, ...day.runValues };
            byDate.set(day.date, { date: day.date, runs: [...runMap.values()], runValues: mergedRunValues });
          }
        }
        const merged = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_HISTORY_DAYS);
        // Skip the save + re-render when history is unchanged; the outgoing payload
        // always echoes loadHistory(), so each SSE cycle would otherwise re-render.
        if (JSON.stringify(merged) !== JSON.stringify(local)) {
          try { localStorage.setItem(HISTORY_KEY, JSON.stringify(merged)); } catch {}
          setHistory(merged);
        }
      }

      requestAnimationFrame(() => {
        isSyncApplyingRef.current = false;
        // We kept a strictly-newer local run value over a stale remote — re-push so
        // peers adopt ours and converge. Clear the signature gate so the push isn't
        // skipped as a no-op, and defer until isSyncApplyingRef is cleared above.
        if (rejectedStale) {
          lastSyncSigRef.current = "";
          schedulePush(dayStateRef.current, 0);
        }
      });
    };
  });

  // SSE connection — receives updates from other clients
  useEffect(() => {
    const es = new EventSource(`/api/sync/events?clientId=${clientId.current}&today=${todayStr()}`);
    es.onopen = () => {
      setSyncConnected(true);
      // Re-push our current state after every (re)connect so the server always has our latest,
      // even if pushes failed while the server was restarting.
      schedulePush(dayStateRef.current, 1000);
    };
    es.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { data: SyncPayload | null };
        if (msg.data) applySyncCallbackRef.current(msg.data);
      } catch {}
    };
    es.onerror = () => {
      setSyncConnected(false);
      // EventSource can't read the HTTP status, so a drop may be the daily reset
      // signing us out. Re-check /me; if the session is gone we land on login.
      revalidate();
    };
    return () => { setSyncConnected(false); es.close(); };
  }, []);

  // ── Durable merged-away tombstone (once on mount) ──
  // The per-day sync blob can't carry a merge across a day boundary: a new day's
  // row starts empty and whichever device seeds it wins. So on load we fetch the
  // factory-wide durable tombstone, union it into the local one, and strip those
  // names from every master list. This makes a merge stick across days and
  // across a device that was offline during the merge. Best-effort: a failure
  // just leaves the existing local/sync behavior unchanged.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let remoteNames: string[];
      try {
        remoteNames = await fetchMergedAwayNames();
      } catch {
        return; // offline / server error — local + sync tombstones still apply
      }
      if (cancelled || remoteNames.length === 0) return;
      const mergedTomb = [...new Set([...loadMergedAway(), ...remoteNames])];
      saveMergedAway(mergedTomb);
      const tombSet = new Set(mergedTomb.map(n => n.trim().toLowerCase()));
      const prune = (
        key: string,
        defaults: string[],
        setter: (v: string[]) => void,
      ) => {
        const current = loadList(key, defaults);
        const pruned = dropMergedAway(current, tombSet);
        if (pruned.length === current.length) return;
        saveList(key, pruned);
        setter(pruned);
      };
      prune(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES, setIngredientTypes);
      prune(PEP_TYPES_KEY, DEFAULT_PEP_TYPES, setPepTypes);
      prune(DIE_TYPES_KEY, DEFAULT_DIE_TYPES, setDieTypes);
      prune(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS, setCheeseIngredients);
      prune(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS, setDoughIngredients);
      prune(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS, setFrontlineIngredients);
      prune(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS, setMixIngredients);
    })();
    return () => { cancelled = true; };
  }, []);

  // Periodic push every 30 s — ensures sync recovers automatically even with no user activity
  useEffect(() => {
    const id = setInterval(() => { schedulePush(dayStateRef.current, 0); }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Auto-save dough recipe preset whenever name + rows are set
  useEffect(() => {
    const name = v.doughRecipeName?.trim();
    if (!name || (v.doughRecipe ?? []).length === 0) return;
    const presets = loadDoughRecipePresets();
    presets[name] = { rows: v.doughRecipe ?? [] };
    saveDoughRecipePresets(presets);
  }, [v.doughRecipeName, v.doughRecipe]);

  // Auto-save frontline (sauce) recipe preset
  useEffect(() => {
    const name = v.frontlineRecipeName?.trim();
    if (!name || (v.frontlineRecipe ?? []).length === 0) return;
    const presets = loadFrontlineRecipePresets();
    presets[name] = v.frontlineRecipe ?? [];
    saveFrontlineRecipePresets(presets);
  }, [v.frontlineRecipeName, v.frontlineRecipe]);

  // Auto-save cheese blend recipe presets (one per applicator, shared pool by name)
  useEffect(() => {
    const saves: [string | undefined, RecipeRow[]][] = [
      [v.app1CheeseRecipeName, v.app1CheeseRecipe ?? []],
      [v.app2CheeseRecipeName, v.app2CheeseRecipe ?? []],
      [v.app3CheeseRecipeName, v.app3CheeseRecipe ?? []],
      [v.app4CheeseRecipeName, v.app4CheeseRecipe ?? []],
    ];
    let changed = false;
    const presets = loadCheeseRecipePresets();
    for (const [name, rows] of saves) {
      const trimmed = name?.trim();
      if (!trimmed || rows.length === 0) continue;
      presets[trimmed] = rows;
      changed = true;
    }
    if (changed) saveCheeseRecipePresets(presets);
  }, [v.app1CheeseRecipeName, v.app1CheeseRecipe, v.app2CheeseRecipeName, v.app2CheeseRecipe, v.app3CheeseRecipeName, v.app3CheeseRecipe, v.app4CheeseRecipeName, v.app4CheeseRecipe]);

  // Detect day change while the tab is open (visibility change + periodic check)
  useEffect(() => {
    async function checkDateRollover() {
      const stored = (() => {
        try { return JSON.parse(localStorage.getItem(DAY_KEY) ?? "{}") as { date?: string }; } catch { return {}; }
      })();
      if (stored.date && stored.date !== todayStr()) {
        // Auto-end any active run before archiving yesterday
        const prevDs = (() => { try { return JSON.parse(localStorage.getItem(DAY_KEY) ?? "null") as DayState | null; } catch { return null; } })();
        if (prevDs && stored.date) {
          // Auto-deduct inventory for every run being closed by the rollover, the
          // same as an explicit endRun. consume is idempotent per runId, so runs
          // already deducted via endRun won't double-count.
          for (const r of prevDs.runs) {
            if (r.startedAt && !r.endedAt) {
              const vals = r.id === currentRunIdRef.current ? form.getValues() : loadRunValues(r.id);
              void consumeRun(r.id, computeRunConsumptionLines(vals)).catch(() => setWriteError("Couldn't record a finished run's inventory use on the server — stock counts may be out of sync. Check your connection."));
            }
          }
          const finalDs: DayState = {
            ...prevDs,
            runs: prevDs.runs.map(r =>
              r.startedAt && !r.endedAt ? { ...r, endedAt: Date.now(), pausedAt: undefined } : r
            ),
          };
          archiveDayToHistory(finalDs, stored.date);
        }
        const newDate = todayStr();
        // Try to load any pre-scheduled data for the new day
        try {
          const res = await fetch(`/api/sync/${newDate}`);
          if (res.ok) {
            const payload = await res.json() as SyncPayload | null;
            if (payload?.dayState?.runs?.length) {
              const ds: DayState = { runs: payload.dayState.runs, currentIndex: 0, date: newDate, shiftNotes: payload.dayState.shiftNotes, runToTime: payload.dayState.runToTime, resetAt: Date.now(), substitutions: [], substitutionLog: [], stagedItems: {} };
              for (const [id, vals] of Object.entries(payload.runValues ?? {})) saveRunValues(id, { ...DEFAULT_VALUES, ...(vals as FormValues) });
              { const dm = loadDeletedItems(); if (dm["runs"]) { delete dm["runs"]; saveDeletedItems(dm); } }
              saveDayState(ds);
              setDayState(ds);
              if (ds.runToTime) setRunToTime(ds.runToTime);
              const firstId = ds.runs[0]?.id;
              const firstVals = firstId ? { ...DEFAULT_VALUES, ...((payload.runValues ?? {})[firstId] as FormValues ?? {}) } : DEFAULT_VALUES;
              form.reset(firstVals);
              resetFieldArrays(firstVals);
              schedulePush(ds, 0);
              fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[])).catch(() => {});
              // The new day's resetAt becomes the server-side session boundary
              // (pushed above), so the daily reset signs everyone out. Drop this
              // device to the login screen now instead of waiting for its next
              // 401 — forceSignedOut keeps the cookie so the push lands first.
              forceSignedOut();
              return;
            }
          }
        } catch {}
        // Fallback: fresh empty state
        const fresh = { ...freshDayState(), resetAt: Date.now() };
        { const dm = loadDeletedItems(); if (dm["runs"]) { delete dm["runs"]; saveDeletedItems(dm); } }
        saveDayState(fresh);
        setDayState(fresh);
        setRunToTime("19:15");
        form.reset(DEFAULT_VALUES);
        resetFieldArrays(DEFAULT_VALUES);
        schedulePush(fresh, 0);
        // See note above: the daily reset signs everyone out, including us.
        forceSignedOut();
      }
    }
    // Run once on mount too. loadDayState() only resets the in-memory view when
    // the stored date is stale; it does NOT archive, stamp resetAt, push the new
    // boundary, or sign out. Without this immediate call, the rollover (and its
    // forceSignedOut) only fires up to 60s later via the interval — by which
    // time another device's pushed resetAt may have already 401-bounced us to
    // login, so the user sees the logout but never the reset. Mobile already
    // rolls over on its mount effect; this brings web to parity.
    void checkDateRollover();
    const interval = setInterval(checkDateRollover, 60_000);
    document.addEventListener("visibilitychange", checkDateRollover);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkDateRollover);
    };
  }, []);

  function doFetch(payload: SyncPayload, retriesLeft: number, sig?: string) {
    // Guard the retry path too: buildSyncPayload stamps the payload with the
    // date it was built on. A push queued just before midnight could otherwise
    // retry after midnight and write yesterday's runs into the new day's
    // /api/sync/today row — the same leak schedulePush guards. If the payload's
    // build-date is no longer today, drop it (the rollover will push the fresh
    // day instead).
    if (payload.dayState.date && payload.dayState.date !== todayStr()) { pushAcknowledgedRef.current = true; return; }
    // Key the live row by the CLIENT's local date (?today=). The server is UTC, so
    // without this a client behind UTC writes the live day into its local
    // "tomorrow" row — clobbering a scheduled day (and its case counts).
    fetch(`/api/sync/today?today=${todayStr()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderId: clientId.current, payload }),
    }).then(() => {
      pushAcknowledgedRef.current = true;
      setSyncPushFailed(false);
      // Record the synced signature ONLY after a successful PUT, so a failed
      // push is never treated as synced (which would block its retry).
      if (sig !== undefined) lastSyncSigRef.current = sig;
    }).catch(() => {
      if (retriesLeft > 0) {
        setTimeout(() => doFetch(payload, retriesLeft - 1, sig), 5_000);
      } else {
        // All retries exhausted — stop blocking remote state so other devices can still sync
        pushAcknowledgedRef.current = true;
        // ...but tell the user their changes aren't backed up / shared yet.
        setSyncPushFailed(true);
      }
    });
  }

  // Build the full sync payload from current form + localStorage. Extracted so
  // both the debounced schedulePush and the merge flow (which must push the
  // merged payload synchronously before reloading) share one source of truth.
  function buildSyncPayload(ds: DayState): SyncPayload {
    const curId = ds.runs[ds.currentIndex]?.id;
    const runValues: Record<string, FormValues> = {};
    for (const run of ds.runs) {
      if (run.id === curId) {
        // The current run is normally pushed from the LIVE form so an in-progress
        // edit is shared immediately. But the form is transiently all-default
        // during mount/hydration and right after a programmatic form.reset()
        // (run switch, daily rollover, sync-apply) before the run's real values
        // are loaded back in. The stamp map (runValuesUpdatedAt below) is read
        // independently from localStorage and still carries this run's real edit
        // time, so a push firing in that window (periodic 30s, SSE-reconnect
        // re-push, or any schedulePush) would emit an EMPTY value paired with a
        // REAL stamp — and because the stamps are equal the per-run lost-update
        // guard on every peer ACCEPTS the empty value, wiping real data on the
        // shared day-state row (the recurring "I entered it, refreshed, it
        // vanished" loss). Never push an all-default current-run form over a
        // populated stored value; fall back to the durable localStorage copy.
        // Mirrors the autosave [v] effect's guard, applied at the push boundary
        // so it covers EVERY push path, not just direct edits.
        runValues[run.id] = pickCurrentRunPushValue(form.getValues(), loadRunValues(run.id));
      } else {
        runValues[run.id] = loadRunValues(run.id);
      }
    }
    // Collect brand+flavor profiles from localStorage
    const brandProfiles: Record<string, Partial<FormValues>> = {};
    const crustProfiles: Record<string, Partial<FormValues>> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("run-calc-profile-")) {
        try { brandProfiles[key.slice("run-calc-profile-".length)] = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch {}
      } else if (key.startsWith("run-calc-crust-profile-")) {
        try { crustProfiles[key.slice("run-calc-crust-profile-".length)] = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch {}
      }
    }
    return {
      dayState: { runs: ds.runs, shiftNotes: ds.shiftNotes, runToTime: dayStateRef.current.runToTime, resetAt: ds.resetAt, date: todayStr(), substitutions: ds.substitutions ?? [], substitutionLog: ds.substitutionLog ?? [], stagedItems: ds.stagedItems ?? {} },
      runValues,
      runValuesUpdatedAt: loadRunValuesUpdated(),
      brands: loadList(BRANDS_KEY, []).filter(b => !STALE_BRANDS.includes(b)),
      brandFlavors: loadBrandFlavors(),
      ingredientTypes: loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES),
      templates: loadTemplates(),
      history: loadHistory(),
      pepTypes: loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES),
      dieTypes: loadList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES),
      cheeseIngredients: loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS),
      doughIngredients: loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS),
      frontlineIngredients: loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS),
      mixIngredients: loadList(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS),
      doughRecipeNames: loadList(DOUGH_RECIPE_NAMES_KEY, []),
      doughRecipePresets: loadDoughRecipePresets(),
      frontlineRecipeNames: loadList(FRONTLINE_RECIPE_NAMES_KEY, []).filter(n => !SEED_MIX_RECIPE_NAMES.has(n)),
      frontlineRecipePresets: loadFrontlineRecipePresets(),
      cheeseRecipeNames: loadList(CHEESE_RECIPE_NAMES_KEY, []),
      mixRecipeNames: loadList(MIX_RECIPE_NAMES_KEY, []),
      cheeseRecipePresets: loadCheeseRecipePresets(),
      brandProfiles,
      crustProfiles,
      mergedAway: loadMergedAway(),
      deletedItems: loadDeletedItems(),
    };
  }

  function schedulePush(ds: DayState, delay = 600) {
    if (isSyncApplyingRef.current) return;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushAcknowledgedRef.current = false;
    pushTimerRef.current = setTimeout(() => {
      // Never push a stale-dated day into today's sync row. A tab left open
      // across midnight still holds yesterday's runs until the rollover fires;
      // pushing them to /api/sync/today (the server resolves "today" by its own
      // clock) would leak yesterday's runs into today's row. The rollover then
      // fetches that row and "pulls them up" as if they were pre-scheduled, so
      // the daily reset never clears. Skip until the rollover swaps in the fresh
      // day. The SSE-onopen reconnect re-push is the main offender here.
      if (ds.date && ds.date !== todayStr()) { pushAcknowledgedRef.current = true; return; }
      const payload = buildSyncPayload(ds);
      // Skip re-pushing an unchanged state (idle periodic/reconnect pushes).
      // Without this, a second open tab keeps broadcasting its stale copy and
      // clobbers the other tab's edits ("keeps resetting / loses changes").
      const sig = JSON.stringify(payload);
      if (sig === lastSyncSigRef.current) { pushAcknowledgedRef.current = true; return; }
      doFetch(payload, 3, sig);
    }, delay);
  }
  function resetFieldArrays(vals: FormValues) {
    replaceCheese1(vals.app1CheeseRecipe ?? []);
    replaceCheese2(vals.app2CheeseRecipe ?? []);
    replaceCheese3(vals.app3CheeseRecipe ?? []);
    replaceCheese4(vals.app4CheeseRecipe ?? []);
    replaceDough(vals.doughRecipe ?? []);
    replaceFrontline(vals.frontlineRecipe ?? []);
  }

  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const ds = dayStateRef.current;
    const run = ds?.runs[ds?.currentIndex];
    const runId = run?.id;
    if (!runId) return;
    // Only treat this as a real user edit when the live form actually DIFFERS from
    // the values already stored for this run. A programmatic form.reset() — run
    // switch, sync-apply (the merge resets the live form to the accepted remote),
    // daily rollover, or post-login load — re-emits the SAME persisted values
    // through form.watch(). Without this guard the effect would re-stamp them with
    // a fresh markRunValuesUpdated() time, defeating the per-run lost-update guard
    // and letting a loaded/stale/empty value win the merge across devices and
    // clobber a peer's genuine edit (the "I entered cases needed and it vanished"
    // multi-device data loss). Mirrors mobile's primed-baseline diffStampRunEdits,
    // which only stamps genuine changes.
    if (deepEqual(loadRunValues(runId), v)) return;
    // Safety net for the recurring "I entered cases-needed, waited, refreshed,
    // and it all vanished" data loss on the shared day-state row. A genuine user
    // edit never reduces EVERY field to its default at once — an all-default form
    // is always a programmatic reset (mount/init race, daily rollover, or a
    // sync-apply echo) re-emitting through form.watch() while localStorage still
    // holds the real values. Saving + stamping it would mint a FRESH
    // markRunValuesUpdated() time that then wins the per-run lost-update guard on
    // every other connected tab/device and clobber the real run data. Never let
    // an empty form overwrite a populated stored value. (Equality of stored ==
    // DEFAULT is already short-circuited above, so this only blocks the
    // populated→empty transition, never a legitimately blank run.)
    if (deepEqual(v, DEFAULT_VALUES) && !deepEqual(loadRunValues(runId), DEFAULT_VALUES)) return;
    const now = Date.now();
    saveRunValues(runId, v);
    // Stamp this run's edit time so an in-flight stale remote can't clobber it
    // (the "click away and my change disappeared" lost-update).
    markRunValuesUpdated(runId, now);
    if (run?.brand || run?.flavor) {
      saveProfile(run.brand, run.flavor, v);
    }
    lastLocalEditRef.current = now;
    schedulePush(ds, 2000);
    flashSaved();
  }, [v]);

  // Commit a single confirmed value from the "Fill in missing data" panel. Goes
  // through the normal form path (setValue → autosave effect persists run values
  // + profile), so there is no separate write path and no auto-apply.
  function commitMissingField(key: string, value: string | number) {
    form.setValue(key as keyof FormValues, value as never, { shouldDirty: true });
  }

  function switchToRun(newIndex: number) {
    if (newIndex < 0 || newIndex >= dayState.runs.length) return;
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);
    const newId = dayState.runs[newIndex].id;
    const newDs = { ...dayState, currentIndex: newIndex };
    setDayState(newDs);
    saveDayState(newDs);
    const newVals = loadRunValues(newId);
    form.reset(newVals);
    resetFieldArrays(newVals);
    setDoughSubTab(dayState.runs[newIndex].subTab ?? "dough");
    // Restore open stoppage for the new run (or clear if none)
    const openStop = dayState.runs[newIndex].stoppages?.find(s => !s.endedAt);
    setActiveStopId(openStop?.id ?? null);
    setConfirmDeleteStopId(null);
  }

  // ── Temporary ingredient substitutions (day-state overlay) ─────────────────
  // Floor staff overlay today's recipes when an ingredient is low/out. These
  // never touch master data or the editable run recipes — they live in the
  // synced day-state and auto-revert at the daily reset (freshDayState clears
  // them) or when cleared here. The shared calc/consumption engine applies them
  // via substitutionState (mirrored by the effect above).
  function persistSubstitutions(
    subs: IngredientSubstitution[],
    logEntries: SubstitutionLogEntry[] = [],
  ) {
    const prevLog = dayStateRef.current.substitutionLog ?? [];
    const nextLog = logEntries.length ? [...prevLog, ...logEntries] : prevLog;
    const newDs = { ...dayStateRef.current, substitutions: subs, substitutionLog: nextLog };
    setDayState(newDs);
    saveDayState(newDs);
    setActiveSubstitutions(subs);
    lastLocalEditRef.current = Date.now();
    schedulePush(newDs, 0);
  }
  // Build a timestamped audit-trail entry for the substitution activity log.
  function makeSubLogEntry(kind: SubstitutionLogEntry["kind"], description: string): SubstitutionLogEntry {
    return { id: genId(), ts: Date.now(), kind, description, ...(me?.name ? { user: me.name } : {}) };
  }
  function addSubstitution(sub: IngredientSubstitution) {
    const existing = dayStateRef.current.substitutions ?? [];
    // One active substitution per affected ingredient — replace if it exists.
    const next = [...existing.filter(s => s.ingredient !== sub.ingredient), sub];
    persistSubstitutions(next, [makeSubLogEntry("added", describeSubstitution(sub))]);
  }
  function removeSubstitution(id: string) {
    const existing = dayStateRef.current.substitutions ?? [];
    const removed = existing.find(s => s.id === id);
    persistSubstitutions(
      existing.filter(s => s.id !== id),
      removed ? [makeSubLogEntry("cleared", describeSubstitution(removed))] : [],
    );
  }
  function clearSubstitutions() {
    const existing = dayStateRef.current.substitutions ?? [];
    if (existing.length === 0) {
      persistSubstitutions([]);
      return;
    }
    const description =
      existing.length === 1
        ? describeSubstitution(existing[0])
        : `All substitutions (${existing.length})`;
    persistSubstitutions([], [makeSubLogEntry("cleared", description)]);
  }

  // ── Warehouse staging checklist (day-state overlay) ────────────────────────
  // Warehouse staff tick off per-run need rows as they pull/stage them. Like
  // substitutions, these live in the synced day-state (NOT master data) and clear
  // at the daily reset. Only checked rows are stored (true); unchecking deletes
  // the key. Keyed by `${runId}::${label}__${unit}` so it lines up across web +
  // mobile and survives row re-renders.
  function toggleStagedItem(runId: string, rowKey: string) {
    const key = `${runId}::${rowKey}`;
    const prev = dayStateRef.current.stagedItems ?? {};
    const next = { ...prev };
    if (next[key]) delete next[key];
    else next[key] = true;
    const newDs = { ...dayStateRef.current, stagedItems: next };
    setDayState(newDs);
    saveDayState(newDs);
    lastLocalEditRef.current = Date.now();
    schedulePush(newDs, 0);
  }

  function addRun() {
    if (dayState.runs.length >= MAX_RUNS) return;
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);
    const newId = genId();
    const newIndex = dayState.runs.length;
    const newDs = {
      runs: [...dayState.runs, { id: newId, brand: "", flavor: "" }],
      currentIndex: newIndex,
    };
    setDayState(newDs);
    saveDayState(newDs);
    form.reset(DEFAULT_VALUES);
    resetFieldArrays(DEFAULT_VALUES);
    schedulePush(newDs, 0);
  }

  function removeRun() {
    const idx = dayState.currentIndex;
    const run = dayState.runs[idx];
    if (!run || run.startedAt || run.endedAt) return; // active or completed — cannot remove
    const newRuns = dayState.runs.filter((_, i) => i !== idx);
    if (newRuns.length === 0) return; // always keep at least one run
    // Tombstone the removed run id so live-sync's additive run-union can't
    // resurrect it from a peer that still has it.
    tombstoneDeleted("runs", run.id);
    const newIndex = Math.max(0, idx - 1);
    const newDs = { ...dayState, runs: newRuns, currentIndex: newIndex };
    setDayState(newDs);
    saveDayState(newDs);
    const removedVals = loadRunValues(newRuns[newIndex].id);
    form.reset(removedVals);
    resetFieldArrays(removedVals);
    schedulePush(newDs, 0);
    setConfirmRemoveRun(false);
  }

  function setRunBrandFlavor(brand: string, flavor: string) {
    // Save current values to old profile
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);

    // Update run meta
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex ? { ...r, brand, flavor } : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);

    // Load profile for new brand+flavor if it exists
    const profile = loadProfile(brand, flavor);
    if (profile) {
      // Strip mix recipe names from sauce fields — they belong in the applicator mix field
      if (profile.frontlineRecipeName && SEED_MIX_RECIPE_NAMES.has(profile.frontlineRecipeName)) {
        profile.frontlineRecipeName = "";
        profile.frontlineRecipe = [];
      }
      form.reset(profile); resetFieldArrays(profile);
    }
    schedulePush(newDs, 0);
  }

  function addBrand(name: string) {
    const trimmed = name.trim();
    if (!trimmed || brands.includes(trimmed)) return trimmed ? trimmed : brands[0];
    const updated = [...brands, trimmed].sort((a, b) => a.localeCompare(b));
    setBrands(updated);
    saveList(BRANDS_KEY, updated);
    clearDeleted("brands", trimmed);
    schedulePush(dayStateRef.current);
    return trimmed;
  }

  function removeBrand(name: string) {
    const updated = brands.filter(b => b !== name);
    setBrands(updated);
    saveList(BRANDS_KEY, updated);
    // Tombstone so live-sync's additive union can't resurrect it from a stale peer.
    tombstoneDeleted("brands", name);
    // Deleting a brand also deletes every flavor that belonged to it — a flavor
    // only exists in the context of its brand. Tombstone each flavor too, so a
    // later re-add of the brand (which clears the brand tombstone) can't let a
    // stale peer resurrect the old flavors via the additive brandFlavors union.
    if (brandFlavors[name]) {
      const ns = flavorNamespace(name);
      for (const f of brandFlavors[name]) tombstoneDeleted(ns, f);
      const next = { ...brandFlavors };
      delete next[name];
      setBrandFlavors(next);
      saveBrandFlavors(next);
    }
    schedulePush(dayStateRef.current);
  }

  function renameBrand(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || brands.includes(trimmed)) return;
    const updated = brands.map(b => b === oldName ? trimmed : b).sort((a, b) => a.localeCompare(b));
    setBrands(updated);
    saveList(BRANDS_KEY, updated);
    // Move flavors over to new brand name
    if (brandFlavors[oldName]) {
      const next = { ...brandFlavors, [trimmed]: brandFlavors[oldName] };
      delete next[oldName];
      setBrandFlavors(next);
      saveBrandFlavors(next);
    }
    // Update any open runs that reference this brand
    const ds = dayStateRef.current;
    const updatedRuns = ds.runs.map(r => r.brand === oldName ? { ...r, brand: trimmed } : r);
    const newDs = { ...ds, runs: updatedRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs);
  }

  function addFlavor(name: string, brand?: string) {
    const b = (brand ?? currentRun?.brand ?? "").trim();
    const trimmed = name.trim();
    if (!trimmed || !b) return trimmed;
    const current = brandFlavors[b] ?? [];
    if (current.includes(trimmed)) return trimmed;
    const next = { ...brandFlavors, [b]: [...current, trimmed].sort((a, bv) => a.localeCompare(bv)) };
    setBrandFlavors(next);
    saveBrandFlavors(next);
    // Re-adding a flavor clears its deletion tombstone; also clear the brand's so
    // the brand can resurrect alongside it (mirrors mobile addFlavor parity).
    clearDeleted(flavorNamespace(b), trimmed);
    clearDeleted("brands", b);
    schedulePush(dayStateRef.current);
    return trimmed;
  }

  function removeFlavor(name: string, brand?: string) {
    const b = (brand ?? currentRun?.brand ?? "").trim();
    if (!b) return;
    const next = { ...brandFlavors, [b]: (brandFlavors[b] ?? []).filter(f => f !== name) };
    setBrandFlavors(next);
    saveBrandFlavors(next);
    // Tombstone so live-sync's additive union can't resurrect it from a stale peer.
    tombstoneDeleted(flavorNamespace(b), name);
    schedulePush(dayStateRef.current);
  }

  function renameFlavor(oldName: string, newName: string, brand?: string) {
    const b = (brand ?? currentRun?.brand ?? "").trim();
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || !b) return;
    const current = brandFlavors[b] ?? [];
    if (current.includes(trimmed)) return;
    const next = { ...brandFlavors, [b]: current.map(f => f === oldName ? trimmed : f).sort((a, bv) => a.localeCompare(bv)) };
    setBrandFlavors(next);
    saveBrandFlavors(next);
    // Update any open runs that reference this flavor
    const ds = dayStateRef.current;
    const updatedRuns = ds.runs.map(r => (r.brand === b && r.flavor === oldName) ? { ...r, flavor: trimmed } : r);
    const newDs = { ...ds, runs: updatedRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs);
  }

  function renameMixRecipeName(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || mixRecipeNames.includes(trimmed)) return;
    const updated = mixRecipeNames.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setMixRecipeNames(updated);
    saveList(MIX_RECIPE_NAMES_KEY, updated);
    schedulePush(dayStateRef.current);
  }

  function renameDoughRecipeName(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || doughRecipeNames.includes(trimmed)) return;
    const updated = doughRecipeNames.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setDoughRecipeNames(updated);
    saveList(DOUGH_RECIPE_NAMES_KEY, updated);
    schedulePush(dayStateRef.current);
  }

  function renameFrontlineRecipeName(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || frontlineRecipeNames.includes(trimmed)) return;
    const updated = frontlineRecipeNames.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setFrontlineRecipeNames(updated);
    saveList(FRONTLINE_RECIPE_NAMES_KEY, updated);
    schedulePush(dayStateRef.current);
  }

  function renameCheeseRecipeName(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || cheeseRecipeNames.includes(trimmed)) return;
    const updated = cheeseRecipeNames.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setCheeseRecipeNames(updated);
    saveList(CHEESE_RECIPE_NAMES_KEY, updated);
    schedulePush(dayStateRef.current);
  }

  function renameDoughIngredient(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || doughIngredients.includes(trimmed)) return;
    const updated = doughIngredients.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setDoughIngredients(updated);
    saveList(DOUGH_INGREDIENTS_KEY, updated);
    const ds = dayStateRef.current;
    for (const run of ds.runs) {
      const vals = run.id === currentRunId ? form.getValues() : loadRunValues(run.id);
      const newVals = { ...vals, doughRecipe: vals.doughRecipe.map(r => r.ingredient === oldName ? { ...r, ingredient: trimmed } : r) };
      saveRunValues(run.id, newVals);
      if (run.id === currentRunId) form.setValue("doughRecipe", newVals.doughRecipe);
    }
    schedulePush(ds);
  }

  function renameFrontlineIngredient(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || frontlineIngredients.includes(trimmed)) return;
    const updated = frontlineIngredients.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setFrontlineIngredients(updated);
    saveList(FRONTLINE_INGREDIENTS_KEY, updated);
    const ds = dayStateRef.current;
    for (const run of ds.runs) {
      const vals = run.id === currentRunId ? form.getValues() : loadRunValues(run.id);
      const newVals = { ...vals, frontlineRecipe: vals.frontlineRecipe.map(r => r.ingredient === oldName ? { ...r, ingredient: trimmed } : r) };
      saveRunValues(run.id, newVals);
      if (run.id === currentRunId) form.setValue("frontlineRecipe", newVals.frontlineRecipe);
    }
    schedulePush(ds);
  }

  function renameCheeseIngredient(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || cheeseIngredients.includes(trimmed)) return;
    const updated = cheeseIngredients.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setCheeseIngredients(updated);
    saveList(CHEESE_INGREDIENTS_KEY, updated);
    const ds = dayStateRef.current;
    const appFields = ["app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe"] as const;
    for (const run of ds.runs) {
      const vals = run.id === currentRunId ? form.getValues() : loadRunValues(run.id);
      const patch: Partial<typeof vals> = {};
      for (const f of appFields) patch[f] = (vals[f] as RecipeRow[]).map(r => r.ingredient === oldName ? { ...r, ingredient: trimmed } : r);
      const newVals = { ...vals, ...patch };
      saveRunValues(run.id, newVals);
      if (run.id === currentRunId) for (const f of appFields) form.setValue(f, patch[f]!);
    }
    schedulePush(ds);
  }

  function renameMixIngredient(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || mixIngredients.includes(trimmed)) return;
    const updated = mixIngredients.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setMixIngredients(updated);
    saveList(MIX_INGREDIENTS_KEY, updated);
    const ds = dayStateRef.current;
    const appFields = ["app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe"] as const;
    for (const run of ds.runs) {
      const vals = run.id === currentRunId ? form.getValues() : loadRunValues(run.id);
      const patch: Partial<typeof vals> = {};
      for (const f of appFields) patch[f] = (vals[f] as RecipeRow[]).map(r => r.ingredient === oldName ? { ...r, ingredient: trimmed } : r);
      const newVals = { ...vals, ...patch };
      saveRunValues(run.id, newVals);
      if (run.id === currentRunId) for (const f of appFields) form.setValue(f, patch[f]!);
    }
    schedulePush(ds);
  }

  function renamePepType(oldName: string, newName: string) {
    if (DEFAULT_PEP_TYPES.includes(oldName)) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || pepTypes.includes(trimmed)) return;
    const updated = pepTypes.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setPepTypes(updated);
    saveList(PEP_TYPES_KEY, updated);
    schedulePush(dayStateRef.current);
  }

  function renameDieType(oldName: string, newName: string) {
    if (DEFAULT_DIE_TYPES.includes(oldName)) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || dieTypes.includes(trimmed)) return;
    const updated = dieTypes.map(n => n === oldName ? trimmed : n).sort((a, b) => a.localeCompare(b));
    setDieTypes(updated);
    saveList(DIE_TYPES_KEY, updated);
    const ds = dayStateRef.current;
    for (const run of ds.runs) {
      const vals = run.id === currentRunId ? form.getValues() : loadRunValues(run.id);
      if (vals.dieType === oldName) {
        const newVals = { ...vals, dieType: trimmed };
        saveRunValues(run.id, newVals);
        if (run.id === currentRunId) form.setValue("dieType", trimmed);
      }
    }
    schedulePush(ds);
  }

  function checkPin() {
    // Resolve the facility PIN: live server value when loaded, else the offline
    // cache, else the default. An empty resolved value ("") means "no gate" — we
    // unlock without comparing. Using the same resolution offline ensures a PIN
    // cleared on another device unlocks here too (not just when serverPin is live).
    const stored =
      (typeof serverPin === "string" ? serverPin : null) ??
      localStorage.getItem(SUPERVISOR_PIN_KEY) ??
      DEFAULT_SUPERVISOR_PIN;
    if (stored === "") {
      setRole("supervisor");
      setShowPinDialog(false);
      setPinInput("");
      setPinError("");
      return;
    }
    if (pinInput === stored) {
      setRole("supervisor");
      setShowPinDialog(false);
      setPinInput("");
      setPinError("");
    } else {
      setPinError("Incorrect PIN. Try again.");
    }
  }

  function startRun() {
    initialFinishTimestampRef.current = Date.now() + calc.totalTimeSec * 1000;
    const now = Date.now();
    // Starting a run stops any other run that is currently running. Finalize each
    // like an explicit endRun: deduct its own inventory (idempotent per runId,
    // from its stored values) before marking it ended.
    for (const r of dayState.runs) {
      if (r.id !== currentRunId && r.startedAt && !r.endedAt) {
        void consumeRun(r.id, computeRunConsumptionLines(loadRunValues(r.id))).catch(() => setWriteError("Couldn't record a finished run's inventory use on the server — stock counts may be out of sync. Check your connection."));
      }
    }
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex
        ? { ...r, startedAt: now, endedAt: undefined }
        : r.startedAt && !r.endedAt
          ? { ...r, endedAt: now, pausedAt: undefined }
          : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 0);
  }

  function pauseRun() {
    const now = Date.now();
    const pauseStop: Stoppage = { id: genId(), reason: "", type: "pause", startedAt: now };
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex
        ? { ...r, pausedAt: now, stoppages: [...(r.stoppages ?? []), pauseStop] }
        : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 0);
  }

  function resumeRun(freezerEmpty: boolean) {
    const run = dayState.runs[dayState.currentIndex];
    if (!run?.pausedAt) return;
    const now = Date.now();
    let newStartedAt = run.startedAt!;
    if (freezerEmpty) {
      newStartedAt = now;
    } else {
      const pauseDuration = now - run.pausedAt;
      newStartedAt = run.startedAt! + pauseDuration;
    }
    // Close the open pause stoppage
    const updatedStoppages = (run.stoppages ?? []).map(s =>
      s.type === "pause" && !s.endedAt ? { ...s, endedAt: now } : s
    );
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex
        ? { ...r, startedAt: newStartedAt, pausedAt: undefined, stoppages: updatedStoppages }
        : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 0);
  }

  function endRun() {
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);
    // Auto-deduct this run's materials from inventory (idempotent by runId;
    // no-op for any material that has no inventory item).
    void consumeRun(currentRunId, computeRunConsumptionLines(cur)).catch(() => setWriteError("Couldn't record a finished run's inventory use on the server — stock counts may be out of sync. Check your connection."));
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex ? { ...r, pausedAt: undefined, endedAt: Date.now() } : r
    );
    const nextIndex = dayState.currentIndex + 1 < dayState.runs.length
      ? dayState.currentIndex + 1
      : dayState.currentIndex;
    const newDs = { ...dayState, runs: newRuns, currentIndex: nextIndex };
    setDayState(newDs);
    saveDayState(newDs);
    if (nextIndex !== dayState.currentIndex) {
      const nextVals = loadRunValues(dayState.runs[nextIndex].id);
      form.reset(nextVals);
      resetFieldArrays(nextVals);
      const openStop = newRuns[nextIndex].stoppages?.find(s => !s.endedAt);
      setActiveStopId(openStop?.id ?? null);
    } else {
      setActiveStopId(null);
    }
    setConfirmDeleteStopId(null);
    schedulePush(newDs, 0);
  }

  function moveRun(fromIdx: number, toIdx: number) {
    if (toIdx < 0 || toIdx >= dayState.runs.length) return;
    const runs = [...dayState.runs];
    const [moved] = runs.splice(fromIdx, 1);
    runs.splice(toIdx, 0, moved);
    // Keep currentIndex pointing at the same run after the move
    const newCurrentIndex = runs.indexOf(dayState.runs[dayState.currentIndex]);
    const newDs = { ...dayState, runs, currentIndex: newCurrentIndex };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs);
  }

  // Apply an AI-suggested run order (array of run ids) to today's runs. Runs are
  // reordered to follow the suggested sequence; any run not in the suggestion
  // keeps its relative position and is appended after the ordered ones. Advisory:
  // only runs on the manager's explicit tap. Returns an undo to restore the
  // prior order. Mirrors the mobile applyScheduleOrder for parity.
  function applyScheduleOrder(order: string[]): { ok: boolean; message: string; undo?: () => void } {
    const prevRuns = dayState.runs;
    const prevIndex = dayState.currentIndex;
    const rank = new Map(order.map((id, i) => [id, i]));
    const reordered = [...prevRuns].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return prevRuns.indexOf(a) - prevRuns.indexOf(b);
    });
    const unchanged = reordered.every((r, i) => r.id === prevRuns[i]?.id);
    if (unchanged) return { ok: true, message: "Already in suggested order" };
    const newCurrentIndex = reordered.indexOf(prevRuns[prevIndex]);
    const newDs = { ...dayState, runs: reordered, currentIndex: newCurrentIndex };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs);
    return {
      ok: true,
      message: "Run order updated",
      undo: () => {
        const restored = { ...dayStateRef.current, runs: prevRuns, currentIndex: prevIndex };
        setDayState(restored);
        saveDayState(restored);
        schedulePush(restored);
      },
    };
  }

  // Apply a one-tap AI recommendation action by routing it to the existing
  // run/schedule mutations. Returns a result the AssistantTab renders inline;
  // nothing is applied without the manager's explicit tap.
  function applyOptimizeAction(action: OptimizeAction): { ok: boolean; message: string; undo?: () => void } {
    if (action.kind === "set_target_time") {
      const time = (action.time ?? "").trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, message: "Invalid time" };
      const prevTime = runToTime;
      setRunToTime(time);
      return {
        ok: true,
        message: `Finish time set to ${time}`,
        undo: () => setRunToTime(prevTime),
      };
    }

    if (action.kind === "set_run_target") {
      const runId = action.runId ?? "";
      const cases = Math.round(action.casesNeeded ?? NaN);
      if (!Number.isFinite(cases) || cases <= 0) return { ok: false, message: "Invalid target" };
      const idx = dayState.runs.findIndex((r) => r.id === runId);
      if (idx < 0) return { ok: false, message: "Run no longer exists" };
      const prevCases =
        runId === currentRunId
          ? (form.getValues("casesNeeded") as number)
          : loadRunValues(runId).casesNeeded;
      const writeCases = (value: number) => {
        if (runId === currentRunId) {
          form.setValue("casesNeeded", value, { shouldDirty: true });
          saveRunValues(currentRunId, form.getValues());
        } else {
          const vals = loadRunValues(runId);
          saveRunValues(runId, { ...vals, casesNeeded: value });
        }
        schedulePush(dayStateRef.current, 0);
      };
      writeCases(cases);
      return {
        ok: true,
        message: `Target set to ${cases} cases`,
        undo: () => writeCases(prevCases),
      };
    }

    // reorder_run
    const runId = action.runId ?? "";
    const fromIdx = dayState.runs.findIndex((r) => r.id === runId);
    if (fromIdx < 0) return { ok: false, message: "Run no longer exists" };
    const beforeId = action.beforeRunId ?? null;
    let toIdx: number;
    if (beforeId === null) {
      toIdx = dayState.runs.length - 1;
    } else {
      const remaining = dayState.runs.filter((r) => r.id !== runId);
      const beforePos = remaining.findIndex((r) => r.id === beforeId);
      if (beforePos < 0) return { ok: false, message: "Target run no longer exists" };
      toIdx = beforePos;
    }
    if (toIdx === fromIdx) return { ok: true, message: "Already in place" };
    const prevRuns = dayState.runs;
    const prevIndex = dayState.currentIndex;
    moveRun(fromIdx, toIdx);
    return {
      ok: true,
      message: "Run order updated",
      undo: () => {
        const restored = { ...dayStateRef.current, runs: prevRuns, currentIndex: prevIndex };
        setDayState(restored);
        saveDayState(restored);
        schedulePush(restored);
      },
    };
  }

  // Voice commands: build the platform handler set that the shared dispatcher
  // calls. Every handler forwards to an EXISTING run/inventory mutation (no new
  // write surface) and returns an undo so a misheard command can be reverted
  // within the AssistantTab's short window. Server-resolved ids are validated
  // again here (the run may have changed since classification). Mobile mirrors
  // this exactly via RunContext in artifacts/run-calculator-mobile (replit.md
  // parity) — same kinds, same arguments through dispatchVoiceCommand.
  function buildVoiceHandlers(): VoiceCommandHandlers {
    // Function declarations are hoisted, so capture the page-level mutations
    // whose names collide with handler methods to call them unambiguously.
    const pageAddRun = addRun;
    const pageRemoveRun = removeRun;
    const pageUpdateRunMeta = updateRunMeta;
    const findIdx = (runId: string) => dayStateRef.current.runs.findIndex((r) => r.id === runId);

    return {
      setTargetTime(time) {
        return applyOptimizeAction({ kind: "set_target_time", label: "", time });
      },
      clearTargetTime() {
        const prev = runToTime;
        setRunToTime("");
        return {
          ok: true,
          message: "Finish time cleared",
          undo: () => setRunToTime(prev),
        };
      },
      setRunTarget(runId, casesNeeded) {
        return applyOptimizeAction({ kind: "set_run_target", label: "", runId, casesNeeded });
      },
      reorderRun(runId, beforeRunId) {
        return applyOptimizeAction({ kind: "reorder_run", label: "", runId, beforeRunId });
      },
      addRun(brand, flavor) {
        if (dayStateRef.current.runs.length >= MAX_RUNS) {
          return { ok: false, message: "Maximum runs reached" };
        }
        const prevDs = dayStateRef.current;
        const prevIndex = prevDs.currentIndex;
        pageAddRun();
        setRunBrandFlavor(brand, flavor);
        const name = `${brand} ${flavor}`.trim() || "run";
        return {
          ok: true,
          message: `Added ${name}`,
          undo: () => {
            setDayState(prevDs);
            saveDayState(prevDs);
            const vals = loadRunValues(prevDs.runs[prevIndex].id);
            form.reset(vals);
            resetFieldArrays(vals);
            schedulePush(prevDs, 0);
          },
        };
      },
      removeRun(runId) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const run = dayStateRef.current.runs[idx];
        if (run.startedAt || run.endedAt) {
          return { ok: false, message: "Can't remove a started or finished run" };
        }
        if (dayStateRef.current.runs.length <= 1) {
          return { ok: false, message: "Can't remove the only run" };
        }
        const prevDs = dayStateRef.current;
        const prevIndex = prevDs.currentIndex;
        if (idx !== prevIndex) switchToRun(idx);
        pageRemoveRun();
        return {
          ok: true,
          message: "Run removed",
          undo: () => {
            setDayState(prevDs);
            saveDayState(prevDs);
            const vals = loadRunValues(prevDs.runs[prevIndex].id);
            form.reset(vals);
            resetFieldArrays(vals);
            schedulePush(prevDs, 0);
          },
        };
      },
      switchRun(runId) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const prevIndex = dayStateRef.current.currentIndex;
        if (idx === prevIndex) return { ok: true, message: "Already on that run" };
        switchToRun(idx);
        return {
          ok: true,
          message: "Switched run",
          undo: () => switchToRun(prevIndex),
        };
      },
      updateRunMeta(runId, brand, flavor) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const run = dayStateRef.current.runs[idx];
        const newBrand = brand ?? run.brand;
        const newFlavor = flavor ?? run.flavor;
        const prevBrand = run.brand;
        const prevFlavor = run.flavor;
        const name = `${newBrand} ${newFlavor}`.trim() || "run";
        if (idx === dayStateRef.current.currentIndex) {
          setRunBrandFlavor(newBrand, newFlavor);
          return {
            ok: true,
            message: `Renamed to ${name}`,
            undo: () => setRunBrandFlavor(prevBrand, prevFlavor),
          };
        }
        pageUpdateRunMeta(runId, { brand: newBrand, flavor: newFlavor });
        return {
          ok: true,
          message: `Renamed to ${name}`,
          undo: () => pageUpdateRunMeta(runId, { brand: prevBrand, flavor: prevFlavor }),
        };
      },
      finishRun(runId) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const run = dayStateRef.current.runs[idx];
        if (run.endedAt) return { ok: false, message: "Run already finished" };
        if (!run.startedAt) return { ok: false, message: "Run hasn't started yet" };
        const prevDs = dayStateRef.current;
        const prevIndex = prevDs.currentIndex;
        if (idx !== prevIndex) switchToRun(idx);
        endRun();
        return {
          ok: true,
          message: "Run finished",
          undo: () => {
            setDayState(prevDs);
            saveDayState(prevDs);
            const vals = loadRunValues(prevDs.runs[prevIndex].id);
            form.reset(vals);
            resetFieldArrays(vals);
            schedulePush(prevDs, 0);
          },
        };
      },
      startStoppage(runId, reason) {
        const targetIdx = runId ? findIdx(runId) : dayStateRef.current.currentIndex;
        if (targetIdx < 0) return { ok: false, message: "Run no longer exists" };
        const prevDs = dayStateRef.current;
        const prevActive = activeStopId;
        if (runId && targetIdx !== dayStateRef.current.currentIndex) switchToRun(targetIdx);
        logStop(reason, "");
        return {
          ok: true,
          message: reason ? `Stoppage started: ${reason}` : "Stoppage started",
          undo: () => {
            setDayState(prevDs);
            saveDayState(prevDs);
            setActiveStopId(prevActive);
            schedulePush(prevDs, 0);
          },
        };
      },
      endStoppage(runId) {
        const targetIdx = runId ? findIdx(runId) : dayStateRef.current.currentIndex;
        if (targetIdx < 0) return { ok: false, message: "Run no longer exists" };
        if (runId && targetIdx !== dayStateRef.current.currentIndex) switchToRun(targetIdx);
        if (!activeStopId) return { ok: false, message: "No active stoppage" };
        const prevDs = dayStateRef.current;
        const prevActive = activeStopId;
        endStop();
        return {
          ok: true,
          message: "Stoppage ended",
          undo: () => {
            setDayState(prevDs);
            saveDayState(prevDs);
            setActiveStopId(prevActive);
            schedulePush(prevDs, 0);
          },
        };
      },
      setRunProgress(runId, progress) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const isCurrent = idx === dayStateRef.current.currentIndex;
        const before = isCurrent ? form.getValues() : loadRunValues(runId);
        const prev = {
          skidsCompleted: before.skidsCompleted,
          casesOnCurrentSkid: before.casesOnCurrentSkid,
          casesPerSkid: before.casesPerSkid,
        };
        const writeProgress = (p: {
          skidsCompleted?: number;
          casesOnCurrentSkid?: number;
          casesPerSkid?: number;
        }) => {
          if (isCurrent) {
            if (p.skidsCompleted != null)
              form.setValue("skidsCompleted", p.skidsCompleted, { shouldDirty: true });
            if (p.casesOnCurrentSkid != null)
              form.setValue("casesOnCurrentSkid", p.casesOnCurrentSkid, { shouldDirty: true });
            if (p.casesPerSkid != null)
              form.setValue("casesPerSkid", p.casesPerSkid, { shouldDirty: true });
            if (p.skidsCompleted != null || p.casesOnCurrentSkid != null)
              autoSuppressUntilRef.current = Date.now() + AUTO_SUPPRESS_MS;
            saveRunValues(currentRunId, form.getValues());
          } else {
            const cur = loadRunValues(runId);
            saveRunValues(runId, {
              ...cur,
              ...(p.skidsCompleted != null ? { skidsCompleted: p.skidsCompleted } : {}),
              ...(p.casesOnCurrentSkid != null ? { casesOnCurrentSkid: p.casesOnCurrentSkid } : {}),
              ...(p.casesPerSkid != null ? { casesPerSkid: p.casesPerSkid } : {}),
            });
          }
          schedulePush(dayStateRef.current, 0);
        };
        writeProgress(progress);
        return {
          ok: true,
          message: "Progress updated",
          undo: () => writeProgress(prev),
        };
      },
      logActualCases(runId, actualCases) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const prev = dayStateRef.current.runs[idx].actualCases;
        pageUpdateRunMeta(runId, { actualCases });
        return {
          ok: true,
          message: `Logged ${actualCases} cases`,
          undo: () => pageUpdateRunMeta(runId, { actualCases: prev }),
        };
      },
      logWaste(runId, wasteLbs) {
        const idx = findIdx(runId);
        if (idx < 0) return { ok: false, message: "Run no longer exists" };
        const prev = dayStateRef.current.runs[idx].wasteLbs;
        pageUpdateRunMeta(runId, { wasteLbs });
        return {
          ok: true,
          message: `Logged ${wasteLbs} lbs waste`,
          undo: () => pageUpdateRunMeta(runId, { wasteLbs: prev }),
        };
      },
      async restockItem(body) {
        await restockInventory({
          itemKey: body.itemKey,
          category: body.category,
          name: body.name,
          unit: body.unit,
          qty: body.qty,
        });
        return { ok: true, message: `Restocked ${body.qty} ${body.unit} of ${body.name}` };
      },
      async adjustItem(body) {
        await adjustInventory({ itemId: body.itemId, qtyDelta: body.qtyDelta, note: body.note });
        const sign = body.qtyDelta >= 0 ? "+" : "";
        return {
          ok: true,
          message: `Adjusted stock ${sign}${body.qtyDelta}`,
          undo: async () => {
            await adjustInventory({
              itemId: body.itemId,
              qtyDelta: -body.qtyDelta,
              note: "Undo voice adjustment",
            });
          },
        };
      },
      rollover() {
        // Manually trigger the same day close-out the midnight reset performs:
        // auto-deduct inventory for open runs, freeze them at now, archive the
        // day to history, then reset to a fresh day and push it. Irreversible by
        // design (no undo) — gated to managers in VOICE_COMMAND_ROLES.
        const cur = dayStateRef.current;
        for (const r of cur.runs) {
          if (r.startedAt && !r.endedAt) {
            const vals = r.id === currentRunIdRef.current ? form.getValues() : loadRunValues(r.id);
            void consumeRun(r.id, computeRunConsumptionLines(vals)).catch(() => {});
          }
        }
        const now = Date.now();
        const finalDs: DayState = {
          ...cur,
          runs: cur.runs.map((r) =>
            r.startedAt && !r.endedAt ? { ...r, endedAt: now, pausedAt: undefined } : r,
          ),
        };
        archiveDayToHistory(finalDs, cur.date ?? todayStr());
        const fresh = { ...freshDayState(), resetAt: now };
        { const dm = loadDeletedItems(); if (dm["runs"]) { delete dm["runs"]; saveDeletedItems(dm); } }
        setDayState(fresh);
        saveDayState(fresh);
        setRunToTime("19:15");
        form.reset(DEFAULT_VALUES);
        resetFieldArrays(DEFAULT_VALUES);
        schedulePush(fresh, 0);
        return { ok: true, message: "Day rolled over" };
      },
    };
  }

  // Entry point passed to AssistantTab: dispatch the server-resolved actions
  // through the shared, parity-critical mapping with this user's role.
  const applyVoiceCommand = (actions: VoiceCommandAction[]): Promise<VoiceCommandResult[]> =>
    dispatchVoiceCommand(actions, buildVoiceHandlers(), isManager);

  // Apply a confirm-first recipe suggestion (a scaled recipe or substitution) to
  // a CHOSEN run's matching recipe rows. The target defaults to the current run
  // but the worker may pick any of the day's runs from the SuggestionCard. The
  // suggestion only names a recipe field (recipeId); the run is passed here.
  // The current run writes through the live form + field-array path (so the open
  // form reflects it); other runs write through saveRunValues — both are EXISTING
  // per-run write paths, no new write surface. Undo restores the chosen run's
  // previous rows. Mirrored verbatim on mobile (replit.md parity).
  function applyRecipeSuggestion(
    s: RecipeAssistSuggestion,
    runId?: string,
  ): { ok: boolean; message: string; undo?: () => void } {
    // Field-array writers for the current run's live form.
    const formWriters: Record<RecipeFieldId, (rows: { ingredient: string; lbs: number }[]) => void> = {
      doughRecipe: (next) => {
        form.setValue("doughRecipe", next, { shouldDirty: true });
        replaceDough(next);
      },
      frontlineRecipe: (next) => {
        form.setValue("frontlineRecipe", next, { shouldDirty: true });
        replaceFrontline(next);
      },
      app1CheeseRecipe: (next) => {
        form.setValue("app1CheeseRecipe", next, { shouldDirty: true });
        replaceCheese1(next);
      },
      app2CheeseRecipe: (next) => {
        form.setValue("app2CheeseRecipe", next, { shouldDirty: true });
        replaceCheese2(next);
      },
      app3CheeseRecipe: (next) => {
        form.setValue("app3CheeseRecipe", next, { shouldDirty: true });
        replaceCheese3(next);
      },
      app4CheeseRecipe: (next) => {
        form.setValue("app4CheeseRecipe", next, { shouldDirty: true });
        replaceCheese4(next);
      },
    };

    return applyRecipeSuggestionShared(s, runId, {
      // Default to the current run, validate it still exists.
      resolveTargetId: (id) => {
        const targetId = id ?? currentRunId;
        return targetId && dayState.runs.some((r) => r.id === targetId) ? targetId : null;
      },
      // Read prior rows defensively from the correct source (live form for the
      // current run, persisted values for any other run).
      readPrevRows: (targetId, recipeId) =>
        (targetId === currentRunId
          ? (form.getValues() as Record<string, unknown>)
          : (loadRunValues(targetId) as unknown as Record<string, unknown>))[recipeId],
      // The current run writes through the live form + field-array path (so the
      // open form reflects it); other runs write through saveRunValues — both are
      // EXISTING per-run write paths, no new write surface.
      write: (targetId, recipeId, next) => {
        if (targetId === currentRunId) {
          formWriters[recipeId](next);
          saveRunValues(currentRunId, form.getValues());
        } else {
          const vals = { ...DEFAULT_VALUES, ...loadRunValues(targetId), [recipeId]: next };
          saveRunValues(targetId, vals as FormValues);
        }
        schedulePush(dayStateRef.current, 0);
      },
    });
  }

  // Persist skid/case progress for a SPECIFIC (non-active) draining run. The
  // active run writes through the live form + autosave effect; a just-ended run
  // still draining its freezer is written here through the EXISTING per-run
  // saveRunValues path (no new write surface), pushed to sync, and a bump forces
  // an immediate re-render of the draining panel. Manual logging only — we never
  // auto-track a non-active ended run. Mirrored on mobile (replit.md parity).
  function updateDrainingRunValues(id: string, partial: Partial<FormValues>) {
    const vals = { ...DEFAULT_VALUES, ...loadRunValues(id), ...partial } as FormValues;
    saveRunValues(id, vals);
    schedulePush(dayStateRef.current, 0);
    setDrainBump((b) => b + 1);
  }

  function flashSaved() {
    const el = savedFlashRef.current;
    if (!el) return;
    el.style.opacity = "1";
    if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    savedFlashTimer.current = setTimeout(() => { if (savedFlashRef.current) savedFlashRef.current.style.opacity = "0"; }, 1800);
  }

  // ── Downtime log ──────────────────────────────────────────────────────────
  function logStop(reason = "", notes = "") {
    const id = genId();
    const newStop: Stoppage = { id, type: "stop", reason, startedAt: Date.now(), notes: notes.trim() || undefined };
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex
        ? { ...r, stoppages: [...(r.stoppages ?? []), newStop] }
        : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    setActiveStopId(id);
    schedulePush(newDs, 0);
  }

  function updateStop(id: string, patch: Partial<Stoppage>) {
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex
        ? { ...r, stoppages: (r.stoppages ?? []).map(s => s.id === id ? { ...s, ...patch } : s) }
        : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 600);
  }

  function addManualStop(type: "stop" | "pause" | "manual", startTs: number, endTs: number | undefined, reason: string, notes: string) {
    const newStop: Stoppage = {
      id: genId(),
      type,
      reason,
      startedAt: startTs,
      endedAt: endTs,
      notes: notes.trim() || undefined,
    };
    const merged = [...(currentRun?.stoppages ?? []), newStop].sort((a, b) => a.startedAt - b.startedAt);
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex ? { ...r, stoppages: merged } : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 0);
  }

  function endStop() {
    if (!activeStopId) return;
    const endedAt = Date.now();
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex
        ? { ...r, stoppages: (r.stoppages ?? []).map(s => s.id === activeStopId ? { ...s, endedAt } : s) }
        : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    setActiveStopId(null);
    schedulePush(newDs, 0);
  }

  function deleteStop(stopId: string) {
    const newRuns = dayState.runs.map((r, i) =>
      i === dayState.currentIndex
        ? { ...r, stoppages: (r.stoppages ?? []).filter(s => s.id !== stopId) }
        : r
    );
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    if (activeStopId === stopId) setActiveStopId(null);
    schedulePush(newDs, 0);
  }

  // ── AI demand forecast → editable schedule ────────────────────────────────
  // Non-destructive: the forecast plan only pre-fills the schedule editor for the
  // target date. The manager reviews/adjusts and explicitly saves; nothing is
  // committed by accepting the forecast.
  function applyForecast(plan: ForecastPlan) {
    const rows: { id: string; brand: string; flavor: string; casesNeeded: number }[] = [];
    const values: Record<string, FormValues> = {};
    for (const r of plan.runs) {
      const id = genId();
      const profile = r.brand ? loadProfile(r.brand, r.flavor) : null;
      const base: FormValues = profile ?? { ...DEFAULT_VALUES };
      const cases = Number.isFinite(r.casesNeeded) && r.casesNeeded > 0 ? Math.round(r.casesNeeded) : 0;
      rows.push({ id, brand: r.brand, flavor: r.flavor, casesNeeded: cases });
      values[id] = { ...base, casesNeeded: cases, ...(r.dieType ? { dieType: r.dieType } : {}) };
    }
    if (rows.length === 0) {
      const id = genId();
      rows.push({ id, brand: "", flavor: "", casesNeeded: 0 });
      values[id] = { ...DEFAULT_VALUES };
    }
    setScheduleAdvancedRunId(null);
    setScheduleEditorDate(plan.targetDate || todayStr());
    setScheduleEditorRunValues(values);
    setScheduleEditorRuns(rows);
    setScheduleView("editor");
    setShowScheduleDialog(true);
  }

  // ── Templates ─────────────────────────────────────────────────────────────
  function saveAsTemplate(name: string) {
    const cur = form.getValues();
    const trimmedName = name.trim();
    const template: RunTemplate = {
      id: genId(),
      name: trimmedName,
      values: cur,
      brand: currentRun?.brand,
      flavor: currentRun?.flavor,
      createdAt: todayStr(),
    };
    const updated = [template, ...templates.filter(t => t.name !== trimmedName)].slice(0, MAX_TEMPLATES);
    setTemplates(updated);
    saveTemplates(updated);
    cycleCountQc.setQueryData(["runTemplates"], updated);
    saveRunTemplates(updated)
      .then((saved) => {
        setTemplates(saved);
        saveTemplates(saved);
        cycleCountQc.setQueryData(["runTemplates"], saved);
      })
      .catch(() => {});
  }

  function deleteTemplate(id: string) {
    const updated = templates.filter(t => t.id !== id);
    setTemplates(updated);
    saveTemplates(updated);
    cycleCountQc.setQueryData(["runTemplates"], updated);
    deleteRunTemplates([id])
      .then((saved) => {
        setTemplates(saved);
        saveTemplates(saved);
        cycleCountQc.setQueryData(["runTemplates"], saved);
      })
      .catch(() => {});
  }

  function applyTemplate(t: RunTemplate) {
    const clean = { ...t.values, skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0, carryOverDone: false };
    form.reset(clean);
    resetFieldArrays(clean);
    saveRunValues(currentRunId, clean);
    setShowTemplatesDialog(false);
  }

  function copyRun() {
    const cur = form.getValues();
    saveRunValues(currentRunId, cur);
    if (currentRun?.brand || currentRun?.flavor) saveProfile(currentRun.brand, currentRun.flavor, cur);
    const newId = genId();
    const newIndex = dayState.runs.length;
    // Copy meta (brand/flavor) but clear timing
    const newMeta: RunMeta = { id: newId, brand: currentRun?.brand ?? "", flavor: currentRun?.flavor ?? "" };
    const newDs = { ...dayState, runs: [...dayState.runs, newMeta], currentIndex: newIndex };
    setDayState(newDs);
    saveDayState(newDs);
    // Copy all form values except progress fields
    const copied = { ...cur, skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0, carryOverDone: false };
    saveRunValues(newId, copied);
    form.reset(copied);
    resetFieldArrays(copied);
    schedulePush(newDs, 0);
  }

  function updateRunMeta(id: string, patch: Partial<RunMeta>) {
    const newRuns = dayState.runs.map(r => r.id === id ? { ...r, ...patch } : r);
    const newDs = { ...dayState, runs: newRuns };
    setDayState(newDs);
    saveDayState(newDs);
    schedulePush(newDs, 600);
  }

  function buildRunCsvRow(date: string, run: RunMeta, vals: FormValues): string[] {
    const s = computeSummaryStats(vals);
    const status = run.endedAt ? "Finished" : run.startedAt ? "Running" : "Upcoming";
    const grossDurSec = run.startedAt && run.endedAt ? (run.endedAt - run.startedAt) / 1000 : 0;
    const downtimeSec = (run.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((acc, s) => acc + (s.endedAt! - s.startedAt) / 1000, 0);
    const netDurSec = Math.max(0, grossDurSec - downtimeSec);
    const netPpm = netDurSec > 0 && s.totalCases > 0 && vals.pizzasPerCase > 0 ? Math.round(((run.actualCases ?? s.totalCases) * vals.pizzasPerCase) / (netDurSec / 60)) : 0;
    const stopReasons = (run.stoppages ?? []).map(s => `${s.reason}(${s.endedAt ? fmtTime((s.endedAt - s.startedAt) / 1000) : "open"})`).join("; ");
    return [
      date, run.brand, run.flavor, status,
      String(s.totalCases), String(run.actualCases ?? ""),
      String(run.wasteLbs ?? ""),
      run.startedAt ? fmtClock(run.startedAt) : "",
      run.endedAt ? fmtClock(run.endedAt) : "",
      grossDurSec > 0 ? fmtTime(grossDurSec) : "",
      downtimeSec > 0 ? fmtTime(downtimeSec) : "0",
      netPpm > 0 ? String(netPpm) : "",
      (run.notes ?? "").replace(/"/g, '""'),
      stopReasons,
    ];
  }

  function exportCSV() {
    const header = ["Date", "Brand", "Flavor", "Status", "Cases Planned", "Cases Actual", "Waste Lbs", "Started", "Ended", "Duration", "Downtime", "Actual PPM", "Notes", "Stoppages"];
    const rows: string[][] = [header];
    for (const run of dayState.runs) {
      const vals = run.id === currentRunId ? v : loadRunValues(run.id);
      rows.push(buildRunCsvRow(todayStr(), run, vals));
    }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `production-run-${todayStr()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportHistoryCSV(day: HistoryDay) {
    const header = ["Date", "Brand", "Flavor", "Status", "Cases Planned", "Cases Actual", "Waste Lbs", "Started", "Ended", "Duration", "Downtime", "Actual PPM", "Notes", "Stoppages"];
    const rows: string[][] = [header];
    for (const run of day.runs) {
      const vals = day.runValues[run.id] ?? DEFAULT_VALUES;
      rows.push(buildRunCsvRow(day.date, run, vals as FormValues));
    }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `production-run-${day.date}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportExcel() {
    const rows = dayState.runs.map((run) => {
      const vals = run.id === currentRunId ? v : loadRunValues(run.id);
      return buildRunExportRow(todayStr(), runLabel(run), run, vals);
    });
    const wb = buildRunWorkbook(rows);
    XLSX.writeFile(wb, `production-run-${todayStr()}.xlsx`);
  }

  function exportQuickBooks() {
    const runs = dayState.runs.map((run) => {
      const vals = run.id === currentRunId ? v : loadRunValues(run.id);
      return { label: runLabel(run), brand: run.brand, flavor: run.flavor, vals, actualCases: run.actualCases };
    });
    const csv = buildQuickBooksCsv(todayStr(), runs);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `quickbooks-runs-${todayStr()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseRunWorkbook(buf);
      // Multi-sheet schedule planner: keep only runs dated today-or-later (the
      // user's chosen behavior) and route to the multi-date override commit.
      const result = parsed.multiDay ? filterImportFromDate(parsed, todayStr()) : parsed;
      setImportIntoEditor(false);
      setImportDefaultDate(todayStr());
      setImportResult(result);
      setShowImportDialog(true);
    } catch {
      // ignore malformed file — user can retry
    }
  }

  // Spec-sheet importer: read the .xlsx, ask the AI to interpret it into
  // structured spec profiles + recipes, canonicalize the names, and show a
  // single review/summary screen. Nothing is written until the user confirms.
  async function handleSpecImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_SPEC_IMPORT_FILES);
    e.target.value = "";
    if (files.length === 0) return;
    setSpecImportPrepared(null);
    setSpecImportError(null);
    setSpecImportProgress(files.length > 1 ? { done: 0, total: files.length } : null);
    setSpecImportLoading(true);
    setShowSpecImport(true);
    try {
      // Read each workbook independently so one unreadable file doesn't sink the
      // batch — prepareSpecImportMulti skips unparseable buffers and throws only
      // if every file failed.
      const buffers = await Promise.all(
        files.map((f) => f.arrayBuffer().catch(() => new ArrayBuffer(0))),
      );
      const prepared =
        buffers.length === 1
          ? await prepareSpecImport(buffers[0])
          : await prepareSpecImportMulti(buffers, (done, total) =>
              setSpecImportProgress({ done, total }),
            );
      setSpecImportPrepared(prepared);
    } catch (err) {
      setSpecImportError(
        err instanceof Error ? err.message : "Could not read or interpret that workbook.",
      );
    } finally {
      setSpecImportLoading(false);
      setSpecImportProgress(null);
    }
  }

  async function handleSpecImportConfirm() {
    if (!specImportPrepared) return;
    setSpecImportApplying(true);
    // Imported recipes can introduce ingredients that duplicate standalone ones,
    // so kick off a merge check afterwards (only when recipes were actually
    // imported). Capture before clearing the prepared payload.
    const importedRecipes = (specImportPrepared.summary?.totalRecipes ?? 0) > 0;
    try {
      await commitSpecImport(specImportPrepared);
      // Refresh derived dropdowns/profiles now that storage changed.
      reloadMasterData();
      setShowSpecImport(false);
      setSpecImportPrepared(null);
      // Fire-and-forget: a bump runs the merge-check effect after the new lists
      // have re-rendered. Never blocks or fails the already-committed import.
      if (importedRecipes) setMergeCheckRequest((c) => c + 1);
      // Auto-run spec cross-reference with the newly saved sheet.
      setSpecReconcileSignal((c) => c + 1);
    } catch (err) {
      setSpecImportError(
        err instanceof Error ? err.message : "Import failed while saving. Please try again.",
      );
    } finally {
      setSpecImportApplying(false);
    }
  }

  // Premix-sheet importer: read the .xlsx, parse each product tab/block into a
  // Mix deterministically (the AI only disambiguates product names), ground the
  // names, and show a single review/summary screen. Nothing is written until the
  // user confirms; re-importing updates existing mixes by id.
  async function handlePremixImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PREMIX_IMPORT_FILES);
    e.target.value = "";
    if (files.length === 0) return;
    setPremixImportPrepared(null);
    setPremixImportError(null);
    setPremixImportProgress(files.length > 1 ? { done: 0, total: files.length } : null);
    setPremixImportLoading(true);
    setShowPremixImport(true);
    try {
      const buffers = await Promise.all(
        files.map((f) => f.arrayBuffer().catch(() => new ArrayBuffer(0))),
      );
      const prepared = await preparePremixImport(buffers, (done, total) =>
        setPremixImportProgress(total > 1 ? { done, total } : null),
      );
      setPremixImportPrepared(prepared);
    } catch (err) {
      setPremixImportError(
        err instanceof Error ? err.message : "Could not read or interpret that workbook.",
      );
    } finally {
      setPremixImportLoading(false);
      setPremixImportProgress(null);
    }
  }

  async function handlePremixImportConfirm(mixesToApply: Mix[]) {
    if (!premixImportPrepared) return;
    setPremixImportApplying(true);
    try {
      await commitPremixImport(premixImportPrepared, mixesToApply);
      // Refresh the shared mixes query so imported mixes appear immediately in
      // the Mixes view and feed the make-day plan without waiting for polling.
      void cycleCountQc.invalidateQueries({ queryKey: ["mixes"] });
      setShowPremixImport(false);
      setPremixImportPrepared(null);
    } catch (err) {
      setPremixImportError(
        err instanceof Error ? err.message : "Import failed while saving. Please try again.",
      );
    } finally {
      setPremixImportApplying(false);
    }
  }

  // Excel upload triggered from within the Schedule editor: extracts rows into
  // the in-memory editor (scoped to the day being planned) instead of writing
  // to the server directly, so the user reviews then hits "Save Schedule".
  async function handleScheduleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseRunWorkbook(buf);
      // A multi-sheet planner spans many days, so it can't load into the single
      // open editor day — route it to the multi-date override commit instead
      // (today-or-later only), exactly like the toolbar import.
      const result = parsed.multiDay ? filterImportFromDate(parsed, todayStr()) : parsed;
      setImportIntoEditor(!parsed.multiDay);
      setImportDefaultDate(scheduleEditorDate || todayStr());
      setImportResult(result);
      setShowImportDialog(true);
    } catch {
      // ignore malformed file — user can retry
    }
  }

  async function commitExcelImport(payload: ImportCommit) {
    for (const b of payload.createBrands) addBrand(b);
    for (const cf of payload.createFlavors) addFlavor(cf.flavor, cf.brand);
    const date = payload.date;
    // Fetch the existing day payload so we can append additively WITHOUT
    // dropping any existing run metadata (started/ended times, stoppages,
    // actuals) or other day-level fields (shiftNotes, recipe presets, etc.).
    let existing: SyncPayload | null = null;
    try {
      const res = await fetch(`/api/sync/${date}`);
      if (res.ok) existing = (await res.json()) as SyncPayload | null;
    } catch {}
    const existingDayState = existing?.dayState ?? { runs: [] as RunMeta[] };
    const existingRuns: RunMeta[] = existingDayState.runs ?? [];
    const existingRunValues: Record<string, FormValues> = existing?.runValues ?? {};
    const newRuns: RunMeta[] = [];
    const newRunValues: Record<string, FormValues> = {};
    for (const r of payload.runs) {
      const id = genId();
      const profile = r.brand ? loadProfile(r.brand, r.flavor) : null;
      const base: FormValues = profile ?? DEFAULT_VALUES;
      newRunValues[id] = { ...base, casesNeeded: r.casesPlanned };
      newRuns.push({ id, brand: r.brand, flavor: r.flavor, notes: r.notes || undefined });
    }
    const runs = [...existingRuns, ...newRuns];
    const runValues = { ...existingRunValues, ...newRunValues };
    const outPayload: SyncPayload = {
      ...(existing ?? {}),
      dayState: { ...existingDayState, runs, date, resetAt: existingDayState.resetAt ?? Date.now() },
      runValues,
      brands: loadList(BRANDS_KEY, []).filter(b => !STALE_BRANDS.includes(b)),
      brandFlavors: loadBrandFlavors(),
      deletedItems: unionDeletedItems(loadDeletedItems(), existing?.deletedItems),
    };
    try {
      const res = await fetch(`/api/sync/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: outPayload }),
      });
      if (res.ok) {
        fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[])).catch(() => {});
      }
    } catch {}
    setShowImportDialog(false);
    setImportResult(null);
  }

  function importExcelIntoEditor(payload: ImportCommit) {
    for (const b of payload.createBrands) addBrand(b);
    for (const cf of payload.createFlavors) addFlavor(cf.flavor, cf.brand);
    const newRuns: { id: string; brand: string; flavor: string; casesNeeded: number }[] = [];
    const newVals: Record<string, FormValues> = {};
    for (const r of payload.runs) {
      const id = genId();
      const profile = r.brand ? loadProfile(r.brand, r.flavor) : null;
      newVals[id] = { ...(profile ?? DEFAULT_VALUES), casesNeeded: r.casesPlanned };
      newRuns.push({ id, brand: r.brand, flavor: r.flavor, casesNeeded: r.casesPlanned });
    }
    setScheduleEditorRunValues(prev => ({ ...prev, ...newVals }));
    // Drop any empty placeholder rows so the imported rows don't leave a blank
    // run that blocks the Save Schedule validation.
    setScheduleEditorRuns(prev => [...prev.filter(r => r.brand || r.casesNeeded), ...newRuns]);
    if (payload.date) setScheduleEditorDate(payload.date);
    setShowImportDialog(false);
    setImportResult(null);
    setImportIntoEditor(false);
  }

  // Multi-sheet schedule planner commit: each date in `payload.byDate` is written
  // independently. Per the user's choice, a re-import OVERRIDES the prior import
  // for a date — previously imported runs are dropped and replaced — but manual
  // runs and any imported run already started/ended are preserved (so an
  // in-progress day isn't wiped). Only dates present in the file are touched.
  async function commitMultiDayImport(payload: ImportCommit) {
    for (const b of payload.createBrands) addBrand(b);
    for (const cf of payload.createFlavors) addFlavor(cf.flavor, cf.brand);
    const byDate = payload.byDate ?? [];
    setImportProgress({ done: 0, total: byDate.length });
    let done = 0;
    for (const day of byDate) {
      const date = day.date;
      let existing: SyncPayload | null = null;
      try {
        const res = await fetch(`/api/sync/${date}`);
        if (res.ok) existing = (await res.json()) as SyncPayload | null;
      } catch {}
      const existingDayState = existing?.dayState ?? { runs: [] as RunMeta[] };
      const existingRuns: RunMeta[] = existingDayState.runs ?? [];
      const existingRunValues: Record<string, FormValues> = existing?.runValues ?? {};
      // Keep manual runs, and imported runs that have already been started/ended
      // (don't disturb an in-progress/completed day). Drop untouched prior imports.
      const keptRuns = existingRuns.filter(r => !r.imported || r.startedAt || r.endedAt);
      const keptIds = new Set(keptRuns.map(r => r.id));
      const keptRunValues: Record<string, FormValues> = {};
      for (const id of keptIds) if (existingRunValues[id]) keptRunValues[id] = existingRunValues[id];
      const newRuns: RunMeta[] = [];
      const newRunValues: Record<string, FormValues> = {};
      for (const r of day.runs) {
        const id = genId();
        const profile = r.brand ? loadProfile(r.brand, r.flavor) : null;
        const base: FormValues = profile ?? DEFAULT_VALUES;
        newRunValues[id] = { ...base, casesNeeded: r.casesPlanned };
        newRuns.push({ id, brand: r.brand, flavor: r.flavor, notes: r.notes || undefined, imported: true });
      }
      const runs = [...keptRuns, ...newRuns];
      const runValues = { ...keptRunValues, ...newRunValues };
      const outPayload: SyncPayload = {
        ...(existing ?? {}),
        dayState: { ...existingDayState, runs, date, resetAt: existingDayState.resetAt ?? Date.now() },
        runValues,
        brands: loadList(BRANDS_KEY, []).filter(b => !STALE_BRANDS.includes(b)),
        brandFlavors: loadBrandFlavors(),
        deletedItems: unionDeletedItems(loadDeletedItems(), existing?.deletedItems),
      };
      try {
        await fetch(`/api/sync/${date}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: outPayload }),
        });
      } catch {}
      done += 1;
      setImportProgress({ done, total: byDate.length });
    }
    fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[])).catch(() => {});
    setImportProgress(null);
    setShowImportDialog(false);
    setImportResult(null);
    setImportIntoEditor(false);
  }

  function printSummary() {
    window.print();
  }

  const runStatus: "pending" | "running" | "paused" | "ended" =
    currentRun?.endedAt ? "ended"
    : currentRun?.pausedAt ? "paused"
    : currentRun?.startedAt ? "running"
    : "pending";

  const nowTime = useClock(runStatus);

  const liveFreezerMin = (() => {
    if (!currentRun?.startedAt) return 0;
    if (currentRun.endedAt) return Number(v.freezerTime);
    // When paused, freeze the timer at the moment of pause
    const refTime = currentRun.pausedAt ?? nowTime.getTime();
    const elapsed = (refTime - currentRun.startedAt) / 60000;
    return Math.min(elapsed, Number(v.freezerTime));
  })();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);


  // ── Idle screen-saver: auto-activate floor mode after 3 min of no activity ──
  useEffect(() => {
    if (!floorModeEnabled) return; // Floor Mode disabled — never auto-activate
    const IDLE_MS = 3 * 60 * 1000;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    function resetTimer() {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => setShowFloorMode(true), IDLE_MS);
    }
    resetTimer();
    const events = ["touchstart", "mousedown", "keydown"] as const;
    events.forEach(ev => window.addEventListener(ev, resetTimer, { passive: true }));
    return () => {
      if (timerId) clearTimeout(timerId);
      events.forEach(ev => window.removeEventListener(ev, resetTimer));
    };
  }, [floorModeEnabled]); // setShowFloorMode is a stable setter

  // Floor Mode auto-dim: once Floor Mode is showing, dim it after a stretch of
  // inactivity and restore instantly on any interaction. Paired with the slow
  // CSS drift (.floor-drift) this keeps a left-on floor monitor safe from
  // burn-in/glare without hiding the live numbers when someone is watching.
  useEffect(() => {
    if (!showFloorMode) { setFloorDimmed(false); return; }
    const DIM_MS = 90 * 1000;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    function arm() {
      setFloorDimmed(false);
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => setFloorDimmed(true), DIM_MS);
    }
    arm();
    const events = ["touchstart", "mousedown", "keydown", "mousemove"] as const;
    events.forEach(ev => window.addEventListener(ev, arm, { passive: true }));
    return () => {
      if (timerId) clearTimeout(timerId);
      events.forEach(ev => window.removeEventListener(ev, arm));
    };
  }, [showFloorMode]);

  // Reset all runs at midnight — archive current day first, auto-end any active run
  useEffect(() => {
    function msUntilMidnight() {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      return midnight.getTime() - now.getTime();
    }
    let timeout: ReturnType<typeof setTimeout>;
    function scheduleReset() {
      timeout = setTimeout(async () => {
        const storedDs = (() => {
          try { return JSON.parse(localStorage.getItem(DAY_KEY) ?? "null") as DayState | null; }
          catch { return null; }
        })();
        if (storedDs?.date && storedDs.date !== todayStr()) {
          // Auto-deduct inventory for every run closed by the midnight rollover,
          // matching endRun. consume is idempotent per runId — no double-count.
          for (const r of storedDs.runs) {
            if (r.startedAt && !r.endedAt) {
              const vals = r.id === currentRunIdRef.current ? form.getValues() : loadRunValues(r.id);
              void consumeRun(r.id, computeRunConsumptionLines(vals)).catch(() => setWriteError("Couldn't record a finished run's inventory use on the server — stock counts may be out of sync. Check your connection."));
            }
          }
          // Auto-end any run that was still active when midnight hit
          const finalDs: DayState = {
            ...storedDs,
            runs: storedDs.runs.map(r =>
              r.startedAt && !r.endedAt ? { ...r, endedAt: Date.now(), pausedAt: undefined } : r
            ),
          };
          archiveDayToHistory(finalDs, storedDs.date);
        }
        const newDate = todayStr();
        // Try to load any pre-scheduled data for the new day
        try {
          const res = await fetch(`/api/sync/${newDate}`);
          if (res.ok) {
            const payload = await res.json() as SyncPayload | null;
            if (payload?.dayState?.runs?.length) {
              const ds: DayState = { runs: payload.dayState.runs, currentIndex: 0, date: newDate, shiftNotes: payload.dayState.shiftNotes, runToTime: payload.dayState.runToTime, resetAt: Date.now(), substitutions: [], substitutionLog: [], stagedItems: {} };
              for (const [id, vals] of Object.entries(payload.runValues ?? {})) saveRunValues(id, { ...DEFAULT_VALUES, ...(vals as FormValues) });
              { const dm = loadDeletedItems(); if (dm["runs"]) { delete dm["runs"]; saveDeletedItems(dm); } }
              saveDayState(ds);
              setDayState(ds);
              if (ds.runToTime) setRunToTime(ds.runToTime);
              const firstId = ds.runs[0]?.id;
              const firstVals = firstId ? { ...DEFAULT_VALUES, ...((payload.runValues ?? {})[firstId] as FormValues ?? {}) } : DEFAULT_VALUES;
              form.reset(firstVals);
              resetFieldArrays(firstVals);
              schedulePush(ds, 0);
              fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[])).catch(() => {});
              scheduleReset();
              return;
            }
          }
        } catch {}
        // Fallback: fresh empty state
        const fresh = { ...freshDayState(), resetAt: Date.now() };
        { const dm = loadDeletedItems(); if (dm["runs"]) { delete dm["runs"]; saveDeletedItems(dm); } }
        setDayState(fresh);
        saveDayState(fresh);
        setRunToTime("19:15");
        form.reset(DEFAULT_VALUES);
        resetFieldArrays(DEFAULT_VALUES);
        schedulePush(fresh, 0);
        scheduleReset();
      }, msUntilMidnight());
    }
    scheduleReset();
    return () => clearTimeout(timeout);
  }, []);

  // Clear hidden fields the moment their recipe-driven hide condition becomes true
  useEffect(() => {
    const lbs = (v.doughRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    if (lbs > 0 && Number(v.targetDoughballWeight) > 0 && v.doughBatchYield !== 0) {
      form.setValue("doughBatchYield", 0, { shouldDirty: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.doughRecipe, v.targetDoughballWeight]);

  useEffect(() => {
    const lbs = (v.frontlineRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    if (lbs > 0 && v.sauceBarrelLbs !== 0) {
      form.setValue("sauceBarrelLbs", 0, { shouldDirty: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.frontlineRecipe]);

  useEffect(() => {
    const check = (
      recipe: { lbs: number }[] | undefined,
      type: string,
      field: "app1BatchLbs" | "app2BatchLbs" | "app3BatchLbs" | "app4BatchLbs",
      current: number,
    ) => {
      const isMix = type.trim().toLowerCase().includes("mix");
      const hasLbs = !isMix && (recipe ?? []).some(r => Number(r.lbs) > 0);
      if (hasLbs && current !== 0) form.setValue(field, 0, { shouldDirty: true });
    };
    check(v.app1CheeseRecipe, v.app1Type, "app1BatchLbs", v.app1BatchLbs);
    check(v.app2CheeseRecipe, v.app2Type, "app2BatchLbs", v.app2BatchLbs);
    check(v.app3CheeseRecipe, v.app3Type, "app3BatchLbs", v.app3BatchLbs);
    check(v.app4CheeseRecipe, v.app4Type, "app4BatchLbs", v.app4BatchLbs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.app1CheeseRecipe, v.app2CheeseRecipe, v.app3CheeseRecipe, v.app4CheeseRecipe,
      v.app1Type, v.app2Type, v.app3Type, v.app4Type]);

  const calc = useMemo(() => {
    const ppm =
      doughSubTab === "crusts"
        ? v.approxLineSpeed
        : v.crustsPerCycle * v.cycleSpeed * v.speedAdjustment;

    const perTray = doughSubTab === "crusts" ? v.crustsPerStack : v.doughballsPerTray;

    // Effective batch yield: derive from recipe when recipe + target weight are both present
    const doughRecipeLbs = (v.doughRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const effectiveDoughBatchYield =
      doughRecipeLbs > 0 && v.targetDoughballWeight > 0
        ? (doughRecipeLbs * 16) / v.targetDoughballWeight
        : v.doughBatchYield;

    const traysPerSkid =
      (v.casesPerSkid * v.pizzasPerCase) / perTray;
    const perBatch = doughSubTab === "crusts" ? v.crustsPerCase : effectiveDoughBatchYield;
    const traysPerBatch = effectiveDoughBatchYield / perTray;
    const batchesPerSkid = traysPerSkid / traysPerBatch;

    // casesOnLine = ROUNDDOWN(ppm * freezerTime / pizzasPerCase, 0)
    // ppm already includes speedAdjustment — do not apply it a second time
    const freezerTime = liveFreezerMin;
    const casesOnLine =
      ppm > 0
        ? Math.floor((ppm * freezerTime) / v.pizzasPerCase)
        : 0;

    // Spreadsheet Dough!B4: casesNeeded - skidsCompleted*casesPerSkid - casesOnCurrentSkid - casesOnLine + casesPerLayer
    const casesLeftToRun =
      v.casesNeeded -
      v.skidsCompleted * v.casesPerSkid -
      v.casesOnCurrentSkid -
      casesOnLine +
      v.casesPerLayer;

    // For timing: same but without casesPerLayer (Timing sheet formula)
    const casesForTiming =
      v.casesNeeded -
      v.skidsCompleted * v.casesPerSkid -
      v.casesOnCurrentSkid -
      casesOnLine;

    const totalPizzasLeft = casesLeftToRun * v.pizzasPerCase;
    // Staged supply: trays/stacks already ready × units per tray, plus mixed batches ready
    const doughOnHand =
      v.traysOnLine * perTray +
      v.batchesReady * effectiveDoughBatchYield;
    const doughDeficit = Math.max(0, totalPizzasLeft - doughOnHand);
    const batchesNeeded = doughDeficit / effectiveDoughBatchYield;
    const traysNeeded = doughDeficit / perTray;
    // Net pizzas after deducting already-staged trays/stacks (same logic as doughDeficit)
    const pizzasNetOfStaged = Math.max(0, totalPizzasLeft - v.traysOnLine * perTray);
    const casesLeftToOpen = v.crustsPerCase > 0
      ? Math.ceil(pizzasNetOfStaged / v.crustsPerCase)
      : 0;
    const stacksNeededTotal = perTray > 0 ? Math.ceil(pizzasNetOfStaged / perTray) : 0;
    const buffer = Math.max(0, doughOnHand - totalPizzasLeft) / v.pizzasPerCase;
    const doughShortCases = doughDeficit / v.pizzasPerCase;
    const doughDepletionSec = ppm > 0 ? (doughOnHand / ppm) * 60 : 0;

    // Spreadsheet B9: roundup(casesPerSkid - casesOnLine, 0)
    const casesOnLastSkid = Math.ceil(
      Math.max(0, v.casesPerSkid - casesOnLine)
    );

    // Timing — spreadsheet D5 = (60/cycleSpeed)/speedAdjustment
    const timePressHzSec =
      ppm > 0 ? (60 / v.cycleSpeed) / v.speedAdjustment : 0;
    // Unified formula: perTray / ppm * 60 — equivalent to press-cycle formula in dough
    // mode, and correct for crust mode where ppm = approxLineSpeed directly
    const timePerTraySec =
      ppm > 0 ? (perTray / ppm) * 60 : 0;
    const timePerBatchSec =
      ppm > 0 ? (perBatch / ppm) * 60 : 0;
    const timePerSkidSec =
      ppm > 0 ? ((v.casesPerSkid * v.pizzasPerCase) / ppm) * 60 : 0;
    const timePerCaseSec =
      ppm > 0 ? (v.pizzasPerCase / ppm) * 60 : 0;
    const totalTimeSec =
      ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : 0;
    // Spreadsheet: includes batchesReady dough
    const doughMadeTimeSec =
      ppm > 0
        ? ((v.traysOnLine * perTray +
            v.batchesReady * effectiveDoughBatchYield) /
            ppm) *
          60
        : 0;

    const rackTimes = [10, 12, 16, 18, 20, 22].map((n) => ({
      trays: n,
      sec: ppm > 0 ? (n * perTray * 60) / ppm : 0,
    }));

    // Frontline — batches = total_oz_needed / (batch_lbs * 16)
    // Spreadsheet adds casesPerLayer as a pizza buffer to sauce total only
    const totalPizzasRun = casesLeftToRun * v.pizzasPerCase;
    const totalPizzasForSauce = totalPizzasRun + v.casesPerLayer * v.pizzasPerCase;
    const frontlineRecipeLbs = (v.frontlineRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const sauceEffBarrel = frontlineRecipeLbs > 0 ? frontlineRecipeLbs : v.sauceBarrelLbs;
    const sauceLbs = (totalPizzasForSauce * v.sauceOzPerPizza) / 16 + 30;
    const sauceBatches =
      sauceEffBarrel > 0
        ? sauceLbs / sauceEffBarrel
        : 0;
    const app1RecipeLbs = (v.app1CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const app1Lbs = (totalPizzasForSauce * v.app1OzPerPizza) / 16 + 20;
    const app1IsMix = v.app1Type.trim().toLowerCase().includes("mix");
    const app1EffBatch = app1RecipeLbs > 0 ? app1RecipeLbs : v.app1BatchLbs;
    const app1Batches = !app1IsMix && app1EffBatch > 0 ? app1Lbs / app1EffBatch : 0;
    const app2RecipeLbs = (v.app2CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const app2Lbs = (totalPizzasForSauce * v.app2OzPerPizza) / 16 + 20;
    const app2IsMix = v.app2Type.trim().toLowerCase().includes("mix");
    const app2EffBatch = app2RecipeLbs > 0 ? app2RecipeLbs : v.app2BatchLbs;
    const app2Batches = !app2IsMix && app2EffBatch > 0 ? app2Lbs / app2EffBatch : 0;
    const app3RecipeLbs = (v.app3CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const app3Lbs = (totalPizzasForSauce * v.app3OzPerPizza) / 16 + 20;
    const app3IsMix = v.app3Type.trim().toLowerCase().includes("mix");
    const app3EffBatch = app3RecipeLbs > 0 ? app3RecipeLbs : v.app3BatchLbs;
    const app3Batches = !app3IsMix && app3EffBatch > 0 ? app3Lbs / app3EffBatch : 0;
    const app4RecipeLbs = (v.app4CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const app4Lbs = (totalPizzasForSauce * v.app4OzPerPizza) / 16 + 20;
    const app4IsMix = v.app4Type.trim().toLowerCase().includes("mix");
    const app4EffBatch = app4RecipeLbs > 0 ? app4RecipeLbs : v.app4BatchLbs;
    const app4Batches = !app4IsMix && app4EffBatch > 0 ? app4Lbs / app4EffBatch : 0;
    const pep1Lbs = (totalPizzasForSauce * v.pep1OzPerPizza) / 16 + v.pep1Sticks;
    const pep1Batches =
      !DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") && v.pep1BatchLbs > 0
        ? pep1Lbs / v.pep1BatchLbs
        : 0;
    const pep2Lbs = (totalPizzasForSauce * v.pep2OzPerPizza) / 16 + v.pep2Sticks;
    const pep2Batches =
      !DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") && v.pep2BatchLbs > 0
        ? pep2Lbs / v.pep2BatchLbs
        : 0;

    // ── Pace gauge ──────────────────────────────────────────────────────────
    // casesCompleted = skids done + cases on current skid
    const casesCompleted = v.skidsCompleted * v.casesPerSkid + v.casesOnCurrentSkid;
    // Extra cases produced beyond the run target (only positive once the order
    // is met and the line keeps running).
    const extraCases = Math.max(0, casesCompleted - v.casesNeeded);
    // Adjusted remaining time: based on cases still left rather than full run
    const adjustedTimeSec = ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : totalTimeSec;
    // Pace: expected cases completed by now vs actual
    // Subtract freeze tunnel time — cases aren't done until they exit the tunnel
    let paceStatus: "on-pace" | "ahead" | "behind" | null = null;
    let paceDelta = 0; // positive = ahead, negative = behind (in cases)
    if (currentRun?.startedAt && !currentRun?.endedAt && ppm > 0 && v.pizzasPerCase > 0) {
      const refTime = currentRun.pausedAt ?? Date.now();
      const downtimeMs = (currentRun.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
      const elapsedMin = Math.max(0, (refTime - currentRun.startedAt - downtimeMs)) / 60000;
      const elapsedMinAfterTunnel = Math.max(0, elapsedMin - Number(v.freezerTime));
      const expectedCases = Math.floor((ppm * elapsedMinAfterTunnel) / v.pizzasPerCase);
      paceDelta = casesCompleted - expectedCases;
      paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
    }

    // ── Catch-up PPM: if behind, what PPM is needed to finish on time? ──────
    let catchUpPpm: number | null = null;
    if (
      paceStatus === "behind" &&
      currentRun?.startedAt &&
      !currentRun?.endedAt &&
      ppm > 0 &&
      v.pizzasPerCase > 0 &&
      v.casesNeeded > 0
    ) {
      const refTime = currentRun.pausedAt ?? Date.now();
      const downtimeMs = (currentRun.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
      const elapsedSec = Math.max(0, (refTime - currentRun.startedAt - downtimeMs)) / 1000;
      const remainingCases = v.casesNeeded - casesCompleted;
      const originalTotalSec = ppm > 0 ? (v.casesNeeded * v.pizzasPerCase * 60) / ppm : 0;
      const remainingSec = Math.max(60, originalTotalSec - elapsedSec);
      if (remainingSec > 0 && remainingCases > 0) {
        catchUpPpm = Math.round((remainingCases * v.pizzasPerCase * 60) / remainingSec);
      }
    }

    return {
      ppm,
      traysPerSkid,
      traysPerBatch,
      batchesPerSkid,
      casesOnLine,
      casesLeftToRun,
      casesLeftToOpen,
      stacksNeededTotal,
      casesForTiming,
      batchesNeeded,
      traysNeeded,
      buffer,
      doughShortCases,
      doughDepletionSec,
      casesOnLastSkid,
      timePressHzSec,
      timePerTraySec,
      timePerBatchSec,
      timePerSkidSec,
      timePerCaseSec,
      totalTimeSec,
      adjustedTimeSec,
      extraCases,
      doughMadeTimeSec,
      rackTimes,
      sauceBatches,
      app1Lbs,
      app1Batches,
      app2Lbs,
      app2Batches,
      app3Lbs,
      app3Batches,
      app4Lbs,
      app4Batches,
      pep1Lbs,
      pep1Batches,
      pep2Lbs,
      pep2Batches,
      casesCompleted,
      paceStatus,
      paceDelta,
      catchUpPpm,
      perTray,
      perBatch: effectiveDoughBatchYield,
      sauceEffBarrel,
    };
  }, [v, liveFreezerMin, currentRun?.startedAt, currentRun?.pausedAt, currentRun?.endedAt, nowTime]);

  // ── Next-run die type (for change warning) ────────────────────────────────
  const nextRunDieType = useMemo(() => {
    const nextRun = dayState.runs[dayState.currentIndex + 1];
    if (!nextRun) return "";
    return loadRunValues(nextRun.id).dieType ?? "";
  }, [dayState.runs, dayState.currentIndex]);

  // ── Last-run recall (same brand+flavor from history) ──────────────────────
  const lastRunRecall = useMemo(() => {
    if (!currentRun?.brand || !currentRun?.flavor) return null;
    const history = loadHistory();
    for (const day of history) {
      for (const run of [...day.runs].reverse()) {
        if (run.brand === currentRun.brand && run.flavor === currentRun.flavor && run.endedAt) {
          const vals = (day as HistoryDay & { runValues?: Record<string, FormValues> }).runValues?.[run.id];
          return {
            date: day.date,
            actualCases: run.actualCases,
            wasteLbs: run.wasteLbs,
            casesNeeded: vals?.casesNeeded,
          };
        }
      }
    }
    return null;
  }, [currentRun?.brand, currentRun?.flavor]);

  const { showBatchDue, setShowBatchDue } = useNotifications({
    runStatus,
    nowTime,
    currentRun,
    calc,
    v,
    isCrust: doughSubTab === "crusts",
  });

  // ── Screen casting views (early returns) ──────────────────────────────────
  const casesPct = v.casesNeeded > 0 ? Math.min(1, calc.casesCompleted / v.casesNeeded) : 0;
  const currentRunDowntimeMs = (currentRun?.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
  const elapsedBatchSec = currentRun?.startedAt
    ? Math.max(0, ((currentRun.pausedAt ?? nowTime.getTime()) - currentRun.startedAt - currentRunDowntimeMs)) / 1000
    : 0;
  // ── Auto-track progress ───────────────────────────────────────────────────
  const { autoTrackProgress, setAutoTrackProgress, autoTrackSuggestion, autoSuppressUntilRef, lastAutoMinBucketRef } = useAutoTrack({
    runId: currentRunId,
    runStatus,
    nowTime,
    elapsedBatchSec,
    calc,
    v,
    form,
  });

  const currentBatchNum = calc.timePerBatchSec > 0 ? Math.floor(elapsedBatchSec / calc.timePerBatchSec) : 0;
  const secUntilNextBatch = calc.timePerBatchSec > 0
    ? calc.timePerBatchSec - (elapsedBatchSec % calc.timePerBatchSec)
    : 0;
  const totalBatchesNeeded = calc.timePerBatchSec > 0 && calc.totalTimeSec > 0
    ? Math.ceil(calc.totalTimeSec / calc.timePerBatchSec)
    : 0;


  if (screenMode === "dashboard") {
    const paceColor = calc.paceStatus === "ahead" ? "text-emerald-400" : calc.paceStatus === "behind" ? "text-red-400" : "text-yellow-400";
    const paceLabel = calc.paceStatus === "ahead" ? "AHEAD" : calc.paceStatus === "behind" ? "BEHIND" : "ON PACE";
    const dashDowntimeSec = (currentRun?.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((a, s) => a + (s.endedAt! - s.startedAt) / 1000, 0);
    const dashMinutesDelta = calc.ppm > 0 && calc.paceDelta !== 0 ? Math.round(Math.abs(calc.paceDelta) * v.pizzasPerCase / calc.ppm) : 0;
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-6 gap-6 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Factory className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Production Dashboard</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        {/* Run name + status */}
        <div className="flex items-center gap-4">
          <h1 className="text-5xl font-black tracking-tight">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>
          {runStatus === "running" && <span className="px-3 py-1 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-sm font-bold uppercase">Running</span>}
          {runStatus === "paused" && <span className="px-3 py-1 rounded-full bg-yellow-600/20 border border-yellow-600/40 text-yellow-400 text-sm font-bold uppercase">Paused</span>}
          {runStatus === "ended" && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold uppercase">Ended</span>}
          {v.dieType && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold">{v.dieType}</span>}
        </div>

        {/* Main stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 flex-1">
          {/* PPM */}
          <div className="rounded-2xl bg-card border border-border p-8 flex flex-col justify-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">Pizzas / Min</p>
            <p className="text-8xl font-black tabular-nums text-primary">{calc.ppm > 0 ? fmtComma(calc.ppm) : "—"}</p>
          </div>

          {/* Cases progress */}
          <div className="rounded-2xl bg-card border border-border p-8 flex flex-col justify-center gap-4">
            <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Cases Done</p>
            <p className="text-7xl font-black tabular-nums">
              {fmtComma(calc.casesCompleted)}
              <span className="text-3xl text-muted-foreground"> / {fmtComma(v.casesNeeded)}</span>
            </p>
            <div className="h-4 rounded-full bg-muted/30 overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-1000" style={{ width: `${casesPct * 100}%` }} />
            </div>
            <div className="flex items-center gap-6">
              <p className="text-lg font-semibold text-muted-foreground">{Math.round(casesPct * 100)}% complete</p>
              {v.casesPerSkid > 0 && v.casesNeeded > 0 && (
                <p className="text-lg font-semibold text-muted-foreground">
                  {v.skidsCompleted} / {Math.floor(v.casesNeeded / v.casesPerSkid)} skids
                </p>
              )}
            </div>
          </div>

          {/* Pace + time */}
          <div className="rounded-2xl bg-card border border-border p-8 flex flex-col justify-center gap-4">
            <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Pace</p>
            <p className={`text-6xl font-black ${paceColor}`}>{paceLabel}</p>
            {calc.paceDelta !== 0 && (
              <p className="text-2xl font-bold text-muted-foreground">
                {calc.paceDelta > 0 ? "+" : ""}{fmtComma(Math.abs(calc.paceDelta))} cases
                {dashMinutesDelta > 0 && <span className="text-lg ml-2 opacity-70">(~{dashMinutesDelta} min)</span>}
              </p>
            )}
            {dashDowntimeSec > 0 && (
              <p className="text-lg font-semibold text-red-400/80">
                ↓ {fmtTime(dashDowntimeSec)} downtime
              </p>
            )}
            {calc.adjustedTimeSec > 0 && (
              <div className="mt-2 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold mb-1">Est. Finish</p>
                <p className="text-3xl font-black tabular-nums">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</p>
                <p className="text-lg text-muted-foreground">{fmtTime(calc.adjustedTimeSec)} remaining</p>
              </div>
            )}
          </div>
        </div>

        {/* Next run footer */}
        {dayState.runs[dayState.currentIndex + 1] && (
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-muted/20 border border-border/50 text-muted-foreground">
            <ArrowRight className="w-4 h-4 shrink-0" />
            <span className="text-sm font-semibold">Next: {runLabel(dayState.runs[dayState.currentIndex + 1])}</span>
            {nextRunDieType && nextRunDieType !== v.dieType && (
              <span className="ml-2 text-xs font-bold text-amber-400">⚠ Die change → {nextRunDieType}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "dough") {
    const batchUrgent = secUntilNextBatch > 0 && secUntilNextBatch < 120;
    const batchDue = secUntilNextBatch <= 0 || (elapsedBatchSec > 0 && secUntilNextBatch < 5);
    const mm = Math.floor(secUntilNextBatch / 60);
    const ss = Math.floor(secUntilNextBatch % 60);
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-8 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Droplets className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Dough Station</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        <h1 className="text-4xl font-black">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>

        {/* Big countdown */}
        {runStatus === "running" && calc.timePerBatchSec > 0 && doughSubTab !== "crusts" ? (
          <div className={`flex-1 flex flex-col items-center justify-center gap-6 rounded-3xl border p-12 ${batchDue ? "bg-orange-950/40 border-orange-500/50" : batchUrgent ? "bg-amber-950/30 border-amber-600/40" : "bg-card border-border"}`}>
            <p className={`text-lg font-bold uppercase tracking-widest ${batchDue ? "text-orange-400" : batchUrgent ? "text-amber-400" : "text-muted-foreground"}`}>
              {batchDue ? "🍕 Start Next Batch Now!" : "Next Batch In"}
            </p>
            <p className={`text-[10rem] font-black tabular-nums leading-none ${batchDue ? "text-orange-400 animate-pulse" : batchUrgent ? "text-amber-400" : "text-primary"}`}>
              {batchDue ? "GO" : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`}
            </p>
            <div className="flex items-center gap-8 text-center mt-4">
              <div>
                <p className="text-sm text-muted-foreground uppercase tracking-wider">Current Batch</p>
                <p className="text-5xl font-black tabular-nums">{currentBatchNum + 1}</p>
              </div>
              {totalBatchesNeeded > 0 && (
                <>
                  <p className="text-4xl text-muted-foreground font-light">of</p>
                  <div>
                    <p className="text-sm text-muted-foreground uppercase tracking-wider">Total Batches</p>
                    <p className="text-5xl font-black tabular-nums">{totalBatchesNeeded}</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-6 text-muted-foreground">
              <div className="text-center">
                <p className="text-xs uppercase tracking-wider mb-1">Time Per Batch</p>
                <p className="text-2xl font-bold">{fmtTime(calc.timePerBatchSec)}</p>
              </div>
              {calc.perBatch > 0 && (
                <div className="text-center">
                  <p className="text-xs uppercase tracking-wider mb-1">Yield / Batch</p>
                  <p className="text-2xl font-bold">{fmtComma(Math.round(calc.perBatch))}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-3xl border border-border bg-card">
            <p className="text-2xl text-muted-foreground">
              {doughSubTab === "crusts" ? "Crust run — no dough batches to mix" : runStatus === "pending" ? "Run not started" : runStatus === "ended" ? "Run ended" : "Enter line speed to see batch timing"}
            </p>
          </div>
        )}

        {/* Dough stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-card border border-border p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{doughSubTab === "crusts" ? "Stacks Ready" : "Trays on Line"}</p>
            <p className="text-3xl font-black tabular-nums">{v.traysOnLine > 0 ? v.traysOnLine : "—"}</p>
            {calc.traysNeeded > 0 && <p className="text-sm text-muted-foreground">/ {fmtNum(calc.traysNeeded, 0)} needed</p>}
          </div>
          {doughSubTab !== "crusts" && (
            <div className="rounded-2xl bg-card border border-border p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Batches Ready</p>
              <p className="text-3xl font-black tabular-nums">{v.batchesReady}</p>
              {calc.batchesNeeded > 0 && <p className="text-sm text-muted-foreground">/ {fmtNum(calc.batchesNeeded, 1)} needed</p>}
            </div>
          )}
          {v.doughBatchYield > 0 && doughSubTab !== "crusts" && (
            <div className="rounded-2xl bg-card border border-border p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Batch Yield</p>
              <p className="text-3xl font-black tabular-nums">{fmtComma(v.doughBatchYield)}</p>
              <p className="text-sm text-muted-foreground">doughballs</p>
            </div>
          )}
          {v.casesNeeded > 0 && (
            <div className="rounded-2xl bg-card border border-border p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cases Done</p>
              <p className="text-3xl font-black tabular-nums">{fmtComma(calc.casesCompleted)}</p>
              <p className="text-sm text-muted-foreground">/ {fmtComma(v.casesNeeded)}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (screenMode === "frontline") {
    const s = computeSummaryStats(v);
    const items: { label: string; value: string; sub?: string }[] = [];
    if (s.sauceBatches > 0) {
      const bd = sauceBarrelBreakdown(s.sauceBatches, s.sauceEffBarrel);
      items.push({ label: "Sauce", value: bd ? `${fmtNum(s.sauceBatches, 2)} batches · ${bd.totalBarrels} barrels` : fmtNum(s.sauceBatches, 2) + " barrels" });
    }
    if (s.app1Type) {
      const isMix = s.app1Type.trim().toLowerCase().includes("mix");
      if (isMix ? s.app1Lbs > 0 : s.app1Batches > 0)
        items.push({ label: `App 1 — ${s.app1Type}`, value: isMix ? fmtNum(s.app1Lbs, 1) + " lbs" : fmtNum(s.app1Batches, 2) + " batches", sub: isMix ? undefined : fmtNum(s.app1Lbs, 1) + " lbs total" });
    }
    if (s.app2Type) {
      const isMix = s.app2Type.trim().toLowerCase().includes("mix");
      if (isMix ? s.app2Lbs > 0 : s.app2Batches > 0)
        items.push({ label: `App 2 — ${s.app2Type}`, value: isMix ? fmtNum(s.app2Lbs, 1) + " lbs" : fmtNum(s.app2Batches, 2) + " batches", sub: isMix ? undefined : fmtNum(s.app2Lbs, 1) + " lbs total" });
    }
    if (s.app3Type) {
      const isMix = s.app3Type.trim().toLowerCase().includes("mix");
      if (isMix ? s.app3Lbs > 0 : s.app3Batches > 0)
        items.push({ label: `App 3 — ${s.app3Type}`, value: isMix ? fmtNum(s.app3Lbs, 1) + " lbs" : fmtNum(s.app3Batches, 2) + " batches", sub: isMix ? undefined : fmtNum(s.app3Lbs, 1) + " lbs total" });
    }
    if (s.app4Type) {
      const isMix = s.app4Type.trim().toLowerCase().includes("mix");
      if (isMix ? s.app4Lbs > 0 : s.app4Batches > 0)
        items.push({ label: `App 4 — ${s.app4Type}`, value: isMix ? fmtNum(s.app4Lbs, 1) + " lbs" : fmtNum(s.app4Batches, 2) + " batches", sub: isMix ? undefined : fmtNum(s.app4Lbs, 1) + " lbs total" });
    }
    if (s.pep1Type) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep1Type);
      if ((isPepStd ? s.pep1Lbs : s.pep1Batches) > 0)
        items.push({ label: `Pep 1 — ${s.pep1Type}`, value: isPepStd ? fmtNum(s.pep1Lbs, 2) + " lbs" : fmtNum(s.pep1Batches, 2) + " batches" });
    }
    if (s.pep2Type) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep2Type);
      if ((isPepStd ? s.pep2Lbs : s.pep2Batches) > 0)
        items.push({ label: `Pep 2 — ${s.pep2Type}`, value: isPepStd ? fmtNum(s.pep2Lbs, 2) + " lbs" : fmtNum(s.pep2Batches, 2) + " batches" });
    }
    const cheeseRecipes: { label: string; rows: { ingredient: string; lbs: number }[] }[] = [];
    if ((v.app1CheeseRecipe ?? []).length > 0) cheeseRecipes.push({ label: `App 1 Cheese Recipe`, rows: v.app1CheeseRecipe.filter(r => r.ingredient && Number(r.lbs) > 0).map(r => ({ ingredient: r.ingredient, lbs: Number(r.lbs) })) });
    if ((v.app2CheeseRecipe ?? []).length > 0) cheeseRecipes.push({ label: `App 2 Cheese Recipe`, rows: v.app2CheeseRecipe.filter(r => r.ingredient && Number(r.lbs) > 0).map(r => ({ ingredient: r.ingredient, lbs: Number(r.lbs) })) });

    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-6 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Frontline Station</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        {/* Run name + status */}
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-4xl font-black">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>
          {runStatus === "running" && <span className="px-3 py-1 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-sm font-bold uppercase">Running</span>}
          {runStatus === "paused" && <span className="px-3 py-1 rounded-full bg-yellow-600/20 border border-yellow-600/40 text-yellow-400 text-sm font-bold uppercase">Paused</span>}
          {runStatus === "ended" && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold uppercase">Ended</span>}
          {v.dieType && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold">{v.dieType}</span>}
          {v.casesNeeded > 0 && (
            <span className="ml-auto text-2xl font-black tabular-nums text-muted-foreground">
              {fmtComma(calc.casesCompleted)} <span className="text-lg">/ {fmtComma(v.casesNeeded)} cases</span>
            </span>
          )}
        </div>

        {/* Progress bar */}
        {v.casesNeeded > 0 && (
          <div className="h-3 rounded-full bg-muted/30 overflow-hidden -mt-2">
            <div className="h-full rounded-full bg-primary transition-all duration-1000" style={{ width: `${casesPct * 100}%` }} />
          </div>
        )}

        {/* Ingredient grid */}
        {items.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 flex-1">
            {items.map((item, i) => (
              <div key={i} className="rounded-2xl bg-card border border-border p-6 flex flex-col justify-center gap-1">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="text-5xl font-black tabular-nums text-foreground">{item.value}</p>
                {item.sub && <p className="text-base text-muted-foreground font-semibold">{item.sub}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-2xl border border-border bg-card">
            <p className="text-2xl text-muted-foreground">No frontline ingredients configured</p>
          </div>
        )}

        {/* Cheese recipe breakdown */}
        {cheeseRecipes.filter(r => r.rows.length > 0).map((recipe, i) => (
          <div key={i} className="rounded-2xl bg-card border border-border p-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">{recipe.label}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {recipe.rows.map((row, j) => (
                <div key={j} className="flex items-center justify-between gap-3">
                  <span className="text-xl font-semibold">{row.ingredient}</span>
                  <span className="text-2xl font-black tabular-nums text-primary">{fmtNum(row.lbs, 1)} lbs</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Time remaining footer */}
        {(runStatus === "running" || runStatus === "paused") && calc.adjustedTimeSec > 0 && (
          <div className="flex items-center gap-8 px-6 py-4 rounded-2xl bg-muted/20 border border-border/50 text-muted-foreground">
            <div><p className="text-xs uppercase tracking-wider">Est. Finish</p><p className="text-3xl font-black tabular-nums">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</p></div>
            <div><p className="text-xs uppercase tracking-wider">Time Left</p><p className="text-3xl font-black tabular-nums">{fmtTime(calc.adjustedTimeSec)}</p></div>
            {calc.ppm > 0 && <div><p className="text-xs uppercase tracking-wider">PPM</p><p className="text-3xl font-black tabular-nums">{fmtComma(calc.ppm)}</p></div>}
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "backline") {
    const freezerMs = Number(v.freezerTime) * 60000;
    const freezerRemainMs = runStatus === "ended" && currentRun?.endedAt && freezerMs > 0
      ? Math.max(0, currentRun.endedAt + freezerMs - nowTime.getTime())
      : 0;
    const freezerDraining = freezerRemainMs > 0;
    const freezerPct = freezerMs > 0 ? Math.max(0, 1 - freezerRemainMs / freezerMs) : 1;
    const fmm = Math.floor(freezerRemainMs / 60000);
    const fss = Math.floor((freezerRemainMs % 60000) / 1000);
    const upcomingRuns = dayState.runs.filter((_, i) => i > dayState.currentIndex);

    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-6 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Backline Station</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        {/* Current run block */}
        <div className={`rounded-3xl border p-8 flex flex-col gap-5 ${
          runStatus === "ended" && freezerDraining ? "bg-amber-950/30 border-amber-600/40"
          : runStatus === "ended" ? "bg-emerald-950/20 border-emerald-700/30"
          : runStatus === "running" ? "bg-primary/5 border-primary/30"
          : "bg-card border-border"
        }`}>
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-4xl font-black">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>
            {v.dieType && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold">{v.dieType}</span>}
            {runStatus === "running" && <span className="px-3 py-1 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-sm font-bold uppercase">Running</span>}
            {runStatus === "paused" && <span className="px-3 py-1 rounded-full bg-yellow-600/20 border border-yellow-600/40 text-yellow-400 text-sm font-bold uppercase">Paused</span>}
            {runStatus === "ended" && !freezerDraining && <span className="px-3 py-1 rounded-full bg-emerald-700/30 text-emerald-400 text-sm font-bold uppercase">Complete</span>}
          </div>

          {/* Cases progress while running */}
          {(runStatus === "running" || runStatus === "paused") && v.casesNeeded > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-end gap-4">
                <p className="text-6xl font-black tabular-nums">{fmtComma(calc.casesCompleted)}</p>
                <p className="text-3xl text-muted-foreground font-bold mb-1">/ {fmtComma(v.casesNeeded)} cases</p>
              </div>
              <div className="h-4 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-1000" style={{ width: `${casesPct * 100}%` }} />
              </div>
              <div className="flex gap-6 flex-wrap">
                {v.casesPerSkid > 0 && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Skids Done</p><p className="text-2xl font-black tabular-nums">{v.skidsCompleted}{v.casesNeeded > 0 ? ` / ${Math.floor(v.casesNeeded / v.casesPerSkid)}` : ""}</p></div>
                )}
                {calc.ppm > 0 && <div><p className="text-xs text-muted-foreground uppercase tracking-wider">PPM</p><p className="text-2xl font-black tabular-nums">{fmtComma(calc.ppm)}</p></div>}
                {currentRunDowntimeMs > 0 && <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Downtime</p><p className="text-2xl font-black tabular-nums text-amber-400">{fmtTime(currentRunDowntimeMs / 1000)}</p></div>}
              </div>
              {calc.adjustedTimeSec > 0 && (
                <div className="flex gap-8 mt-1">
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Est. Finish</p><p className="text-3xl font-black tabular-nums">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</p></div>
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Time Left</p><p className="text-3xl font-black tabular-nums">{fmtTime(calc.adjustedTimeSec)}</p></div>
                </div>
              )}
            </div>
          )}

          {/* Freezer countdown */}
          {runStatus === "ended" && freezerMs > 0 && (
            <div className="flex flex-col gap-4">
              <p className={`text-sm font-bold uppercase tracking-widest ${freezerDraining ? "text-amber-400" : "text-emerald-400"}`}>
                {freezerDraining ? "❄️ Freezer Draining" : "✅ Freezer Empty — Ready"}
              </p>
              {freezerDraining && (
                <>
                  <p className="text-[8rem] font-black tabular-nums leading-none text-amber-400">
                    {String(fmm).padStart(2, "0")}:{String(fss).padStart(2, "0")}
                  </p>
                  <div className="h-4 rounded-full bg-muted/30 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500 transition-all duration-1000" style={{ width: `${freezerPct * 100}%` }} />
                  </div>
                  <p className="text-lg text-muted-foreground">{fmtNum(Number(v.freezerTime), 0)} min total · clears at {fmtClock((currentRun?.endedAt ?? 0) + freezerMs)}</p>
                </>
              )}
              {!freezerDraining && (
                <p className="text-5xl font-black text-emerald-400">CLEAR</p>
              )}
            </div>
          )}

          {/* Ended with no freezer */}
          {runStatus === "ended" && freezerMs === 0 && (
            <p className="text-5xl font-black text-emerald-400">Run Complete</p>
          )}
        </div>

        {/* Upcoming runs */}
        {upcomingRuns.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Up Next — {upcomingRuns.length} run{upcomingRuns.length > 1 ? "s" : ""}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {upcomingRuns.map((run, i) => {
                const vals = loadRunValues(run.id);
                const s = computeSummaryStats(vals);
                const estSec = s.estimatedTimeSec;
                const dieChange = vals.dieType && v.dieType && vals.dieType !== (i === 0 ? v.dieType : loadRunValues(upcomingRuns[i - 1].id).dieType);
                return (
                  <div key={run.id} className="rounded-2xl bg-card border border-border p-5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">#{dayState.currentIndex + i + 2}</span>
                      {dieChange && <span className="text-xs font-bold text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Die change</span>}
                    </div>
                    <p className="text-2xl font-black leading-tight">{runLabel(run)}</p>
                    {vals.dieType && <span className="self-start px-2 py-0.5 rounded text-xs font-bold bg-muted/50 border border-border/50 text-muted-foreground">{vals.dieType}</span>}
                    <div className="flex gap-4 mt-auto">
                      {s.totalCases > 0 && <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cases</p><p className="text-xl font-black tabular-nums">{fmtComma(s.totalCases)}</p></div>}
                      {estSec > 0 && <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Est. Time</p><p className="text-xl font-black tabular-nums">{fmtTime(estSec)}</p></div>}
                      {vals.freezerTime && Number(vals.freezerTime) > 0 && <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Freezer</p><p className="text-xl font-black tabular-nums">{fmtNum(Number(vals.freezerTime), 0)}m</p></div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {upcomingRuns.length === 0 && runStatus === "ended" && !freezerDraining && (
          <div className="flex items-center justify-center rounded-2xl border border-border bg-card py-10">
            <p className="text-2xl text-muted-foreground">No more runs scheduled for this shift</p>
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "sauce") {
    const bd = sauceBarrelBreakdown(calc.sauceBatches, calc.sauceEffBarrel);
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-8 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Droplets className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Sauce Station</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        {/* Run name + status */}
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-4xl font-black">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>
          {v.dieType && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold">{v.dieType}</span>}
          {v.casesNeeded > 0 && (
            <span className="ml-auto text-2xl font-black tabular-nums text-muted-foreground">
              {fmtComma(calc.casesLeftToRun)} <span className="text-lg">cases left</span>
            </span>
          )}
        </div>

        {/* Big sauce display */}
        {calc.sauceBatches > 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 rounded-3xl border border-border bg-card p-12">
            <p className="text-lg font-bold uppercase tracking-widest text-muted-foreground">Sauce Needed</p>
            <p className="text-[10rem] font-black tabular-nums leading-none text-primary">{fmtNum(calc.sauceBatches, 2)}</p>
            <p className="text-3xl font-bold text-muted-foreground">batches</p>
            {bd && (
              <div className="flex items-center gap-8 text-center mt-4">
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Batches / Barrel</p>
                  <p className="text-5xl font-black tabular-nums">{bd.batchesPerBarrel}</p>
                </div>
                <p className="text-4xl text-muted-foreground font-light">→</p>
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Total Barrels</p>
                  <p className="text-5xl font-black tabular-nums text-primary">{bd.totalBarrels}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-3xl border border-border bg-card">
            <p className="text-2xl text-muted-foreground">No sauce configured for this run</p>
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "warehouse") {
    const activeRuns = dayState.runs.filter(r => !r.endedAt);
    const valsList = activeRuns.map(r => loadRunValues(r.id));
    const agg = aggregateNeedRows(valsList);
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-6 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Warehouse className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Warehouse</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        <h1 className="text-4xl font-black">Total Ingredient Needs — {activeRuns.length} active run{activeRuns.length !== 1 ? "s" : ""}</h1>

        {/* Aggregate ingredient grid */}
        {agg.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 flex-1 content-start">
            {agg.map((row, i) => (
              <div key={i} className="rounded-2xl bg-card border border-border p-6 flex flex-col justify-center gap-1">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground truncate">{row.label}</p>
                <p className="text-5xl font-black tabular-nums text-foreground">{row.value}</p>
                {row.sub && <p className="text-base text-muted-foreground font-semibold">{row.sub}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-2xl border border-border bg-card">
            <p className="text-2xl text-muted-foreground">No active runs with ingredient needs</p>
          </div>
        )}

        {/* Upcoming production schedule */}
        {scheduledDays.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Upcoming Production</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {scheduledDays.map(day => (
                <div key={day.date} className="rounded-2xl bg-card border border-border p-5 flex items-center justify-between gap-3">
                  <span className="text-2xl font-black">{day.date}</span>
                  <span className="text-lg text-muted-foreground font-semibold">{day.runCount} run{day.runCount !== 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "summary") {
    const finished = dayState.runs.filter(r => !!r.endedAt);
    const totalCases = finished.reduce((s, r) => s + (computeSummaryStats(loadRunValues(r.id)).totalCases), 0);
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-6 select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart2 className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Shift Summary</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>
        <div className="grid grid-cols-2 gap-4 flex-1">
          {dayState.runs.map((run, i) => {
            const vals = i === dayState.currentIndex ? v : loadRunValues(run.id);
            const s = computeSummaryStats(vals);
            const isCurr = i === dayState.currentIndex;
            const isDone = !!run.endedAt;
            return (
              <div key={run.id} className={`rounded-2xl border p-6 flex flex-col gap-3 ${isCurr ? "bg-primary/10 border-primary/40" : isDone ? "bg-emerald-950/20 border-emerald-700/30" : "bg-card border-border/50"}`}>
                <div className="flex items-center gap-3">
                  <p className="text-2xl font-black">{runLabel(run)}</p>
                  {vals.dieType && <span className="px-2 py-0.5 rounded text-xs font-bold bg-muted/50 border border-border text-muted-foreground">{vals.dieType}</span>}
                  <span className={`ml-auto text-xs font-bold uppercase px-2 py-0.5 rounded-full ${isCurr ? "bg-primary/20 text-primary" : isDone ? "bg-emerald-700/30 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                    {isCurr ? "Current" : isDone ? "Done" : "Upcoming"}
                  </span>
                </div>
                <div className="flex gap-6 flex-wrap">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Cases</p>
                    <p className="text-3xl font-black tabular-nums">{fmtComma(isDone && run.actualCases != null ? run.actualCases : isCurr ? calc.casesCompleted : 0)}<span className="text-lg text-muted-foreground"> / {fmtComma(s.totalCases)}</span></p>
                  </div>
                  {isCurr && calc.ppm > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">PPM</p>
                      <p className="text-3xl font-black tabular-nums">{fmtComma(calc.ppm)}</p>
                    </div>
                  )}
                  {isCurr && calc.paceStatus && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Pace</p>
                      <p className={`text-2xl font-black ${calc.paceStatus === "ahead" ? "text-emerald-400" : calc.paceStatus === "behind" ? "text-red-400" : "text-yellow-400"}`}>
                        {calc.paceStatus === "ahead" ? "AHEAD" : calc.paceStatus === "behind" ? "BEHIND" : "ON PACE"}
                        {calc.paceDelta !== 0 && <span className="text-lg text-muted-foreground ml-1">{calc.paceDelta > 0 ? "+" : ""}{fmtComma(Math.abs(calc.paceDelta))}</span>}
                      </p>
                    </div>
                  )}
                  {s.estimatedTimeSec > 0 && !isCurr && !isDone && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Est. Time</p>
                      <p className="text-2xl font-black tabular-nums">{fmtTime(s.estimatedTimeSec)}</p>
                    </div>
                  )}
                </div>
                {run.startedAt && <p className="text-xs text-muted-foreground">Started {fmtClock(run.startedAt)}{run.endedAt ? ` · Ended ${fmtClock(run.endedAt)}` : ""}</p>}
              </div>
            );
          })}
        </div>
        {finished.length > 0 && (
          <div className="flex items-center gap-8 px-6 py-4 rounded-2xl bg-card border border-border">
            <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Runs Finished</p><p className="text-4xl font-black">{finished.length}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Total Cases</p><p className="text-4xl font-black tabular-nums">{fmtComma(totalCases)}</p></div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-background text-foreground p-4 md:p-6 pb-20 font-sans"
      onTouchStart={e => { swipeTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={e => {
        if (!swipeTouchStart.current) return;
        const dx = e.changedTouches[0].clientX - swipeTouchStart.current.x;
        const dy = e.changedTouches[0].clientY - swipeTouchStart.current.y;
        swipeTouchStart.current = null;
        // Only register clear horizontal swipes: long enough, mostly horizontal, and not a scroll
        if (Math.abs(dx) < 60) return;           // must travel at least 60px horizontally
        if (Math.abs(dy) > 30) return;            // any notable vertical movement → it's a scroll
        if (Math.abs(dx) < Math.abs(dy) * 3) return; // must be 3× more horizontal than vertical
        // Don't swipe if user is interacting with an input
        if ((e.target as HTMLElement).closest("input, textarea, select, button")) return;
        if (dx < 0) { if (dayState.currentIndex < dayState.runs.length - 1) switchToRun(dayState.currentIndex + 1); }
        else { if (dayState.currentIndex > 0) switchToRun(dayState.currentIndex - 1); }
      }}
    >
      {/* ── Floor Mode overlay ──────────────────────────────────────────── */}
      {showFloorMode && (() => {
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
          ? `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
          : "—";
        const downtimeStr = currentRunDowntimeMs > 0 ? fmtTime(currentRunDowntimeMs / 1000) : "0m";
        const estFinish = calc.adjustedTimeSec > 0 && (runStatus === "running" || runStatus === "paused")
          ? fmtClock(Date.now() + calc.adjustedTimeSec * 1000)
          : "—";

        return (
          <div
            className="fixed inset-0 z-[40] flex flex-col font-sans select-none"
            style={{ background: bg, color: "white", opacity: floorDimmed ? 0.45 : 1, transition: "opacity 1200ms ease" }}
          >
            <div className="floor-drift flex flex-1 flex-col min-h-0">
            {/* Header */}
            <header className="flex justify-between items-center px-5 pt-5 pb-2 shrink-0">
              <div className="flex flex-col gap-1.5">
                <span className="text-lg font-bold" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {currentRun ? runLabel(currentRun) : "No Active Run"}
                </span>
                <span className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest" style={{ background: badge, color: badgeText }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accentColor }} />
                  {statusLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowFloorMode(false)}
                className="p-2.5 rounded-full transition-colors"
                style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}
                title="Exit floor mode"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            {/* Big three numbers */}
            <main className="flex-1 flex flex-col items-center justify-center gap-9 py-2">
              <div className="flex flex-col items-center">
                <div className="text-[96px] leading-none font-black tracking-tight tabular-nums">{fmtComma(calc.casesCompleted)}</div>
                <div className="text-sm font-bold tracking-[0.2em] mt-1.5" style={{ color: accentColor, opacity: 0.75 }}>CASES DONE</div>
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
                    className="text-[96px] leading-none font-black tracking-tight tabular-nums"
                    style={{ color: accentColor, ...(mm === 0 && ss < 120 && runStatus === "running" ? { animation: "pulse 1s ease-in-out infinite" } : {}) }}
                  >
                    {batchStr}
                  </div>
                  <div className="text-sm font-bold tracking-[0.2em] mt-1.5" style={{ color: accentColor, opacity: 0.75 }}>NEXT BATCH</div>
                </div>
              )}
            </main>

            {/* Bottom */}
            <div className="px-4 pb-6 space-y-4 shrink-0">
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
                    {chips.map(c => (
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
                  <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="text-[9px] font-bold tracking-[0.18em] mb-2" style={{ color: "rgba(255,255,255,0.25)" }}>FRONTLINE</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)` }}>
                      {items.map((item, i) => (
                        <div key={i} className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-semibold truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{item.label}</span>
                          <span className="text-sm font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.85)" }}>{item.oz} oz</span>
                          {item.value && <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{item.value}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Action buttons */}
              <div className="flex gap-3">
                {hasActiveStop ? (
                  <button
                    type="button"
                    onClick={endStop}
                    className="flex-1 h-[68px] rounded-2xl font-bold text-base flex items-center justify-center gap-2 animate-pulse transition-colors"
                    style={{ background: "rgba(234,88,12,0.5)", color: "#fed7aa", border: "1px solid rgba(234,88,12,0.4)" }}
                  >
                    <CircleDot className="w-5 h-5" /> End Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setStopReason(""); setStopNotes(""); setShowStopDialog(true); }}
                    className="flex-1 h-[68px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: "rgba(127,29,29,0.45)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    🛑 Log Stop
                  </button>
                )}
                {runStatus === "running" && (
                  <button
                    type="button"
                    onClick={pauseRun}
                    className="flex-1 h-[68px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#fbbf24", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    ⏸ Pause
                  </button>
                )}
                {runStatus === "paused" && (
                  <button
                    type="button"
                    onClick={() => setResumeDialog(true)}
                    className="flex-1 h-[68px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: "rgba(22,101,52,0.5)", color: "#86efac", border: "1px solid rgba(74,222,128,0.2)" }}
                  >
                    ▶ Resume
                  </button>
                )}
                {(runStatus === "running" || runStatus === "paused") && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.vibrate?.(15);
                      autoSuppressUntilRef.current = Date.now() + AUTO_SUPPRESS_MS;
                      form.setValue("skidsCompleted", v.skidsCompleted + 1, { shouldDirty: true });
                      form.setValue("casesOnCurrentSkid", 0, { shouldDirty: true });
                    }}
                    className="flex-[1.3] h-[68px] rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-colors"
                    style={{ background: accentBar, color: bg }}
                  >
                    ✅ Skid Done
                  </button>
                )}
              </div>
            </div>
            </div>
          </div>
        );
      })()}

      {/* ── Glance overlay ──────────────────────────────────────────────── */}
      {showGlance && (() => {
        const pct = v.casesNeeded > 0 ? Math.min(1, calc.casesCompleted / v.casesNeeded) : 0;
        return (
          <div
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm p-8 cursor-pointer select-none"
            onClick={() => setShowGlance(false)}
          >
            <div className="text-center space-y-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              {/* Run name */}
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Current Run</p>
                <p className="text-2xl font-bold">{runLabel(currentRun)}</p>
              </div>
              {/* Cases */}
              {v.casesNeeded > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Cases</p>
                  <p className="text-7xl font-black tabular-nums leading-none">{fmtComma(calc.casesCompleted)}</p>
                  <p className="text-xl text-muted-foreground mt-1">of {fmtComma(v.casesNeeded)}</p>
                  {v.casesNeeded > 0 && (
                    <div className="mt-3 h-3 rounded-full bg-muted/30 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${pct >= 1 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct * 100}%` }} />
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Cases Done</p>
                  <p className="text-7xl font-black tabular-nums leading-none">{fmtComma(calc.casesCompleted)}</p>
                </div>
              )}
              {/* Time left */}
              {(runStatus === "running" || runStatus === "paused") && calc.adjustedTimeSec > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Time Remaining</p>
                  <p className="text-5xl font-black tabular-nums">{fmtTime(calc.adjustedTimeSec)}</p>
                </div>
              )}
              {/* Pace + PPM */}
              <div className="flex items-center justify-center gap-4">
                {calc.paceStatus !== null && (
                  <span className={`text-base font-bold ${calc.paceStatus === "behind" ? "text-amber-400" : "text-emerald-400"}`}>
                    {calc.paceStatus === "on-pace" ? "✓ On Pace" : calc.paceStatus === "ahead" ? `▲ ${calc.paceDelta} ahead` : `▼ ${Math.abs(calc.paceDelta)} behind`}
                  </span>
                )}
                {calc.ppm > 0 && <span className="text-base font-bold text-muted-foreground">{calc.ppm} PPM</span>}
              </div>
            </div>
            <p className="absolute bottom-6 text-xs text-muted-foreground/50">Tap anywhere to dismiss</p>
          </div>
        );
      })()}



      {/* ── Screens / Cast Dialog ───────────────────────────────────────── */}
      {showScreensDialog && (() => {
        const base = window.location.origin + window.location.pathname;
        const screens = [
          {
            key: "dashboard",
            icon: <BarChart2 className="w-5 h-5 text-primary" />,
            title: "Dashboard",
            desc: "Wall TV / floor display — large PPM, pace, cases progress",
            url: `${base}?screen=dashboard`,
          },
          {
            key: "dough",
            icon: <Droplets className="w-5 h-5 text-blue-400" />,
            title: "Dough Station",
            desc: "Mixer display — next batch countdown, batch number, yield",
            url: `${base}?screen=dough`,
          },
          {
            key: "sauce",
            icon: <Droplets className="w-5 h-5 text-rose-400" />,
            title: "Sauce Station",
            desc: "Sauce display — batches and barrel breakdown for remaining cases",
            url: `${base}?screen=sauce`,
          },
          {
            key: "frontline",
            icon: <Layers className="w-5 h-5 text-orange-400" />,
            title: "Frontline Station",
            desc: "Topping line display — sauce, cheese, applicators, pep amounts",
            url: `${base}?screen=frontline`,
          },
          {
            key: "warehouse",
            icon: <Warehouse className="w-5 h-5 text-amber-400" />,
            title: "Warehouse",
            desc: "Total ingredient needs across all active runs + upcoming schedule",
            url: `${base}?screen=warehouse`,
          },
          {
            key: "backline",
            icon: <Clock className="w-5 h-5 text-blue-400" />,
            title: "Backline Station",
            desc: "Freezer & packaging display — current run, freezer countdown, upcoming runs",
            url: `${base}?screen=backline`,
          },
          {
            key: "summary",
            icon: <ClipboardList className="w-5 h-5 text-emerald-400" />,
            title: "Shift Summary",
            desc: "Supervisor screen — all runs, status, and day totals",
            url: `${base}?screen=summary`,
          },
        ];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowScreensDialog(false)}>
            <div className="bg-card border border-border rounded-xl p-4 w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold flex items-center gap-2"><Monitor className="w-4 h-4 text-primary" /> Cast to Screens</h3>
                <button type="button" onClick={() => setShowScreensDialog(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Open any URL below on another device or browser tab. Each screen stays live-synced automatically.</p>
              <div className="space-y-3 overflow-y-auto overscroll-contain flex-1 mt-3">
                {screens.map(s => (
                  <div key={s.key} className="flex items-start gap-4 p-4 rounded-lg bg-muted/20 border border-border/50">
                    {/* QR code */}
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(s.url)}&size=80x80&bgcolor=1a1a1a&color=ffffff&margin=4`}
                      alt={`QR for ${s.title}`}
                      className="w-20 h-20 rounded-lg shrink-0 border border-border/40"
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        {s.icon}
                        <span className="font-semibold text-sm">{s.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.desc}</p>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={s.url}
                          className="flex-1 text-xs bg-background border border-border/60 rounded px-2 py-1 font-mono text-muted-foreground truncate"
                          onFocus={e => e.target.select()}
                        />
                        <button
                          type="button"
                          onClick={() => { navigator.clipboard?.writeText(s.url); }}
                          className="px-2 py-1 rounded text-xs font-semibold bg-muted/40 border border-border hover:bg-muted/70 transition-colors shrink-0"
                        >
                          Copy
                        </button>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" /> Open
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Manage Lists Dialog ─────────────────────────────────────────── */}
      {/* ── Reorder Runs Dialog ─────────────────────────────────────────── */}
      {showReorderDialog && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
          onClick={() => setShowReorderDialog(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-primary" />
                <h2 className="font-bold text-base">Reorder Runs</h2>
              </div>
              <button type="button" onClick={() => setShowReorderDialog(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain flex-1 p-3 space-y-2">
              {dayState.runs.map((run, idx) => {
                const isCur = idx === dayState.currentIndex;
                const statusDot = run.endedAt ? "bg-emerald-400" : run.startedAt ? "bg-primary animate-pulse" : "bg-muted-foreground/40";
                return (
                  <div
                    key={run.id}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg border ${isCur ? "border-primary/40 bg-primary/10" : "border-border/40 bg-card/60"}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{runLabel(run)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {run.endedAt ? "Ended" : run.startedAt ? "In progress" : "Upcoming"} · #{idx + 1}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveRun(idx, idx - 1)}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:pointer-events-none transition-colors"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === dayState.runs.length - 1}
                        onClick={() => moveRun(idx, idx + 1)}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:pointer-events-none transition-colors"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-border shrink-0">
              <button
                type="button"
                onClick={() => setShowReorderDialog(false)}
                className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile App QR Dialog ────────────────────────────────────────── */}
      {showMobileQrDialog && (() => {
        const mobileUrl = `${window.location.origin}/mobile/`;
        return (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
            onClick={() => setShowMobileQrDialog(false)}
          >
            <div
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-primary" />
                  <h2 className="font-bold text-base">Open on your phone</h2>
                </div>
                <button type="button" onClick={() => setShowMobileQrDialog(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 flex flex-col items-center gap-4">
                <p className="text-sm text-muted-foreground text-center">
                  Scan this code with your phone's camera to jump straight to the mobile app.
                </p>
                <div className="bg-white p-4 rounded-lg">
                  <QRCode value={mobileUrl} size={200} />
                </div>
                <div className="text-xs text-muted-foreground break-all text-center font-mono">{mobileUrl}</div>
                <button
                  type="button"
                  onClick={() => window.open(mobileUrl, "_blank", "noopener,noreferrer")}
                  className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  Open in new tab
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showManageDialog && (() => {
        // Simple list panel: add input + item list
        const ListPanel = ({
          items, onAdd, onRemove, placeholder, protected: protectedItems,
          inputVal, setInputVal, onRename, onEdit, selectedItem,
        }: {
          items: string[]; onAdd: (v: string) => void; onRemove: (v: string) => void;
          placeholder: string; protected?: string[]; inputVal: string; setInputVal: (v: string) => void;
          onRename?: (oldName: string, newName: string) => void;
          onEdit?: (name: string) => void;
          selectedItem?: string | null;
        }) => {
          const [renamingItem, setRenamingItem] = useState<string | null>(null);
          const [renameVal, setRenameVal] = useState("");
          function beginRename(item: string) { setRenamingItem(item); setRenameVal(item); }
          function commitRename() {
            if (renamingItem && renameVal.trim() && renameVal.trim() !== renamingItem) {
              onRename!(renamingItem, renameVal.trim());
            }
            setRenamingItem(null); setRenameVal("");
          }
          return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && inputVal.trim()) { onAdd(inputVal.trim()); setInputVal(""); } }}
                placeholder={placeholder}
                className="flex-1 border border-input rounded-md px-3 py-1.5 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => { if (inputVal.trim()) { onAdd(inputVal.trim()); setInputVal(""); } }}
                disabled={!inputVal.trim()}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40"
              >Add</button>
            </div>
            {items.length === 0
              ? <p className="text-xs text-muted-foreground text-center py-3">No items yet.</p>
              : <ul className="space-y-1 max-h-48 overflow-y-auto overscroll-contain">
                  {items.map(item => {
                    const isProt = protectedItems?.includes(item);
                    const isRenaming = renamingItem === item;
                    const isSelected = selectedItem === item;
                    return (
                      <li key={item} className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-md transition-colors ${isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/30 hover:bg-muted/50"}`}>
                        {isRenaming ? (
                          <input
                            autoFocus
                            type="text"
                            value={renameVal}
                            onChange={e => setRenameVal(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setRenamingItem(null); setRenameVal(""); } }}
                            onBlur={commitRename}
                            className="flex-1 border border-primary rounded px-2 py-0.5 text-sm bg-background focus:outline-none"
                          />
                        ) : (
                          <span className="text-sm flex-1">{item}</span>
                        )}
                        {isProt
                          ? <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">default</span>
                          : isRenaming
                          ? <button type="button" onClick={commitRename} className="text-primary hover:text-primary/80 shrink-0"><Check className="w-3.5 h-3.5" /></button>
                          : <div className="flex items-center gap-1 shrink-0">
                              {onEdit && <button type="button" title="View / edit recipe" onClick={() => onEdit(item)} className={`${isSelected ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}><ClipboardList className="w-3.5 h-3.5" /></button>}
                              {onRename && <button type="button" onClick={() => beginRename(item)} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3 h-3" /></button>}
                              <button type="button" onClick={() => onRemove(item)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                            </div>}
                      </li>
                    );
                  })}
                </ul>
            }
          </div>
          );
        };

        // Grouped panel: recipe names (left) + ingredients (right)
        const GroupedPanel = ({
          namesLabel, names, onAddName, onRemoveName, onRenameName, onEditName, selectedName,
          ingLabel, ingredients, onAddIng, onRemoveIng, onRenameIng,
          ingProtected,
        }: {
          namesLabel: string; names: string[]; onAddName: (v: string) => void; onRemoveName: (v: string) => void; onRenameName?: (o: string, n: string) => void; onEditName?: (n: string) => void; selectedName?: string | null;
          ingLabel: string; ingredients: string[]; onAddIng: (v: string) => void; onRemoveIng: (v: string) => void; onRenameIng?: (o: string, n: string) => void;
          ingProtected?: string[];
        }) => (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{namesLabel}</p>
              <ListPanel items={names} onAdd={onAddName} onRemove={onRemoveName} onRename={onRenameName} onEdit={onEditName} selectedItem={selectedName} placeholder="Add name…" inputVal={mgNamesInput} setInputVal={setMgNamesInput} />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{ingLabel}</p>
              <ListPanel items={ingredients} onAdd={onAddIng} onRemove={onRemoveIng} onRename={onRenameIng} placeholder="Add ingredient…" protected={ingProtected} inputVal={mgIngInput} setInputVal={setMgIngInput} />
            </div>
          </div>
        );

        // Standalone tabs: still use a single input
        // History instrumentation wrappers: snapshot before the edit, run it, then
        // record (recordMasterDataChange skips no-ops). This is the single point
        // where every manageable list add/remove/rename gets an undo entry — the
        // merge and PIN tabs are intentionally not wrapped (merge records itself;
        // PIN isn't master data).
        const histAdd = (label: string, fn: (v: string) => void) => (v: string) => {
          const before = captureMasterDataSnapshot();
          fn(v);
          noteChange("add", `Added "${v}" to ${label}`, before);
        };
        const histRemove = (label: string, fn: (v: string) => void) => (v: string) => {
          const before = captureMasterDataSnapshot();
          fn(v);
          noteChange("remove", `Removed "${v}" from ${label}`, before);
        };
        const histRename = (label: string, fn: (o: string, n: string) => void) => (o: string, n: string) => {
          const before = captureMasterDataSnapshot();
          fn(o, n);
          noteChange("rename", `Renamed "${o}" to "${n}" in ${label}`, before);
        };
        type StandaloneTab = { key: string; label: string; items: string[]; protected?: string[]; onAdd: (v: string) => void; onRemove: (v: string) => void; onRename?: (o: string, n: string) => void; };
        const standaloneTabs: StandaloneTab[] = [
          { key: "brands", label: "Brands", items: brands, onAdd: histAdd("Brands", addBrand), onRemove: histRemove("Brands", removeBrand), onRename: histRename("Brands", renameBrand) },
          { key: "flavors", label: "Flavors", items: manageBrandFilter ? (brandFlavors[manageBrandFilter] ?? []) : [], onAdd: histAdd("Flavors", (v) => addFlavor(v, manageBrandFilter)), onRemove: histRemove("Flavors", (v) => removeFlavor(v, manageBrandFilter)), onRename: histRename("Flavors", (o, n) => renameFlavor(o, n, manageBrandFilter)) },
          { key: "ingredientTypes", label: "Applicator Types", items: ingredientTypes, onAdd: histAdd("Applicator Types", addIngredientType), onRemove: histRemove("Applicator Types", removeIngredientType), onRename: histRename("Applicator Types", renameIngredientType) },
          { key: "pepTypes", label: "Pep Types", items: pepTypes, protected: [...DEFAULT_PEP_TYPES], onAdd: histAdd("Pep Types", addPepType), onRemove: histRemove("Pep Types", removePepType), onRename: histRename("Pep Types", renamePepType) },
          { key: "dieTypes", label: "Die Types", items: dieTypes, protected: [...DEFAULT_DIE_TYPES], onAdd: histAdd("Die Types", addDieType), onRemove: histRemove("Die Types", removeDieType), onRename: histRename("Die Types", renameDieType) },
          { key: "merge", label: "Merge", items: [], onAdd: () => {}, onRemove: () => {} },
          { key: "pin", label: "Change PIN", items: [], onAdd: () => {}, onRemove: () => {} },
        ];
        const groupedTabs = [
          { key: "dough",   label: "Dough",  namesLabel: "Recipe Names", names: doughRecipeNames,     onAddName: histAdd("Dough Recipe Names", addDoughRecipeName),     onRemoveName: histRemove("Dough Recipe Names", removeDoughRecipeName),     onRenameName: histRename("Dough Recipe Names", renameDoughRecipeName),     ingLabel: "Ingredients", ingredients: doughIngredients,     onAddIng: histAdd("Dough Ingredients", addDoughIngredient),     onRemoveIng: histRemove("Dough Ingredients", removeDoughIngredient),     onRenameIng: histRename("Dough Ingredients", renameDoughIngredient) },
          { key: "sauce",   label: "Sauce",  namesLabel: "Recipe Names", names: frontlineRecipeNames, onAddName: histAdd("Sauce Recipe Names", addFrontlineRecipeName), onRemoveName: histRemove("Sauce Recipe Names", removeFrontlineRecipeName), onRenameName: histRename("Sauce Recipe Names", renameFrontlineRecipeName), ingLabel: "Ingredients", ingredients: frontlineIngredients, onAddIng: histAdd("Sauce Ingredients", addFrontlineIngredient), onRemoveIng: histRemove("Sauce Ingredients", removeFrontlineIngredient), onRenameIng: histRename("Sauce Ingredients", renameFrontlineIngredient) },
          { key: "cheese",  label: "Cheese", namesLabel: "Recipe Names", names: cheeseRecipeNames,    onAddName: histAdd("Cheese Recipe Names", addCheeseRecipeName),    onRemoveName: histRemove("Cheese Recipe Names", removeCheeseRecipeName),    onRenameName: histRename("Cheese Recipe Names", renameCheeseRecipeName),    ingLabel: "Ingredients", ingredients: cheeseIngredients,    onAddIng: histAdd("Cheese Ingredients", addCheeseIngredient),   onRemoveIng: histRemove("Cheese Ingredients", removeCheeseIngredient),   onRenameIng: histRename("Cheese Ingredients", renameCheeseIngredient) },
          { key: "mix",     label: "Mix",    namesLabel: "Recipe Names", names: mixRecipeNames,       onAddName: histAdd("Mix Recipe Names", addMixRecipeName),       onRemoveName: histRemove("Mix Recipe Names", removeMixRecipeName),       onRenameName: histRename("Mix Recipe Names", renameMixRecipeName),       ingLabel: "Ingredients", ingredients: mixIngredients,       onAddIng: histAdd("Mix Ingredients", addMixIngredient),      onRemoveIng: histRemove("Mix Ingredients", removeMixIngredient),      onRenameIng: histRename("Mix Ingredients", renameMixIngredient) },
        ];

        const settingsTabs: { key: string; label: string }[] = [
          { key: "import", label: "Import" },
          ...(canEditRules ? [{ key: "rules", label: "Rules" }] : []),
          ...(canManageInventory ? [{ key: "freezer", label: "Freezer Pull" }] : []),
          ...(canManageInventory ? [{ key: "mixes", label: "Mixes" }] : []),
          ...(canManageInventory ? [{ key: "cycleCount", label: "Cycle Counts" }] : []),
          ...(canManageStaff || canApproveResets ? [{ key: "staff", label: "Staff" }] : []),
        ];
        const allTabs = [...groupedTabs, ...standaloneTabs];
        const isGrouped = groupedTabs.some(t => t.key === manageCategory);
        const groupedTab = groupedTabs.find(t => t.key === manageCategory);
        const standaloneTab = standaloneTabs.find(t => t.key === manageCategory);

        // Preset config per grouped tab: ingredient list + load/save helpers
        const presetConfig = (() => {
          const base: Record<string, { ingOptions: string[]; load: (n: string) => RecipeRow[]; save: (n: string, rows: RecipeRow[]) => void }> = {
            dough:  { ingOptions: doughIngredients,     load: (n) => loadDoughRecipePresets()[n]?.rows ?? [],    save: (n, rows) => { const p = loadDoughRecipePresets(); p[n] = { rows }; saveDoughRecipePresets(p); schedulePush(dayStateRef.current); } },
            sauce:  { ingOptions: frontlineIngredients, load: (n) => loadFrontlineRecipePresets()[n] ?? [],      save: (n, rows) => { const p = loadFrontlineRecipePresets(); p[n] = rows; saveFrontlineRecipePresets(p); schedulePush(dayStateRef.current); } },
            cheese: { ingOptions: cheeseIngredients,    load: (n) => loadCheeseRecipePresets()[n] ?? [],         save: (n, rows) => { const p = loadCheeseRecipePresets(); p[n] = rows; saveCheeseRecipePresets(p); schedulePush(dayStateRef.current); } },
            mix:    { ingOptions: mixIngredients,       load: (n) => loadCheeseRecipePresets()[n] ?? [],         save: (n, rows) => { const p = loadCheeseRecipePresets(); p[n] = rows; saveCheeseRecipePresets(p); schedulePush(dayStateRef.current); } },
          };
          return base[manageCategory] ?? null;
        })();

        function selectPreset(name: string) {
          if (name === mgSelectedPreset) { setMgSelectedPreset(null); setMgPresetRows([]); return; }
          setMgSelectedPreset(name);
          setMgPresetRows(presetConfig?.load(name) ?? []);
        }
        function updatePresetRow(i: number, field: "ingredient" | "lbs", val: string | number) {
          const newRows = mgPresetRows.map((r, idx) => idx === i ? { ...r, [field]: field === "lbs" ? Number(val) : val } : r);
          setMgPresetRows(newRows);
          if (mgSelectedPreset) presetConfig?.save(mgSelectedPreset, newRows);
        }
        function addPresetRow() {
          const first = presetConfig?.ingOptions[0] ?? "";
          const newRows = [...mgPresetRows, { ingredient: first, lbs: 0 }];
          setMgPresetRows(newRows);
          if (mgSelectedPreset) presetConfig?.save(mgSelectedPreset, newRows);
        }
        function removePresetRow(i: number) {
          const newRows = mgPresetRows.filter((_, idx) => idx !== i);
          setMgPresetRows(newRows);
          if (mgSelectedPreset) presetConfig?.save(mgSelectedPreset, newRows);
        }

        const handlePinSave = () => {
          if (!newPin) { setPinChangeMsg("Enter a new PIN."); return; }
          if (newPin !== newPinConfirm) { setPinChangeMsg("PINs don't match."); return; }
          updateSupervisorPin(newPin)
            .then((saved) => {
              try { localStorage.setItem(SUPERVISOR_PIN_KEY, saved); } catch {}
              cycleCountQc.setQueryData(["supervisorPin"], saved);
              setNewPin(""); setNewPinConfirm("");
              setPinChangeMsg("PIN updated successfully.");
            })
            .catch((err) => {
              setPinChangeMsg(
                err instanceof Error && /\b403\b/.test(err.message)
                  ? "Only a manager can change the supervisor PIN."
                  : "Couldn't update the PIN. Try again.",
              );
            });
        };

        // Clear the facility PIN ("" = no gate, unlocked everywhere). Mirrors the
        // mobile "Remove PIN lock" action; manager-gated server-side.
        const handlePinClear = () => {
          updateSupervisorPin("")
            .then((saved) => {
              try { localStorage.setItem(SUPERVISOR_PIN_KEY, saved); } catch {}
              cycleCountQc.setQueryData(["supervisorPin"], saved);
              setNewPin(""); setNewPinConfirm("");
              setPinChangeMsg("PIN removed — settings are now unlocked.");
            })
            .catch((err) => {
              setPinChangeMsg(
                err instanceof Error && /\b403\b/.test(err.message)
                  ? "Only a manager can change the supervisor PIN."
                  : "Couldn't update the PIN. Try again.",
              );
            });
        };

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowManageDialog(false)}
          >
            <div
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" />
                  <h2 className="font-bold text-base">Manage Lists & Settings</h2>
                </div>
                <button type="button" onClick={() => setShowManageDialog(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tab row — grouped first, then standalone */}
              <div className="flex gap-1 flex-wrap px-5 py-3 border-b border-border shrink-0">
                {groupedTabs.map(t => (
                  <button key={t.key} type="button"
                    onClick={() => { setManageCategory(t.key); setManageInput(""); setPinChangeMsg(""); setMgSelectedPreset(null); }}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${manageCategory === t.key ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                  >{t.label}</button>
                ))}
                <span className="w-px bg-border/60 self-stretch mx-1" />
                {standaloneTabs.map(t => (
                  <button key={t.key} type="button"
                    onClick={() => { setManageCategory(t.key); setManageInput(""); setPinChangeMsg(""); setMgSelectedPreset(null); }}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${manageCategory === t.key ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                  >{t.label}</button>
                ))}
                {settingsTabs.length > 0 && <span className="w-px bg-border/60 self-stretch mx-1" />}
                {settingsTabs.map(t => (
                  <button key={t.key} type="button"
                    onClick={() => { setManageCategory(t.key); setManageInput(""); setPinChangeMsg(""); setMgSelectedPreset(null); }}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${manageCategory === t.key ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                  >{t.label}</button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                {/* Grouped panel (Dough / Sauce / Cheese / Mix) */}
                {isGrouped && groupedTab && (
                  <div className="space-y-4">
                    <GroupedPanel
                      namesLabel={groupedTab.namesLabel}
                      names={groupedTab.names}
                      onAddName={groupedTab.onAddName}
                      onRemoveName={groupedTab.onRemoveName}
                      onRenameName={(groupedTab as any).onRenameName}
                      onEditName={selectPreset}
                      selectedName={mgSelectedPreset}
                      ingLabel={groupedTab.ingLabel}
                      ingredients={groupedTab.ingredients}
                      onAddIng={groupedTab.onAddIng}
                      onRemoveIng={groupedTab.onRemoveIng}
                      onRenameIng={(groupedTab as any).onRenameIng}
                    />

                    {/* Recipe ingredient editor */}
                    {mgSelectedPreset && presetConfig && (
                      <div className="border border-primary/30 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border-b border-primary/20">
                          <div className="flex items-center gap-2">
                            <ClipboardList className="w-3.5 h-3.5 text-primary" />
                            <span className="text-xs font-semibold text-primary">{mgSelectedPreset}</span>
                            <span className="text-[10px] text-muted-foreground">(click ingredient to edit, lbs is per batch)</span>
                          </div>
                          <button type="button" onClick={() => { setMgSelectedPreset(null); setMgPresetRows([]); }} className="text-muted-foreground hover:text-foreground">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="p-3 space-y-1.5">
                          {mgPresetRows.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-2">No ingredients saved yet — add a row below.</p>
                          )}
                          {mgPresetRows.map((row, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <select
                                value={row.ingredient}
                                onChange={e => updatePresetRow(i, "ingredient", e.target.value)}
                                className="flex-1 border border-input rounded px-2 py-1 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                              >
                                {row.ingredient === "" && <option value="">— ingredient —</option>}
                                {presetConfig.ingOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={row.lbs === 0 ? "" : row.lbs}
                                onChange={e => updatePresetRow(i, "lbs", e.target.value)}
                                placeholder="0"
                                className="w-20 border border-input rounded px-2 py-1 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring text-right"
                              />
                              <span className="text-xs text-muted-foreground shrink-0">lbs</span>
                              <button type="button" onClick={() => removePresetRow(i)} className="text-muted-foreground hover:text-destructive shrink-0">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addPresetRow}
                            className="mt-1 flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add ingredient row
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Standalone: flavors brand picker */}
                {manageCategory === "flavors" && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Select brand to manage its flavors</label>
                      <select
                        value={manageBrandFilter}
                        onChange={e => { setManageBrandFilter(e.target.value); setMgStandaloneInput(""); }}
                        className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="">— choose a brand —</option>
                        {brands.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    {manageBrandFilter && standaloneTab && (
                      <ListPanel
                        items={standaloneTab.items}
                        onAdd={(v) => { standaloneTab.onAdd(v); setMgStandaloneInput(""); }}
                        onRemove={standaloneTab.onRemove}
                        onRename={standaloneTab.onRename}
                        placeholder={`Add flavor for ${manageBrandFilter}…`}
                        inputVal={mgStandaloneInput}
                        setInputVal={setMgStandaloneInput}
                      />
                    )}
                  </div>
                )}

                {/* Standalone: Merge ingredients */}
                {manageCategory === "merge" && (
                  <div className="space-y-4">
                    {mergeFromImport && (
                      <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5">
                        <p className="text-xs text-foreground">
                          Recipes were imported. Since recipe ingredients can also be used on
                          their own, we checked them for possible duplicates below — review any
                          suggestions before they become separate items.
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Combine duplicate or similar ingredients into one. Pick the ingredient(s)
                      to merge away (sources), then the one to keep (target). Every recipe,
                      list, preset, profile, run, template and history entry is updated, and
                      inventory stock is folded into the target. This can't be undone.
                    </p>

                    {/* AI + learned-memory suggestions: scan the whole list for
                        duplicate groups and let the user review before merging. */}
                    {mergeUniverse.length > 0 && (
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-foreground">Suggested merges</p>
                            <p className="text-[11px] text-muted-foreground">
                              Scan for likely duplicates and previously-merged names.
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={mergeSuggestBusy || mergeBusy}
                            onClick={() => handleSuggestMerges()}
                            className="px-3 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                          >{mergeSuggestBusy ? "Scanning…" : "Suggest with AI"}</button>
                        </div>

                        {mergeSuggestError && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-500">{mergeSuggestError}</p>
                        )}
                        {mergeSuggestRan && !mergeSuggestBusy && mergeSuggestions.length === 0 && !mergeSuggestError && (
                          <p className="text-[11px] text-muted-foreground">
                            {mergeSuggestNote || "No duplicate groups found."}
                          </p>
                        )}

                        {mergeSuggestions.length > 0 && (
                          <div className="space-y-2">
                            {mergeSuggestions.map((s, i) => {
                              const sources = s.sources.filter(n => n !== s.target);
                              if (sources.length === 0) return null;
                              return (
                                <div key={`${s.target}-${i}`} className="rounded-md border border-border bg-background/60 px-2.5 py-2 space-y-1">
                                  <p className="text-xs">
                                    <span className="text-muted-foreground">{sources.join(", ")}</span>
                                    {" → "}
                                    <span className="font-semibold text-primary">{s.target}</span>
                                  </p>
                                  {s.reason && (
                                    <p className="text-[11px] text-muted-foreground">{s.reason}</p>
                                  )}
                                  {s.review && <ReviewBadge review={s.review} />}
                                  <div className="flex items-center gap-2 pt-0.5">
                                    <button
                                      type="button"
                                      disabled={mergeBusy || mergeSuggestBusy}
                                      onClick={() => loadMergeSuggestion(s)}
                                      className="px-2.5 py-1 rounded border border-border text-[11px] font-medium hover:bg-muted transition-colors disabled:opacity-50"
                                    >Load</button>
                                    <button
                                      type="button"
                                      disabled={mergeBusy || mergeSuggestBusy}
                                      onClick={() => applyMergeSuggestion(s)}
                                      className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                                    >Apply</button>
                                    <button
                                      type="button"
                                      disabled={mergeBusy || mergeSuggestBusy}
                                      onClick={() => ignoreMergeSuggestion(s)}
                                      title="Never suggest merging these again"
                                      className="px-2.5 py-1 rounded border border-border text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 ml-auto"
                                    >Ignore</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {mergeUniverse.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No ingredients to merge yet.</p>
                    ) : (
                      <div ref={mergeFormRef} className="space-y-4 scroll-mt-2">
                        {/* Sources */}
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Merge these (sources)</p>
                          <div className="border border-border rounded-lg max-h-48 overflow-y-auto overscroll-contain divide-y divide-border/40">
                            {mergeUniverseRanked.map(name => {
                              const checked = mergeSources.includes(name);
                              const isTarget = name === mergeTarget.trim();
                              return (
                                <label
                                  key={name}
                                  className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 ${isTarget ? "opacity-40" : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={isTarget || mergeBusy}
                                    onChange={() => toggleMergeSource(name)}
                                    className="accent-primary"
                                  />
                                  <span className={checked ? "font-semibold text-primary" : ""}>{name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Target */}
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Keep this one (target)</p>
                          <input
                            list="merge-target-options"
                            value={mergeTarget}
                            disabled={mergeBusy}
                            onChange={e => { setMergeTarget(e.target.value); setMergeConfirming(false); setMergeError(""); }}
                            placeholder="Type or pick the ingredient to keep…"
                            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <datalist id="merge-target-options">
                            {mergeUniverseRanked.map(name => <option key={name} value={name} />)}
                          </datalist>
                        </div>

                        {mergeError && (
                          <p className="text-xs text-destructive font-medium">{mergeError}</p>
                        )}

                        {/* Preview / confirm */}
                        {Object.keys(mergeMap).length > 0 && (
                          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-1">
                            <p className="text-xs">
                              Merging{" "}
                              <span className="font-semibold text-primary">{Object.keys(mergeMap).join(", ")}</span>
                              {" "}→{" "}
                              <span className="font-semibold text-primary">{mergeTarget.trim()}</span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {mergePreviewCount} reference{mergePreviewCount === 1 ? "" : "s"} will be updated.
                              Inventory stock for merged items folds into the target.
                            </p>
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={mergeBusy}
                            onClick={resetMergeForm}
                            className="px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                          >Clear</button>
                          {!mergeConfirming ? (
                            <button
                              type="button"
                              disabled={Object.keys(mergeMap).length === 0 || mergeBusy}
                              onClick={() => { setMergeError(""); setMergeConfirming(true); }}
                              className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >Merge…</button>
                          ) : (
                            <button
                              type="button"
                              disabled={mergeBusy}
                              onClick={() => handleApplyMerge()}
                              className="flex-1 px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50"
                            >{mergeBusy ? "Merging…" : "Confirm merge"}</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Standalone: PIN change */}
                {manageCategory === "pin" && (
                  <div className="space-y-3 max-w-xs mx-auto">
                    <p className="text-xs text-muted-foreground">Set a new supervisor PIN. It must match in both fields.</p>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">New PIN</label>
                      <input type="password" value={newPin} onChange={e => { setNewPin(e.target.value); setPinChangeMsg(""); }} placeholder="New PIN" maxLength={8}
                        className="w-full font-mono text-center text-xl tracking-[0.3em] border border-input rounded-md h-11 bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Confirm PIN</label>
                      <input type="password" value={newPinConfirm} onChange={e => { setNewPinConfirm(e.target.value); setPinChangeMsg(""); }} placeholder="Confirm PIN" maxLength={8}
                        onKeyDown={e => e.key === "Enter" && handlePinSave()}
                        className="w-full font-mono text-center text-xl tracking-[0.3em] border border-input rounded-md h-11 bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    {pinChangeMsg && (
                      <p className={`text-xs text-center font-medium ${pinChangeMsg.includes("success") ? "text-green-400" : "text-destructive"}`}>{pinChangeMsg}</p>
                    )}
                    <button type="button" onClick={handlePinSave}
                      className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                      Save PIN
                    </button>
                    {serverPin ? (
                      <button type="button" onClick={handlePinClear}
                        className="w-full px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground">
                        Remove PIN lock
                      </button>
                    ) : (
                      <p className="text-xs text-center text-muted-foreground">No PIN set — all settings are unlocked.</p>
                    )}
                  </div>
                )}

                {/* Standalone: simple list tabs (Brands, Applicator Ingredients, Pep Types, Die Types) */}
                {!isGrouped && manageCategory !== "flavors" && manageCategory !== "pin" && manageCategory !== "merge" && standaloneTab && (
                  <ListPanel
                    items={standaloneTab.items}
                    onAdd={(v) => { standaloneTab.onAdd(v); setMgStandaloneInput(""); }}
                    onRemove={standaloneTab.onRemove}
                    onRename={standaloneTab.onRename}
                    placeholder={`Add to ${standaloneTab.label}…`}
                    protected={standaloneTab.protected}
                    inputVal={mgStandaloneInput}
                    setInputVal={setMgStandaloneInput}
                  />
                )}

                {/* Import (spec sheet + excel) */}
                {manageCategory === "import" && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">Import spec sheets &amp; recipes, or a production schedule, from an Excel workbook.</p>
                    {isManager && (
                      <button type="button" onClick={() => specImportInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                        <Upload className="w-4 h-4" /> Import Spec Sheet
                      </button>
                    )}
                    <button type="button" onClick={() => importInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-border bg-muted/40 text-sm font-semibold hover:bg-muted">
                      <Upload className="w-4 h-4" /> Import Excel
                    </button>
                  </div>
                )}

                {/* Rules */}
                {manageCategory === "rules" && canEditRules && <ProductionRulesManager />}

                {/* Freezer-pull items */}
                {manageCategory === "freezer" && canManageInventory && (
                  <FreezerPullItemsManager
                    suggestions={[
                      ...doughIngredients,
                      ...frontlineIngredients,
                      ...cheeseIngredients,
                      ...mixIngredients,
                      ...ingredientTypes,
                      ...pepTypes,
                    ]}
                  />
                )}

                {/* Mixes (pre-blended mix definitions) */}
                {manageCategory === "mixes" && canManageInventory && (
                  <div className="space-y-3">
                    {isManager && (
                      <button type="button" onClick={() => premixImportInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                        <Upload className="w-4 h-4" /> Import Premix Sheet
                      </button>
                    )}
                    <MixesManager
                      brands={brands}
                      brandFlavors={brandFlavors}
                      ingredientSuggestions={[
                        ...doughIngredients,
                        ...frontlineIngredients,
                        ...cheeseIngredients,
                        ...mixIngredients,
                        ...ingredientTypes,
                        ...pepTypes,
                      ]}
                    />
                    <MixReconcilePanel isManager={isManager} />
                    <MixAssistChat />
                  </div>
                )}

                {/* Cycle-count schedules */}
                {manageCategory === "cycleCount" && canManageInventory && (
                  <CycleCountManager suggestions={DEFAULT_CYCLE_COUNT_SECTIONS} />
                )}

                {/* Staff (roster + roles) */}
                {manageCategory === "staff" && (canManageStaff || canApproveResets) && (
                  <div className="space-y-4">
                    <StaffRolesCard />
                    <RolesManager />
                  </div>
                )}

                {/* Recent changes: local per-device undo trail for master-data edits */}
                {!["pin", "import", "rules", "staff"].includes(manageCategory) && (
                  <div className="mt-6 pt-4 border-t border-border">
                    <h3 className="text-sm font-semibold mb-1">Recent changes</h3>
                    <p className="text-[11px] text-muted-foreground mb-3">
                      Edits to lists, recipes, and merges on this device. Undo also reverts any changes made after it. (Stored locally, not synced.)
                    </p>
                    {changeHistory.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No recent changes.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {changeHistory.map((entry) => (
                          <div key={entry.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-border bg-background/40">
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
                              entry.type === "merge" ? "bg-amber-500/20 text-amber-300"
                              : entry.type === "remove" ? "bg-destructive/20 text-destructive"
                              : entry.type === "rename" ? "bg-sky-500/20 text-sky-300"
                              : "bg-emerald-500/20 text-emerald-300"
                            }`}>{entry.type}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs truncate" title={entry.description}>{entry.description}</p>
                              <p className="text-[10px] text-muted-foreground">{new Date(entry.ts).toLocaleString()}</p>
                            </div>
                            <button
                              type="button"
                              disabled={undoBusy}
                              onClick={() => handleUndoChange(entry)}
                              className="shrink-0 px-2.5 py-1 rounded border border-border text-[11px] font-medium hover:bg-muted transition-colors disabled:opacity-50"
                            >Undo</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── PIN Dialog ─────────────────────────────────────────────────── */}
      {showPinDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => { setShowPinDialog(false); setPinInput(""); setPinError(""); }}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-xs space-y-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center">
              <ShieldCheck className="w-9 h-9 mx-auto mb-2 text-primary" />
              <h2 className="font-bold text-lg">Supervisor Access</h2>
              <p className="text-xs text-muted-foreground mt-1">Enter the supervisor PIN to unlock all settings</p>
            </div>
            <input
              type="password"
              value={pinInput}
              onChange={e => { setPinInput(e.target.value); setPinError(""); }}
              onKeyDown={e => e.key === "Enter" && checkPin()}
              className="w-full text-center font-mono text-2xl tracking-[0.4em] border border-input rounded-md h-12 bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="••••"
              autoFocus
              maxLength={8}
            />
            {pinError && <p className="text-xs text-destructive text-center font-medium">{pinError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowPinDialog(false); setPinInput(""); setPinError(""); }}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
              >Cancel</button>
              <button
                type="button"
                onClick={checkPin}
                className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >Unlock</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-5">
        {/* ─── RUN SELECTOR ─── */}
        <div className="print:hidden flex justify-center">
          {/* Current run — brand + flavor pickers */}
          <div className="flex flex-col items-center gap-2 px-4 py-2 rounded-lg bg-primary/15 border border-primary/30 w-full max-w-lg">
            <div className="text-[9px] uppercase tracking-widest text-primary/70 font-semibold">Current Run</div>
            <div className="flex items-center gap-2">

              {/* Brand picker */}
              <div className="relative">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-0.5 text-center">Brand</div>
                <div className="relative">
                  <input
                    value={showBrandDrop ? brandInput : (currentRun?.brand ?? "")}
                    placeholder="Brand…"
                    className="w-28 bg-background/60 border border-border/60 rounded px-2 py-1 text-sm font-semibold text-center outline-none focus:border-primary cursor-pointer"
                    readOnly={!showBrandDrop}
                    onClick={() => {
                      setBrandInput(currentRun?.brand ?? "");
                      setShowBrandDrop(true);
                      setShowFlavorDrop(false);
                    }}
                    onChange={(e) => setBrandInput(e.target.value)}
                    onKeyDown={(e) => {
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
                    <div className="absolute z-50 top-full mt-1 left-0 w-44 bg-popover border border-border rounded-md shadow-lg py-1 max-h-52 overflow-y-auto overscroll-contain">
                      {brands
                        .filter((b) => b.toLowerCase().includes(brandInput.toLowerCase()))
                        .map((b) =>
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
                                className={`flex-1 text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${currentRun?.brand === b ? "text-primary font-semibold" : ""}`}
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
                          <Plus className="w-3 h-3" /> Add "{brandInput.trim()}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="text-muted-foreground/40 text-lg font-light">–</div>

              {/* Flavor picker */}
              <div className="relative">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-0.5 text-center">Flavor</div>
                <div className="relative">
                  <input
                    value={showFlavorDrop ? flavorInput : (currentRun?.flavor ?? "")}
                    placeholder="Flavor…"
                    className="w-28 bg-background/60 border border-border/60 rounded px-2 py-1 text-sm font-semibold text-center outline-none focus:border-primary cursor-pointer"
                    readOnly={!showFlavorDrop}
                    onClick={() => {
                      setFlavorInput(currentRun?.flavor ?? "");
                      setShowFlavorDrop(true);
                      setShowBrandDrop(false);
                    }}
                    onChange={(e) => setFlavorInput(e.target.value)}
                    onKeyDown={(e) => {
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
                    <div className="absolute z-50 top-full mt-1 left-0 w-44 bg-popover border border-border rounded-md shadow-lg py-1 max-h-52 overflow-y-auto overscroll-contain">
                      {!(currentRun?.brand) && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">Pick a brand first</p>
                      )}
                      {(brandFlavors[currentRun?.brand ?? ""] ?? [])
                        .filter((f) => f.toLowerCase().includes(flavorInput.toLowerCase()))
                        .map((f) =>
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
                                className={`flex-1 text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${currentRun?.flavor === f ? "text-primary font-semibold" : ""}`}
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
                          <Plus className="w-3 h-3" /> Add "{flavorInput.trim()}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Cases Needed — editable by all, plain input outside Form context */}
            <div className="px-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Cases Needed</label>
              <input
                type="number"
                min="0"
                step="1"
                value={v.casesNeeded === 0 ? "" : v.casesNeeded}
                onChange={e => form.setValue("casesNeeded", Number(e.target.value) || 0, { shouldDirty: true })}
                placeholder="0"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              {Number(v.casesNeeded) === 0 && (
                <p className="mt-1 text-xs font-medium text-amber-400 flex items-center gap-1">
                  <span>⚠</span> Enter cases needed to enable calculations
                </p>
              )}
            </div>

            {/* Last-run recall hint */}
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

            {/* Run status + Start/End buttons */}
            <div className="flex items-center gap-2">
              {runStatus === "pending" && (
                <button
                  type="button"
                  onClick={startRun}
                  disabled={blockingViolations.length > 0}
                  title={
                    blockingViolations.length > 0
                      ? `Blocked by production rule${blockingViolations.length > 1 ? "s" : ""}: ${blockingViolations.map(x => x.name).join(", ")}`
                      : undefined
                  }
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-600"
                >
                  <Play className="w-3 h-3 fill-current" /> Start Run
                </button>
              )}
              {runStatus === "running" && (
                <>
                  <span className="flex items-center gap-1.5 text-xs text-green-400 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse shrink-0" />
                    <span className="hidden sm:inline">Running</span>
                    {currentRun?.startedAt ? (
                      <span className="text-green-400/70 font-normal hidden sm:inline">
                        · {fmtElapsed(nowTime.getTime() - currentRun.startedAt + (currentRun.pausedAt ? nowTime.getTime() - currentRun.pausedAt : 0))}
                      </span>
                    ) : null}
                  </span>
                  {activeStopId ? (
                    <button
                      type="button"
                      onClick={endStop}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold transition-colors animate-pulse"
                    >
                      <CircleDot className="w-3 h-3" /> End Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setStopReason(""); setStopNotes(""); setShowStopDialog(true); }}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-orange-700/60 text-orange-400 hover:bg-orange-950/40 text-xs font-semibold transition-colors"
                    >
                      <OctagonX className="w-3 h-3" /> <span className="hidden sm:inline">Log Stop</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={pauseRun}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
                  >
                    <Pause className="w-3 h-3 fill-current" /> <span className="hidden sm:inline">Pause</span>
                  </button>
                  <button
                    type="button"
                    onClick={endRun}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-700 hover:bg-red-600 text-white text-xs font-semibold transition-colors"
                  >
                    <Square className="w-3 h-3 fill-current" /> <span className="hidden sm:inline">Stop Run</span>
                  </button>
                </>
              )}
              {runStatus === "paused" && (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                    Paused
                  </span>
                  {resumeDialog ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground font-medium">Freezer empty?</span>
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors"
                        onClick={() => { resumeRun(true); setResumeDialog(false); }}
                      >Yes</button>
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded bg-muted hover:bg-muted/70 text-muted-foreground text-xs font-semibold transition-colors"
                        onClick={() => { resumeRun(false); setResumeDialog(false); }}
                      >No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setResumeDialog(true)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" /> Resume
                    </button>
                  )}
                </div>
              )}
              {runStatus === "ended" && (() => {
                const emptyMs = Number(v.freezerTime) * 60000;
                const remainMs = lastEndedRun?.endedAt && emptyMs > 0
                  ? Math.max(0, lastEndedRun.endedAt + emptyMs - nowTime.getTime())
                  : 0;
                const draining = emptyMs > 0 && remainMs > 0;
                const mm = Math.floor(remainMs / 60000);
                const ss = Math.floor((remainMs % 60000) / 1000);
                return draining ? (
                  <span className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    Freezer draining · {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                    Ended{emptyMs > 0 ? " · Freezer empty" : ""}
                  </span>
                );
              })()}
              {/* Die type badge in run header */}
              {v.dieType && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted/40 border border-border/50 text-muted-foreground tabular-nums">
                  {v.dieType}
                </span>
              )}
              {/* Allergen badge in run header */}
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

            {/* Glanceable case progress — persistent across tabs, mirrors mobile control-bar KPI */}
            {v.casesNeeded > 0 && (
              <div className="flex items-center gap-2 px-1">
                <span className="text-sm font-bold font-mono tabular-nums text-foreground shrink-0">
                  {fmtComma(calc.casesCompleted)}
                  <span className="text-muted-foreground">/{fmtComma(v.casesNeeded)}</span>
                </span>
                <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.min(100, (calc.casesCompleted / v.casesNeeded) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-primary shrink-0 tabular-nums">
                  {Math.round(Math.min(100, (calc.casesCompleted / v.casesNeeded) * 100))}%
                </span>
              </div>
            )}

            {/* Estimated time to finish — shown while running or paused */}
            {(runStatus === "running" || runStatus === "paused") && calc.totalTimeSec > 0 && (() => {
              const projectedFinish = Date.now() + calc.totalTimeSec * 1000;
              const driftMs = initialFinishTimestampRef.current > 0
                ? projectedFinish - initialFinishTimestampRef.current
                : 0;
              const driftSec = driftMs / 1000;
              const showDrift = Math.abs(driftSec) >= 30;
              const ahead = driftSec < 0;
              return (
                <div className="flex flex-col items-center gap-1 py-1.5">
                  <div className="flex items-center gap-2">
                    <Timer className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">Est. finish in</span>
                    <span className="text-sm font-bold tabular-nums text-foreground">{fmtTime(calc.adjustedTimeSec)}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-sm font-bold tabular-nums text-foreground">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</span>
                  </div>
                  {showDrift && (
                    <div className={`flex items-center gap-1.5 text-xs font-semibold ${ahead ? "text-emerald-400" : "text-amber-400"}`}>
                      <span>{ahead ? "▲" : "▼"}</span>
                      <span>{ahead ? `${fmtTime(Math.abs(driftSec))} ahead of original estimate` : `${fmtTime(Math.abs(driftSec))} behind original estimate`}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Pace gauge + PPM */}
            {calc.paceStatus !== null && (
              <div className={`flex flex-wrap items-center justify-center gap-2 py-1.5 px-4 rounded-lg text-xs font-semibold ${
                calc.paceStatus === "on-pace" ? "bg-emerald-950/40 border border-emerald-700/30 text-emerald-400"
                : calc.paceStatus === "ahead" ? "bg-emerald-950/40 border border-emerald-700/30 text-emerald-400"
                : "bg-red-950/40 border border-red-700/30 text-red-400"
              }`}>
                <span>{calc.paceStatus === "on-pace" ? "✓ On Pace" : calc.paceStatus === "ahead" ? `▲ ${calc.paceDelta} cases ahead` : `▼ ${Math.abs(calc.paceDelta)} cases behind`}</span>
                {calc.ppm > 0 && (
                  <span className="opacity-60 border-l border-current/30 pl-2 ml-0.5">
                    {calc.ppm} PPM
                  </span>
                )}
                {calc.catchUpPpm !== null && (
                  <span className="border-l border-current/30 pl-2 ml-0.5 text-red-300 font-bold">
                    Need {calc.catchUpPpm} PPM to finish on time
                  </span>
                )}
                {(() => {
                  const dtSec = (currentRun?.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((a, s) => a + (s.endedAt! - s.startedAt) / 1000, 0);
                  return dtSec > 0 ? (
                    <span className="border-l border-current/30 pl-2 ml-0.5 text-red-300">
                      ↓ {fmtTime(dtSec)} downtime
                    </span>
                  ) : null;
                })()}
              </div>
            )}

            {/* Run position dots */}
            {dayState.runs.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 py-1">
                {dayState.runs.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => switchToRun(i)}
                    className={`rounded-full transition-all ${i === dayState.currentIndex ? "w-4 h-2 bg-primary" : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
                  />
                ))}
              </div>
            )}

            {/* Navigation row: Previous · count · New Run · Upcoming */}
            <div className="flex items-center justify-between w-full gap-1 pt-1 border-t border-primary/20">
              {/* Previous */}
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

              {/* Upcoming */}
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

              {/* Count + Run actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground tabular-nums">{dayState.runs.length}/{MAX_RUNS}</span>
                {/* Remove run — only for upcoming (pending) runs when more than one exists, supervisors only */}
                {isSupervisor && !currentRun?.startedAt && !currentRun?.endedAt && dayState.runs.length > 1 && (
                  confirmRemoveRun ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-destructive font-semibold">Remove?</span>
                      <button
                        type="button"
                        className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors"
                        onClick={removeRun}
                      >Yes</button>
                      <button
                        type="button"
                        className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors"
                        onClick={() => setConfirmRemoveRun(false)}
                      >No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveRun(true)}
                      className="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove this run"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setTemplateSaveMode(false); setTemplateNameInput(""); setShowTemplatesDialog(true); }}
                  title="Run templates — save or load run settings"
                  className="h-6 px-2 gap-1 text-xs"
                >
                  <Bookmark className="w-3 h-3" />
                  <span className="hidden sm:inline">Templates</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyRun}
                  disabled={dayState.runs.length >= MAX_RUNS}
                  title="Duplicate this run's settings into a new run"
                  className="h-6 px-2 gap-1 text-xs"
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addRun}
                  disabled={dayState.runs.length >= MAX_RUNS}
                  className="h-6 px-2 gap-1 text-xs"
                >
                  <Plus className="w-3 h-3" />
                  <span className="hidden sm:inline">New Run</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Sandbox scope banner — persistent while signed in as the test user */}
        {me?.sandbox && (
          <div className="print:hidden mb-2 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs sm:text-sm font-medium text-amber-700 dark:text-amber-400">
            <FlaskConical className="w-4 h-4 shrink-0" />
            <span className="min-w-0">
              Sandbox mode — changes here are isolated and never affect live data.
              {me.sandboxCopiedAt && (
                <span className="hidden sm:inline opacity-80">
                  {" "}Copied from live at {fmtSandboxCopiedAt(me.sandboxCopiedAt)}.
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Reset the sandbox? This discards all sandbox changes and re-copies the current live data into the sandbox. Live factory data is not affected.",
                  )
                ) {
                  resetSandboxRequest()
                    .then(() => window.location.reload())
                    .catch(() => {});
                }
              }}
              className="ml-auto shrink-0 flex items-center gap-1 rounded border border-amber-500/50 px-2 py-1 font-semibold hover:bg-amber-500/20 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset sandbox
            </button>
          </div>
        )}

        {/* Header */}
        <header className="flex items-center justify-between gap-2 print:mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded bg-primary text-primary-foreground flex items-center justify-center shrink-0 print:hidden">
              <Factory className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold tracking-tight leading-tight truncate">
                <span className="hidden sm:inline">Production Run Calculator</span>
                <span className="sm:hidden">Run Calculator</span>
              </h1>
              <p className="hidden sm:block text-xs text-muted-foreground">
                Pizza line planning & schedule estimation
              </p>
            </div>
          </div>
          <div className="print:hidden flex items-center gap-1.5 shrink-0">
            {/* Sync status dot */}
            <span
              title={syncPushFailed ? "Not synced — last save to the server failed" : syncConnected ? "Sync connected" : isOnline ? "Reconnecting to sync…" : "Offline — changes saved locally"}
              className={`h-2 w-2 rounded-full shrink-0 transition-colors ${syncPushFailed ? "bg-red-500 animate-pulse" : syncConnected ? "bg-emerald-500" : isOnline ? "bg-amber-400 animate-pulse" : "bg-zinc-500 animate-pulse"}`}
            />
            {/* Auto-save badge — hidden on xs to save space */}
            <span ref={savedFlashRef} style={{ opacity: 0, transition: "opacity 0.5s" }} className="hidden sm:flex text-[10px] font-semibold items-center gap-1 text-emerald-400 pointer-events-none">
              <Check className="w-3 h-3" /> Saved
            </span>
            {/* Screens / cast button */}
            <button
              type="button"
              onClick={() => setShowScreensDialog(true)}
              title="Cast to other screens"
              className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <Monitor className="w-4 h-4" />
            </button>
            {/* Floor mode toggle */}
            {floorModeEnabled && (
              <button
                type="button"
                onClick={() => setShowFloorMode(true)}
                title="Floor mode — big numbers, status color"
                className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Layers className="w-4 h-4" />
              </button>
            )}
            {/* Fullscreen / kiosk toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen / kiosk mode"}
              className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            {/* Role badge — icon+text on sm+, icon-only on xs */}
            <button
              type="button"
              onClick={() => {
                // Managers always have access via their account; no PIN toggle.
                if (isManager) return;
                if (isSupervisor) {
                  setRole("operator");
                } else {
                  setPinInput("");
                  setPinError("");
                  setShowPinDialog(true);
                }
              }}
              title={isManager ? "Manager — full access" : isSupervisor ? "Click to exit supervisor mode" : "Click to enter supervisor mode"}
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                isSupervisor
                  ? "border-primary/40 text-primary bg-primary/10 hover:bg-primary/20"
                  : "border-border text-muted-foreground bg-muted/30 hover:bg-muted/60"
              }`}
            >
              {isSupervisor ? <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> : <Lock className="w-3.5 h-3.5 shrink-0" />}
              <span className="hidden sm:inline">{isSupervisor ? "Supervisor" : "Operator"}</span>
            </button>
            {/* Header overflow menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title={
                    pendingResetCount + unreviewedIncidentCount > 0
                      ? `${pendingResetCount + unreviewedIncidentCount} item${pendingResetCount + unreviewedIncidentCount === 1 ? "" : "s"} need attention`
                      : "More"
                  }
                  className="relative flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <Menu className="w-4 h-4" />
                  {pendingResetCount + unreviewedIncidentCount > 0 && (
                    <span
                      aria-label={`${pendingResetCount + unreviewedIncidentCount} items need attention`}
                      className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center leading-none ring-2 ring-background"
                    >
                      {pendingResetCount + unreviewedIncidentCount}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setActiveTab("stoppages")}>
                  <OctagonX className="w-4 h-4 mr-2" /> Stoppages
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab("summary")}>
                  <BarChart2 className="w-4 h-4 mr-2" /> Summary
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab("inventory")}>
                  <ClipboardList className="w-4 h-4 mr-2" /> Stock
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab("ai")}>
                  <Sparkles className="w-4 h-4 mr-2" /> AI Assistant
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab("mixes")}>
                  <Blend className="w-4 h-4 mr-2" /> Mixes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowReportIssue(true)}>
                  <LifeBuoy className="w-4 h-4 mr-2" /> Report an issue
                </DropdownMenuItem>
                {isManager && (
                  <DropdownMenuItem onClick={() => setActiveTab("incidents")}>
                    <LifeBuoy className="w-4 h-4 mr-2" /> Reported issues
                    {unreviewedIncidentCount > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                        {unreviewedIncidentCount}
                      </span>
                    )}
                  </DropdownMenuItem>
                )}
                {isManager && (
                  <DropdownMenuItem onClick={() => setActiveTab("quality")}>
                    <ShieldCheck className="w-4 h-4 mr-2" /> Quality history
                  </DropdownMenuItem>
                )}
                {(canManageStaff || canApproveResets) && (
                  <DropdownMenuItem onClick={() => setActiveTab("staff")}>
                    <Users className="w-4 h-4 mr-2" /> Staff roster
                    {pendingResetCount > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                        {pendingResetCount}
                      </span>
                    )}
                  </DropdownMenuItem>
                )}
                {isSupervisor && (
                  <DropdownMenuItem onClick={() => { fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[])).catch(() => {}); setScheduleView("list"); setScheduleDeleteConfirm(null); setShowScheduleDialog(true); }}>
                    <CalendarPlus className="w-4 h-4 mr-2" /> Schedule
                    {scheduledDays.length > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center leading-none">
                        {scheduledDays.length}
                      </span>
                    )}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setActiveTab("setup")}>
                  <Settings className="w-4 h-4 mr-2" /> Setup
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.preventDefault(); toggleFloorModeEnabled(); }}>
                  <Layers className="w-4 h-4 mr-2" /> Floor Mode: {floorModeEnabled ? "On" : "Off"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setManageInput(""); setPinChangeMsg(""); setShowManageDialog(true); }}>
                  <ShieldCheck className="w-4 h-4 mr-2" /> Settings
                  {pendingResetCount > 0 && (
                    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                      {pendingResetCount}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowPasswordDialog(true)}>
                  <KeyRound className="w-4 h-4 mr-2" /> Password
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowGetStarted(true)}>
                  <Boxes className="w-4 h-4 mr-2" /> Get Started
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowMobileQrDialog(true)}>
                  <Smartphone className="w-4 h-4 mr-2" /> Mobile App
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowTour(true)}>
                  <Compass className="w-4 h-4 mr-2" /> Guided Tour
                </DropdownMenuItem>
                {me?.sandbox && (
                  <DropdownMenuItem
                    onClick={() => {
                      if (
                        window.confirm(
                          "Reset the sandbox? This discards all sandbox changes and re-copies the current live data into the sandbox. Live factory data is not affected.",
                        )
                      ) {
                        resetSandboxRequest()
                          .then(() => window.location.reload())
                          .catch(() => {});
                      }
                    }}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" /> Reset sandbox
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => { void signOut(); }}>
                  <LogOut className="w-4 h-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <Form {...form}>
          <form>
            {(syncPushFailed || writeError) && (
              <div className="print:hidden mb-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
                <div className="flex-1 min-w-0">
                  {syncPushFailed && (
                    <p>Your latest changes haven't synced to the server. They're saved on this device, but other devices won't see them and they aren't backed up until the connection is restored.</p>
                  )}
                  {writeError && <p className={syncPushFailed ? "mt-1" : ""}>{writeError}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => { setSyncPushFailed(false); setWriteError(null); }}
                  className="shrink-0 text-red-300 hover:text-red-100 text-xs font-semibold"
                >
                  Dismiss
                </button>
              </div>
            )}
            <ProactiveAlertBanner alert={proactiveAlert} onDismiss={dismissProactiveAlert} />
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full print:hidden">
              {/* ─── RUN ─── */}
              <TabsContent value="run">
                {/* Ended-run banner */}
                {currentRun?.endedAt && (() => {
                  const emptyMs = Number(v.freezerTime) * 60000;
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
                              ? `Freezer draining — ${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")} remaining`
                              : emptyMs > 0 ? "Freezer empty — run complete." : "Run ended."}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Run stopped at {fmtClock(currentRun.endedAt)}{emptyMs > 0 ? ` · ${fmtNum(Number(v.freezerTime), 0)} min freezer time` : ""} — switch to another run to continue.
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

                {/* Freezer status — filling at run start, emptying at run end.
                    Auto-hidden whenever the tunnel is in steady state. */}
                {!currentRun?.endedAt && runStatus === "running" && (() => {
                  const freezerMin = Number(v.freezerTime) || 0;
                  if (freezerMin <= 0) return null;
                  const elapsedMin = elapsedBatchSec / 60;
                  const ppm = calc.ppm;
                  // No line speed yet → no product moving through the tunnel, so
                  // neither phase is meaningful.
                  if (ppm <= 0) return null;
                  const feedDoneMin =
                    v.pizzasPerCase > 0 && v.casesNeeded > 0
                      ? (v.casesNeeded * v.pizzasPerCase) / ppm
                      : Infinity;
                  const feedComplete = elapsedMin >= feedDoneMin;
                  const filling = elapsedMin > 0 && elapsedMin < freezerMin && !feedComplete;
                  const emptyRemainMin = Math.max(0, feedDoneMin + freezerMin - elapsedMin);
                  const emptying = feedComplete && emptyRemainMin > 0;
                  if (!filling && !emptying) return null;
                  const remainMin = filling ? freezerMin - elapsedMin : emptyRemainMin;
                  const remainMs = Math.max(0, remainMin * 60000);
                  const mm = Math.floor(remainMs / 60000);
                  const ss = Math.floor((remainMs % 60000) / 1000);
                  const pct = Math.max(0, Math.min(1, 1 - remainMin / freezerMin));
                  const tone = filling
                    ? { wrap: "bg-sky-950/30 border-sky-700/30", text: "text-sky-400", bar: "bg-sky-500" }
                    : { wrap: "bg-amber-950/30 border-amber-700/30", text: "text-amber-400", bar: "bg-amber-500" };
                  return (
                    <div className="mb-4 rounded-lg border overflow-hidden">
                      <div className={`flex items-start gap-2.5 px-4 py-3 ${tone.wrap}`}>
                        <Timer className={`w-4 h-4 shrink-0 mt-0.5 ${tone.text}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${tone.text}`}>
                            {filling
                              ? `Freezer filling — first cases exit in ${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
                              : `Freezer emptying — ${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")} until last cases exit`}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {filling
                              ? `Product is still travelling the ${fmtNum(freezerMin, 0)} min freezer tunnel — the completed count starts climbing once it clears.`
                              : `Dough feed is done — the tunnel is draining the last cases.`}
                          </p>
                          <div className="mt-2 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ${tone.bar}`}
                              style={{ width: `${pct * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Batch due alert — dough only */}
                {showBatchDue && runStatus === "running" && doughSubTab !== "crusts" && (
                  <div className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-orange-950/40 border border-orange-500/50 animate-pulse">
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">🍕</span>
                      <div>
                        <p className="text-sm font-bold text-orange-400">Start next dough batch now</p>
                        <p className="text-xs text-orange-300/70 mt-0.5">Time per batch: {fmtTime(calc.timePerBatchSec)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBatchDue(false)}
                      className="text-orange-400/60 hover:text-orange-400 transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

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

                {/* Case completion progress bar */}
                {v.casesNeeded > 0 && calc.casesCompleted > 0 && (
                  <div className="mb-4 space-y-1.5">
                    {calc.casesCompleted >= v.casesNeeded ? (
                      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-emerald-600/20 border border-emerald-600/40 text-emerald-400">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span className="text-sm font-bold">Target reached! {fmtComma(calc.casesCompleted)} / {fmtComma(v.casesNeeded)} cases</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Cases completed</span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {fmtComma(calc.casesCompleted)} / {fmtComma(v.casesNeeded)}
                            {" "}
                            <span className="text-muted-foreground">({Math.round(calc.casesCompleted / v.casesNeeded * 100)}%)</span>
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              calc.casesCompleted / v.casesNeeded >= 0.75 ? "bg-primary" : "bg-primary/70"
                            }`}
                            style={{ width: `${Math.min(100, (calc.casesCompleted / v.casesNeeded) * 100)}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Carry-over surplus to next run (moved from Current Progress) */}
                {(() => {
                  const nextRun = dayState.runs[dayState.currentIndex + 1];
                  if (!nextRun) return null;
                  if (v.carryOverDone) return null;
                  const excessPizzas = calc.buffer * v.pizzasPerCase;
                  if (excessPizzas < 1 || calc.perTray <= 0) return null;
                  const excessBatches = calc.perBatch > 0 ? Math.floor(excessPizzas / calc.perBatch) : 0;
                  const afterBatches = excessBatches > 0 ? excessPizzas - excessBatches * calc.perBatch : excessPizzas;
                  const excessTrays = Math.floor(afterBatches / calc.perTray);
                  if (excessTrays === 0 && excessBatches === 0) return null;
                  const nextLabel = `${nextRun.brand ?? ""}${nextRun.flavor ? ` – ${nextRun.flavor}` : ""}`.trim() || `Run ${dayState.currentIndex + 2}`;
                  return (
                    <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-950/20 px-3 py-2.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <ArrowRight className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-amber-300 leading-snug">
                            <span className="font-semibold">{doughSubTab === "crusts" ? "Surplus crusts" : "Surplus dough"}</span> exceeds this run
                            {excessTrays > 0 && <span> — <span className="font-semibold">{excessTrays} {doughSubTab === "crusts" ? `stack${excessTrays !== 1 ? "s" : ""}` : `tray${excessTrays !== 1 ? "s" : ""}`}</span></span>}
                            {excessBatches > 0 && doughSubTab !== "crusts" && <span> + <span className="font-semibold">{excessBatches} batch{excessBatches !== 1 ? "es" : ""}</span></span>}
                            . Carry to <span className="font-semibold">{nextLabel}</span>?
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => form.setValue("carryOverDone", true, { shouldDirty: true })}
                          className="text-muted-foreground/50 hover:text-muted-foreground shrink-0 mt-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const existing = loadRunValues(nextRun.id);
                            saveRunValues(nextRun.id, {
                              ...existing,
                              traysOnLine: (existing.traysOnLine ?? 0) + excessTrays,
                              batchesReady: (existing.batchesReady ?? 0) + excessBatches,
                            });
                            form.setValue("carryOverDone", true, { shouldDirty: true });
                            navigator.vibrate?.(15);
                          }}
                          className="flex-1 py-1.5 rounded-md bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/40 text-amber-300 text-xs font-semibold transition-colors"
                        >
                          Carry over →
                        </button>
                        <button
                          type="button"
                          onClick={() => form.setValue("carryOverDone", true, { shouldDirty: true })}
                          className="px-3 py-1.5 rounded-md border border-border/50 text-muted-foreground text-xs transition-colors hover:bg-muted/30"
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Run Details (moved from Dough tab) — sub-view aware */}
                {doughSubTab === "crusts" ? (
                  <Card className="bg-card/50 border-border/50 shadow-md mt-4">
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Run Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <StatRow label="Cases Left to Run" value={fmtNum(calc.casesLeftToRun, 0)} testId="output-crust-cases-left" highlight />
                      <StatRow label="Total Time Left" value={fmtTime(calc.totalTimeSec)} highlight />
                      <StatRow label="Approx. Cases on Line" value={fmtNum(calc.casesOnLine, 0)} testId="output-cases-on-line" />
                      <div className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-muted-foreground">Crust Supply</span>
                        {calc.doughShortCases > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-400">
                            <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                            SHORT {fmtNum(calc.doughShortCases, 1)} cases
                          </span>
                        ) : calc.buffer > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
                            <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                            +{fmtNum(calc.buffer, 1)} cases ahead
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                            <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                            Balanced
                          </span>
                        )}
                      </div>
                      <StatRow label="Cases on Last Skid" value={fmtNum(calc.casesOnLastSkid, 0)} />
                      <Separator className="my-3 opacity-30" />
                      <StatRow label="Stacks Per Skid" value={fmtNum(calc.traysPerSkid, 2)} />
                      <StatRow label="Time Per Stack" value={fmtTime(calc.timePerTraySec)} />
                      <StatRow label="Time Per Skid" value={fmtTime(calc.timePerSkidSec)} />
                      <StatRow label="PPM" value={fmtNum(calc.ppm, 1)} testId="output-ppm-crust" />
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="bg-card/50 border-border/50 shadow-md mt-4">
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Run Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <StatRow
                        label="Cases Left to Run"
                        value={fmtNum(calc.casesLeftToRun, 0)}
                        testId="output-dough-cases-left"
                      />
                      <StatRow
                        label="Approx. Cases on Line"
                        value={fmtNum(calc.casesOnLine, 0)}
                        testId="output-cases-on-line"
                      />
                      <div className="flex items-center justify-between py-1.5" data-testid="output-dough-status">
                        <span className="text-sm text-muted-foreground">Dough Status</span>
                        {calc.doughShortCases > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-400">
                            <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                            SHORT {fmtNum(calc.doughShortCases, 1)} cases
                          </span>
                        ) : calc.buffer > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
                            <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                            +{fmtNum(calc.buffer, 1)} cases ahead
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                            <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                            Balanced
                          </span>
                        )}
                      </div>
                      <StatRow
                        label="Cases on Last Skid"
                        value={fmtNum(calc.casesOnLastSkid, 0)}
                        testId="output-last-skid-cases"
                      />
                      <Separator className="my-3 opacity-30" />
                      <StatRow
                        label="Trays Per Skid"
                        value={fmtNum(calc.traysPerSkid, 2)}
                        testId="output-trays-per-skid"
                      />
                      <StatRow
                        label="Trays Per Batch"
                        value={fmtNum(calc.traysPerBatch, 2)}
                        testId="output-trays-per-batch"
                      />
                      <StatRow
                        label="Batches Per Skid"
                        value={fmtNum(calc.batchesPerSkid, 2)}
                        testId="output-batches-per-skid"
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Upcoming runs */}
                {(() => {
                  const upcoming = dayState.runs.slice(dayState.currentIndex + 1);
                  if (upcoming.length === 0) return null;
                  return (
                    <div className="mt-4 rounded-xl border border-border/40 bg-card/50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Upcoming Runs</p>
                      <div className="space-y-2">
                        {upcoming.map((r, i) => {
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
              </TabsContent>

              {/* ─── SETUP ─── */}
              <TabsContent value="setup">
                <div className="mb-4">
                  <FillMissingPanel
                    getRecord={() => ({
                      ...form.getValues(),
                      brand: currentRun?.brand ?? "",
                      flavor: currentRun?.flavor ?? "",
                    })}
                    brand={currentRun?.brand ?? ""}
                    flavor={currentRun?.flavor ?? ""}
                    dieType={form.getValues("dieType") ?? ""}
                    canEdit={isSupervisor}
                    onCommit={commitMissingField}
                  />
                </div>
                <details className="group rounded-xl border border-border/50 bg-card/50 shadow-md overflow-hidden mb-4">
                    <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer list-none select-none">
                      <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Settings className="w-3.5 h-3.5" />
                        Line Settings
                        {!isSupervisor && <Lock className="w-3.5 h-3.5 text-muted-foreground/50" />}
                      </span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <div className={`border-t border-border/40 px-5 pb-5 pt-4 space-y-3${!isSupervisor ? " opacity-60 pointer-events-none" : ""}`}>
                    <fieldset disabled={!isSupervisor} className="contents">
                      {/* Dough / Crust toggle */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Line Type</label>
                        <div className="flex gap-1 p-1 bg-muted/40 rounded-lg w-fit">
                          <button
                            type="button"
                            onClick={() => {
                              setDoughSubTab("dough");
                              const newRuns = dayState.runs.map((r, i) => i === dayState.currentIndex ? { ...r, subTab: "dough" as const } : r);
                              const newDs = { ...dayState, runs: newRuns };
                              setDayState(newDs);
                              saveDayState(newDs);
                            }}
                            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${doughSubTab === "dough" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            Dough
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDoughSubTab("crusts");
                              const newRuns = dayState.runs.map((r, i) => i === dayState.currentIndex ? { ...r, subTab: "crusts" as const } : r);
                              const newDs = { ...dayState, runs: newRuns };
                              setDayState(newDs);
                              saveDayState(newDs);
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
                          {dieTypes.map(dt => (
                            <button
                              key={dt}
                              type="button"
                              onClick={() => form.setValue("dieType", v.dieType === dt ? "" : dt, { shouldDirty: true })}
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
                          {ALLERGENS.map(m => {
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
                            {allergenWarnings.map(w => (
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
                            {ruleViolations.map(rv => {
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
                                      {cl.map((step, i) => {
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
                          label="Freezer Time (min)"
                        />
                      </div>
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
                        const hasRecipe = (v.doughRecipe ?? []).some(r => Number(r.lbs) > 0) && Number(v.targetDoughballWeight) > 0;
                        return hasRecipe ? null : (
                          <NumField
                            control={form.control}
                            name="doughBatchYield"
                            label="Dough Batch Yield (doughballs)"
                            step="1"
                          />
                        );
                      })()}
                    </fieldset>
                    </div>
                </details>

                {/* Packaging Settings */}
                <details className="group rounded-xl border border-border/50 bg-card/50 shadow-md overflow-hidden mb-4">
                  <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer list-none select-none">
                    <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Package className="w-3.5 h-3.5" />
                      Packaging Settings
                    </span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-border/40 px-5 pb-5 pt-4 space-y-4">
                    {PACKAGING_FIELDS.map((f) => {
                      const cur = (v[f.name] as string) ?? "";
                      return (
                        <div key={f.name}>
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                            {f.label}
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {f.options.map((opt) => {
                              const active = cur === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() =>
                                    form.setValue(f.name, active ? "" : opt, { shouldDirty: true })
                                  }
                                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border capitalize transition-colors ${
                                    active
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground"
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    <NumField
                      control={form.control}
                      name="cartonsPerCase"
                      label="Cartons Per Case"
                      step="1"
                    />
                  </div>
                </details>
              </TabsContent>

              {/* ─── PACKAGING ─── */}
              <TabsContent value="packaging">
                <Card className="bg-card/50 border-border/50 shadow-md mb-4">
                  <CardHeader className="pb-1 pt-3 px-4">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5" /> Packaging
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {(() => {
                      const isCartoned = ((v.cartoned as string) ?? "").trim().toLowerCase() === "yes";
                      return (
                        <span
                          className={`inline-block mb-3 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border ${
                            isCartoned
                              ? "bg-primary/15 text-primary border-primary/40"
                              : "bg-muted/40 text-muted-foreground border-border/60"
                          }`}
                        >
                          {isCartoned ? "Cartoned" : "Labeled"}
                        </span>
                      );
                    })()}
                    <div className="space-y-1.5">
                      {((v.cartoned as string) ?? "").trim().toLowerCase() === "yes" && (
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="text-muted-foreground">Cartons / Case</span>
                          <span className="font-bold tabular-nums text-foreground whitespace-nowrap">
                            {Number(v.cartonsPerCase) > 0 ? fmtNum(Number(v.cartonsPerCase), 0) : "—"}
                          </span>
                        </div>
                      )}
                      {PACKAGING_FIELDS.filter((f) => f.name !== "cartoned").map((f) => {
                        const val = ((v[f.name] as string) ?? "").trim();
                        return (
                          <div key={f.name} className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="text-muted-foreground">{f.label}</span>
                            <span className="font-bold tabular-nums text-foreground capitalize whitespace-nowrap">
                              {val || "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
                {/* ─── Finishing — Freezer Draining (just-ended run still exiting freezer) ─── */}
                {(() => {
                  // Pick the most-recently-ended run (other than the active one)
                  // whose freezer is STILL draining AND that still has unpackaged
                  // cases. Filter for eligibility FIRST, then take the latest, so a
                  // newer ended-but-finished run can't hide an older still-draining one.
                  // (The active run shows its own emptying bar elsewhere.)
                  const nowMsT = nowTime.getTime();
                  let drainingRun: RunMeta | undefined;
                  let dv: FormValues | undefined;
                  for (const r of dayState.runs) {
                    if (!r.endedAt) continue;
                    if (r.id === currentRunId) continue;
                    const rv = loadRunValues(r.id);
                    const rfT = Number(rv.freezerTime) || 0;
                    if (rfT <= 0) continue;
                    if (nowMsT >= r.endedAt + rfT * 60000) continue; // freezer fully empty
                    const cps = Number(rv.casesPerSkid) || 0;
                    const cn = Number(rv.casesNeeded) || 0;
                    const cDone = (Number(rv.skidsCompleted) || 0) * cps + (Number(rv.casesOnCurrentSkid) || 0);
                    if (cn > 0 && Math.max(0, cn - cDone) <= 0) continue; // all packaged
                    if (!drainingRun?.endedAt || r.endedAt > drainingRun.endedAt) {
                      drainingRun = r;
                      dv = rv;
                    }
                  }
                  if (!drainingRun?.endedAt || !dv) return null;
                  const fT = Number(dv.freezerTime) || 0;
                  const freezerMs = fT * 60000;
                  const remainMs = Math.max(0, drainingRun.endedAt + freezerMs - nowTime.getTime());
                  const casesPerSkid = Number(dv.casesPerSkid) || 0;
                  const casesNeeded = Number(dv.casesNeeded) || 0;
                  const skids = Number(dv.skidsCompleted) || 0;
                  const casesOnSkid = Number(dv.casesOnCurrentSkid) || 0;
                  const casesDone = skids * casesPerSkid + casesOnSkid;
                  const casesLeft = Math.max(0, casesNeeded - casesDone);
                  const id = drainingRun.id;
                  const name =
                    `${drainingRun.brand ?? ""}${drainingRun.flavor ? ` – ${drainingRun.flavor}` : ""}`.trim() ||
                    "Finished run";
                  const maxSkids = casesPerSkid > 0 ? Math.floor(casesNeeded / casesPerSkid) : undefined;
                  const maxCasesOnSkid = casesPerSkid > 0 ? casesPerSkid : undefined;
                  const pct = Math.min(1 - remainMs / freezerMs, 1);
                  const mm = Math.floor(remainMs / 60000);
                  const ss = Math.floor((remainMs % 60000) / 1000);
                  const skidNearlyFull =
                    casesPerSkid > 0 && casesOnSkid > 0 &&
                    casesOnSkid >= casesPerSkid - 3 && casesOnSkid < casesPerSkid;
                  return (
                    <Card className="bg-amber-950/10 border-amber-600/40 shadow-md mb-4">
                      <CardHeader className="pb-1 pt-3 px-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                          Finishing — Freezer Draining
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 space-y-2">
                        <p className="text-base font-semibold text-foreground truncate">{name}</p>
                        <p className="text-xs text-muted-foreground">
                          Finished pizzas are still exiting the freezer. Log skids &amp; cases as they come off.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Total Skids Completed</p>
                            <div className="flex items-stretch">
                              <button
                                type="button"
                                onClick={() => { navigator.vibrate?.(8); updateDrainingRunValues(id, { skidsCompleted: Math.max(0, skids - 1) }); }}
                                className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none"
                              >
                                −
                              </button>
                              <div className="flex-1 h-12 border-y border-input bg-background flex items-center justify-center text-lg font-mono font-bold tabular-nums text-foreground">
                                {skids}
                              </div>
                              <button
                                type="button"
                                onClick={() => { if (maxSkids !== undefined && skids >= maxSkids) return; navigator.vibrate?.(8); updateDrainingRunValues(id, { skidsCompleted: skids + 1 }); }}
                                className="h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Cases on Current Skid</p>
                            <div className="flex items-stretch">
                              <button
                                type="button"
                                onClick={() => { navigator.vibrate?.(8); updateDrainingRunValues(id, { casesOnCurrentSkid: Math.max(0, casesOnSkid - 1) }); }}
                                className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none"
                              >
                                −
                              </button>
                              <div className="flex-1 h-12 border-y border-input bg-background flex items-center justify-center text-lg font-mono font-bold tabular-nums text-foreground">
                                {casesOnSkid}
                              </div>
                              <button
                                type="button"
                                onClick={() => { if (maxCasesOnSkid !== undefined && casesOnSkid >= maxCasesOnSkid) return; navigator.vibrate?.(8); updateDrainingRunValues(id, { casesOnCurrentSkid: casesOnSkid + 1 }); }}
                                className="h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                        {skidNearlyFull && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-600/30 text-amber-400 text-xs font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Skid nearly full — {casesPerSkid - casesOnSkid} case{casesPerSkid - casesOnSkid !== 1 ? "s" : ""} to go
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => { navigator.vibrate?.(15); updateDrainingRunValues(id, { skidsCompleted: skids + 1, casesOnCurrentSkid: 0 }); }}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 text-sm font-semibold transition-colors active:scale-[0.98]"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Skid Done — log &amp; reset
                        </button>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-muted/20 rounded-lg p-3 text-center">
                            <p className="text-2xl font-mono font-bold tabular-nums text-emerald-400">{fmtNum(casesDone, 0)}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Cases done</p>
                          </div>
                          <div className="bg-muted/20 rounded-lg p-3 text-center">
                            <p className="text-2xl font-mono font-bold tabular-nums">{fmtNum(casesLeft, 0)}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Cases left</p>
                          </div>
                        </div>
                        <Separator className="opacity-30 my-1" />
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Freezer Emptying</p>
                          <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-1000 bg-amber-500"
                              style={{ width: `${pct * 100}%` }}
                            />
                          </div>
                          <p className="text-[10px] font-mono font-semibold text-right text-amber-400">
                            {`Draining — ${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")} left`}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}
                <Card className="bg-card/50 border-border/50 shadow-md mb-4">
                    <CardHeader className="pb-1 pt-3 px-4">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Current Progress
                        </CardTitle>
                        {(runStatus === "running" || runStatus === "paused") && autoTrackSuggestion && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = !autoTrackProgress;
                              setAutoTrackProgress(next);
                              if (next) {
                                autoSuppressUntilRef.current = 0;
                                lastAutoMinBucketRef.current = -1;
                              }
                            }}
                            className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${autoTrackProgress ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-muted/20 text-muted-foreground"}`}
                          >
                            <Sparkles className="w-2.5 h-2.5" />
                            {autoTrackProgress ? "Auto" : "Manual"}
                          </button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2">
                      {(() => {
                        const maxSkids = v.casesPerSkid > 0 ? Math.floor(v.casesNeeded / v.casesPerSkid) : undefined;
                        const maxCasesOnSkid = v.casesPerSkid > 0 ? v.casesPerSkid : undefined;
                        const s = autoTrackSuggestion;
                        const suppressed = Date.now() < autoSuppressUntilRef.current;
                        const suppressedMinsLeft = suppressed ? Math.ceil((autoSuppressUntilRef.current - Date.now()) / 60000) : 0;
                        const onManual = () => { autoSuppressUntilRef.current = Date.now() + AUTO_SUPPRESS_MS; };
                        return (
                          <>
                            {autoTrackProgress && s && suppressed && (
                              <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-amber-950/20 border border-amber-600/20 text-[10px]">
                                <span className="text-amber-400 font-semibold">Manual override active · auto resumes in ~{suppressedMinsLeft} min</span>
                                <button type="button" onClick={() => { autoSuppressUntilRef.current = 0; lastAutoMinBucketRef.current = -1; }} className="text-amber-400 hover:text-amber-300 font-semibold ml-2">Resume now</button>
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                              <StepperField
                                control={form.control}
                                name="skidsCompleted"
                                label={autoTrackProgress && s && !suppressed ? "Total Skids Completed · Auto" : "Total Skids Completed"}
                                max={maxSkids}
                                suggestion={!autoTrackProgress && s && s.skids !== v.skidsCompleted ? s.skids : null}
                                onSuggest={() => { form.setValue("skidsCompleted", s!.skids, { shouldDirty: true }); form.setValue("casesOnCurrentSkid", s!.casesOnSkid, { shouldDirty: true }); }}
                                onManualChange={onManual}
                              />
                              <StepperField
                                control={form.control}
                                name="casesOnCurrentSkid"
                                label={autoTrackProgress && s && !suppressed ? "Cases on Current Skid · Auto" : "Cases on Current Skid"}
                                max={maxCasesOnSkid}
                                suggestion={!autoTrackProgress && s && s.casesOnSkid !== v.casesOnCurrentSkid ? s.casesOnSkid : null}
                                onSuggest={() => { form.setValue("casesOnCurrentSkid", s!.casesOnSkid, { shouldDirty: true }); }}
                                onManualChange={onManual}
                              />
                            </div>
                            {!autoTrackProgress && s && (s.skids !== v.skidsCompleted || s.casesOnSkid !== v.casesOnCurrentSkid) && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.vibrate?.(10);
                                  form.setValue("skidsCompleted", s.skids, { shouldDirty: true });
                                  form.setValue("casesOnCurrentSkid", s.casesOnSkid, { shouldDirty: true });
                                }}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-xs font-semibold transition-colors"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                Apply expected — {s.skids} skids · {s.casesOnSkid} cases
                              </button>
                            )}
                          </>
                        );
                      })()}
                      {/* Skid nearly full nudge */}
                      {v.casesPerSkid > 0 && v.casesOnCurrentSkid > 0 &&
                        v.casesOnCurrentSkid >= v.casesPerSkid - 3 &&
                        v.casesOnCurrentSkid < v.casesPerSkid && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-600/30 text-amber-400 text-xs font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Skid nearly full — {v.casesPerSkid - v.casesOnCurrentSkid} case{v.casesPerSkid - v.casesOnCurrentSkid !== 1 ? "s" : ""} to go
                        </div>
                      )}
                      {/* Skid Done quick action */}
                      {(runStatus === "running" || runStatus === "paused") && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.vibrate?.(15);
                            autoSuppressUntilRef.current = Date.now() + AUTO_SUPPRESS_MS;
                            form.setValue("skidsCompleted", v.skidsCompleted + 1, { shouldDirty: true });
                            form.setValue("casesOnCurrentSkid", 0, { shouldDirty: true });
                          }}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 text-sm font-semibold transition-colors active:scale-[0.98]"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Skid Done — log &amp; reset
                        </button>
                      )}
                      {/* Freezer countdowns */}
                      {Number(v.freezerTime) > 0 && (runStatus === "running" || runStatus === "ended") && (
                        <Separator className="opacity-30 my-1" />
                      )}
                      {runStatus === "running" && Number(v.freezerTime) > 0 && (() => {
                        const totalSecs = Number(v.freezerTime) * 60;
                        const elapsedSecs = liveFreezerMin * 60;
                        const remainSecs = Math.max(0, totalSecs - elapsedSecs);
                        const pct = totalSecs > 0 ? Math.min(elapsedSecs / totalSecs, 1) : 0;
                        const mm = Math.floor(remainSecs / 60);
                        const ss = Math.floor(remainSecs % 60);
                        const done = remainSecs === 0;
                        return (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Freezer Filling</p>
                            <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-1000 ${done ? "bg-green-500" : "bg-primary"}`}
                                style={{ width: `${pct * 100}%` }}
                              />
                            </div>
                            <p className={`text-[10px] font-mono font-semibold text-right ${done ? "text-green-400" : "text-muted-foreground"}`}>
                              {done ? "✓ Freezer full" : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")} remaining`}
                            </p>
                          </div>
                        );
                      })()}
                      {Number(v.freezerTime) > 0 && lastEndedRun?.endedAt && lastEndedRun.id === currentRunId && (() => {
                        const freezerMs = Number(v.freezerTime) * 60000;
                        const remainMs = Math.max(0, lastEndedRun.endedAt + freezerMs - nowTime.getTime());
                        const pct = Math.min(1 - remainMs / freezerMs, 1);
                        const mm = Math.floor(remainMs / 60000);
                        const ss = Math.floor((remainMs % 60000) / 1000);
                        const done = remainMs === 0;
                        return (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Freezer Emptying</p>
                            <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-1000 ${done ? "bg-emerald-500" : "bg-amber-500"}`}
                                style={{ width: `${pct * 100}%` }}
                              />
                            </div>
                            <p className={`text-[10px] font-mono font-semibold text-right ${done ? "text-emerald-400" : "text-amber-400"}`}>
                              {done ? "✓ Freezer empty" : `Draining — ${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")} left`}
                            </p>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* Output metrics */}
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div className="bg-muted/20 rounded-lg p-3 text-center">
                      <p className="text-3xl font-mono font-bold tabular-nums text-emerald-400">{fmtNum(calc.casesCompleted, 0)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Cases done</p>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-3 text-center">
                      <p className="text-3xl font-mono font-bold tabular-nums">{fmtNum(calc.casesLeftToRun, 0)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Cases left</p>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-3 text-center">
                      <p className="text-3xl font-mono font-bold tabular-nums">{fmtNum(calc.casesOnLine, 0)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">On line</p>
                    </div>
                  </div>
                  {calc.extraCases > 0 && (
                    <div className="mt-3 rounded-lg border border-emerald-700/40 bg-emerald-950/30 p-3 text-center">
                      <p className="text-3xl font-mono font-bold tabular-nums text-emerald-400">+{fmtNum(calc.extraCases, 0)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Extra cases beyond target</p>
                    </div>
                  )}
              </TabsContent>

              {/* ─── SAUCE ─── */}
              <TabsContent value="sauce">
                <Card className="bg-card/50 border-border/50 shadow-md mb-4">
                  <CardHeader className="pb-2 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Droplets className="w-4 h-4" /> Sauce Needs
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <NeedsList rows={buildNeedRows(v).sauce} />
                  </CardContent>
                </Card>
                <ReadOnlyRecipeCard
                  title="Sauce Recipe"
                  subtitle={v.frontlineRecipeName?.trim() || undefined}
                  recipe={v.frontlineRecipe ?? []}
                  accent="bg-red-500/70"
                />
              </TabsContent>

              {/* ─── FRONTLINE ─── */}
              <TabsContent value="frontline">
                <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mb-4">
                  <div className="h-1 bg-primary w-full" />
                  <CardHeader className="pb-2 pt-4 px-5">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Boxes className="w-4 h-4" /> Batches Needed
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-5">
                    <p className="text-xs text-muted-foreground mb-4">
                      Based on{" "}
                      <span className="font-mono text-foreground">
                        {fmtNum(calc.casesLeftToRun, 0)}
                      </span>{" "}
                      cases ×{" "}
                      <span className="font-mono text-foreground">
                        {v.pizzasPerCase}
                      </span>{" "}
                      pizzas/case
                    </p>
                    <StatRow
                      label="Sauce"
                      value={(() => {
                        const bd = sauceBarrelBreakdown(calc.sauceBatches, calc.sauceEffBarrel);
                        return bd
                          ? `${fmtNum(calc.sauceBatches, 2)} batches · ${bd.batchesPerBarrel}/barrel → ${bd.totalBarrels} barrels`
                          : fmtNum(calc.sauceBatches, 2) + " batches";
                      })()}
                      testId="output-sauce-batches"
                      highlight={calc.sauceBatches > 0}
                    />
                    <StatRow
                      label={v.app1Type ? `App 1 — ${v.app1Type}` : "Applicator 1"}
                      value={v.app1Type.trim().toLowerCase().includes("mix") ? fmtNum(calc.app1Lbs, 1) + " lbs" : fmtNum(calc.app1Batches, 2) + " batches"}
                      testId="output-app1-batches"
                      highlight={v.app1Type.trim().toLowerCase().includes("mix") ? calc.app1Lbs > 0 : calc.app1Batches > 0}
                    />
                    <StatRow
                      label={v.app2Type ? `App 2 — ${v.app2Type}` : "Applicator 2"}
                      value={v.app2Type.trim().toLowerCase().includes("mix") ? fmtNum(calc.app2Lbs, 1) + " lbs" : fmtNum(calc.app2Batches, 2) + " batches"}
                      testId="output-app2-batches"
                      highlight={v.app2Type.trim().toLowerCase().includes("mix") ? calc.app2Lbs > 0 : calc.app2Batches > 0}
                    />
                    <StatRow
                      label={v.app3Type ? `App 3 — ${v.app3Type}` : "Applicator 3"}
                      value={v.app3Type.trim().toLowerCase().includes("mix") ? fmtNum(calc.app3Lbs, 1) + " lbs" : fmtNum(calc.app3Batches, 2) + " batches"}
                      testId="output-app3-batches"
                      highlight={v.app3Type.trim().toLowerCase().includes("mix") ? calc.app3Lbs > 0 : calc.app3Batches > 0}
                    />
                    <StatRow
                      label={v.app4Type ? `App 4 — ${v.app4Type}` : "Applicator 4"}
                      value={v.app4Type.trim().toLowerCase().includes("mix") ? fmtNum(calc.app4Lbs, 1) + " lbs" : fmtNum(calc.app4Batches, 2) + " batches"}
                      testId="output-app4-batches"
                      highlight={v.app4Type.trim().toLowerCase().includes("mix") ? calc.app4Lbs > 0 : calc.app4Batches > 0}
                    />
                    <Separator className="my-3 opacity-30" />
                    <StatRow
                      label={v.pep1Type ? `Pep 1 — ${v.pep1Type}` : "Pep Applicator 1"}
                      value={DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") ? fmtNum(calc.pep1Lbs, 2) + " lbs" : fmtNum(calc.pep1Batches, 2) + " batches"}
                      testId="output-pep1-batches"
                      highlight={DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") ? calc.pep1Lbs > 0 : calc.pep1Batches > 0}
                    />
                    <StatRow
                      label={v.pep2Type ? `Pep 2 — ${v.pep2Type}` : "Pep Applicator 2"}
                      value={DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") ? fmtNum(calc.pep2Lbs, 2) + " lbs" : fmtNum(calc.pep2Batches, 2) + " batches"}
                      testId="output-pep2-batches"
                      highlight={DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") ? calc.pep2Lbs > 0 : calc.pep2Batches > 0}
                    />
                  </CardContent>
                </Card>
                {[
                  { type: v.app1Type, recipe: v.app1CheeseRecipe, name: v.app1CheeseRecipeName },
                  { type: v.app2Type, recipe: v.app2CheeseRecipe, name: v.app2CheeseRecipeName },
                  { type: v.app3Type, recipe: v.app3CheeseRecipe, name: v.app3CheeseRecipeName },
                  { type: v.app4Type, recipe: v.app4CheeseRecipe, name: v.app4CheeseRecipeName },
                ].map((app, i) => {
                  const t = (app.type ?? "").trim();
                  if (!t) return null;
                  const lower = t.toLowerCase();
                  const isMix = lower.includes("mix");
                  if (lower !== "cheese" && !isMix) return null;
                  const rows = (app.recipe ?? []).filter(
                    r => (r.ingredient ?? "").trim() !== "" || Number(r.lbs ?? 0) > 0
                  );
                  if (rows.length === 0) return null;
                  return (
                    <ReadOnlyRecipeCard
                      key={i}
                      title={`${t} Recipe`}
                      subtitle={app.name?.trim() || undefined}
                      recipe={app.recipe ?? []}
                      accent={isMix ? "bg-emerald-500/70" : "bg-amber-500/70"}
                    />
                  );
                })}
              </TabsContent>

              {/* ─── WAREHOUSE ─── */}
              <TabsContent value="warehouse">
                {/* Pull Out Freezer: for each upcoming scheduled run within an
                    item's days-early window whose recipe uses a tagged
                    freezer-pull ingredient, show what to pull now, grouped by
                    run date. Scheduled runs carry no recipe rows, so resolve
                    each via its profile -> FormValues -> need rows, exactly like
                    the schedule editor / per-run breakdown. */}
                {(() => {
                  const runs = scheduledDays.flatMap((day) =>
                    (day.runs ?? [])
                      .filter((r) => r.brand)
                      .map((r) => {
                        const profile = loadProfile(r.brand, r.flavor);
                        const vals: FormValues = {
                          ...(profile ?? DEFAULT_VALUES),
                          casesNeeded: r.casesNeeded,
                          ...(r.dieType ? { dieType: r.dieType } : {}),
                        };
                        const needRows = [
                          ...aggregateNeedRows([vals]),
                          ...aggregatePackagingNeeds([vals]),
                        ];
                        return {
                          date: day.date,
                          brand: r.brand,
                          flavor: r.flavor,
                          ingredients: needRows.map((row) => ({
                            name: row.label,
                            quantity: row.value,
                            unit: row.sub ?? "",
                          })),
                        };
                      }),
                  );
                  const plan = buildFreezerPullPlan({
                    runs,
                    freezerItems: freezerPullItems,
                    today: todayStr(),
                  });
                  if (plan.length === 0) return null;
                  return (
                    <div className="space-y-3 mb-4">
                      {plan.map((group) => (
                        <Card
                          key={group.date}
                          className="bg-sky-950/30 border-sky-700/40 shadow-md"
                          data-testid={`freezer-pull-${group.date}`}
                        >
                          <CardHeader className="pb-2 pt-4 px-5">
                            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                              <Snowflake className="w-4 h-4" /> Pull Out Freezer for {group.date}
                              <span className="ml-1 font-normal normal-case text-xs text-sky-400/80">
                                ({group.daysUntil === 0 ? "today" : `in ${group.daysUntil} day${group.daysUntil !== 1 ? "s" : ""}`})
                              </span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 pb-4 space-y-3">
                            {group.runs.map((run, ri) => (
                              <div key={ri} className="rounded-md border border-sky-800/40 bg-sky-950/20 p-3">
                                <div className="font-semibold text-sm text-sky-100 mb-1.5 truncate">
                                  {run.brand}{run.flavor ? ` — ${run.flavor}` : ""}
                                </div>
                                <div className="space-y-1">
                                  {run.items.map((it, ii) => (
                                    <div key={ii} className="flex items-baseline justify-between gap-2 text-sm">
                                      <span className="text-sky-200/90 truncate">
                                        {it.name}
                                        <span className="ml-1.5 text-[11px] text-sky-400/70">pull {it.daysEarly}d early</span>
                                      </span>
                                      <span className="font-bold tabular-nums whitespace-nowrap text-sky-50">
                                        {it.quantity} <span className="font-normal text-sky-300/80">{it.unit}</span>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  );
                })()}
                {/* Time to Count: warehouse sections now due for a cycle count
                    (never counted, or last counted longer ago than their
                    cadence). Config is factory-wide manager master-data; any
                    signed-in user can mark a section counted, which stamps it
                    and clears it until the cadence elapses again. */}
                {(() => {
                  const due = buildCycleCountDueList({
                    schedules: cycleCountSchedules,
                    today: todayStr(),
                  });
                  if (due.length === 0) return null;
                  return (
                    <Card
                      className="bg-amber-950/30 border-amber-700/40 shadow-md mb-4"
                      data-testid="cycle-count-due"
                    >
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                          <ClipboardCheck className="w-4 h-4" /> Time to Count
                          <span className="ml-1 font-normal normal-case text-xs text-amber-400/80">
                            ({due.length} section{due.length !== 1 ? "s" : ""} due)
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 space-y-2">
                        {due.map((d) => (
                          <div
                            key={d.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-amber-800/40 bg-amber-950/20 p-3"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-amber-100 truncate">
                                {d.section}
                              </div>
                              <div className="text-[11px] text-amber-400/80">
                                {d.daysSince === null
                                  ? `Never counted · every ${d.cadenceDays}d`
                                  : `Last counted ${d.lastCountedAt} · ${d.daysSince}d ago${d.overdueDays > 0 ? ` (${d.overdueDays}d over)` : ""}`}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => markCountedMutation.mutate(d.id)}
                              disabled={markCountedMutation.isPending}
                              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-600 text-amber-50 text-xs font-semibold disabled:opacity-50"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" /> Mark counted
                            </button>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })()}
                {/* Recipe Setup Needed (managers): upcoming scheduled runs whose
                    brand+flavor has no saved profile (or a profile with no recipe
                    rows). Their reorder demand silently falls back to defaults, so
                    warn managers and let them jump to set the profile up.
                    Detection is shared with mobile (replit.md parity). */}
                {isManager &&
                  (() => {
                    const scheduledRuns = scheduledDays.flatMap((day) =>
                      (day.runs ?? [])
                        .filter((r) => r.brand)
                        .map((r) => ({
                          date: day.date,
                          brand: r.brand,
                          flavor: r.flavor,
                          casesNeeded: r.casesNeeded,
                        })),
                    );
                    return (
                      <ScheduledRecipeWarningCard
                        scheduledRuns={scheduledRuns}
                        onSetup={(brand, flavor) => {
                          if (currentRunId) updateRunMeta(currentRunId, { brand, flavor });
                          setActiveTab("setup");
                        }}
                      />
                    );
                  })()}
                {/* Reorder Now: cross-location on-hand at/below reorder threshold
                    once upcoming scheduled-run demand is subtracted. Scheduled
                    runs carry no recipe rows, so resolve each via its profile ->
                    FormValues (same pattern as the freezer-pull / per-run blocks)
                    and feed them as the demand basis. Advisory only. */}
                {(() => {
                  const scheduledValsList: FormValues[] = scheduledDays.flatMap((day) =>
                    (day.runs ?? [])
                      .filter((r) => r.brand)
                      .map((r) => {
                        const profile = loadProfile(r.brand, r.flavor);
                        return {
                          ...(profile ?? DEFAULT_VALUES),
                          casesNeeded: r.casesNeeded,
                          ...(r.dieType ? { dieType: r.dieType } : {}),
                        } as FormValues;
                      }),
                  );
                  return <ReorderCard scheduledValsList={scheduledValsList} />;
                })()}
                {/* Use First: stock lots expiring within the configured window
                    (plus any already past), ordered first-expired-first-out, with
                    the lots used by today's runs surfaced to the top. Today's runs
                    = active runs + runs scheduled for today, resolved to their
                    FormValues. Deterministic counterpart to the AI waste insight;
                    advisory only. */}
                {(() => {
                  const activeVals: FormValues[] = dayState.runs
                    .filter((r) => !r.endedAt)
                    .map((r) => loadRunValues(r.id));
                  const todayKey = todayStr();
                  const todayScheduledVals: FormValues[] = scheduledDays
                    .filter((d) => d.date === todayKey)
                    .flatMap((d) =>
                      (d.runs ?? [])
                        .filter((r) => r.brand)
                        .map((r) => {
                          const profile = loadProfile(r.brand, r.flavor);
                          return {
                            ...(profile ?? DEFAULT_VALUES),
                            casesNeeded: r.casesNeeded,
                            ...(r.dieType ? { dieType: r.dieType } : {}),
                          } as FormValues;
                        }),
                    );
                  return <UseFirstCard todayValsList={[...activeVals, ...todayScheduledVals]} />;
                })()}
                {(() => {
                  const activeRuns = dayState.runs.filter(r => !r.endedAt);
                  const valsList = activeRuns.map(r => loadRunValues(r.id));
                  const agg = aggregateNeedRows(valsList);
                  const pkg = aggregatePackagingNeeds(valsList);
                  return (
                    <>
                      <Card className="bg-card/50 border-border/50 shadow-md mb-4">
                        <CardHeader className="pb-2 pt-4 px-5">
                          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Warehouse className="w-4 h-4" /> Total Ingredient Needs — All Runs
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                          <NeedsList rows={agg} />
                        </CardContent>
                      </Card>
                      {pkg.length > 0 && (
                        <Card className="bg-card/50 border-border/50 shadow-md mb-4">
                          <CardHeader className="pb-2 pt-4 px-5">
                            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <Package className="w-4 h-4" /> Packaging Needs — All Runs
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 pb-4">
                            <NeedsList rows={pkg} />
                          </CardContent>
                        </Card>
                      )}
                    </>
                  );
                })()}
                {/* Per-run breakdown: what each active run needs and roughly how
                    long it runs, so warehouse staff can stage materials run by
                    run instead of reading off one combined total. Reuses the
                    same need/packaging math as the roll-up above. */}
                {(() => {
                  const activeRuns = dayState.runs.filter(r => !r.endedAt);
                  if (activeRuns.length === 0) return null;
                  return (
                    <Card className="bg-card/50 border-border/50 shadow-md mb-4">
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <ListChecks className="w-4 h-4" /> What Each Run Needs
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 space-y-3">
                        {activeRuns.map((r) => {
                          const vals = loadRunValues(r.id);
                          const s = computeSummaryStats(vals);
                          const rows = [...aggregateNeedRows([vals]), ...aggregatePackagingNeeds([vals])];
                          const estSec = s.estimatedTimeSec;
                          const staged = dayState.stagedItems ?? {};
                          const stagedCount = rows.filter(row => staged[`${r.id}::${row.label}__${row.sub ?? ""}`]).length;
                          return (
                            <div key={r.id} className="rounded-md border border-border/40 bg-muted/10 p-3" data-testid={`warehouse-run-${r.id}`}>
                              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                                <span className="font-semibold text-sm truncate">{runLabel(r)}</span>
                                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                                  {rows.length > 0 ? `${stagedCount}/${rows.length} staged · ` : ""}{s.totalCases} case{s.totalCases !== 1 ? "s" : ""}{estSec > 0 ? ` · ~${fmtTime(estSec)}` : ""}
                                </span>
                              </div>
                              {rows.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">No materials configured yet.</p>
                              ) : (
                                <div className="space-y-1">
                                  {rows.map((row) => {
                                    const rowKey = `${row.label}__${row.sub ?? ""}`;
                                    const checked = !!staged[`${r.id}::${rowKey}`];
                                    return (
                                      <button
                                        key={rowKey}
                                        type="button"
                                        onClick={() => toggleStagedItem(r.id, rowKey)}
                                        aria-pressed={checked}
                                        data-testid={`stage-${r.id}-${rowKey}`}
                                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted/40 transition-colors"
                                      >
                                        {checked ? (
                                          <CheckSquare className="w-4 h-4 shrink-0 text-primary" />
                                        ) : (
                                          <Square className="w-4 h-4 shrink-0 text-muted-foreground/60" />
                                        )}
                                        <span className={`flex-1 truncate ${checked ? "line-through text-muted-foreground" : "text-muted-foreground"}`}>{row.label}</span>
                                        <span className={`font-bold tabular-nums whitespace-nowrap ${checked ? "text-muted-foreground" : "text-foreground"}`}>
                                          {row.value} <span className="font-normal text-muted-foreground">{row.sub}</span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  );
                })()}
                <Card className="bg-card/50 border-border/50 shadow-md mb-4">
                  <CardHeader className="pb-2 pt-4 px-5">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <CalendarDays className="w-4 h-4" /> Production Schedule
                      </CardTitle>
                      <button
                        type="button"
                        onClick={() => {
                          if (!isSupervisor) { setPinInput(""); setPinError(""); setShowPinDialog(true); return; }
                          fetch(`/api/sync/scheduled?include=runs&today=${todayStr()}`).then(r => r.json()).then(d => setScheduledDays(d as {date:string;runCount:number;runs?:{id:string;brand:string;flavor:string;casesNeeded:number;dieType:string}[]}[])).catch(() => {}); setScheduleView("list"); setScheduleDeleteConfirm(null); setShowScheduleDialog(true);
                        }}
                        title={isSupervisor ? "Manage production schedule" : "Supervisor only — tap to enter PIN"}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
                      >
                        {isSupervisor ? <CalendarPlus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} Manage
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {scheduledDays.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">No upcoming days scheduled. Tap Manage to plan future production.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {scheduledDays.map(day => (
                          <div key={day.date} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-muted/20 border border-border/30 text-sm">
                            <span className="font-medium">{day.date}</span>
                            <span className="text-xs text-muted-foreground">{day.runCount} run{day.runCount !== 1 ? "s" : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="inventory">
                {(() => {
                  const valsList = dayState.runs.map(r => r.id === currentRunId ? form.getValues() : loadRunValues(r.id));
                  const candidates = deriveCandidateItems(valsList);
                  // Suggestions for the substitution pickers: consumption-key names
                  // (cheese/pep types, Dough, Sauce, packaging) plus every recipe-row
                  // ingredient and non-empty type value across today's runs, so staff
                  // can target a recipe ingredient (e.g. Flour) too. Free text allowed.
                  const optSet = new Set<string>(candidates.map(c => c.name));
                  for (const v of valsList) {
                    const recipes = [
                      v.doughRecipe, v.frontlineRecipe,
                      v.app1CheeseRecipe, v.app2CheeseRecipe, v.app3CheeseRecipe, v.app4CheeseRecipe,
                    ];
                    for (const rows of recipes) for (const r of rows ?? []) if (r?.ingredient) optSet.add(r.ingredient);
                    for (const t of [v.app1Type, v.app2Type, v.app3Type, v.app4Type, v.pep1Type, v.pep2Type]) if (t) optSet.add(t);
                  }
                  return <InventoryTab
                    candidates={candidates}
                    runValsList={valsList}
                    substitutions={dayState.substitutions ?? []}
                    substitutionLog={dayState.substitutionLog ?? []}
                    substitutionOptions={[...optSet].sort()}
                    onAddSubstitution={addSubstitution}
                    onRemoveSubstitution={removeSubstitution}
                    onClearSubstitutions={clearSubstitutions}
                  />;
                })()}
              </TabsContent>

              {/* ─── MIXES ─── */}
              <TabsContent value="mixes">
                {/* Pre-blended mixes made ahead for a product. Pick a make-day;
                    for every scheduled run within a matching mix's days-early
                    window, show per-product cards with cases/pizzas, batches to
                    make, total lbs, and a "Pull For Mix" per-component lbs
                    breakdown. Scheduled runs carry no recipe rows, so resolve
                    each via its profile -> FormValues -> computeSummaryStats for
                    pizza/case counts, exactly like the warehouse card. Advisory
                    only — this never moves stock. */}
                <div className="space-y-4 max-w-2xl mx-auto pb-8">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Blend className="w-5 h-5 text-emerald-400" />
                    <h2 className="text-lg font-semibold">Mixes</h2>
                  </div>
                  <Card>
                    <CardContent className="px-4 py-3 flex items-center gap-3 flex-wrap">
                      <label htmlFor="mix-make-day" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                        Make day
                      </label>
                      <Input
                        id="mix-make-day"
                        type="date"
                        value={mixMakeDay}
                        onChange={(e) => setMixMakeDay(e.target.value || todayStr())}
                        className="w-auto"
                        data-testid="mix-make-day"
                      />
                    </CardContent>
                  </Card>
                  {(() => {
                    if (mixes.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground px-1">
                          No mixes defined yet.{canManageInventory ? " Add mixes under Settings → Mixes." : " Ask a manager to add mixes under Settings."}
                        </p>
                      );
                    }
                    const runs = scheduledDays.flatMap((day) =>
                      (day.runs ?? [])
                        .filter((r) => r.brand)
                        .map((r) => {
                          const profile = loadProfile(r.brand, r.flavor);
                          const vals: FormValues = {
                            ...(profile ?? DEFAULT_VALUES),
                            casesNeeded: r.casesNeeded,
                            ...(r.dieType ? { dieType: r.dieType } : {}),
                          };
                          const s = computeSummaryStats(vals);
                          return {
                            date: day.date,
                            brand: r.brand,
                            flavor: r.flavor,
                            pizzas: s.totalPizzas,
                            cases: s.totalCases,
                          };
                        }),
                    );
                    const plan = buildMixPlan({ runs, mixes, today: mixMakeDay });
                    if (plan.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground px-1" data-testid="mix-plan-empty">
                          No mixes to make for this day. Pick a make-day with scheduled runs whose product matches a mix (within its days-early window).
                        </p>
                      );
                    }
                    return (
                      <div className="space-y-3">
                        {plan.map((group) => (
                          <Card
                            key={group.date}
                            className="bg-emerald-950/30 border-emerald-700/40 shadow-md"
                            data-testid={`mix-plan-${group.date}`}
                          >
                            <CardHeader className="pb-2 pt-4 px-5">
                              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                                <Blend className="w-4 h-4" /> Mixes for {group.date}
                                <span className="ml-1 font-normal normal-case text-xs text-emerald-400/80">
                                  ({group.daysUntil === 0 ? "today" : `in ${group.daysUntil} day${group.daysUntil !== 1 ? "s" : ""}`})
                                </span>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="px-4 pb-4 space-y-3">
                              {group.runs.map((run, ri) => (
                                <div key={ri} className="rounded-md border border-emerald-800/40 bg-emerald-950/20 p-3">
                                  <div className="flex items-baseline justify-between gap-2 mb-2">
                                    <div className="font-semibold text-sm text-emerald-100 truncate">
                                      {run.brand}{run.flavor ? ` — ${run.flavor}` : ""}
                                    </div>
                                    <div className="text-xs text-emerald-300/80 whitespace-nowrap tabular-nums">
                                      {run.cases} case{run.cases !== 1 ? "s" : ""} · {run.pizzas} pizza{run.pizzas !== 1 ? "s" : ""}
                                    </div>
                                  </div>
                                  <div className="space-y-2.5">
                                    {run.mixes.map((m) => (
                                      <div key={m.mixId} className="rounded border border-emerald-800/30 bg-emerald-900/10 p-2.5">
                                        <div className="flex items-baseline justify-between gap-2 mb-1">
                                          <span className="font-medium text-sm text-emerald-50 truncate">
                                            {m.name}
                                            {m.daysEarly > 0 && (
                                              <span className="ml-1.5 text-[11px] text-emerald-400/70">make {m.daysEarly}d early</span>
                                            )}
                                          </span>
                                          <span className="font-bold tabular-nums whitespace-nowrap text-emerald-50 text-sm">
                                            {m.batchSize > 0 ? (
                                              <>{fmtNum(m.batches, 2)} <span className="font-normal text-emerald-300/80">batch{m.batches === 1 ? "" : "es"}</span></>
                                            ) : (
                                              <span className="font-normal text-emerald-300/80 text-xs">no batch size</span>
                                            )}
                                          </span>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-2 text-xs text-emerald-300/80 mb-1.5 tabular-nums">
                                          <span>Total {fmtNum(m.totalLbs, 2)} lbs</span>
                                          {m.amountAlreadyMade > 0 && (
                                            <span>have {fmtNum(m.amountAlreadyMade, 2)} → need {fmtNum(m.remainingLbs, 2)} lbs</span>
                                          )}
                                        </div>
                                        {m.notes && (
                                          <div className="text-[11px] text-emerald-400/70 italic mb-1.5">{m.notes}</div>
                                        )}
                                        <div className="space-y-1 pt-1 border-t border-emerald-800/30">
                                          <div className="text-[11px] uppercase tracking-wider text-emerald-400/70 font-semibold pt-1">Pull For Mix</div>
                                          {m.components.length === 0 ? (
                                            <div className="text-xs text-emerald-400/60">No components defined.</div>
                                          ) : (
                                            m.components.map((c, ci) => (
                                              <div key={ci} className="flex items-baseline justify-between gap-2 text-sm">
                                                <span className="text-emerald-200/90 truncate">{c.ingredient}</span>
                                                <span className="font-bold tabular-nums whitespace-nowrap text-emerald-50">
                                                  {fmtNum(c.lbs, 2)} <span className="font-normal text-emerald-300/80">lbs</span>
                                                </span>
                                              </div>
                                            ))
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </TabsContent>

              <TabsContent value="ai">
                <AssistantTab
                  buildInput={() =>
                    buildOptimizeInput({
                      date: todayStr(),
                      nowMs: Date.now(),
                      runToTime,
                      runs: dayState.runs,
                      runValuesFor: (id) => (id === currentRunId ? form.getValues() : loadRunValues(id)),
                      history,
                      scheduledDays: scheduledDays.map((d) => ({
                        date: d.date,
                        runs: (d.runs ?? []).map((r) => ({
                          brand: r.brand,
                          flavor: r.flavor,
                          casesNeeded: r.casesNeeded,
                          dieType: r.dieType,
                        })),
                      })),
                    })
                  }
                  buildRecipeContext={() =>
                    buildRecipeAssistContext(
                      form.getValues(),
                      [...cheeseIngredients, ...doughIngredients, ...frontlineIngredients],
                      {
                        brand: currentRun?.brand,
                        flavor: currentRun?.flavor,
                        casesNeeded: v.casesNeeded,
                        pizzasPerCase: v.pizzasPerCase,
                        doughballWeightOz: v.targetDoughballWeight,
                      },
                    )
                  }
                  onApplyRecipeSuggestion={applyRecipeSuggestion}
                  recipeApplyTargets={dayState.runs.map((r, i) => ({
                    id: r.id,
                    label: `Run ${i + 1} · ${runLabel(r)}`,
                  }))}
                  recipeDefaultTargetId={currentRunId}
                  onApplyAction={applyOptimizeAction}
                  onApplyVoiceCommand={applyVoiceCommand}
                  buildSummary={(scope) =>
                    scope === "week"
                      ? buildWeekSummaryInput({
                          date: todayStr(),
                          nowMs: Date.now(),
                          history,
                          runValuesForHistory: (day, run) => day.runValues?.[run.id],
                        })
                      : buildDaySummaryInput({
                          date: todayStr(),
                          nowMs: Date.now(),
                          runs: dayState.runs,
                          runValues: (run) =>
                            run.id === currentRunId ? form.getValues() : loadRunValues(run.id),
                        })
                  }
                  buildAnomaly={() =>
                    buildAnomalyInput({
                      date: todayStr(),
                      nowMs: Date.now(),
                      runs: dayState.runs,
                      runValues: (run) =>
                        run.id === currentRunId ? form.getValues() : loadRunValues(run.id),
                      history,
                      runValuesForHistory: (day, run) => day.runValues?.[run.id],
                    })
                  }
                  buildSchedule={() =>
                    buildScheduleInput({
                      nowMs: Date.now(),
                      runs: dayState.runs,
                      runValues: (run) =>
                        run.id === currentRunId ? form.getValues() : loadRunValues(run.id),
                    })
                  }
                  onApplySchedule={applyScheduleOrder}
                  buildForecast={(targetDate, horizonDays) =>
                    buildForecastInput({
                      targetDate: targetDate || tomorrowStr(),
                      horizonDays,
                      nowMs: Date.now(),
                      history,
                      runValuesForHistory: (day, run) => day.runValues?.[run.id],
                      scheduledDays: scheduledDays.map((d) => ({
                        date: d.date,
                        runs: (d.runs ?? []).map((r) => ({
                          brand: r.brand,
                          flavor: r.flavor,
                          casesNeeded: r.casesNeeded,
                          dieType: r.dieType,
                        })),
                      })),
                    })
                  }
                  onApplyForecast={applyForecast}
                  buildAccuracy={() =>
                    buildForecastAccuracyInput({
                      nowMs: Date.now(),
                      history,
                      runValuesForHistory: (day, run) => day.runValues?.[run.id],
                    })
                  }
                />
                <div className="mt-3">
                  <SpecReconcilePanel autoCheckSignal={specReconcileSignal} />
                </div>
              </TabsContent>

              <TabsContent value="incidents">
                <IncidentsTab />
              </TabsContent>

              <TabsContent value="quality">
                <QualityHistoryTab />
              </TabsContent>

              <TabsContent value="staff">
                <div className="space-y-4 pb-24">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold">Staff Roster</h2>
                  </div>
                  <StaffRolesCard />
                  <RolesManager />
                </div>
              </TabsContent>

              <TabsList className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-6 w-full rounded-none border-t border-border bg-background/95 backdrop-blur-sm print:hidden" style={{paddingBottom: "env(safe-area-inset-bottom)"}}>
                <TabsTrigger value="run" data-testid="tab-run" className="flex flex-col items-center gap-0.5 px-1">
                  <Activity className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] truncate">Run</span>
                </TabsTrigger>
                <TabsTrigger value="dough" data-testid="tab-dough" className="flex flex-col items-center gap-0.5 px-1">
                  <Layers className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] truncate">Dough</span>
                </TabsTrigger>
                <TabsTrigger value="sauce" data-testid="tab-sauce" className="flex flex-col items-center gap-0.5 px-1">
                  <Droplets className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] truncate">Sauce</span>
                </TabsTrigger>
                <TabsTrigger value="frontline" data-testid="tab-frontline" className="flex flex-col items-center gap-0.5 px-1">
                  <Boxes className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] truncate">Front</span>
                </TabsTrigger>
                <TabsTrigger value="packaging" data-testid="tab-packaging" className="flex flex-col items-center gap-0.5 px-1">
                  <Package className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] truncate">Pack</span>
                </TabsTrigger>
                <TabsTrigger value="warehouse" data-testid="tab-warehouse" className="flex flex-col items-center gap-0.5 px-1">
                  <Warehouse className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] truncate">Whse</span>
                </TabsTrigger>
              </TabsList>

              {/* ─── DOUGH ─── */}
              <TabsContent value="dough">
                {/* Supply progress steppers (moved from Current Progress) */}
                <div className="mb-4">
                  {(() => {
                    const s = autoTrackSuggestion;
                    const suppressed = Date.now() < autoSuppressUntilRef.current;
                    const suppressedMinsLeft = suppressed ? Math.ceil((autoSuppressUntilRef.current - Date.now()) / 60000) : 0;
                    const onManual = () => { autoSuppressUntilRef.current = Date.now() + AUTO_SUPPRESS_MS; };
                    const suggestedTrays = calc.traysNeeded > 0
                      ? Math.min(74, Math.max(1, Math.round(Math.min(40, calc.traysNeeded))))
                      : null;
                    const suggestedBatches = calc.batchesNeeded > 0
                      ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, calc.batchesNeeded))))
                      : null;
                    const trayAutoActive = autoTrackProgress && runStatus === "running" && !suppressed;
                    const batchAutoActive = autoTrackProgress && runStatus === "running" && !suppressed;
                    return (
                      <>
                        {autoTrackProgress && s && suppressed && (
                          <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-amber-950/20 border border-amber-600/20 text-[10px] mb-2">
                            <span className="text-amber-400 font-semibold">Manual override active · auto resumes in ~{suppressedMinsLeft} min</span>
                            <button type="button" onClick={() => { autoSuppressUntilRef.current = 0; lastAutoMinBucketRef.current = -1; }} className="text-amber-400 hover:text-amber-300 font-semibold ml-2">Resume now</button>
                          </div>
                        )}
                        <div className={doughSubTab !== "crusts" ? "grid grid-cols-2 gap-2" : ""}>
                          <div>
                            <StepperField
                              control={form.control}
                              name="traysOnLine"
                              label={trayAutoActive
                                ? (doughSubTab === "crusts" ? "Total Stacks Ready · Auto" : "Total Trays on Line · Auto")
                                : (doughSubTab === "crusts" ? "Total Stacks Ready" : "Total Trays on Line")}
                              max={74}
                              suggestion={!trayAutoActive ? suggestedTrays : null}
                              onSuggest={() => form.setValue("traysOnLine", suggestedTrays ?? v.traysOnLine, { shouldDirty: true })}
                              onManualChange={onManual}
                            />
                            {v.traysOnLine >= 74 && doughSubTab !== "crusts" && (
                              <p className="text-[11px] text-amber-400 font-semibold flex items-center gap-1 mt-1">
                                <AlertTriangle className="w-3 h-3 shrink-0" /> Line full — max 74 trays
                              </p>
                            )}
                          </div>
                          {doughSubTab !== "crusts" && (
                            <div>
                              <StepperField
                                control={form.control}
                                name="batchesReady"
                                label={batchAutoActive ? "Batches of Dough Ready · Auto" : "Batches of Dough Ready"}
                                max={3}
                                suggestion={!batchAutoActive ? suggestedBatches : null}
                                onSuggest={() => form.setValue("batchesReady", suggestedBatches ?? v.batchesReady, { shouldDirty: true })}
                                onManualChange={onManual}
                              />
                              {v.batchesReady >= 3 && (
                                <p className="text-[11px] text-amber-400 font-semibold flex items-center gap-1 mt-1">
                                  <AlertTriangle className="w-3 h-3 shrink-0" /> Max 3 batches — avoid over-mixing
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Skids / cases completed — mirrored from Packaging so the
                            packout can be updated without switching tabs */}
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <StepperField
                            control={form.control}
                            name="skidsCompleted"
                            label={autoTrackProgress && s && !suppressed ? "Total Skids Completed · Auto" : "Total Skids Completed"}
                            max={v.casesPerSkid > 0 ? Math.floor(v.casesNeeded / v.casesPerSkid) : undefined}
                            suggestion={!autoTrackProgress && s && s.skids !== v.skidsCompleted ? s.skids : null}
                            onSuggest={() => { form.setValue("skidsCompleted", s!.skids, { shouldDirty: true }); form.setValue("casesOnCurrentSkid", s!.casesOnSkid, { shouldDirty: true }); }}
                            onManualChange={onManual}
                          />
                          <StepperField
                            control={form.control}
                            name="casesOnCurrentSkid"
                            label={autoTrackProgress && s && !suppressed ? "Cases on Current Skid · Auto" : "Cases on Current Skid"}
                            max={v.casesPerSkid > 0 ? v.casesPerSkid : undefined}
                            suggestion={!autoTrackProgress && s && s.casesOnSkid !== v.casesOnCurrentSkid ? s.casesOnSkid : null}
                            onSuggest={() => { form.setValue("casesOnCurrentSkid", s!.casesOnSkid, { shouldDirty: true }); }}
                            onManualChange={onManual}
                          />
                        </div>
                      </>
                    );
                  })()}
                </div>
                <fieldset disabled={!isSupervisor} className={!isSupervisor ? "opacity-60 pointer-events-none" : ""}>
                {/* ── Crust run ── */}
                {doughSubTab === "crusts" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
                      <div className="h-1 bg-sky-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          What You Need Now
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-muted/20 rounded-lg p-3 text-center">
                            <p className="text-3xl font-mono font-bold text-sky-400 tabular-nums" data-testid="output-cases-to-open">{fmtNum(calc.casesLeftToOpen, 0)}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Cases to open</p>
                          </div>
                          <div className="bg-muted/20 rounded-lg p-3 text-center">
                            <p className="text-3xl font-mono font-bold tabular-nums" data-testid="output-stacks-needed">{fmtNum(calc.stacksNeededTotal, 0)}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Stacks to stage</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* ── Dough run ── */}
                {doughSubTab === "dough" && (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
                    <div className="h-1 bg-primary w-full" />
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        What You Need Now
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-muted/20 rounded-lg p-3 text-center">
                          <p className="text-3xl font-mono font-bold text-primary tabular-nums" data-testid="output-batches-needed">{fmtNum(calc.batchesNeeded, 2)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Batches to mix</p>
                        </div>
                        <div className="bg-muted/20 rounded-lg p-3 text-center">
                          <p className="text-3xl font-mono font-bold tabular-nums" data-testid="output-trays-needed">{fmtNum(calc.traysNeeded, 0)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Trays needed</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                  </>
                )}
                </fieldset>

                {/* Run to Time card — available to all roles */}
                {doughSubTab === "dough" && (() => {
                  const target = new Date(nowTime);
                  const [hrs, mins] = runToTime.split(":").map(Number);
                  target.setHours(hrs, mins, 0, 0);
                  if (target <= nowTime) target.setDate(target.getDate() + 1);
                  const minutesAvailable = Math.max(0, (target.getTime() - nowTime.getTime()) / 60000);
                  const timePerBatchMin = calc.timePerBatchSec / 60;
                  const onHandBatches = v.batchesReady ?? 0;
                  const onHandTrays = v.traysOnLine ?? 0;
                  const hasOnHand = onHandBatches > 0 || onHandTrays > 0;
                  // Total doughballs the line will consume in the available window
                  const totalDoughballsNeeded = calc.ppm > 0 ? calc.ppm * minutesAvailable : 0;
                  // Combine ALL on-hand dough into a single doughball count
                  const doughOnHand = onHandBatches * calc.perBatch + onHandTrays * calc.perTray;
                  // Net doughballs still needed after deducting everything on hand
                  const doughStillNeeded = Math.max(0, totalDoughballsNeeded - doughOnHand);
                  // Batches to mix — allow partial so the decimal shows a partial batch
                  const batchesStillToMix = calc.perBatch > 0 ? doughStillNeeded / calc.perBatch : 0;
                  // Trays those remaining batches will produce
                  const traysFromBatches = calc.perTray > 0 ? (batchesStillToMix * calc.perBatch) / calc.perTray : 0;
                  // Total cases the line will run in this window
                  const casesInWindow = v.pizzasPerCase > 0 ? Math.floor(totalDoughballsNeeded / v.pizzasPerCase) : 0;
                  const to12hr = (hhmm: string) => {
                    const [h, m] = hhmm.split(":").map(Number);
                    const ampm = h >= 12 ? "PM" : "AM";
                    const h12 = h % 12 || 12;
                    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                  };
                  const nowLabel = to12hr(
                    `${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}`
                  );
                  return (
                    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mt-0">
                      <div className="h-1 bg-amber-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" />
                          Run to Time
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs text-muted-foreground shrink-0">{nowLabel}</span>
                          <span className="text-xs text-muted-foreground shrink-0">→ run until</span>
                          <input
                            type="time"
                            value={runToTime}
                            onChange={(e) => {
                              const t = e.target.value;
                              setRunToTime(t);
                              const newDs = { ...dayStateRef.current, runToTime: t };
                              setDayState(newDs);
                              saveDayState(newDs);
                              schedulePush(newDs, 0);
                            }}
                            className="flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                          <span className="text-xs text-muted-foreground shrink-0 font-mono">{fmtNum(timePerBatchMin, 1)} min/batch</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-amber-400">
                              {Math.floor(minutesAvailable / 60) > 0 && `${Math.floor(minutesAvailable / 60)}h `}{Math.round(minutesAvailable % 60)}m
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Time available</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-primary">{fmtNum(batchesStillToMix, 2)}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Batches to mix</p>
                          </div>
                          {calc.perBatch > 0 && calc.perTray > 0 && (
                            <div className="bg-muted/30 rounded-lg p-2 text-center">
                              <p className="text-xl font-mono font-bold text-emerald-400">{Math.ceil(traysFromBatches)}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">Trays to make</p>
                            </div>
                          )}
                          {v.pizzasPerCase > 0 && (
                            <div className="bg-muted/30 rounded-lg p-2 text-center">
                              <p className="text-xl font-mono font-bold text-sky-400">{casesInWindow}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">Cases in window</p>
                            </div>
                          )}
                        </div>
                        {hasOnHand && (
                          <p className="text-[10px] text-muted-foreground mt-2">
                            {[
                              onHandBatches > 0 && `${onHandBatches} batch${onHandBatches !== 1 ? "es" : ""} ready`,
                              onHandTrays > 0 && `${onHandTrays} tray${onHandTrays !== 1 ? "s" : ""} on line`,
                            ].filter(Boolean).join(" · ")} already on hand — subtracted from totals
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Run to Time card — crust mode */}
                {doughSubTab === "crusts" && (() => {
                  const target = new Date(nowTime);
                  const [hrs, mins] = runToTime.split(":").map(Number);
                  target.setHours(hrs, mins, 0, 0);
                  if (target <= nowTime) target.setDate(target.getDate() + 1);
                  const minutesAvailable = Math.max(0, (target.getTime() - nowTime.getTime()) / 60000);
                  const pizzasByTime = calc.ppm * minutesAvailable;
                  const casesToOpenByTime = v.crustsPerCase > 0 ? Math.ceil(pizzasByTime / v.crustsPerCase) : 0;
                  const stacksByTime = calc.perTray > 0 ? Math.ceil(pizzasByTime / calc.perTray) : 0;
                  const stacksAlreadyOpen = v.traysOnLine ?? 0;
                  const moreStacksNeeded = Math.max(0, stacksByTime - stacksAlreadyOpen);
                  const moreCasesNeeded = v.crustsPerCase > 0 && v.crustsPerStack > 0
                    ? Math.max(0, casesToOpenByTime - Math.floor(stacksAlreadyOpen * v.crustsPerStack / v.crustsPerCase))
                    : casesToOpenByTime;
                  const hasAlreadyOpen = stacksAlreadyOpen > 0;
                  const to12hr = (hhmm: string) => {
                    const [h, m] = hhmm.split(":").map(Number);
                    const ampm = h >= 12 ? "PM" : "AM";
                    const h12 = h % 12 || 12;
                    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                  };
                  const nowLabel = to12hr(
                    `${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}`
                  );
                  return (
                    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mt-0">
                      <div className="h-1 bg-sky-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" />
                          Run to Time
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs text-muted-foreground shrink-0">{nowLabel}</span>
                          <span className="text-xs text-muted-foreground shrink-0">→ run until</span>
                          <input
                            type="time"
                            value={runToTime}
                            onChange={(e) => {
                              const t = e.target.value;
                              setRunToTime(t);
                              const newDs = { ...dayStateRef.current, runToTime: t };
                              setDayState(newDs);
                              saveDayState(newDs);
                              schedulePush(newDs, 0);
                            }}
                            className="flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-amber-400">
                              {Math.floor(minutesAvailable / 60) > 0 && `${Math.floor(minutesAvailable / 60)}h `}{Math.round(minutesAvailable % 60)}m
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Time available</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-sky-400">{casesToOpenByTime}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {hasAlreadyOpen ? "Cases total" : "Cases to open"}
                            </p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-primary">{stacksByTime}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {hasAlreadyOpen ? "Stacks total" : "Stacks to stage"}
                            </p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-emerald-400">{moreStacksNeeded}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">More stacks needed</p>
                          </div>
                        </div>
                        {hasAlreadyOpen && (
                          <p className="text-[10px] text-muted-foreground mt-2">
                            {stacksAlreadyOpen} stack{stacksAlreadyOpen !== 1 ? "s" : ""} already open — subtracted from totals
                            {moreCasesNeeded > 0 && ` · open ${moreCasesNeeded} more case${moreCasesNeeded !== 1 ? "s" : ""}`}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                <RecipeSubstitutionBadge
                  substitutions={dayState.substitutions ?? []}
                  recipes={[v.doughRecipe, v.frontlineRecipe, v.app1CheeseRecipe, v.app2CheeseRecipe, v.app3CheeseRecipe, v.app4CheeseRecipe]}
                  typeValues={[v.app1Type, v.app2Type, v.app3Type, v.app4Type, v.pep1Type, v.pep2Type]}
                />
                {doughSubTab === "dough" && (
                <ReadOnlyRecipeCard
                  title="Dough Recipe"
                  subtitle={v.doughRecipeName?.trim() || undefined}
                  recipe={v.doughRecipe ?? []}
                  accent="bg-orange-500/70"
                  scalable
                />
                )}
              </TabsContent>

              {/* ─── SETUP (recipe editors) ─── */}
              <TabsContent value="setup">
                {!isSupervisor && (
                  <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-xs text-muted-foreground">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    Supervisor access required to edit these settings
                  </div>
                )}
                <fieldset disabled={!isSupervisor} className={!isSupervisor ? "opacity-60 pointer-events-none" : ""}>
                <div className="space-y-5">
                  <DoughRecipeCard
                    batchesNeeded={calc.batchesNeeded}
                    fields={doughFields}
                    recipe={v.doughRecipe ?? []}
                    register={form.register}
                    targetWeight={Number(v.targetDoughballWeight ?? 0)}
                    doughBatchYield={Number(v.doughBatchYield)}
                    ingredientOptions={doughIngredients}
                    onAddIngredient={addDoughIngredient}
                    onRemoveIngredient={removeDoughIngredient}
                    onSetIngredient={(idx, val) => form.setValue(`doughRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                    onAppend={() => appendDough({ ingredient: "", lbs: 0 })}
                    onRemove={removeDough}
                    onTargetWeightChange={val => form.setValue("targetDoughballWeight", val, { shouldDirty: true })}
                    recipeName={v.doughRecipeName ?? ""}
                    recipeNameOptions={doughRecipeNames}
                    onAddRecipeName={addDoughRecipeName}
                    onRemoveRecipeName={removeDoughRecipeName}
                    onRecipeNameChange={val => {
                      form.setValue("doughRecipeName", val, { shouldDirty: true });
                      if (val.trim()) {
                        const preset = loadDoughRecipePresets()[val.trim()];
                        if (preset) { form.setValue("doughRecipe", preset.rows, { shouldDirty: true }); replaceDough(preset.rows); }
                      }
                    }}
                  />
                  <Card className="bg-card/50 border-border/50 shadow-md">
                    <button
                      type="button"
                      onClick={() => setSauceWeightsOpen(o => !o)}
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
                        value={v.frontlineRecipeName}
                        onChange={val => { form.setValue("frontlineRecipeName", val, { shouldDirty: true }); if (!val) { form.setValue("sauceOzPerPizza", 0, { shouldDirty: true }); form.setValue("sauceBarrelLbs", 0, { shouldDirty: true }); } else { const preset = loadFrontlineRecipePresets()[val.trim()]; if (preset) { form.setValue("frontlineRecipe", preset, { shouldDirty: true }); replaceFrontline(preset); } } }}
                        options={frontlineRecipeNames}
                        onAddOption={addFrontlineRecipeName}
                        onRemoveOption={removeFrontlineRecipeName}
                        allowClear
                      />
                      {v.frontlineRecipeName.trim() && (() => {
                        const hasRecipe = (v.frontlineRecipe ?? []).some(r => Number(r.lbs) > 0);
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
                              />
                            )}
                          </div>
                        );
                      })()}
                      {v.frontlineRecipeName.trim() && (
                        <FrontlineRecipeCard
                          embedded
                          fields={frontlineFields}
                          recipe={v.frontlineRecipe ?? []}
                          register={form.register}
                          ingredientOptions={frontlineIngredients}
                          onAddIngredient={addFrontlineIngredient}
                          onRemoveIngredient={removeFrontlineIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`frontlineRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendFrontline({ ingredient: "", lbs: 0 })}
                          onRemove={removeFrontline}
                          recipeName={v.frontlineRecipeName ?? ""}
                          recipeNameOptions={frontlineRecipeNames}
                          onAddRecipeName={addFrontlineRecipeName}
                          onRemoveRecipeName={removeFrontlineRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("frontlineRecipeName", val, { shouldDirty: true });
                            if (val.trim()) {
                              const preset = loadFrontlineRecipePresets()[val.trim()];
                              if (preset) { form.setValue("frontlineRecipe", preset, { shouldDirty: true }); replaceFrontline(preset); }
                            }
                          }}
                        />
                      )}

                      <TypeDropdown
                        label="Applicator 1"
                        value={v.app1Type}
                        onChange={val => { form.setValue("app1Type", val, { shouldDirty: true }); if (!val) { form.setValue("app1OzPerPizza", 0, { shouldDirty: true }); form.setValue("app1BatchLbs", 0, { shouldDirty: true }); } }}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app1Type.trim() && (() => {
                        const isMix = v.app1Type.trim().toLowerCase().includes("mix");
                        const hasRecipe = !isMix && (v.app1CheeseRecipe ?? []).some(r => Number(r.lbs) > 0);
                        return (
                          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="app1OzPerPizza" label="Oz Per Pizza" />
                            {!isMix && !hasRecipe && (
                              <NumField control={form.control} name="app1BatchLbs" label="Batch Weight (lbs)" />
                            )}
                          </div>
                        );
                      })()}
                      {v.app1Type.trim().toLowerCase() === "cheese" && (
                        <CheeseRecipeCard
                          embedded
                          label={v.app1Type || "Applicator 1"}
                          batches={calc.app1Batches}
                          fields={cheese1Fields}
                          recipe={v.app1CheeseRecipe ?? []}
                          fieldPrefix="app1CheeseRecipe"
                          recipeName={v.app1CheeseRecipeName ?? ""}
                          recipeNameOptions={cheeseRecipeNames}
                          register={form.register}
                          ingredientOptions={cheeseIngredients}
                          onAddIngredient={addCheeseIngredient}
                          onRemoveIngredient={removeCheeseIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`app1CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese1({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese1}
                          onAddRecipeName={addCheeseRecipeName}
                          onRemoveRecipeName={removeCheeseRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("app1CheeseRecipeName", val, { shouldDirty: true });
                            if (val.trim()) {
                              const preset = loadCheeseRecipePresets()[val.trim()];
                              if (preset) { form.setValue("app1CheeseRecipe", preset, { shouldDirty: true }); replaceCheese1(preset); }
                            }
                          }}
                        />
                      )}
                      {v.app1Type.trim().toLowerCase().includes("mix") && (
                        <MixRecipeCard
                          embedded
                          label={v.app1Type || "Applicator 1"}
                          totalRunLbs={calc.app1Lbs}
                          fields={cheese1Fields}
                          recipe={v.app1CheeseRecipe ?? []}
                          fieldPrefix="app1CheeseRecipe"
                          register={form.register}
                          ingredientOptions={mixIngredients}
                          onAddIngredient={addMixIngredient}
                          onRemoveIngredient={removeMixIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`app1CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese1({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese1}
                          recipeName={v.app1CheeseRecipeName ?? ""}
                          recipeNameOptions={allMixRecipeOptions}
                          onAddRecipeName={addMixRecipeName}
                          onRemoveRecipeName={removeMixRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("app1CheeseRecipeName", val, { shouldDirty: true });
                            const factoryPreset = currentMixPresets.find(p => p.name === val);
                            if (factoryPreset) { form.setValue("app1CheeseRecipe", factoryPreset.ingredients, { shouldDirty: true }); replaceCheese1(factoryPreset.ingredients); return; }
                            const userPreset = loadCheeseRecipePresets()[val.trim()];
                            if (userPreset) { form.setValue("app1CheeseRecipe", userPreset, { shouldDirty: true }); replaceCheese1(userPreset); }
                          }}
                        />
                      )}

                      <TypeDropdown
                        label="Applicator 2"
                        value={v.app2Type}
                        onChange={val => { form.setValue("app2Type", val, { shouldDirty: true }); if (!val) { form.setValue("app2OzPerPizza", 0, { shouldDirty: true }); form.setValue("app2BatchLbs", 0, { shouldDirty: true }); } }}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app2Type.trim() && (() => {
                        const isMix = v.app2Type.trim().toLowerCase().includes("mix");
                        const hasRecipe = !isMix && (v.app2CheeseRecipe ?? []).some(r => Number(r.lbs) > 0);
                        return (
                          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="app2OzPerPizza" label="Oz Per Pizza" />
                            {!isMix && !hasRecipe && (
                              <NumField control={form.control} name="app2BatchLbs" label="Batch Weight (lbs)" />
                            )}
                          </div>
                        );
                      })()}
                      {v.app2Type.trim().toLowerCase() === "cheese" && (
                        <CheeseRecipeCard
                          embedded
                          label={v.app2Type || "Applicator 2"}
                          batches={calc.app2Batches}
                          fields={cheese2Fields}
                          recipe={v.app2CheeseRecipe ?? []}
                          fieldPrefix="app2CheeseRecipe"
                          recipeName={v.app2CheeseRecipeName ?? ""}
                          recipeNameOptions={cheeseRecipeNames}
                          register={form.register}
                          ingredientOptions={cheeseIngredients}
                          onAddIngredient={addCheeseIngredient}
                          onRemoveIngredient={removeCheeseIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`app2CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese2({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese2}
                          onAddRecipeName={addCheeseRecipeName}
                          onRemoveRecipeName={removeCheeseRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("app2CheeseRecipeName", val, { shouldDirty: true });
                            if (val.trim()) {
                              const preset = loadCheeseRecipePresets()[val.trim()];
                              if (preset) { form.setValue("app2CheeseRecipe", preset, { shouldDirty: true }); replaceCheese2(preset); }
                            }
                          }}
                        />
                      )}
                      {v.app2Type.trim().toLowerCase().includes("mix") && (
                        <MixRecipeCard
                          embedded
                          label={v.app2Type || "Applicator 2"}
                          totalRunLbs={calc.app2Lbs}
                          fields={cheese2Fields}
                          recipe={v.app2CheeseRecipe ?? []}
                          fieldPrefix="app2CheeseRecipe"
                          register={form.register}
                          ingredientOptions={mixIngredients}
                          onAddIngredient={addMixIngredient}
                          onRemoveIngredient={removeMixIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`app2CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese2({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese2}
                          recipeName={v.app2CheeseRecipeName ?? ""}
                          recipeNameOptions={allMixRecipeOptions}
                          onAddRecipeName={addMixRecipeName}
                          onRemoveRecipeName={removeMixRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("app2CheeseRecipeName", val, { shouldDirty: true });
                            const factoryPreset = currentMixPresets.find(p => p.name === val);
                            if (factoryPreset) { form.setValue("app2CheeseRecipe", factoryPreset.ingredients, { shouldDirty: true }); replaceCheese2(factoryPreset.ingredients); return; }
                            const userPreset = loadCheeseRecipePresets()[val.trim()];
                            if (userPreset) { form.setValue("app2CheeseRecipe", userPreset, { shouldDirty: true }); replaceCheese2(userPreset); }
                          }}
                        />
                      )}

                      <TypeDropdown
                        label="Applicator 3"
                        value={v.app3Type}
                        onChange={val => { form.setValue("app3Type", val, { shouldDirty: true }); if (!val) { form.setValue("app3OzPerPizza", 0, { shouldDirty: true }); form.setValue("app3BatchLbs", 0, { shouldDirty: true }); } }}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app3Type.trim() && (() => {
                        const isMix = v.app3Type.trim().toLowerCase().includes("mix");
                        const hasRecipe = !isMix && (v.app3CheeseRecipe ?? []).some(r => Number(r.lbs) > 0);
                        return (
                          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="app3OzPerPizza" label="Oz Per Pizza" />
                            {!isMix && !hasRecipe && (
                              <NumField control={form.control} name="app3BatchLbs" label="Batch Weight (lbs)" />
                            )}
                          </div>
                        );
                      })()}
                      {v.app3Type.trim().toLowerCase() === "cheese" && (
                        <CheeseRecipeCard
                          embedded
                          label={v.app3Type || "Applicator 3"}
                          batches={calc.app3Batches}
                          fields={cheese3Fields}
                          recipe={v.app3CheeseRecipe ?? []}
                          fieldPrefix="app3CheeseRecipe"
                          recipeName={v.app3CheeseRecipeName ?? ""}
                          recipeNameOptions={cheeseRecipeNames}
                          register={form.register}
                          ingredientOptions={cheeseIngredients}
                          onAddIngredient={addCheeseIngredient}
                          onRemoveIngredient={removeCheeseIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`app3CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese3({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese3}
                          onAddRecipeName={addCheeseRecipeName}
                          onRemoveRecipeName={removeCheeseRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("app3CheeseRecipeName", val, { shouldDirty: true });
                            if (val.trim()) {
                              const preset = loadCheeseRecipePresets()[val.trim()];
                              if (preset) { form.setValue("app3CheeseRecipe", preset, { shouldDirty: true }); replaceCheese3(preset); }
                            }
                          }}
                        />
                      )}
                      {v.app3Type.trim().toLowerCase().includes("mix") && (
                        <MixRecipeCard
                          embedded
                          label={v.app3Type || "Applicator 3"}
                          totalRunLbs={calc.app3Lbs}
                          fields={cheese3Fields}
                          recipe={v.app3CheeseRecipe ?? []}
                          fieldPrefix="app3CheeseRecipe"
                          register={form.register}
                          ingredientOptions={mixIngredients}
                          onAddIngredient={addMixIngredient}
                          onRemoveIngredient={removeMixIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`app3CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese3({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese3}
                          recipeName={v.app3CheeseRecipeName ?? ""}
                          recipeNameOptions={allMixRecipeOptions}
                          onAddRecipeName={addMixRecipeName}
                          onRemoveRecipeName={removeMixRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("app3CheeseRecipeName", val, { shouldDirty: true });
                            const factoryPreset = currentMixPresets.find(p => p.name === val);
                            if (factoryPreset) { form.setValue("app3CheeseRecipe", factoryPreset.ingredients, { shouldDirty: true }); replaceCheese3(factoryPreset.ingredients); return; }
                            const userPreset = loadCheeseRecipePresets()[val.trim()];
                            if (userPreset) { form.setValue("app3CheeseRecipe", userPreset, { shouldDirty: true }); replaceCheese3(userPreset); }
                          }}
                        />
                      )}

                      <TypeDropdown
                        label="Applicator 4"
                        value={v.app4Type}
                        onChange={val => { form.setValue("app4Type", val, { shouldDirty: true }); if (!val) { form.setValue("app4OzPerPizza", 0, { shouldDirty: true }); form.setValue("app4BatchLbs", 0, { shouldDirty: true }); } }}
                        options={ingredientTypes}
                        onAddOption={addIngredientType}
                        onRemoveOption={removeIngredientType}
                        allowClear
                      />
                      {v.app4Type.trim() && (() => {
                        const isMix = v.app4Type.trim().toLowerCase().includes("mix");
                        const hasRecipe = !isMix && (v.app4CheeseRecipe ?? []).some(r => Number(r.lbs) > 0);
                        return (
                          <div className={isMix || hasRecipe ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                            <NumField control={form.control} name="app4OzPerPizza" label="Oz Per Pizza" />
                            {!isMix && !hasRecipe && (
                              <NumField control={form.control} name="app4BatchLbs" label="Batch Weight (lbs)" />
                            )}
                          </div>
                        );
                      })()}
                      {v.app4Type.trim().toLowerCase() === "cheese" && (
                        <CheeseRecipeCard
                          embedded
                          label={v.app4Type || "Applicator 4"}
                          batches={calc.app4Batches}
                          fields={cheese4Fields}
                          recipe={v.app4CheeseRecipe ?? []}
                          fieldPrefix="app4CheeseRecipe"
                          recipeName={v.app4CheeseRecipeName ?? ""}
                          recipeNameOptions={cheeseRecipeNames}
                          register={form.register}
                          ingredientOptions={cheeseIngredients}
                          onAddIngredient={addCheeseIngredient}
                          onRemoveIngredient={removeCheeseIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`app4CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese4({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese4}
                          onAddRecipeName={addCheeseRecipeName}
                          onRemoveRecipeName={removeCheeseRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("app4CheeseRecipeName", val, { shouldDirty: true });
                            if (val.trim()) {
                              const preset = loadCheeseRecipePresets()[val.trim()];
                              if (preset) { form.setValue("app4CheeseRecipe", preset, { shouldDirty: true }); replaceCheese4(preset); }
                            }
                          }}
                        />
                      )}
                      {v.app4Type.trim().toLowerCase().includes("mix") && (
                        <MixRecipeCard
                          embedded
                          label={v.app4Type || "Applicator 4"}
                          totalRunLbs={calc.app4Lbs}
                          fields={cheese4Fields}
                          recipe={v.app4CheeseRecipe ?? []}
                          fieldPrefix="app4CheeseRecipe"
                          register={form.register}
                          ingredientOptions={mixIngredients}
                          onAddIngredient={addMixIngredient}
                          onRemoveIngredient={removeMixIngredient}
                          onSetIngredient={(idx, val) => form.setValue(`app4CheeseRecipe.${idx}.ingredient`, val, { shouldDirty: true })}
                          onAppend={() => appendCheese4({ ingredient: "", lbs: 0 })}
                          onRemove={removeCheese4}
                          recipeName={v.app4CheeseRecipeName ?? ""}
                          recipeNameOptions={allMixRecipeOptions}
                          onAddRecipeName={addMixRecipeName}
                          onRemoveRecipeName={removeMixRecipeName}
                          onRecipeNameChange={val => {
                            form.setValue("app4CheeseRecipeName", val, { shouldDirty: true });
                            const factoryPreset = currentMixPresets.find(p => p.name === val);
                            if (factoryPreset) { form.setValue("app4CheeseRecipe", factoryPreset.ingredients, { shouldDirty: true }); replaceCheese4(factoryPreset.ingredients); return; }
                            const userPreset = loadCheeseRecipePresets()[val.trim()];
                            if (userPreset) { form.setValue("app4CheeseRecipe", userPreset, { shouldDirty: true }); replaceCheese4(userPreset); }
                          }}
                        />
                      )}

                      <TypeDropdown
                        label="Pep Applicator 1"
                        value={v.pep1Type}
                        onChange={val => { form.setValue("pep1Type", val, { shouldDirty: true }); if (!val || DEFAULT_PEP_TYPES.includes(val)) { form.setValue("pep1BatchLbs", 0, { shouldDirty: true }); } if (!val) { form.setValue("pep1Sticks", 0, { shouldDirty: true }); form.setValue("pep1OzPerPizza", 0, { shouldDirty: true }); } }}
                        options={pepTypes}
                        onAddOption={addPepType}
                        onRemoveOption={removePepType}
                        allowClear
                      />
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
                              />
                            </div>
                          )}
                        </>
                      )}

                      <TypeDropdown
                        label="Pep Applicator 2"
                        value={v.pep2Type}
                        onChange={val => { form.setValue("pep2Type", val, { shouldDirty: true }); if (!val || DEFAULT_PEP_TYPES.includes(val)) { form.setValue("pep2BatchLbs", 0, { shouldDirty: true }); } if (!val) { form.setValue("pep2Sticks", 0, { shouldDirty: true }); form.setValue("pep2OzPerPizza", 0, { shouldDirty: true }); } }}
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
                              />
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>}
                  </Card>
                </div>
                </fieldset>
              </TabsContent>

              {/* ─── STOPPAGES ─── */}
              <TabsContent value="stoppages">
                {/* ── Stoppage Log ── */}
                {currentRun && (() => {
                  const stoppages = currentRun.stoppages ?? [];
                  const hasActiveRun = !!currentRun.startedAt && !currentRun.endedAt;
                  if (stoppages.length === 0 && !hasActiveRun) return null;
                  const stopOnlyMs = stoppages.filter(s => s.endedAt && s.type !== "pause").reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
                  const noReasonCount = stoppages.filter(s => !s.reason.trim()).length;
                  return (
                    <div className="mb-5 rounded-lg border border-border/50 bg-card/40 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                        <div className="flex items-center gap-2">
                          <OctagonX className="w-4 h-4 text-orange-400 shrink-0" />
                          <span className="text-sm font-semibold">Stoppage Log</span>
                          {stoppages.length > 0 && <span className="text-xs text-muted-foreground">{stoppages.length} event{stoppages.length !== 1 ? "s" : ""}</span>}
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
                      {stoppages.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">No events recorded yet. Pauses and stops are logged automatically.</p>
                      ) : (
                        <div className="divide-y divide-border/20">
                          {[...stoppages].reverse().map(stop => {
                            const isPause = stop.type === "pause";
                            const isManual = stop.type === "manual";
                            const dur = stop.endedAt ? (stop.endedAt - stop.startedAt) / 1000 : null;
                            const isActive = !stop.endedAt;
                            const noReason = !stop.reason.trim();
                            return (
                              <div key={stop.id} className={`flex items-start gap-3 px-4 py-2.5 text-sm ${isActive && !isPause ? "bg-orange-950/20" : isActive && isPause ? "bg-blue-950/20" : ""}`}>
                                <div className="mt-0.5 shrink-0">
                                  {isPause
                                    ? <PauseCircle className={`w-3.5 h-3.5 ${isActive ? "text-blue-400 animate-pulse" : "text-blue-400/50"}`} />
                                    : <OctagonX className={`w-3.5 h-3.5 ${isActive ? "text-orange-400 animate-pulse" : "text-orange-400/50"}`} />
                                  }
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${isPause ? "text-blue-400/70" : isManual ? "text-violet-400/70" : "text-orange-400/70"}`}>
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
                      )}
                    </div>
                  );
                })()}
              </TabsContent>

              {/* ─── SUMMARY ─── */}
              <TabsContent value="summary">
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
                  const todayFinished = dayState.runs.filter(r => r.startedAt && r.endedAt);
                  if (todayFinished.length === 0 && histBenchmarkPpm === null) return null;
                  const todayTotalCases = todayFinished.reduce((acc, r) => {
                    const vals = loadRunValues(r.id);
                    return acc + (r.actualCases ?? computeSummaryStats(vals).totalCases);
                  }, 0);
                  const todayNetSec = todayFinished.reduce((acc, r) => {
                    const gross = (r.endedAt! - r.startedAt!) / 1000;
                    const dt = (r.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((a, s) => a + (s.endedAt! - s.startedAt) / 1000, 0);
                    return acc + Math.max(0, gross - dt);
                  }, 0);
                  const todayDowntimeSec = todayFinished.reduce((acc, r) => {
                    return acc + (r.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((a, s) => a + (s.endedAt! - s.startedAt) / 1000, 0);
                  }, 0);
                  const todayTotalPizzas = todayFinished.reduce((acc, r) => {
                    const vals = loadRunValues(r.id);
                    const cases = r.actualCases ?? computeSummaryStats(vals).totalCases;
                    return acc + cases * (vals.pizzasPerCase ?? 0);
                  }, 0);
                  const todayPpm = todayNetSec > 0 && todayTotalPizzas > 0 ? Math.round(todayTotalPizzas / (todayNetSec / 60)) : null;
                  const benchDiff = todayPpm !== null && histBenchmarkPpm !== null ? todayPpm - histBenchmarkPpm : null;
                  return (
                    <div className="mb-5 rounded-xl border border-border/50 bg-card/50 overflow-hidden">
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
                          Historical average: <span className="font-bold text-foreground">{histBenchmarkPpm} PPM</span> across {history.reduce((a, d) => a + d.runs.filter(r => r.startedAt && r.endedAt).length, 0)} finished runs
                        </div>
                      )}
                    </div>
                  );
                })()}


                {(() => {
                  const finishedRuns = dayState.runs.filter(r => !!r.endedAt);
                  const upcomingRuns = dayState.runs.filter((r, i) => !r.endedAt && i !== dayState.currentIndex);

                  function SummaryCard({ run, isCurrent, readOnly, runVals }: { run: RunMeta; isCurrent?: boolean; readOnly?: boolean; runVals?: FormValues }) {
                    const vals = runVals ?? (isCurrent ? v : loadRunValues(run.id));
                    const s = computeSummaryStats(vals);
                    const isFinished = !!run.endedAt;
                    const actualDurationSec = run.startedAt && run.endedAt
                      ? (run.endedAt - run.startedAt) / 1000
                      : null;
                    const frontlineItems: { label: string; value: string }[] = [];
                    if (s.sauceBatches > 0) {
                      const bd = sauceBarrelBreakdown(s.sauceBatches, s.sauceEffBarrel);
                      frontlineItems.push({ label: "Sauce", value: bd ? `${fmtNum(s.sauceBatches, 2)} batches · ${bd.totalBarrels} barrels` : fmtNum(s.sauceBatches, 2) + " barrels" });
                    }
                    if (s.app1Type) { const isMix = s.app1Type.trim().toLowerCase().includes("mix"); if (isMix ? s.app1Lbs > 0 : s.app1Batches > 0) frontlineItems.push({ label: `App 1 — ${s.app1Type}`, value: isMix ? fmtNum(s.app1Lbs, 1) + " lbs" : fmtNum(s.app1Batches, 2) + " batches" }); }
                    if (s.app2Type) { const isMix = s.app2Type.trim().toLowerCase().includes("mix"); if (isMix ? s.app2Lbs > 0 : s.app2Batches > 0) frontlineItems.push({ label: `App 2 — ${s.app2Type}`, value: isMix ? fmtNum(s.app2Lbs, 1) + " lbs" : fmtNum(s.app2Batches, 2) + " batches" }); }
                    if (s.app3Type) { const isMix = s.app3Type.trim().toLowerCase().includes("mix"); if (isMix ? s.app3Lbs > 0 : s.app3Batches > 0) frontlineItems.push({ label: `App 3 — ${s.app3Type}`, value: isMix ? fmtNum(s.app3Lbs, 1) + " lbs" : fmtNum(s.app3Batches, 2) + " batches" }); }
                    if (s.app4Type) { const isMix = s.app4Type.trim().toLowerCase().includes("mix"); if (isMix ? s.app4Lbs > 0 : s.app4Batches > 0) frontlineItems.push({ label: `App 4 — ${s.app4Type}`, value: isMix ? fmtNum(s.app4Lbs, 1) + " lbs" : fmtNum(s.app4Batches, 2) + " batches" }); }
                    if (s.pep1Type) frontlineItems.push({ label: `Pep 1 — ${s.pep1Type}`, value: DEFAULT_PEP_TYPES.includes(s.pep1Type) ? fmtNum(s.pep1Lbs, 2) + " lbs" : fmtNum(s.pep1Batches, 2) + " batches" });
                    if (s.pep2Type) frontlineItems.push({ label: `Pep 2 — ${s.pep2Type}`, value: DEFAULT_PEP_TYPES.includes(s.pep2Type) ? fmtNum(s.pep2Lbs, 2) + " lbs" : fmtNum(s.pep2Batches, 2) + " batches" });
                    const canEdit = !readOnly && (isSupervisor || isCurrent);
                    const caseDelta = run.actualCases != null ? run.actualCases - s.totalCases : null;

                    return (
                      <Card
                        className={`border-border/50 shadow-md ${!readOnly ? "cursor-pointer transition-colors hover:bg-accent/30" : ""} ${isCurrent ? "bg-primary/10 border-primary/40" : isFinished ? "bg-emerald-950/20 border-emerald-700/30" : "bg-card/50"}`}
                        onClick={readOnly ? undefined : () => { const idx = dayState.runs.indexOf(run); if (idx !== -1) { switchToRun(idx); setActiveTab("run"); } }}
                      >
                        <CardHeader className="pb-2 pt-4 px-5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-base font-semibold">{runLabel(run)}</CardTitle>
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
                            const ppm = vals.crustsPerCycle * vals.cycleSpeed * vals.speedAdjustment;
                            const expectedCases = ppm > 0 && vals.pizzasPerCase > 0
                              ? Math.floor(ppm * liveFreezerMin / vals.pizzasPerCase)
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
                                {frontlineItems.map(item => (
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
                        </CardContent>
                      </Card>
                    );
                  }

                  // ── Day Totals ──────────────────────────────────────────
                  const allRunStats = dayState.runs.map(run => {
                    const vals = run.id === currentRun.id ? v : loadRunValues(run.id);
                    return computeSummaryStats(vals);
                  });
                  const dayTotalCases = allRunStats.reduce((sum, s) => sum + s.totalCases, 0);
                  const dayTotalPizzas = allRunStats.reduce((sum, s) => sum + s.totalPizzas, 0);
                  const dayActualCases = dayState.runs.reduce((sum, r) => sum + (r.actualCases ?? 0), 0);

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
                    const vals = run.id === currentRun.id ? v : loadRunValues(run.id);
                    const s = computeSummaryStats(vals);
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
                    if (s.pep2Type && s.pep2Lbs > 0) shopAdd(`Pep — ${s.pep2Type}`, s.pep2Lbs, "lbs");
                  }
                  const shopList = [...shopMap.values()].sort((a, b) => a.name.localeCompare(b.name));

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
                        const productiveMs = runs.reduce((sum, r) => sum + (r.startedAt && r.endedAt ? r.endedAt - r.startedAt : 0), 0);
                        const gapMs = runs.reduce((sum, r, i) => {
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
                            {shopList.map(item => (
                              <div key={`${item.name}__${item.unit}`} className="flex justify-between text-sm">
                                <span className="text-foreground/80">{item.name}</span>
                                <span className="font-semibold tabular-nums">{fmtNum(item.totalQty, 1)} {item.unit}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* All runs in order with gap connectors */}
                      {dayState.runs.map((run, idx) => {
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
                              ? <SummaryCard run={run} isCurrent />
                              : <SummaryCard run={run} readOnly={isUpcoming ? false : undefined} />
                            }
                          </div>
                        );
                      })}
                      {/* History */}
                      {history.length > 0 && (
                        <div className="space-y-3 pt-2 border-t border-border/30">
                          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                            <History className="w-4 h-4" />
                            History ({history.length} {history.length === 1 ? "day" : "days"})
                          </div>
                          {history.map(day => {
                            const finishedRuns = day.runs.filter(r => r.endedAt && r.startedAt);
                            const totalHistCases = finishedRuns.reduce((acc, r) => {
                              const vals = day.runValues[r.id] ?? DEFAULT_VALUES;
                              return acc + (r.actualCases ?? computeSummaryStats(vals as FormValues).totalCases);
                            }, 0);
                            const totalHistNetSec = finishedRuns.reduce((acc, r) => {
                              const gross = (r.endedAt! - r.startedAt!) / 1000;
                              const dt = (r.stoppages ?? []).filter(s => s.endedAt && s.type !== "pause").reduce((a, s) => a + (s.endedAt! - s.startedAt) / 1000, 0);
                              return acc + Math.max(0, gross - dt);
                            }, 0);
                            const totalHistPizzas = finishedRuns.reduce((acc, r) => {
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
                                  {day.runs.map(run => (
                                    <SummaryCard
                                      key={run.id}
                                      run={run}
                                      readOnly
                                      runVals={day.runValues[run.id] as FormValues | undefined}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </TabsContent>

            </Tabs>
          </form>
        </Form>

        <ReportIssueDialog
          open={showReportIssue}
          onOpenChange={setShowReportIssue}
          screen={activeTab}
        />

        <GetStartedDialog
          open={showGetStarted}
          onOpenChange={setShowGetStarted}
          onDismiss={dismissGetStarted}
          onStartTour={() => setShowTour(true)}
          isManager={isManager}
        />

        <GuidedTour
          open={showTour}
          onClose={() => setShowTour(false)}
          onComplete={() => void markTourCompleted()}
          onNavigate={setActiveTab}
          isManager={isManager}
        />

        {/* ── Stop / Downtime Dialog ────────────────────────────────────────── */}
        {showStopDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowStopDialog(false)}>
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <OctagonX className="w-5 h-5 text-orange-400 shrink-0" />
                <h2 className="text-base font-bold">Log Line Stop</h2>
                <button type="button" onClick={() => setShowStopDialog(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tap a reason to log instantly</label>
                  {isSupervisor && (
                    <button type="button" onClick={() => setShowEditReasonsDialog(true)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                      <ListChecks className="w-3 h-3" /> Edit list
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {stopReasonsList.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { logStop(r, ""); setShowStopDialog(false); }}
                      className="px-3 py-3 rounded-md border border-orange-700/50 bg-orange-950/20 text-orange-300 text-sm font-semibold text-left hover:bg-orange-900/40 hover:border-orange-500 active:scale-95 transition-all"
                    >
                      {r}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setStopReason("Other")}
                    className={`px-3 py-3 rounded-md border text-sm font-semibold text-left transition-all ${stopReason === "Other" ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50"}`}
                  >
                    Other…
                  </button>
                </div>
                {stopReason === "Other" && (
                  <div className="space-y-2 pt-1">
                    <input
                      autoFocus
                      type="text"
                      value={stopNotes}
                      onChange={e => setStopNotes(e.target.value)}
                      placeholder="Describe the reason…"
                      className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => { logStop("Other", stopNotes.trim()); setShowStopDialog(false); }}
                      className="w-full px-4 py-2 rounded-md bg-orange-600 hover:bg-orange-500 text-white text-sm font-semibold transition-colors"
                    >
                      Log Stop Now
                    </button>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1 border-t border-border">
                <button type="button" onClick={() => setShowStopDialog(false)} className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors">Cancel</button>
                <button
                  type="button"
                  onClick={() => { logStop("", ""); setShowStopDialog(false); }}
                  className="flex-1 px-4 py-2 rounded-md border border-orange-700/60 text-orange-400 hover:bg-orange-950/40 text-sm font-semibold transition-colors"
                >
                  Log Without Reason
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Edit Stoppage Dialog ───────────────────────────────────────────── */}
        {editingStop && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditingStop(null)}>
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-bold">Edit Event</h2>
                <span className={`ml-1 text-xs font-semibold uppercase px-1.5 py-0.5 rounded ${editingStop.type === "pause" ? "bg-blue-500/20 text-blue-400" : editingStop.type === "manual" ? "bg-violet-500/20 text-violet-400" : "bg-orange-500/20 text-orange-400"}`}>
                  {editingStop.type ?? "stop"}
                </span>
                <button type="button" onClick={() => setEditingStop(null)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reason <span className="text-muted-foreground/50">(optional)</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {[...stopReasonsList, "Other"].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setEditingStop(s => s ? { ...s, reason: s.reason === r ? "" : r } : s)}
                      className={`px-3 py-2 rounded-md border text-sm font-medium text-left transition-colors ${editingStop.reason === r ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={[...stopReasonsList, "Other"].includes(editingStop.reason) ? "" : editingStop.reason}
                  onChange={e => setEditingStop(s => s ? { ...s, reason: e.target.value } : s)}
                  placeholder="Or type a custom reason…"
                  className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
                <input
                  type="text"
                  value={editingStop.notes ?? ""}
                  onChange={e => setEditingStop(s => s ? { ...s, notes: e.target.value } : s)}
                  placeholder="Optional notes…"
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start time</label>
                  <input
                    type="datetime-local"
                    value={new Date(editingStop.startedAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16)}
                    onChange={e => { const ts = new Date(e.target.value).getTime(); if (!isNaN(ts)) setEditingStop(s => s ? { ...s, startedAt: ts } : s); }}
                    className="w-full border border-input rounded-md px-2 py-1.5 text-xs bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">End time</label>
                  <input
                    type="datetime-local"
                    value={editingStop.endedAt ? new Date(editingStop.endedAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16) : ""}
                    onChange={e => { const ts = new Date(e.target.value).getTime(); setEditingStop(s => s ? { ...s, endedAt: isNaN(ts) ? undefined : ts } : s); }}
                    className="w-full border border-input rounded-md px-2 py-1.5 text-xs bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setEditingStop(null)} className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors">Cancel</button>
                <button
                  type="button"
                  onClick={() => { updateStop(editingStop.id, editingStop); setEditingStop(null); }}
                  className="flex-1 px-4 py-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Manual Entry Dialog ────────────────────────────────────────────── */}
        {showManualStopDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowManualStopDialog(false)}>
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <CalendarPlus className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-bold">Add Past Event</h2>
                <button type="button" onClick={() => setShowManualStopDialog(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-muted-foreground">Add a stop or pause that happened but wasn't logged at the time.</p>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</label>
                <div className="flex gap-2">
                  {(["stop", "pause"] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setManualStopType(t)}
                      className={`flex-1 py-2 rounded-md border text-sm font-semibold transition-colors ${manualStopType === t ? (t === "stop" ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-blue-500 bg-blue-500/10 text-blue-400") : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50"}`}
                    >
                      {t === "stop" ? "Line Stop" : "Pause"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start <span className="text-destructive">*</span></label>
                  <input
                    type="datetime-local"
                    value={manualStopStart}
                    onChange={e => setManualStopStart(e.target.value)}
                    className="w-full border border-input rounded-md px-2 py-1.5 text-xs bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">End <span className="text-muted-foreground/50">(opt)</span></label>
                  <input
                    type="datetime-local"
                    value={manualStopEnd}
                    onChange={e => setManualStopEnd(e.target.value)}
                    className="w-full border border-input rounded-md px-2 py-1.5 text-xs bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reason <span className="text-muted-foreground/50">(optional)</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {[...stopReasonsList, "Other"].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setManualStopReason(manualStopReason === r ? "" : r)}
                      className={`px-3 py-2 rounded-md border text-sm font-medium text-left transition-colors ${manualStopReason === r ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {manualStopReason && ![...stopReasonsList, "Other", ""].includes(manualStopReason) && (
                  <input type="text" value={manualStopReason} onChange={e => setManualStopReason(e.target.value)} placeholder="Custom reason…" className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring" />
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
                <input type="text" value={manualStopNotes} onChange={e => setManualStopNotes(e.target.value)} placeholder="Optional…" className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowManualStopDialog(false)} className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors">Cancel</button>
                <button
                  type="button"
                  disabled={!manualStopStart}
                  onClick={() => {
                    const startTs = new Date(manualStopStart).getTime();
                    const endTs = manualStopEnd ? new Date(manualStopEnd).getTime() : undefined;
                    if (isNaN(startTs)) return;
                    addManualStop("manual", startTs, endTs, manualStopReason.trim(), manualStopNotes.trim());
                    setShowManualStopDialog(false);
                  }}
                  className="flex-1 px-4 py-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors disabled:opacity-40"
                >
                  Add Event
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Edit Reasons List Dialog (Supervisor) ─────────────────────────── */}
        {showEditReasonsDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowEditReasonsDialog(false)}>
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-bold">Quick Reason List</h2>
                <button type="button" onClick={() => setShowEditReasonsDialog(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-2">
                {stopReasonsList.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex-1 text-sm px-3 py-2 rounded-md bg-muted/30 border border-border/50">{r}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = stopReasonsList.filter((_, j) => j !== i);
                        setStopReasonsList(updated);
                        localStorage.setItem(STOP_REASONS_KEY, JSON.stringify(updated));
                      }}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newReasonInput}
                  onChange={e => setNewReasonInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && newReasonInput.trim()) {
                      const updated = [...stopReasonsList, newReasonInput.trim()];
                      setStopReasonsList(updated);
                      localStorage.setItem(STOP_REASONS_KEY, JSON.stringify(updated));
                      setNewReasonInput("");
                    }
                  }}
                  placeholder="Add new reason…"
                  className="flex-1 border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  disabled={!newReasonInput.trim()}
                  onClick={() => {
                    const updated = [...stopReasonsList, newReasonInput.trim()];
                    setStopReasonsList(updated);
                    localStorage.setItem(STOP_REASONS_KEY, JSON.stringify(updated));
                    setNewReasonInput("");
                  }}
                  className="px-4 py-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStopReasonsList(DEFAULT_STOP_REASONS);
                  localStorage.setItem(STOP_REASONS_KEY, JSON.stringify(DEFAULT_STOP_REASONS));
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors"
              >
                Reset to defaults
              </button>
            </div>
          </div>
        )}

        {/* Hidden file inputs for imports — kept always-mounted so they can be
            triggered from the Manage Lists → Import section regardless of tab. */}
        <input
          ref={importInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleImportFile}
        />
        {isManager && (
          <input
            ref={specImportInputRef}
            type="file"
            accept=".xlsx"
            multiple
            className="hidden"
            onChange={handleSpecImportFile}
          />
        )}
        {isManager && (
          <input
            ref={premixImportInputRef}
            type="file"
            accept=".xlsx"
            multiple
            className="hidden"
            onChange={handlePremixImportFile}
          />
        )}

        {/* ── Change Password Dialog ───────────────────────────────────────── */}
        {showPasswordDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowPasswordDialog(false)}>
            <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-primary" />
                  <h2 className="font-bold text-base">Password</h2>
                </div>
                <button type="button" onClick={() => setShowPasswordDialog(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4">
                <ChangePasswordCard />
              </div>
            </div>
          </div>
        )}

        {/* ── Excel Import Dialog ──────────────────────────────────────────── */}
        <ExcelImportDialog
          open={showImportDialog}
          onClose={() => { setShowImportDialog(false); setImportResult(null); setImportIntoEditor(false); }}
          result={importResult}
          brands={brands}
          brandFlavors={brandFlavors}
          canCreate={isSupervisor}
          defaultDate={importDefaultDate}
          onConfirm={(payload) => {
            if (payload.multiDay) { void commitMultiDayImport(payload); return; }
            if (importIntoEditor) importExcelIntoEditor(payload);
            else void commitExcelImport(payload);
          }}
          progress={importProgress}
        />

        {/* ── Spec Sheet Import Dialog ─────────────────────────────────────── */}
        <SpecImportDialog
          open={showSpecImport}
          onClose={() => { setShowSpecImport(false); setSpecImportPrepared(null); setSpecImportError(null); }}
          loading={specImportLoading}
          progress={specImportProgress}
          error={specImportError}
          prepared={specImportPrepared}
          applying={specImportApplying}
          onConfirm={handleSpecImportConfirm}
        />

        {/* ── Premix Sheet Import Dialog ───────────────────────────────────── */}
        <PremixImportDialog
          open={showPremixImport}
          onClose={() => { setShowPremixImport(false); setPremixImportPrepared(null); setPremixImportError(null); }}
          loading={premixImportLoading}
          progress={premixImportProgress}
          error={premixImportError}
          prepared={premixImportPrepared}
          applying={premixImportApplying}
          onConfirm={handlePremixImportConfirm}
        />

        {/* ── Schedule Future Days Dialog ──────────────────────────────────── */}
        {showScheduleDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowScheduleDialog(false)}>
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {scheduleView === "list" ? (
                <>
                  <div className="flex items-center gap-2 px-5 py-4 border-b border-border/40">
                    <CalendarPlus className="w-5 h-5 text-primary shrink-0" />
                    <h2 className="text-base font-bold flex-1">Scheduled Days</h2>
                    <button type="button" onClick={() => setShowScheduleDialog(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-3 min-h-0">
                    {scheduledDays.length === 0 ? (
                      <div className="text-center py-10">
                        <CalendarPlus className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm font-medium text-muted-foreground">No days scheduled yet</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Pre-plan a future day's runs so they load automatically at midnight.</p>
                      </div>
                    ) : scheduledDays.map(day => {
                      const isExpanded = expandedScheduleDay === day.date;
                      return (
                        <div key={day.date} className="rounded-lg bg-muted/30 border border-border/50 overflow-hidden">
                          {/* ── Header row ── */}
                          <div className="flex items-center justify-between gap-3 p-3">
                            <button
                              type="button"
                              className="flex items-center gap-2 min-w-0 flex-1 text-left"
                              onClick={() => setExpandedScheduleDay(isExpanded ? null : day.date)}
                            >
                              <ChevronDown
                                className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">
                                  {new Date(day.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                                </p>
                                <p className="text-xs text-muted-foreground">{day.runCount} run{day.runCount !== 1 ? "s" : ""} planned</p>
                              </div>
                            </button>
                            <div className="flex gap-1.5 shrink-0 items-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setScheduleDeleteConfirm(null);
                                  if (scheduleMove?.from === day.date && scheduleMove.runId === null) {
                                    setScheduleMove(null);
                                  } else {
                                    setScheduleMove({ from: day.date, runId: null });
                                    setScheduleMoveDate(tomorrowStr());
                                  }
                                }}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <ArrowRight className="w-3 h-3" /> Move
                              </button>
                              <button
                                type="button"
                                onClick={() => openScheduleEditor(day.date)}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Pencil className="w-3 h-3" /> Edit
                              </button>
                              {scheduleDeleteConfirm === day.date ? (
                                <span className="flex gap-1 items-center">
                                  <button type="button" className="px-2 py-1 text-xs rounded-md bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => deleteScheduledDay(day.date)}>Yes</button>
                                  <button type="button" className="px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors" onMouseDown={() => setScheduleDeleteConfirm(null)}>No</button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setScheduleDeleteConfirm(day.date)}
                                  className="p-1 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {/* ── Move whole-day panel ── */}
                          {scheduleMove?.from === day.date && scheduleMove.runId === null && (
                            <div className="border-t border-border/40 px-3 py-2.5 bg-primary/5">
                              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground block mb-1.5">Move all runs to</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="date"
                                  value={scheduleMoveDate}
                                  min={tomorrowStr()}
                                  onChange={e => setScheduleMoveDate(e.target.value)}
                                  className="flex-1 h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-xs outline-none focus:border-primary/60 transition-colors"
                                />
                                <button
                                  type="button"
                                  disabled={scheduleMoving || !scheduleMoveDate || scheduleMoveDate === day.date}
                                  onClick={async () => {
                                    setScheduleMoving(true);
                                    await performScheduleMove(day.date, "all", scheduleMoveDate);
                                    setScheduleMoving(false);
                                    setScheduleMove(null);
                                  }}
                                  className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                >
                                  {scheduleMoving ? "Moving…" : "Move"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setScheduleMove(null)}
                                  className="px-3 py-1.5 text-xs rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          {/* ── Expandable run list ── */}
                          <div
                            className="overflow-hidden transition-all duration-200"
                            style={{ maxHeight: isExpanded ? `${(day.runs?.length ?? 0) * 72 + 8}px` : "0px", opacity: isExpanded ? 1 : 0 }}
                          >
                            <div className="border-t border-border/40 px-3 pb-2 pt-1 space-y-1">
                              {(day.runs ?? []).length === 0 ? (
                                <p className="text-xs text-muted-foreground/60 py-1 pl-5">No runs recorded</p>
                              ) : (day.runs ?? []).map((run, i) => (
                                <div key={i} className="py-1 pl-5">
                                  <div className="flex items-center gap-2">
                                    <span className="w-4 h-4 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                                    <span className="text-xs font-medium truncate flex-1">
                                      {run.brand}{run.flavor ? ` — ${run.flavor}` : ""}
                                    </span>
                                    {run.casesNeeded > 0 && (
                                      <span className="text-xs text-muted-foreground shrink-0">{run.casesNeeded} cs</span>
                                    )}
                                    <button
                                      type="button"
                                      disabled={!run.id}
                                      onClick={() => {
                                        if (scheduleMove?.from === day.date && scheduleMove.runId === run.id) {
                                          setScheduleMove(null);
                                        } else {
                                          setScheduleMove({ from: day.date, runId: run.id });
                                          setScheduleMoveDate(tomorrowStr());
                                        }
                                      }}
                                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
                                    >
                                      <ArrowRight className="w-2.5 h-2.5" /> Move
                                    </button>
                                  </div>
                                  {scheduleMove?.from === day.date && scheduleMove.runId === run.id && run.id && (
                                    <div className="flex items-center gap-2 mt-1.5 ml-6">
                                      <input
                                        type="date"
                                        value={scheduleMoveDate}
                                        min={tomorrowStr()}
                                        onChange={e => setScheduleMoveDate(e.target.value)}
                                        className="flex-1 h-7 px-2 rounded-md bg-muted/40 border border-border/60 text-xs outline-none focus:border-primary/60 transition-colors"
                                      />
                                      <button
                                        type="button"
                                        disabled={scheduleMoving || !scheduleMoveDate || scheduleMoveDate === day.date}
                                        onClick={async () => {
                                          setScheduleMoving(true);
                                          await performScheduleMove(day.date, { runId: run.id }, scheduleMoveDate);
                                          setScheduleMoving(false);
                                          setScheduleMove(null);
                                        }}
                                        className="px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                      >
                                        {scheduleMoving ? "Moving…" : "Move"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setScheduleMove(null)}
                                        className="px-2.5 py-1 text-xs rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-5 py-4 border-t border-border/40">
                    <button
                      type="button"
                      onClick={() => openScheduleEditor()}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                    >
                      <Plus className="w-4 h-4" /> Schedule New Day
                    </button>
                  </div>
                </>
              ) : scheduleView === "editor" ? (
                <>
                  <div className="flex items-center gap-2 px-5 py-4 border-b border-border/40">
                    <button type="button" onClick={() => setScheduleView("list")} className="text-muted-foreground hover:text-foreground -ml-1 mr-0.5">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <CalendarPlus className="w-5 h-5 text-primary shrink-0" />
                    <h2 className="text-base font-bold flex-1">
                      {scheduleEditorDate ? `Plan for ${new Date(scheduleEditorDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Plan Future Day"}
                    </h2>
                    <button type="button" onClick={() => setShowScheduleDialog(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-5 min-h-0">
                    {/* Date picker */}
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground block mb-1.5">Date</label>
                      <input
                        type="date"
                        value={scheduleEditorDate}
                        min={todayStr()}
                        onChange={e => setScheduleEditorDate(e.target.value)}
                        className="w-full h-9 px-3 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                      />
                    </div>
                    {/* Runs */}
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Runs</label>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => scheduleImportInputRef.current?.click()}
                            className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                          >
                            <Upload className="w-3.5 h-3.5" /> Import Excel
                          </button>
                          <input
                            ref={scheduleImportInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            onChange={handleScheduleImportFile}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const newId = genId();
                              setScheduleEditorRuns(prev => [...prev, { id: newId, brand: "", flavor: "", casesNeeded: 0 }]);
                              setScheduleEditorRunValues(prev => ({ ...prev, [newId]: { ...DEFAULT_VALUES } }));
                            }}
                            className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Run
                          </button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {scheduleEditorRuns.map((run, idx) => (
                          <div key={run.id} className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-muted-foreground">Run {idx + 1}</span>
                              {scheduleEditorRuns.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setScheduleEditorRuns(prev => prev.filter((_, i) => i !== idx))}
                                  className="text-muted-foreground/40 hover:text-destructive transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">Brand</label>
                                <select
                                  value={run.brand}
                                  onChange={e => {
                                    const brand = e.target.value;
                                    setScheduleEditorRuns(prev => prev.map((r, i) => i === idx ? { ...r, brand, flavor: "" } : r));
                                    const profile = brand ? loadProfile(brand, "") : null;
                                    setScheduleEditorRunValues(prev => ({
                                      ...prev,
                                      [run.id]: { ...(profile ?? DEFAULT_VALUES), casesNeeded: prev[run.id]?.casesNeeded ?? 0 },
                                    }));
                                  }}
                                  className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                                >
                                  <option value="">— Brand —</option>
                                  {brands.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">Flavor</label>
                                <select
                                  value={run.flavor}
                                  onChange={e => {
                                    const flavor = e.target.value;
                                    setScheduleEditorRuns(prev => prev.map((r, i) => i === idx ? { ...r, flavor } : r));
                                    const profile = run.brand ? loadProfile(run.brand, flavor) : null;
                                    if (profile) setScheduleEditorRunValues(prev => ({
                                      ...prev,
                                      [run.id]: { ...profile, casesNeeded: prev[run.id]?.casesNeeded ?? 0 },
                                    }));
                                  }}
                                  disabled={!run.brand}
                                  className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors disabled:opacity-40"
                                >
                                  <option value="">— Flavor —</option>
                                  {(brandFlavors[run.brand] ?? []).map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">Cases Needed</label>
                              <input
                                type="number"
                                min="0"
                                value={run.casesNeeded || ""}
                                onChange={e => setScheduleEditorRuns(prev => prev.map((r, i) => i === idx ? { ...r, casesNeeded: Number(e.target.value) || 0 } : r))}
                                placeholder="0"
                                className="w-full h-8 px-3 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => { setScheduleAdvancedRunId(run.id); setScheduleView("advanced"); }}
                              className="flex items-center justify-between w-full pt-1 border-t border-border/30 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 hover:text-primary transition-colors"
                            >
                              <span>Full Recipe &amp; Settings</span>
                              <ChevronLeft className="w-3 h-3 rotate-180" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-4 border-t border-border/40 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setScheduleView("list")}
                      className="flex-1 py-2 px-4 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/40 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!scheduleEditorDate || scheduleSaving || scheduleEditorRuns.some(r => !r.brand || !r.casesNeeded)}
                      onClick={saveScheduledDay}
                      className="flex-1 py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {scheduleSaving ? "Saving…" : "Save Schedule"}
                    </button>
                  </div>
                </>
              ) : scheduleAdvancedRunId ? (
                <>
                  {/* ── Advanced Settings full-form view ──────────────────────── */}
                  <div className="flex items-center gap-2 px-5 py-4 border-b border-border/40">
                    <button type="button" onClick={() => setScheduleView("editor")} className="text-muted-foreground hover:text-foreground -ml-1 mr-0.5">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <h2 className="text-base font-bold flex-1">
                      {(() => { const r = scheduleEditorRuns.find(r => r.id === scheduleAdvancedRunId); return r?.brand ? `${r.brand}${r.flavor ? ` / ${r.flavor}` : ""} — Settings` : "Advanced Settings"; })()}
                    </h2>
                    <button type="button" onClick={() => setShowScheduleDialog(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 min-h-0 space-y-6">
                    {/* ── Dough & Crust ──────────────────────────────────────── */}
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 pb-1 border-b border-border/30">Dough &amp; Crust</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          ["targetDoughballWeight", "Target Ball Wt (oz)"],
                          ["casesPerSkid", "Cases / Skid"],
                          ["crustsPerCycle", "Crusts / Cycle"],
                          ["cycleSpeed", "Cycle Speed (rpm)"],
                          ["speedAdjustment", "Speed Adj"],
                          ["approxLineSpeed", "Line Speed"],
                          ["freezerTime", "Freezer Time (min)"],
                          ["pizzasPerCase", "Pizzas / Case"],
                          ["casesPerLayer", "Cases / Layer"],
                          ["doughballsPerTray", "Doughballs / Tray"],
                          ["crustsPerStack", "Crusts / Stack"],
                          ["crustsPerCase", "Crusts / Case"],
                          ["doughBatchYield", "Dough Batch Yield"],
                        ] as [keyof FormValues, string][]).map(([field, label]) => (
                          <div key={field}>
                            <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">{label}</label>
                            <input type="number" min="0"
                              value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[field] as number) || ""}
                              onChange={e => updateAdvancedField(scheduleAdvancedRunId!, field, Number(e.target.value) || 0)}
                              placeholder="0"
                              className="w-full h-8 px-3 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-3">
                        <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">Die Type</label>
                        <select
                          value={scheduleEditorRunValues[scheduleAdvancedRunId]?.dieType ?? ""}
                          onChange={e => updateAdvancedField(scheduleAdvancedRunId!, "dieType", e.target.value)}
                          className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                        >
                          <option value="">— Select —</option>
                          {dieTypes.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                    </section>
                    {/* ── Dough Recipe ───────────────────────────────────────── */}
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 pb-1 border-b border-border/30">Dough Recipe</h3>
                      <div className="mb-2">
                        <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">Recipe Name</label>
                        <select
                          value={scheduleEditorRunValues[scheduleAdvancedRunId]?.doughRecipeName ?? ""}
                          onChange={e => updateAdvancedField(scheduleAdvancedRunId!, "doughRecipeName", e.target.value)}
                          className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                        >
                          <option value="">— Select —</option>
                          {doughRecipeNames.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        {(scheduleEditorRunValues[scheduleAdvancedRunId]?.doughRecipe ?? []).map((row, ri) => (
                          <div key={ri} className="flex gap-2 items-center">
                            <select value={row.ingredient}
                              onChange={e => { const rows = [...(scheduleEditorRunValues[scheduleAdvancedRunId]?.doughRecipe ?? [])]; rows[ri] = { ...rows[ri], ingredient: e.target.value }; updateAdvancedArray(scheduleAdvancedRunId!, "doughRecipe", rows); }}
                              className="flex-1 h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                            >
                              <option value="">— Ingredient —</option>
                              {doughIngredients.map(i => <option key={i} value={i}>{i}</option>)}
                            </select>
                            <input type="number" min="0" step="0.1" value={row.lbs || ""}
                              onChange={e => { const rows = [...(scheduleEditorRunValues[scheduleAdvancedRunId]?.doughRecipe ?? [])]; rows[ri] = { ...rows[ri], lbs: Number(e.target.value) || 0 }; updateAdvancedArray(scheduleAdvancedRunId!, "doughRecipe", rows); }}
                              placeholder="lbs" className="w-20 h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                            />
                            <button type="button" onClick={() => updateAdvancedArray(scheduleAdvancedRunId!, "doughRecipe", (scheduleEditorRunValues[scheduleAdvancedRunId]?.doughRecipe ?? []).filter((_, i) => i !== ri))} className="text-muted-foreground/40 hover:text-destructive transition-colors"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => updateAdvancedArray(scheduleAdvancedRunId!, "doughRecipe", [...(scheduleEditorRunValues[scheduleAdvancedRunId]?.doughRecipe ?? []), { ingredient: "", lbs: 0 }])} className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors mt-1"><Plus className="w-3 h-3" /> Add Ingredient</button>
                      </div>
                    </section>
                    {/* ── Applicators & Sauce ────────────────────────────────── */}
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 pb-1 border-b border-border/30">Applicators &amp; Sauce</h3>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">Sauce Oz / Pizza</label>
                            <input type="number" min="0" step="0.1" value={scheduleEditorRunValues[scheduleAdvancedRunId]?.sauceOzPerPizza || ""} onChange={e => updateAdvancedField(scheduleAdvancedRunId!, "sauceOzPerPizza", Number(e.target.value) || 0)} placeholder="0" className="w-full h-8 px-3 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors" />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">Sauce Barrel (lbs)</label>
                            <input type="number" min="0" value={scheduleEditorRunValues[scheduleAdvancedRunId]?.sauceBarrelLbs || ""} onChange={e => updateAdvancedField(scheduleAdvancedRunId!, "sauceBarrelLbs", Number(e.target.value) || 0)} placeholder="0" className="w-full h-8 px-3 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors" />
                          </div>
                        </div>
                        {([1, 2, 3, 4] as const).map(n => (
                          <div key={n} className="rounded-md bg-muted/20 p-2.5 space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Applicator {n}</p>
                            <select value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[`app${n}Type` as keyof FormValues] as string) ?? ""}
                              onChange={e => updateAdvancedField(scheduleAdvancedRunId!, `app${n}Type` as keyof FormValues, e.target.value)}
                              className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                            >
                              <option value="">— Type —</option>
                              {ingredientTypes.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-muted-foreground mb-0.5 block">Oz / Pizza</label>
                                <input type="number" min="0" step="0.1" value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[`app${n}OzPerPizza` as keyof FormValues] as number) || ""}
                                  onChange={e => updateAdvancedField(scheduleAdvancedRunId!, `app${n}OzPerPizza` as keyof FormValues, Number(e.target.value) || 0)}
                                  placeholder="0" className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground mb-0.5 block">Batch (lbs)</label>
                                <input type="number" min="0" value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[`app${n}BatchLbs` as keyof FormValues] as number) || ""}
                                  onChange={e => updateAdvancedField(scheduleAdvancedRunId!, `app${n}BatchLbs` as keyof FormValues, Number(e.target.value) || 0)}
                                  placeholder="0" className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                        {([1, 2] as const).map(n => (
                          <div key={n} className="rounded-md bg-muted/20 p-2.5 space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pepperoni {n}</p>
                            <select value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[`pep${n}Type` as keyof FormValues] as string) ?? ""}
                              onChange={e => updateAdvancedField(scheduleAdvancedRunId!, `pep${n}Type` as keyof FormValues, e.target.value)}
                              className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                            >
                              <option value="">— Type —</option>
                              {pepTypes.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="text-[10px] text-muted-foreground mb-0.5 block">Sticks</label>
                                <input type="number" min="0" value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[`pep${n}Sticks` as keyof FormValues] as number) || ""}
                                  onChange={e => updateAdvancedField(scheduleAdvancedRunId!, `pep${n}Sticks` as keyof FormValues, Number(e.target.value) || 0)}
                                  placeholder="0" className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground mb-0.5 block">Oz / Pizza</label>
                                <input type="number" min="0" step="0.1" value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[`pep${n}OzPerPizza` as keyof FormValues] as number) || ""}
                                  onChange={e => updateAdvancedField(scheduleAdvancedRunId!, `pep${n}OzPerPizza` as keyof FormValues, Number(e.target.value) || 0)}
                                  placeholder="0" className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground mb-0.5 block">Batch (lbs)</label>
                                <input type="number" min="0" value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[`pep${n}BatchLbs` as keyof FormValues] as number) || ""}
                                  onChange={e => updateAdvancedField(scheduleAdvancedRunId!, `pep${n}BatchLbs` as keyof FormValues, Number(e.target.value) || 0)}
                                  placeholder="0" className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                    {/* ── Cheese / Mix Recipes (App 1–4) ─────────────────────── */}
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 pb-1 border-b border-border/30">Cheese / Mix Recipes</h3>
                      <div className="space-y-4">
                        {([1, 2, 3, 4] as const).map(n => {
                          const recipeField = `app${n}CheeseRecipe` as keyof FormValues;
                          const nameField = `app${n}CheeseRecipeName` as keyof FormValues;
                          const rows = (scheduleEditorRunValues[scheduleAdvancedRunId]?.[recipeField] ?? []) as {ingredient: string; lbs: number}[];
                          return (
                            <div key={n}>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">App {n} Recipe</p>
                              <div className="mb-2">
                                <select value={(scheduleEditorRunValues[scheduleAdvancedRunId]?.[nameField] as string) ?? ""}
                                  onChange={e => updateAdvancedField(scheduleAdvancedRunId!, nameField, e.target.value)}
                                  className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                                >
                                  <option value="">— Recipe Name —</option>
                                  {cheeseRecipeNames.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                {rows.map((row, ri) => (
                                  <div key={ri} className="flex gap-2 items-center">
                                    <select value={row.ingredient}
                                      onChange={e => { const next = [...rows]; next[ri] = { ...next[ri], ingredient: e.target.value }; updateAdvancedArray(scheduleAdvancedRunId!, recipeField, next); }}
                                      className="flex-1 h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                                    >
                                      <option value="">— Ingredient —</option>
                                      {cheeseIngredients.map(i => <option key={i} value={i}>{i}</option>)}
                                    </select>
                                    <input type="number" min="0" step="0.1" value={row.lbs || ""}
                                      onChange={e => { const next = [...rows]; next[ri] = { ...next[ri], lbs: Number(e.target.value) || 0 }; updateAdvancedArray(scheduleAdvancedRunId!, recipeField, next); }}
                                      placeholder="lbs" className="w-20 h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                                    />
                                    <button type="button" onClick={() => updateAdvancedArray(scheduleAdvancedRunId!, recipeField, rows.filter((_, i) => i !== ri))} className="text-muted-foreground/40 hover:text-destructive transition-colors"><X className="w-3.5 h-3.5" /></button>
                                  </div>
                                ))}
                                <button type="button" onClick={() => updateAdvancedArray(scheduleAdvancedRunId!, recipeField, [...rows, { ingredient: "", lbs: 0 }])} className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors mt-1"><Plus className="w-3 h-3" /> Add Ingredient</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                    {/* ── Frontline Recipe ───────────────────────────────────── */}
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 pb-1 border-b border-border/30">Frontline Recipe</h3>
                      <div className="mb-2">
                        <select value={scheduleEditorRunValues[scheduleAdvancedRunId]?.frontlineRecipeName ?? ""}
                          onChange={e => updateAdvancedField(scheduleAdvancedRunId!, "frontlineRecipeName", e.target.value)}
                          className="w-full h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                        >
                          <option value="">— Select —</option>
                          {frontlineRecipeNames.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        {(scheduleEditorRunValues[scheduleAdvancedRunId]?.frontlineRecipe ?? []).map((row, ri) => (
                          <div key={ri} className="flex gap-2 items-center">
                            <select value={row.ingredient}
                              onChange={e => { const rows = [...(scheduleEditorRunValues[scheduleAdvancedRunId]?.frontlineRecipe ?? [])]; rows[ri] = { ...rows[ri], ingredient: e.target.value }; updateAdvancedArray(scheduleAdvancedRunId!, "frontlineRecipe", rows); }}
                              className="flex-1 h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm outline-none focus:border-primary/60 transition-colors"
                            >
                              <option value="">— Ingredient —</option>
                              {frontlineIngredients.map(i => <option key={i} value={i}>{i}</option>)}
                            </select>
                            <input type="number" min="0" step="0.1" value={row.lbs || ""}
                              onChange={e => { const rows = [...(scheduleEditorRunValues[scheduleAdvancedRunId]?.frontlineRecipe ?? [])]; rows[ri] = { ...rows[ri], lbs: Number(e.target.value) || 0 }; updateAdvancedArray(scheduleAdvancedRunId!, "frontlineRecipe", rows); }}
                              placeholder="lbs" className="w-20 h-8 px-2 rounded-md bg-muted/40 border border-border/60 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                            />
                            <button type="button" onClick={() => updateAdvancedArray(scheduleAdvancedRunId!, "frontlineRecipe", (scheduleEditorRunValues[scheduleAdvancedRunId]?.frontlineRecipe ?? []).filter((_, i) => i !== ri))} className="text-muted-foreground/40 hover:text-destructive transition-colors"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => updateAdvancedArray(scheduleAdvancedRunId!, "frontlineRecipe", [...(scheduleEditorRunValues[scheduleAdvancedRunId]?.frontlineRecipe ?? []), { ingredient: "", lbs: 0 }])} className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors mt-1"><Plus className="w-3 h-3" /> Add Ingredient</button>
                      </div>
                    </section>
                  </div>
                  <div className="px-5 py-4 border-t border-border/40">
                    <button type="button" onClick={() => setScheduleView("editor")} className="w-full py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                      Done — Back to Run List
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* ── Templates Dialog ──────────────────────────────────────────────── */}
        {showTemplatesDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowTemplatesDialog(false)}>
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <Bookmark className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-bold">Run Templates</h2>
                <button type="button" onClick={() => setShowTemplatesDialog(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              {/* Save current as template */}
              {templateSaveMode ? (
                <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Save current run settings as template</p>
                  <input
                    type="text"
                    value={templateNameInput}
                    onChange={e => setTemplateNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && templateNameInput.trim()) { saveAsTemplate(templateNameInput); setTemplateSaveMode(false); setTemplateNameInput(""); } }}
                    placeholder="Template name…"
                    autoFocus
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setTemplateSaveMode(false)} className="flex-1 px-3 py-1.5 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors">Cancel</button>
                    <button
                      type="button"
                      disabled={!templateNameInput.trim()}
                      onClick={() => { saveAsTemplate(templateNameInput); setTemplateSaveMode(false); setTemplateNameInput(""); }}
                      className="flex-1 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors disabled:opacity-40"
                    >
                      <BookmarkCheck className="w-3.5 h-3.5 inline mr-1" />Save
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setTemplateSaveMode(true); setTemplateNameInput(currentRun?.brand && currentRun?.flavor ? `${currentRun.brand} – ${currentRun.flavor}` : ""); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="w-4 h-4" /> Save current run as template
                </button>
              )}

              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No templates saved yet. Save the current run's settings to reuse them later.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{templates.length} saved template{templates.length !== 1 ? "s" : ""}</p>
                  {templates.map(t => (
                    <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.brand && t.flavor ? `${t.brand} – ${t.flavor}` : t.brand || t.flavor || "—"} · saved {t.createdAt}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => applyTemplate(t)}
                          className="px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors"
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTemplate(t.id)}
                          className="p-1.5 rounded-md text-muted-foreground/50 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
