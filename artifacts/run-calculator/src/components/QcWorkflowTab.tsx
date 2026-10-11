import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  ArrowDownToLine,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FileClock,
  FlaskConical,
  Image,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Weight,
} from "lucide-react";
import {
  deriveRunAllergenFootprint,
  type IngredientAllergen,
} from "@workspace/ingredient-catalog";
import type {
  ExportQcHistoryCsvParams,
  GetQcHistoryParams,
  QcAllergenReviewInput,
  QcCleaningInput,
  QcCorrectionInput,
  QcEvent,
  QcRedactionInput,
  QcTargetInput,
  QcWeightCheckInput,
} from "@workspace/api-client-react";
import {
  exportQcHistoryCsv,
  getGetQcHistoryQueryKey,
  getGetQcRunQueryKey,
  getGetQcTargetsQueryKey,
  useCorrectQcEvent,
  useGetQcHistory,
  useGetQcRun,
  useGetQcTargets,
  useRecordQcAllergenReview,
  useRecordQcCleaning,
  useRecordQcLot,
  useRecordQcWeightCheck,
  useRedactQcEvent,
  useSetQcTarget,
  useSignoffQcRun,
  useVerifyQcCleaning,
} from "@workspace/api-client-react";
import type { IngredientSubstitution } from "@workspace/inventory-math";
import type { FormValues, RunMeta } from "../types";
import { useMasterDataSlice } from "../masterData";
import { collectRunAllergenComponents } from "../runAllergenFootprint";
import {
  deriveQcWeightCheckReminders,
  hasConfiguredQcWeightReminderTarget,
  QC_WEIGHT_CHECK_OVERDUE_GRACE_MS,
} from "../qcWeightCheckSchedule";
import QualityHistoryTab from "./QualityHistoryTab";

export type QcWorkflowTabProps = {
  runId: string;
  runStartedAt: number | null;
  runStoppages: RunMeta["stoppages"];
  profileKey: string;
  runIsActive: boolean;
  values: FormValues;
  substitutions: readonly IngredientSubstitution[];
  stagedIngredients: QcAllergenReviewInput["stagedIngredients"];
  canRecordQc: boolean;
  canManageQc: boolean;
  canViewPhotos: boolean;
};

type ViewName = "lots" | "weights";
type Unit = "oz" | "g" | "lb" | "kg";

const panelClass = "rounded-xl border border-border/80 bg-card shadow-sm";
const labelClass = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const controlClass = "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none";
const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50";
const quietButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50";
function operationId(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The server did not save this QC record. Check the input and try again.";
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  min,
  step,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  min?: string;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className={labelClass}>{label}</span>
      <input
        className={controlClass}
        type={type}
        value={value}
        min={min}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        data-testid={`input-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className={labelClass}>{label}</span>
      <select
        className={controlClass}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        data-testid={`select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      >
        {children}
      </select>
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <textarea
        className={`${controlClass} min-h-0 resize-y py-2.5`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        data-testid={`textarea-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      />
    </label>
  );
}

function MutationAlert({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-rose-300/70 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{errorMessage(error)}</span>
      </div>
      <button type="button" className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold underline underline-offset-2" onClick={onRetry}>
        <RotateCcw className="h-3 w-3" /> Retry or correct the input
      </button>
    </div>
  );
}

function QueryFailure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="rounded-xl border border-rose-300/70 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{message}</p>
          <button type="button" className="mt-2 inline-flex items-center gap-1.5 font-semibold underline underline-offset-2" onClick={retry}>
            <RotateCcw className="h-3.5 w-3.5" /> Retry loading
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "amber" | "green" | "rose" }) {
  const styles = {
    neutral: "border-border bg-muted/60 text-muted-foreground",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    green: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${styles[tone]}`}>{children}</span>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatMinutes(value: number): string {
  const minutes = Math.ceil(Math.max(0, value) / 60_000);
  if (minutes <= 1) return "less than 1 minute";
  return `${minutes} minutes`;
}

export default function QcWorkflowTab({
  runId,
  runStartedAt,
  runStoppages,
  profileKey,
  runIsActive,
  values,
  substitutions,
  stagedIngredients,
  canRecordQc,
  canManageQc,
  canViewPhotos,
}: QcWorkflowTabProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewName>("lots");
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [selectedIngredient, setSelectedIngredient] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [lotStation, setLotStation] = useState("dough");
  const [lotNote, setLotNote] = useState("");
  const [weightIngredient, setWeightIngredient] = useState("");
  const [checkType, setCheckType] = useState<QcWeightCheckInput["checkType"]>(
    runIsActive ? "30-minute" : "pre-run",
  );
  const [actualValue, setActualValue] = useState("");
  const [actualUnit, setActualUnit] = useState<Unit>("oz");
  const [weightNote, setWeightNote] = useState("");
  useEffect(() => {
    setCheckType(runIsActive ? "30-minute" : "pre-run");
  }, [runId, runIsActive]);
  useEffect(() => {
    if (!runIsActive) return;
    setClockNowMs(Date.now());
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [runId, runIsActive, runStartedAt]);
  const [reviewStaged, setReviewStaged] = useState<QcAllergenReviewInput["stagedIngredientsStatus"]>("unknown");
  const [reviewCleaning, setReviewCleaning] = useState<QcAllergenReviewInput["cleaningStatus"]>("unknown");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [cleaningMethod, setCleaningMethod] = useState<QcCleaningInput["method"]>("standard");
  const [cleaningStartedAt, setCleaningStartedAt] = useState("");
  const [cleaningEndedAt, setCleaningEndedAt] = useState("");
  const [cleaningNote, setCleaningNote] = useState("");
  const [verifyRecord, setVerifyRecord] = useState<QcEvent | null>(null);
  const [verifyNote, setVerifyNote] = useState("");
  const [signoffNote, setSignoffNote] = useState("");
  const [targetIngredient, setTargetIngredient] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [targetUnit, setTargetUnit] = useState<Unit>("oz");
  const [targetTolerance, setTargetTolerance] = useState("");
  const [targetReason, setTargetReason] = useState("");
  const [historyRunId, setHistoryRunId] = useState(runId);
  const [historyIngredient, setHistoryIngredient] = useState("");
  const [historyStation, setHistoryStation] = useState("");
  const [historyFrom, setHistoryFrom] = useState(() => {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return from.toISOString().slice(0, 10);
  });
  const [historyTo, setHistoryTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [replacementJson, setReplacementJson] = useState("");
  const [correctionInputError, setCorrectionInputError] = useState("");
  const [redactionReason, setRedactionReason] = useState("");
  const [redactionFields, setRedactionFields] = useState<string[]>([]);
  const [exportError, setExportError] = useState("");
  const [exportPending, setExportPending] = useState(false);
  const ingredientsQuery = useMasterDataSlice("ingredients");
  const catalog = ingredientsQuery.data;
  const components = useMemo(
    () => collectRunAllergenComponents(values, substitutions),
    [values, substitutions],
  );
  const footprint = useMemo(
    () => catalog ? deriveRunAllergenFootprint(components, catalog) : null,
    [catalog, components],
  );

  const targetParams = { profileKey };
  const targetsQuery = useGetQcTargets(targetParams, {
    query: {
      enabled: Boolean(profileKey) && (canRecordQc || canManageQc),
      queryKey: getGetQcTargetsQueryKey(targetParams),
    },
  });
  const runQuery = useGetQcRun(runId, {
    query: {
      enabled: Boolean(runId) && (canRecordQc || canManageQc),
      queryKey: getGetQcRunQueryKey(runId),
    },
  });
  const historyParams: GetQcHistoryParams = {
    ...(historyFrom ? { from: historyFrom } : {}),
    ...(historyTo ? { to: `${historyTo}T23:59:59.999Z` } : {}),
    ...(historyRunId ? { runId: historyRunId.trim() } : {}),
    ...(historyIngredient ? { ingredientId: historyIngredient } : {}),
    ...(historyStation ? { station: historyStation as GetQcHistoryParams["station"] } : {}),
    limit: 100,
  };
  const historyQuery = useGetQcHistory(historyParams, {
    query: { queryKey: getGetQcHistoryQueryKey(historyParams) },
  });

  const refreshAfterWrite = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetQcRunQueryKey(runId) }),
      queryClient.invalidateQueries({ queryKey: getGetQcHistoryQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetQcTargetsQueryKey(targetParams) }),
    ]);
  };
  const targetMutation = useSetQcTarget({ mutation: { onSuccess: refreshAfterWrite } });
  const lotMutation = useRecordQcLot({ mutation: { onSuccess: refreshAfterWrite } });
  const weightMutation = useRecordQcWeightCheck({ mutation: { onSuccess: refreshAfterWrite } });
  const allergenMutation = useRecordQcAllergenReview({ mutation: { onSuccess: refreshAfterWrite } });
  const cleaningMutation = useRecordQcCleaning({ mutation: { onSuccess: refreshAfterWrite } });
  const verificationMutation = useVerifyQcCleaning({ mutation: { onSuccess: refreshAfterWrite } });
  const signoffMutation = useSignoffQcRun({ mutation: { onSuccess: refreshAfterWrite } });
  const correctionMutation = useCorrectQcEvent({ mutation: { onSuccess: refreshAfterWrite } });
  const redactionMutation = useRedactQcEvent({ mutation: { onSuccess: refreshAfterWrite } });

  const availableIngredients = useMemo(() => {
    if (!catalog) return [];
    const referenced = new Set<string>();
    for (const component of components) {
      for (const item of component.ingredients) {
        if (item.ingredientId) referenced.add(item.ingredientId);
        else {
          const byName = catalog.find((ingredient) => ingredient.name.toLocaleLowerCase() === item.ingredient.trim().toLocaleLowerCase());
          if (byName) referenced.add(byName.id);
        }
      }
    }
    const fromRun = catalog.filter((ingredient) => referenced.has(ingredient.id));
    return (fromRun.length ? fromRun : catalog.filter((ingredient) => ingredient.enabled))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, components]);

  const targets = targetsQuery.data?.targets;
  const runItems = runQuery.data?.items;
  const historyItems = historyQuery.data?.items;
  const runEvidenceMatchesSelection = runQuery.data?.runId === runId;
  const weightCheckEventsComplete = runQuery.data?.weightCheckEventsComplete
    ?? !runQuery.data?.hasMore;
  const weightCheckTimeline = useMemo(
    () => runQuery.data?.weightCheckEvents
      ? runQuery.data.weightCheckEvents.map((event) => ({
        eventType: "weight",
        ingredientId: event.ingredientId,
        payload: { checkType: event.checkType },
        createdAt: event.createdAt,
      }))
      : runItems?.filter((event) => event.eventType === "weight") ?? [],
    [runItems, runQuery.data?.weightCheckEvents],
  );
  const hasConfiguredWeightTarget = targets
    ? hasConfiguredQcWeightReminderTarget(targets)
    : false;
  const weightCheckReminders = useMemo(() => {
    if (
      !runIsActive
      || runStartedAt === null
      || !targets
      || !runEvidenceMatchesSelection
      || !weightCheckEventsComplete
    ) return [];
    return deriveQcWeightCheckReminders({
      runStartedAt,
      pauses: runStoppages ?? [],
      targets,
      events: weightCheckTimeline,
      now: clockNowMs,
    });
  }, [
    clockNowMs,
    runEvidenceMatchesSelection,
    runIsActive,
    runStartedAt,
    runStoppages,
    targets,
    weightCheckEventsComplete,
    weightCheckTimeline,
  ]);
  const weightTarget = targets?.find((target) => target.ingredientId === weightIngredient);
  const deviation = weightTarget?.state === "configured"
    && weightTarget.targetValue !== null
    && weightTarget.unit === actualUnit
    && Number(actualValue) > 0
    && Math.abs(Number(actualValue) - weightTarget.targetValue) > (weightTarget.toleranceValue ?? 0);
  const needsWeightReason = Boolean(deviation && !weightNote.trim());

  const submitLot = () => {
    if (!runId || !selectedIngredient || !lotNumber.trim()) return;
    lotMutation.mutate({
      data: {
        operationId: operationId(),
        runId,
        ingredientId: selectedIngredient,
        station: lotStation as "dough" | "sauce" | "frontline" | "warehouse" | "packaging" | "other",
        lotNumber: lotNumber.trim(),
        ...(lotNote.trim() ? { note: lotNote.trim() } : {}),
      },
    }, {
      onSuccess: () => {
        setLotNumber("");
        setLotNote("");
      },
    });
  };

  const submitWeight = () => {
    if (!runId || !profileKey || !weightIngredient || !Number(actualValue) || needsWeightReason) return;
    weightMutation.mutate({
      data: {
        operationId: operationId(),
        runId,
        profileKey,
        ingredientId: weightIngredient,
        checkType,
        actualValue: Number(actualValue),
        actualUnit,
        ...(weightNote.trim() ? { note: weightNote.trim() } : {}),
      },
    }, {
      onSuccess: () => {
        setActualValue("");
        setWeightNote("");
      },
    });
  };

  const submitAllergenReview = () => {
    if (ingredientsQuery.isLoading || !reviewConfirmed || !runId) return;
    const footprintSnapshot: QcAllergenReviewInput["footprint"] = footprint
      ? {
        status: !footprint.hasRecipeData ? "unavailable" : footprint.isComplete ? "complete" : "incomplete",
        allergens: footprint.allergens.map(({ allergen }) => allergen),
        unknownIngredients: footprint.unknownIngredients.map(({ name, reason }) => `${name} (${reason === "missing-catalog" ? "missing from catalog" : "mapping not reviewed"})`),
        missingComponents: footprint.missingComponents,
      }
      : {
        status: "unavailable",
        allergens: [],
        unknownIngredients: ["Ingredient mappings unavailable"],
        missingComponents: ["Ingredient catalog unavailable"],
      };
    allergenMutation.mutate({
      data: {
        operationId: operationId(),
        runId,
        footprintReviewed: true,
        footprint: footprintSnapshot,
        stagedIngredients,
        stagedIngredientsStatus: reviewStaged,
        cleaningStatus: reviewCleaning,
        ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}),
      },
    }, {
      onSuccess: () => {
        setReviewConfirmed(false);
        setReviewNote("");
      },
    });
  };

  const submitCleaning = () => {
    if (!runId || !cleaningStartedAt || !cleaningEndedAt) return;
    const input: QcCleaningInput = {
      operationId: operationId(),
      runId,
      method: cleaningMethod,
      startedAt: new Date(cleaningStartedAt).toISOString(),
      endedAt: new Date(cleaningEndedAt).toISOString(),
      ...(cleaningNote.trim() ? { note: cleaningNote.trim() } : {}),
    };
    cleaningMutation.mutate({ data: input }, {
      onSuccess: () => {
        setCleaningNote("");
        setCleaningStartedAt("");
        setCleaningEndedAt("");
      },
    });
  };

  const submitVerify = () => {
    if (!verifyRecord) return;
    verificationMutation.mutate({
      eventId: verifyRecord.id,
      data: { operationId: operationId(), ...(verifyNote.trim() ? { note: verifyNote.trim() } : {}) },
    }, {
      onSuccess: () => {
        setVerifyRecord(null);
        setVerifyNote("");
      },
    });
  };

  const submitSignoff = () => {
    if (!runId) return;
    signoffMutation.mutate({
      data: {
        operationId: operationId(),
        runId,
        ...(signoffNote.trim() ? { note: signoffNote.trim() } : {}),
      },
    });
  };

  const submitTarget = () => {
    if (!profileKey || !targetIngredient || !targetReason.trim()) return;
    const isClearing = !targetValue.trim() && !targetTolerance.trim();
    if ((!isClearing && (!targetValue.trim() || !targetUnit)) || (targetValue.trim() && !Number(targetValue))) return;
    const input: QcTargetInput = {
      operationId: operationId(),
      profileKey,
      ingredientId: targetIngredient,
      targetValue: isClearing ? null : Number(targetValue),
      unit: isClearing ? null : targetUnit,
      toleranceValue: isClearing ? null : (targetTolerance.trim() ? Number(targetTolerance) : null),
      reason: targetReason.trim(),
    };
    targetMutation.mutate({ data: input }, {
      onSuccess: () => {
        setTargetValue("");
        setTargetTolerance("");
        setTargetReason("");
      },
    });
  };

  const exportHistory = async () => {
    if (!canManageQc) return;
    setExportPending(true);
    setExportError("");
    const params: ExportQcHistoryCsvParams = {
      ...(historyParams.from ? { from: historyParams.from } : {}),
      ...(historyParams.to ? { to: historyParams.to } : {}),
      ...(historyParams.runId ? { runId: historyParams.runId } : {}),
      ...(historyParams.ingredientId ? { ingredientId: historyParams.ingredientId } : {}),
      ...(historyParams.station ? { station: historyParams.station } : {}),
    };
    try {
      const blob = await exportQcHistoryCsv(params, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `qc-history-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExportPending(false);
    }
  };

  const toggleExpandedEvent = (event: QcEvent) => {
    const next = expandedEventId === event.id ? null : event.id;
    setExpandedEventId(next);
    if (next !== null) {
      setCorrectionReason("");
      setReplacementJson(JSON.stringify(event.payload, null, 2));
      setCorrectionInputError("");
      setRedactionReason("");
      setRedactionFields([]);
    }
  };

  const submitCorrection = (event: QcEvent) => {
    if (!correctionReason.trim()) return;
    let replacement: QcCorrectionInput["replacement"];
    try {
      const parsed: unknown = JSON.parse(replacementJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Replacement must be a JSON object.");
      }
      replacement = parsed as QcCorrectionInput["replacement"];
    } catch (error) {
      setCorrectionInputError(error instanceof Error ? error.message : "Replacement must be valid JSON.");
      return;
    }
    setCorrectionInputError("");
    correctionMutation.mutate({
      eventId: event.id,
      data: { operationId: operationId(), reason: correctionReason.trim(), replacement },
    });
  };

  const submitRedaction = (event: QcEvent) => {
    if (!redactionReason.trim() || redactionFields.length === 0) return;
    redactionMutation.mutate({
      eventId: event.id,
      data: {
        operationId: operationId(),
        reason: redactionReason.trim(),
        fields: redactionFields as QcRedactionInput["fields"],
      },
    });
  };

  const signedOff = runQuery.data?.signoff?.signedOff ?? false;
  const isReadOnly = !canRecordQc;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-3 pb-24 pt-4 sm:px-5" data-testid="qc-workflow-tab">
      <header className="relative overflow-hidden rounded-2xl border border-[#c9d8d4] bg-[#e8f1ee] px-4 py-5 dark:border-emerald-900/50 dark:bg-[#132522] sm:px-6">
        <div className="absolute -right-8 -top-16 h-48 w-48 rounded-full border-[28px] border-[#b8d2ca]/35 dark:border-emerald-800/20" aria-hidden="true" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#397065] dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-[#548f80]" />
              Shift record · {runIsActive ? "Active run" : "Run evidence"}
            </div>
            <h1 className="font-semibold tracking-tight text-[#19332e] dark:text-[#e1f0eb] text-2xl sm:text-[30px]">Quality checks</h1>
            <p className="mt-1.5 max-w-xl text-sm leading-5 text-[#527068] dark:text-[#a4c1b9]">
              Durable evidence for this run. QC and allergen notes are advisory; they do not change run allergen settings or sequencing warnings.
            </p>
          </div>
          <div className="flex min-w-40 items-center gap-2 rounded-xl border border-[#bfd3cd] bg-[#f3f8f6]/80 px-3 py-2 dark:border-emerald-900/60 dark:bg-[#1a302b]">
            <ClipboardCheck className="h-4 w-4 text-[#397065] dark:text-emerald-300" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Run reference</p>
              <p className="truncate font-mono text-xs font-semibold" data-testid="text-qc-run-id">{runId || "No run selected"}</p>
            </div>
          </div>
        </div>
      </header>

      {!canRecordQc && !canManageQc ? (
        <div className={`${panelClass} flex items-start gap-3 p-5`}>
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">QC recording is not available for this account.</p>
            <p className="mt-1 text-sm text-muted-foreground">Ask a QC lead for access. Existing photo history remains available below when permitted.</p>
          </div>
        </div>
      ) : (
        <>
          {runIsActive && runStartedAt !== null && (
            <section
              className={`${panelClass} p-4 sm:p-5`}
              aria-labelledby="qc-weight-reminders-title"
              data-testid="qc-weight-reminders"
            >
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#397065] dark:text-emerald-300" />
                <div className="min-w-0 flex-1">
                  <h2 id="qc-weight-reminders-title" className="text-sm font-bold">30-minute weight checks</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Advisory reminders only. They do not pause production or hold shipping.</p>
                  {targetsQuery.isError ? (
                    <p className="mt-3 text-xs text-amber-900 dark:text-amber-200" role="status">Weight-check timing is unavailable because QC targets could not be loaded.</p>
                  ) : runQuery.isError ? (
                    <div className="mt-3">
                      <QueryFailure message="QC check history could not be loaded, so timing is unavailable." retry={() => void runQuery.refetch()} />
                    </div>
                  ) : targetsQuery.isLoading || !targets || runQuery.isLoading || !runEvidenceMatchesSelection ? (
                    <p className="mt-3 text-xs text-muted-foreground" role="status">Loading configured weight checks…</p>
                  ) : !hasConfiguredWeightTarget ? (
                    <p className="mt-3 text-xs text-muted-foreground" role="status">No configured weight targets need timed checks.</p>
                  ) : !weightCheckEventsComplete ? (
                    <p className="mt-3 text-xs text-amber-900 dark:text-amber-200" role="status">Weight-check timing is unavailable because this run has more weight records than can be summarized.</p>
                  ) : weightCheckReminders.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground" role="status">No configured weight targets need timed checks.</p>
                  ) : (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Next weight check times">
                      {weightCheckReminders.map((reminder) => {
                        const overdueAt = reminder.nextCheckAt + QC_WEIGHT_CHECK_OVERDUE_GRACE_MS;
                        const status = clockNowMs > overdueAt
                          ? "overdue"
                          : clockNowMs >= reminder.nextCheckAt
                            ? "due"
                            : "upcoming";
                        const statusText = status === "overdue"
                          ? `Overdue · ${formatMinutes(clockNowMs - reminder.nextCheckAt)} past due`
                          : status === "due"
                            ? "Due now"
                            : `Due in ${formatMinutes(reminder.nextCheckAt - clockNowMs)}`;
                        return (
                          <li
                            key={reminder.ingredientId}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2.5"
                            data-testid={`qc-weight-reminder-${reminder.ingredientId}`}
                          >
                            <span className="min-w-0 truncate text-xs font-semibold">{reminder.ingredientName}</span>
                            <span className="flex shrink-0 items-center gap-2">
                              <StatusPill tone={status === "overdue" ? "rose" : status === "due" ? "amber" : "neutral"}>
                                {statusText}
                              </StatusPill>
                              <time className="text-[10px] text-muted-foreground" dateTime={new Date(reminder.nextCheckAt).toISOString()}>
                                {new Date(reminder.nextCheckAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                              </time>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,.75fr)]">
            <section className={`${panelClass} overflow-hidden`} aria-labelledby="qc-record-title">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
                <div>
                  <h2 id="qc-record-title" className="text-sm font-bold tracking-tight">Run checks</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Choose one focused record type at a time.</p>
                </div>
                <div className="flex rounded-lg border border-border bg-muted/50 p-1" role="tablist" aria-label="QC record type">
                  {(["lots", "weights"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="tab"
                      aria-selected={view === item}
                      className={`min-h-9 rounded-md px-3 text-xs font-semibold transition ${view === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setView(item)}
                      data-testid={`tab-qc-${item}`}
                    >
                      {item === "lots" ? "Lots" : "Weights"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-4 p-4 sm:p-5">
                {ingredientsQuery.isLoading ? (
                  <div className="animate-pulse space-y-3" role="status" aria-label="Loading ingredients">
                    <div className="h-10 rounded-lg bg-muted" />
                    <div className="h-10 rounded-lg bg-muted" />
                  </div>
                ) : ingredientsQuery.isError || !catalog ? (
                  <QueryFailure message="Ingredient catalog unavailable. QC records need a verified ingredient identity." retry={() => void ingredientsQuery.refetch()} />
                ) : availableIngredients.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-5 text-center">
                    <CircleHelp className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-2 text-sm font-semibold">No ingredients are available for this run yet.</p>
                    <p className="mt-1 text-xs text-muted-foreground">Load or configure the run’s ingredient catalog before recording evidence.</p>
                  </div>
                ) : view === "lots" ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Select label="Ingredient" value={selectedIngredient} onChange={setSelectedIngredient} disabled={isReadOnly}>
                        <option value="">Choose ingredient…</option>
                        {availableIngredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
                      </Select>
                      <Input label="Lot number" value={lotNumber} onChange={setLotNumber} placeholder="Scan or enter lot code" disabled={isReadOnly} />
                      <Select label="Station" value={lotStation} onChange={setLotStation} disabled={isReadOnly}>
                        <option value="dough">Dough</option><option value="sauce">Sauce</option><option value="frontline">Frontline</option><option value="warehouse">Warehouse</option><option value="packaging">Packaging</option><option value="other">Other</option>
                      </Select>
                      <Input label="Lot note (optional)" value={lotNote} onChange={setLotNote} placeholder="Supplier, pallet, or handling note" disabled={isReadOnly} />
                    </div>
                    {!canRecordQc && <p className="text-xs text-muted-foreground">You can view this workspace but need QC recording access to add a lot.</p>}
                    <MutationAlert error={lotMutation.error} onRetry={submitLot} />
                    <div className="flex justify-end">
                      <button type="button" className={actionClass} onClick={submitLot} disabled={!canRecordQc || !runId || !selectedIngredient || !lotNumber.trim() || lotMutation.isPending}>
                        {lotMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Record lot
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {targetsQuery.isLoading ? (
                      <div className="animate-pulse space-y-3"><div className="h-10 rounded-lg bg-muted" /><div className="h-10 rounded-lg bg-muted" /></div>
                    ) : targetsQuery.isError ? (
                      <QueryFailure message="QC targets could not be loaded. Weight results remain unevaluated until target data is available." retry={() => void targetsQuery.refetch()} />
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Select label="Ingredient" value={weightIngredient} onChange={(id) => {
                            setWeightIngredient(id);
                            const target = targets?.find((entry) => entry.ingredientId === id);
                            if (target?.unit && ["oz", "g", "lb", "kg"].includes(target.unit)) setActualUnit(target.unit as Unit);
                          }} disabled={isReadOnly}>
                            <option value="">Choose ingredient…</option>
                            {(targets ?? []).map((target) => <option key={target.ingredientId} value={target.ingredientId}>{target.ingredientName}</option>)}
                          </Select>
                          <Select label="Check timing" value={checkType} onChange={(value) => setCheckType(value as QcWeightCheckInput["checkType"])} disabled={isReadOnly}>
                            {runIsActive
                              ? <option value="30-minute">30-minute active-run check</option>
                              : <option value="pre-run">Pre-run check</option>}
                          </Select>
                          <Input label="Actual weight" value={actualValue} onChange={setActualValue} type="number" min="0" step="any" placeholder="Enter measured weight" disabled={isReadOnly} />
                          <Select label="Measured unit" value={actualUnit} onChange={(value) => setActualUnit(value as Unit)} disabled={isReadOnly}>
                            <option value="oz">oz</option><option value="g">g</option><option value="lb">lb</option><option value="kg">kg</option>
                          </Select>
                        </div>
                        {weightIngredient && (
                          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${weightTarget?.state === "configured" && weightTarget.unit === actualUnit ? "border-[#cbd8d4] bg-[#f2f7f5] text-[#48675f] dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200" : "border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200"}`}>
                            {weightTarget?.state === "configured" && weightTarget.unit === actualUnit ? <Weight className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                            <span>
                              {targetsQuery.isError ? "Target unavailable; this measurement cannot be evaluated." : !weightTarget || weightTarget.state !== "configured" || weightTarget.targetValue === null || !weightTarget.unit
                                ? "Not evaluated — a valid QC target is not configured."
                                : weightTarget.unit !== actualUnit
                                  ? `Not evaluated — target is in ${weightTarget.unit}; measured unit is ${actualUnit}.`
                                  : `Target ${weightTarget.targetValue} ${weightTarget.unit}${weightTarget.toleranceValue === null ? "" : ` · tolerance ±${weightTarget.toleranceValue} ${weightTarget.unit}`}`}
                            </span>
                          </div>
                        )}
                        <Textarea label={deviation ? "Reason / note (required for deviation)" : "Weight note (optional)"} value={weightNote} onChange={setWeightNote} placeholder={deviation ? "Explain the out-of-tolerance reading" : "Context for this measurement"} />
                        {deviation && <StatusPill tone="amber"><ShieldAlert className="h-3 w-3" /> Outside tolerance</StatusPill>}
                        <MutationAlert error={weightMutation.error} onRetry={submitWeight} />
                        <div className="flex justify-end">
                          <button type="button" className={actionClass} onClick={submitWeight} disabled={!canRecordQc || !runId || !weightIngredient || Number(actualValue) <= 0 || needsWeightReason || weightMutation.isPending}>
                            {weightMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Record weight check
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className={`${panelClass} p-4 sm:p-5`} aria-labelledby="qc-target-title">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="qc-target-title" className="flex items-center gap-2 text-sm font-bold">
                    <FlaskConical className="h-4 w-4 text-[#548f80]" /> Reviewed targets
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Overrides are profile-scoped and never alter the recipe.</p>
                </div>
                {canManageQc && <StatusPill>Manager review</StatusPill>}
              </div>
              {targetsQuery.isLoading ? (
                <div className="mt-4 animate-pulse space-y-2"><div className="h-9 rounded bg-muted" /><div className="h-9 rounded bg-muted" /></div>
              ) : targetsQuery.isError ? (
                <div className="mt-4"><QueryFailure message="Target settings unavailable." retry={() => void targetsQuery.refetch()} /></div>
              ) : (
                <>
                  <div className="mt-4 max-h-48 space-y-2 overflow-y-auto pr-1">
                    {(targets ?? []).length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No target rows are configured for this profile.</p>
                    ) : targets?.map((target) => (
                      <div key={target.ingredientId} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{target.ingredientName}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {target.state !== "configured" || target.targetValue === null || !target.unit
                              ? target.reason || "Not evaluated · target not configured"
                              : `${target.targetValue} ${target.unit}${target.toleranceValue === null ? "" : ` ±${target.toleranceValue}`} · ${target.source === "qc-override" ? "QC override" : "spec import"}`}
                          </p>
                        </div>
                        <StatusPill tone={target.state === "configured" ? "green" : "amber"}>{target.state === "configured" ? "Set" : "Unknown"}</StatusPill>
                      </div>
                    ))}
                  </div>
                  {canManageQc && (
                    <div className="mt-4 space-y-3 border-t border-border/70 pt-4">
                      <p className="text-xs font-semibold">Set or clear an override</p>
                      <Select label="Target ingredient" value={targetIngredient} onChange={setTargetIngredient}>
                        <option value="">Choose target…</option>
                        {(targets ?? []).map((target) => <option key={target.ingredientId} value={target.ingredientId}>{target.ingredientName}</option>)}
                      </Select>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Target value" value={targetValue} onChange={setTargetValue} type="number" min="0" step="any" placeholder="Blank to clear" />
                        <Select label="Target unit" value={targetUnit} onChange={(value) => setTargetUnit(value as Unit)}>
                          <option value="oz">oz</option><option value="g">g</option><option value="lb">lb</option><option value="kg">kg</option>
                        </Select>
                        <Input label="Tolerance" value={targetTolerance} onChange={setTargetTolerance} type="number" min="0" step="any" placeholder="Optional" />
                        <div className="flex items-end">
                          <button type="button" className={`${quietButtonClass} w-full`} onClick={() => {
                            setTargetValue("");
                            setTargetTolerance("");
                          }}><Trash2 className="h-3.5 w-3.5" /> Clear values</button>
                        </div>
                      </div>
                      <Textarea label="Reason for review" value={targetReason} onChange={setTargetReason} placeholder="Why this target is changing" rows={2} />
                      <MutationAlert error={targetMutation.error} onRetry={submitTarget} />
                       <button type="button" className={`${actionClass} w-full`} onClick={submitTarget} disabled={!targetIngredient || !targetReason.trim() || targetMutation.isPending || (!targetValue.trim() && Boolean(targetTolerance.trim())) || (Boolean(targetValue.trim()) && Number(targetValue) <= 0) || (Boolean(targetTolerance.trim()) && Number(targetTolerance) < 0)}>
                        {targetMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                        Save reviewed target
                      </button>
                      <p className="text-[10px] leading-4 text-muted-foreground">Leave target and tolerance blank together to return to the spec-import target. A reason is required.</p>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>

          <section className={`${panelClass} overflow-hidden`} aria-labelledby="allergen-review-title">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e7f0ed] text-[#397065] dark:bg-emerald-950/50 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" /></div>
                <div>
                  <h2 id="allergen-review-title" className="text-sm font-bold">Pre-run allergen & staging review</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Snapshot the calculated ingredient footprint, then record what was physically staged and cleaned. This advisory record is separate from the manual run-allergen field.</p>
                </div>
              </div>
              <StatusPill tone={footprint?.isComplete ? "green" : "amber"}>{footprint?.isComplete ? "Mapping complete" : "Coverage unknown / incomplete"}</StatusPill>
            </div>
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.1fr_.9fr]">
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                {ingredientsQuery.isLoading ? (
                  <div className="animate-pulse space-y-2"><div className="h-3 w-1/2 rounded bg-muted" /><div className="h-3 rounded bg-muted" /><div className="h-3 w-4/5 rounded bg-muted" /></div>
                ) : ingredientsQuery.isError || !footprint ? (
                  <div className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
                    <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Ingredient mappings are unavailable. The footprint is unknown and cannot be recorded as clear.</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Derived snapshot</p>
                      <StatusPill tone={footprint.isComplete ? "green" : "amber"}>{!footprint.hasRecipeData ? "Unavailable" : footprint.isComplete ? "Complete" : "Incomplete"}</StatusPill>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {footprint.allergens.length ? footprint.allergens.map(({ allergen, ingredientNames }) => (
                        <span key={allergen} className="rounded-md border border-[#d5dfdc] bg-[#f0f5f3] px-2 py-1 text-[11px] font-semibold capitalize text-[#35574f] dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100" title={ingredientNames.join(", ")}>{allergen}</span>
                      )) : <span className="text-xs text-muted-foreground">No mapped allergens reported among mapped ingredients; this is not a verified allergen-free result.</span>}
                    </div>
                    {footprint.unknownIngredients.length > 0 && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-900 dark:text-amber-200">Unknown ingredient mappings</p>
                        <ul className="mt-1.5 space-y-1">
                          {footprint.unknownIngredients.map((item) => <li key={item.key} className="text-xs"><span className="font-semibold">{item.name}</span> · {item.reason === "missing-catalog" ? "missing from catalog" : "mapping not reviewed"} <span className="text-muted-foreground">({item.components.join(", ")})</span></li>)}
                        </ul>
                      </div>
                    )}
                    {footprint.missingComponents.length > 0 && <p className="text-xs text-amber-900 dark:text-amber-200">No ingredient rows for: {footprint.missingComponents.join(", ")}</p>}
                    {!footprint.hasRecipeData && <p className="text-xs text-amber-900 dark:text-amber-200">No recipe ingredient data is available for this run. Coverage cannot be considered clear.</p>}
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-border/70 bg-background/70 p-3" data-testid="qc-staged-ingredients-snapshot">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Warehouse staging snapshot</p>
                    <StatusPill tone={stagedIngredients.length > 0 && stagedIngredients.every((item) => item.staged) ? "green" : "amber"}>
                      {stagedIngredients.filter((item) => item.staged).length}/{stagedIngredients.length} marked staged
                    </StatusPill>
                  </div>
                  {stagedIngredients.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-900 dark:text-amber-200">No ingredient staging rows are loaded for this run. Keep the review status unknown unless you verified the staging separately.</p>
                  ) : (
                    <>
                      <p className="mt-1 text-[10px] text-muted-foreground">Snapshot from the per-run Warehouse checklist; a check mark records warehouse status, not an independent physical confirmation.</p>
                      <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto" aria-label="Staged ingredient rows">
                        {stagedIngredients.map((item, index) => (
                          <li key={`${item.area}-${item.name}-${item.unit}-${index}`} className="flex items-start justify-between gap-3 text-xs">
                            <span className="min-w-0"><span className="font-semibold">{item.name}</span><span className="text-muted-foreground"> · {item.area} · {item.quantity} {item.unit}</span></span>
                            <span className={item.staged ? "shrink-0 font-semibold text-emerald-700 dark:text-emerald-300" : "shrink-0 text-muted-foreground"}>{item.staged ? "Marked staged" : "Not marked"}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <Select label="Staged ingredients review" value={reviewStaged} onChange={(value) => setReviewStaged(value as QcAllergenReviewInput["stagedIngredientsStatus"])} disabled={!canRecordQc}>
                  <option value="unknown">Unknown — not reviewed</option><option value="reviewed">Reviewed against the run</option><option value="not-reviewed">Not reviewed</option>
                </Select>
                <Select label="Cleaning review" value={reviewCleaning} onChange={(value) => setReviewCleaning(value as QcAllergenReviewInput["cleaningStatus"])} disabled={!canRecordQc}>
                  <option value="unknown">Unknown</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="not-applicable">Not applicable</option>
                </Select>
                <Textarea label="Review note (optional)" value={reviewNote} onChange={setReviewNote} placeholder="Observed staging or cleaning context" rows={2} />
                <label className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-5">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[#548f80]" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} disabled={!canRecordQc || ingredientsQuery.isLoading} data-testid="checkbox-footprint-reviewed" />
                  <span>I reviewed the derived snapshot above, including any unknown or missing mappings. Staged-item and cleaning statuses below are saved as selected; they do not clear unknown data.</span>
                </label>
                <MutationAlert error={allergenMutation.error} onRetry={submitAllergenReview} />
                <button type="button" className={`${actionClass} w-full`} onClick={submitAllergenReview} disabled={!canRecordQc || !runId || ingredientsQuery.isLoading || !reviewConfirmed || allergenMutation.isPending}>
                  {allergenMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                  Save pre-run review
                </button>
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className={`${panelClass} p-4 sm:p-5`} aria-labelledby="cleaning-record-title">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="cleaning-record-title" className="flex items-center gap-2 text-sm font-bold"><Archive className="h-4 w-4 text-[#548f80]" /> Cleaning record</h2>
                  <p className="mt-1 text-xs text-muted-foreground">A second authenticated person must verify; the server rejects self-verification.</p>
                </div>
                <StatusPill>Two-person record</StatusPill>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Select label="Method" value={cleaningMethod} onChange={(value) => setCleaningMethod(value as QcCleaningInput["method"])} disabled={!canRecordQc}>
                  <option value="standard">Standard</option><option value="deep">Deep</option><option value="chemical">Chemical</option><option value="other">Other</option>
                </Select>
                <div className="hidden sm:block" />
                <Input label="Started at" value={cleaningStartedAt} onChange={setCleaningStartedAt} type="datetime-local" disabled={!canRecordQc} />
                <Input label="Ended at" value={cleaningEndedAt} onChange={setCleaningEndedAt} type="datetime-local" disabled={!canRecordQc} />
              </div>
              <div className="mt-3"><Textarea label="Cleaning note (optional)" value={cleaningNote} onChange={setCleaningNote} placeholder="Area, procedure, or materials used" rows={2} /></div>
              <MutationAlert error={cleaningMutation.error} onRetry={submitCleaning} />
              <div className="mt-3 flex justify-end">
                <button type="button" className={actionClass} onClick={submitCleaning} disabled={!canRecordQc || !runId || !cleaningStartedAt || !cleaningEndedAt || cleaningMutation.isPending}>
                  {cleaningMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Record cleaning
                </button>
              </div>
            </section>

            <section className={`${panelClass} p-4 sm:p-5`} aria-labelledby="run-signoff-title">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="run-signoff-title" className="flex items-center gap-2 text-sm font-bold"><BadgeCheck className="h-4 w-4 text-[#548f80]" /> QC run sign-off</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Sign-off applies to the currently reviewed QC event set. Any new QC event reopens it.</p>
                </div>
                {runQuery.data?.signoff && <StatusPill tone={signedOff ? "green" : "amber"}>{signedOff ? "Signed off" : "Reopened"}</StatusPill>}
              </div>
              {runQuery.isLoading ? (
                <div className="mt-4 animate-pulse space-y-2"><div className="h-4 w-2/3 rounded bg-muted" /><div className="h-4 w-1/2 rounded bg-muted" /></div>
              ) : runQuery.isError ? (
                <div className="mt-4"><QueryFailure message="QC run evidence and sign-off could not be loaded." retry={() => void runQuery.refetch()} /></div>
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-md bg-muted px-2 py-1">{runItems?.length ?? 0} loaded events</span>
                    {runQuery.data?.hasMore && <span>More run history is available in scoped history below.</span>}
                    {runQuery.data?.signoff && <span>Last sign-off · {formatTime(runQuery.data.signoff.createdAt)}</span>}
                  </div>
                  {canManageQc && (
                    <>
                      <div className="mt-3"><Textarea label="Sign-off note (optional)" value={signoffNote} onChange={setSignoffNote} placeholder="QC disposition or shift handoff note" rows={2} /></div>
                      <MutationAlert error={signoffMutation.error} onRetry={submitSignoff} />
                      <button type="button" className={`${actionClass} mt-3 w-full`} onClick={submitSignoff} disabled={!runId || !runItems?.length || signoffMutation.isPending}>
                        {signoffMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        {signedOff ? "Sign off reviewed set again" : "Sign off reviewed set"}
                      </button>
                      {signedOff && <p className="mt-2 text-center text-[11px] text-[#397065] dark:text-emerald-300">This is advisory QC evidence only. Production sequencing and shipping status are unchanged.</p>}
                    </>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}

      <section className={`${panelClass} overflow-hidden`} aria-labelledby="qc-history-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
          <div>
            <h2 id="qc-history-title" className="flex items-center gap-2 text-sm font-bold"><FileClock className="h-4 w-4 text-[#548f80]" /> QC evidence history</h2>
            <p className="mt-1 text-xs text-muted-foreground">Facility-scoped, bounded records. Filter to this run or widen the scope.</p>
          </div>
          {canManageQc && (
            <button type="button" className={quietButtonClass} onClick={() => void exportHistory()} disabled={exportPending}>
              {exportPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
              Export CSV
            </button>
          )}
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input label="From date" value={historyFrom} onChange={setHistoryFrom} type="date" />
            <Input label="To date" value={historyTo} onChange={setHistoryTo} type="date" />
            <Input label="Run ID filter" value={historyRunId} onChange={setHistoryRunId} placeholder="All facility runs" />
            <Select label="Ingredient filter" value={historyIngredient} onChange={setHistoryIngredient}>
              <option value="">All ingredients</option>{(catalog ?? []).map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
            </Select>
            <Select label="Station filter" value={historyStation} onChange={setHistoryStation}>
              <option value="">All stations</option><option value="dough">Dough</option><option value="sauce">Sauce</option><option value="frontline">Frontline</option><option value="warehouse">Warehouse</option><option value="packaging">Packaging</option><option value="other">Other</option>
            </Select>
          </div>
          {exportError && <div className="flex items-start justify-between gap-3 rounded-lg border border-rose-300/70 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200" role="alert"><span>{exportError}</span><button type="button" onClick={() => void exportHistory()} className="shrink-0 font-semibold underline">Retry export</button></div>}
          {historyQuery.isLoading ? (
            <div className="animate-pulse space-y-2" role="status" aria-label="Loading QC history"><div className="h-14 rounded-lg bg-muted" /><div className="h-14 rounded-lg bg-muted" /><div className="h-14 rounded-lg bg-muted" /></div>
          ) : historyQuery.isError ? (
            <QueryFailure message="QC history could not be loaded. No empty-history assumption is shown." retry={() => void historyQuery.refetch()} />
          ) : !historyItems?.length ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-9 text-center">
              <Clock3 className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">No QC events in this filter.</p>
              <p className="mt-1 text-xs text-muted-foreground">Adjust the dates or clear the run filter to search more facility history.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {historyItems.map((event) => {
                const isExpanded = expandedEventId === event.id;
                return (
                  <article key={event.id} className="overflow-hidden rounded-xl border border-border/75 bg-background/70" data-testid={`qc-history-event-${event.id}`}>
                    <button type="button" className="flex min-h-[64px] w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/30" onClick={() => toggleExpandedEvent(event)}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e9f1ef] text-[#397065] dark:bg-emerald-950/40 dark:text-emerald-300">
                        {event.eventType === "weight" ? <Weight className="h-4 w-4" /> : event.eventType === "allergen-review" ? <ShieldCheck className="h-4 w-4" /> : <FileClock className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs font-bold capitalize">{event.eventType.replaceAll("-", " ")}</span>
                          {event.ingredientName && <span className="text-xs text-muted-foreground">{event.ingredientName}</span>}
                          {event.corrected && <StatusPill tone="amber">Corrected</StatusPill>}
                          {!!event.redactedFields?.length && <StatusPill>Redacted</StatusPill>}
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                          {formatTime(event.createdAt)}{event.station ? ` · ${event.station}` : ""}{event.runId ? ` · run ${event.runId}` : ""}
                        </span>
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                    {isExpanded && (
                      <div className="space-y-3 border-t border-border/70 bg-muted/15 p-3 sm:p-4">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-lg border border-border/70 bg-background p-2.5"><p className={labelClass}>Record ID</p><p className="break-all font-mono text-[10px]">{event.recordId}</p></div>
                          <div className="rounded-lg border border-border/70 bg-background p-2.5"><p className={labelClass}>Actor</p><p className="break-all font-mono text-[10px]">{event.redactedFields?.includes("actorId") ? "Redacted" : event.actorId || "Not provided"}</p></div>
                          <div className="rounded-lg border border-border/70 bg-background p-2.5"><p className={labelClass}>Payload</p><p className="text-xs">{Object.keys(event.payload ?? {}).length ? Object.entries(event.payload).map(([key, value]) => {
                            const hidden = event.redactedFields?.includes(`payload.${key}`);
                            return <span key={key} className="mr-2 inline-block"><span className="font-semibold">{key}:</span> {hidden ? "Redacted" : typeof value === "object" ? JSON.stringify(value) : String(value)}</span>;
                          }) : "No payload fields"}</p></div>
                        </div>
                        {canManageQc && (
                          <div className="grid gap-4 border-t border-border/70 pt-3 lg:grid-cols-2">
                            <div className="space-y-2">
                              <p className="text-xs font-bold">Append correction</p>
                              <Textarea label="Correction reason" value={correctionReason} onChange={setCorrectionReason} placeholder="What was inaccurate?" rows={2} />
                              <Textarea label="Replacement payload JSON" value={replacementJson} onChange={(value) => {
                                setReplacementJson(value);
                                setCorrectionInputError("");
                              }} rows={5} />
                              {correctionInputError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{correctionInputError} Correct the JSON before appending.</p>}
                              <MutationAlert error={correctionMutation.error} onRetry={() => submitCorrection(event)} />
                              <button type="button" className={quietButtonClass} onClick={() => submitCorrection(event)} disabled={!correctionReason.trim() || correctionMutation.isPending}>
                                {correctionMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Append correction
                              </button>
                            </div>
                            <div className="space-y-2">
                              <p className="text-xs font-bold">Append privacy redaction</p>
                              <Textarea label="Redaction reason" value={redactionReason} onChange={setRedactionReason} placeholder="Why does this field need redaction?" rows={2} />
                              <div className="space-y-1.5">
                                {[
                                  ["actorId", "Actor identifier"],
                                  ["ingredientName", "Ingredient name"],
                                  ["payload.note", "Payload note"],
                                  ["payload.lotNumber", "Lot number"],
                                ].map(([field, text]) => (
                                  <label key={field} className="flex items-center gap-2 text-xs">
                                    <input type="checkbox" className="h-4 w-4 accent-[#548f80]" checked={redactionFields.includes(field)} onChange={(event) => setRedactionFields((current) => event.target.checked ? [...current, field] : current.filter((item) => item !== field))} />
                                    {text}
                                  </label>
                                ))}
                              </div>
                              <MutationAlert error={redactionMutation.error} onRetry={() => submitRedaction(event)} />
                              <button type="button" className={quietButtonClass} onClick={() => submitRedaction(event)} disabled={!redactionReason.trim() || redactionFields.length === 0 || redactionMutation.isPending}>
                                {redactionMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />} Append redaction
                              </button>
                            </div>
                          </div>
                        )}
                        {event.eventType === "cleaning" && !event.corrected && canRecordQc && (
                          <div className="rounded-lg border border-[#c9d8d4] bg-[#f1f7f5] p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                            <p className="text-xs font-bold">Second-person verification</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">Sign in as a different person from the cleaning recorder. Your identity is authenticated by the server.</p>
                            {verifyRecord?.id === event.id ? (
                              <div className="mt-3 space-y-2">
                                <Textarea label="Verifier note (optional)" value={verifyNote} onChange={setVerifyNote} placeholder="Independent verification note" rows={2} />
                                <MutationAlert error={verificationMutation.error} onRetry={submitVerify} />
                                <div className="flex flex-wrap gap-2">
                                  <button type="button" className={actionClass} onClick={submitVerify} disabled={verificationMutation.isPending}>{verificationMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Verify as another person</button>
                                  <button type="button" className={quietButtonClass} onClick={() => setVerifyRecord(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className={`${quietButtonClass} mt-3`} onClick={() => setVerifyRecord(event)}><BadgeCheck className="h-4 w-4" /> Verify cleaning</button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {historyQuery.data?.hasMore && <p className="text-center text-xs text-muted-foreground">Showing the latest 100 matching events. Narrow the date range for a focused review.</p>}
            </div>
          )}
        </div>
      </section>

      {canViewPhotos && (
        <section className={`${panelClass} overflow-hidden`} aria-labelledby="photo-history-separate-title">
          <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3.5 sm:px-5">
            <Image className="h-4 w-4 text-[#548f80]" />
            <div>
              <h2 id="photo-history-separate-title" className="text-sm font-bold">Photo quality history</h2>
              <p className="text-[11px] text-muted-foreground">Existing image assessments are kept separate from run QC evidence.</p>
            </div>
          </div>
          <QualityHistoryTab />
        </section>
      )}
    </div>
  );
}
