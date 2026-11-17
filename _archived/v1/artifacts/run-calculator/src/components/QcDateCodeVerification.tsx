import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, LoaderCircle, RotateCcw } from "lucide-react";
import {
  getGetQcDateCodeReferencesQueryKey,
  getGetQcHistoryQueryKey,
  getGetQcRunQueryKey,
  useGetQcDateCodeReferences,
  useRecordQcDateCodeCheck,
  useReviewQcDateCodeReference,
  useSaveQcDateCodeReference,
  type QcDateCodeCheckInput,
  type QcDateCodeReadability,
  type QcDateCodeReference,
  type QcDateCodeReferenceInput,
  type QcDateCodeText,
  type QcEvent,
  type QcLabelReferenceReviewInput,
} from "@workspace/api-client-react";
import {
  DATE_CODE_CONTEXTS,
  DATE_CODE_FIELDS,
  DEFAULT_READABILITY,
  EMPTY_TEXT,
  MAX_CODE,
  QcDateCodeComparison,
  READABILITY,
  ResultTag,
  contextLabel,
  literal,
  type DateCodeField,
  type Readability,
} from "./qcDateCodeShared";

export { QcDateCodeComparison };

type Ctx = QcDateCodeCheckInput["context"];

const labelClass = "mb-1.5 block text-xs font-semibold text-muted-foreground";
const inputClass = "min-h-10 w-full min-w-0 appearance-none rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60";
const monoInput = `${inputClass} font-mono tracking-wide`;
const buttonClass = "inline-flex min-h-10 max-w-full flex-wrap items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50";
const quietButtonClass = "inline-flex min-h-10 max-w-full flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50";
const errorBox = "flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-lg border border-rose-300/70 bg-rose-50 p-[min(.75rem,3vw)] text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200";

const uuid = () => crypto.randomUUID();
const canon = (v: string) => v.normalize("NFC").trim().toLocaleLowerCase("en-US");
function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "The server did not confirm this change. Retry without changing the submitted values.";
}

function ErrorRetry({ error, onRetry, pending, testId }: { error: unknown; onRetry: () => void; pending: boolean; testId: string }) {
  return (
    <div className={errorBox} role="alert" data-testid={testId}>
      <span className="flex min-w-0 items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{errorText(error)} Your entries were kept.</span>
      </span>
      <button type="button" className={quietButtonClass} onClick={onRetry} disabled={pending} data-testid={`${testId}-retry`}>
        <RotateCcw className="h-3.5 w-3.5" /> Retry unchanged values
      </button>
    </div>
  );
}

export default function QcDateCodeVerification({
  runId,
  profileKey,
  canRecordQc,
  canManageQc,
  labelChecks = [],
}: {
  runId: string;
  profileKey: string;
  canRecordQc: boolean;
  canManageQc: boolean;
  labelChecks?: QcEvent[];
}) {
  const queryClient = useQueryClient();
  const currentRunId = useRef(runId);
  currentRunId.current = runId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const live = (savedRunId: string | null | undefined) => mounted.current && savedRunId === currentRunId.current;

  const referenceQuery = useGetQcDateCodeReferences({
    query: { enabled: canRecordQc || canManageQc, queryKey: getGetQcDateCodeReferencesQueryKey() },
  });

  // ---- check form
  const [batchContext, setBatchContext] = useState("");
  const [context, setContext] = useState<Ctx>("shipper-case");
  const [referenceEventId, setReferenceEventId] = useState("");
  const [labelCheckEventId, setLabelCheckEventId] = useState("");
  const [observed, setObserved] = useState<QcDateCodeText>(EMPTY_TEXT);
  const [readability, setReadability] = useState<QcDateCodeReadability>(DEFAULT_READABILITY);
  const [note, setNote] = useState("");
  const [checkOperationId, setCheckOperationId] = useState(uuid);
  const [lastSaved, setLastSaved] = useState<QcEvent | null>(null);
  const [checkAck, setCheckAck] = useState("");
  const submittedCheck = useRef<QcDateCodeCheckInput | null>(null);

  // ---- reference form
  const [editing, setEditing] = useState<QcDateCodeReference | null>(null);
  const [refBatch, setRefBatch] = useState("");
  const [refContext, setRefContext] = useState<Ctx>("shipper-case");
  const [expected, setExpected] = useState<QcDateCodeText>(EMPTY_TEXT);
  const [requiredFields, setRequiredFields] = useState<DateCodeField[]>(["productionCode", "bestByCode"]);
  const [sourceIdentity, setSourceIdentity] = useState("");
  const [sourceVersion, setSourceVersion] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [refOperationId, setRefOperationId] = useState(uuid);
  const [refAck, setRefAck] = useState("");
  const submittedRef = useRef<QcDateCodeReferenceInput | null>(null);

  const [reviewReason, setReviewReason] = useState("");
  const [reviewAttempt, setReviewAttempt] = useState<{ eventId: number; data: QcLabelReferenceReviewInput } | null>(null);
  const [reviewAck, setReviewAck] = useState("");

  const refreshRun = (savedRunId: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: getGetQcRunQueryKey(savedRunId) }),
    queryClient.invalidateQueries({ queryKey: getGetQcHistoryQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetQcDateCodeReferencesQueryKey() }),
  ]);

  const checkMutation = useRecordQcDateCodeCheck();
  const refMutation = useSaveQcDateCodeReference();
  const reviewMutation = useReviewQcDateCodeReference();

  const resetCheckForm = () => {
    setBatchContext("");
    setContext("shipper-case");
    setReferenceEventId("");
    setLabelCheckEventId("");
    setObserved(EMPTY_TEXT);
    setReadability(DEFAULT_READABILITY);
    setNote("");
    setCheckOperationId(uuid());
    submittedCheck.current = null;
  };

  useEffect(() => {
    resetCheckForm();
    setLastSaved(null);
    setCheckAck("");
    setEditing(null);
    setRefBatch("");
    setRefAck("");
    setRefOperationId(uuid());
    submittedRef.current = null;
    checkMutation.reset();
    refMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const references = referenceQuery.data?.items ?? [];
  const runProduct = canon(profileKey);
  const productKnown = Boolean(runProduct && runProduct.split("__").length === 2 && !runProduct.startsWith("__") && !runProduct.endsWith("__"));
  const trimmedBatch = literal(batchContext);
  const approved = useMemo(() => references.filter((r) => r.state === "approved"
    && productKnown
    && canon(r.productKey) === runProduct
    && r.runId === runId
    && literal(r.batchContext) === trimmedBatch
    && r.context === context), [references, productKnown, runProduct, runId, trimmedBatch, context]);
  const selectedRef = approved.find((r) => String(r.configurationEventId) === referenceEventId);
  const sameRunLabelChecks = labelChecks.filter((e) => e.runId === runId);

  // Drop a selected reference if it no longer matches filters (e.g. withdrawn after reload).
  useEffect(() => {
    if (referenceEventId && !selectedRef && !referenceQuery.isFetching) setReferenceEventId("");
  }, [referenceEventId, selectedRef, referenceQuery.isFetching]);

  const touchCheck = () => { setCheckOperationId(uuid()); setCheckAck(""); submittedCheck.current = null; checkMutation.reset(); };
  const batchValid = trimmedBatch.length >= 1 && trimmedBatch.length <= 200;
  const checkPending = checkMutation.isPending;
  const canSubmitCheck = canRecordQc && !!runId && batchValid && !checkPending;

  const buildCheck = (): QcDateCodeCheckInput => ({
    operationId: checkOperationId,
    runId,
    batchContext: trimmedBatch,
    context,
    ...(selectedRef ? { referenceEventId: selectedRef.configurationEventId } : {}),
    ...(labelCheckEventId && sameRunLabelChecks.some((e) => String(e.id) === labelCheckEventId) ? { labelCheckEventId: Number(labelCheckEventId) } : {}),
    observed: { productionCode: literal(observed.productionCode), bestByCode: literal(observed.bestByCode), otherCode: literal(observed.otherCode) },
    readability,
    ...(note.trim() ? { note: note.trim() } : {}),
  });

  const sendCheck = async (data: QcDateCodeCheckInput) => {
    submittedCheck.current = data;
    try {
      const response = await checkMutation.mutateAsync({ data });
      const savedRunId = response.event.runId ?? data.runId;
      if (live(savedRunId)) {
        setLastSaved(response.event);
        setCheckAck("Date code record acknowledged by the server. The result below is the server's literal comparison, not a hold or release decision.");
        resetCheckForm();
      }
      await refreshRun(savedRunId);
    } catch {
      // error surfaced via checkMutation.error; inputs preserved
    }
  };
  const submitCheck = () => { if (canSubmitCheck) void sendCheck(buildCheck()); };
  const retryCheck = () => { if (submittedCheck.current && !checkPending && submittedCheck.current.runId === runId) void sendCheck(submittedCheck.current); };

  // ---- references
  const touchRef = (fn: () => void) => { fn(); setRefOperationId(uuid()); setRefAck(""); submittedRef.current = null; refMutation.reset(); };
  const resetRefForm = () => {
    setEditing(null); setRefBatch(""); setRefContext("shipper-case"); setExpected(EMPTY_TEXT);
    setRequiredFields(["productionCode", "bestByCode"]); setSourceIdentity(""); setSourceVersion(""); setSourceDescription("");
    setRefOperationId(uuid()); setRefAck(""); submittedRef.current = null;
  };
  const editRef = (r: QcDateCodeReference) => {
    setEditing(r); setRefBatch(r.batchContext); setRefContext(r.context); setExpected({ ...r.expected });
    setRequiredFields([...r.requiredFields]); setSourceIdentity(r.sourceIdentity); setSourceVersion(r.sourceVersion);
    setSourceDescription(r.sourceDescription); setRefOperationId(uuid()); setRefAck("");
  };
  const requiredHaveValues = requiredFields.every((f) => literal(expected[f]).length > 0);
  const refValid = canManageQc && !!runId && literal(refBatch).length >= 1 && literal(refBatch).length <= 200
    && requiredFields.length > 0 && requiredHaveValues && !!sourceIdentity.trim() && !!sourceVersion.trim() && !!sourceDescription.trim();

  const sendRef = async (data: QcDateCodeReferenceInput) => {
    submittedRef.current = data;
    try {
      const response = await refMutation.mutateAsync({ data });
      const value = (response.event.payload as Record<string, unknown>).value as Record<string, unknown> | undefined;
      if (live(data.runId)) {
        resetRefForm();
        setRefAck(`Version ${String(value?.version ?? "")} saved as a draft. It cannot be used for comparison until a manager explicitly approves it.`);
      }
      await refreshRun(data.runId);
    } catch {
      // preserved
    }
  };
  const submitRef = () => {
    if (!refValid || refMutation.isPending) return;
    void sendRef({
      operationId: refOperationId,
      ...(editing ? { referenceId: editing.referenceId } : {}),
      runId,
      batchContext: literal(refBatch),
      context: refContext,
      expected: { productionCode: literal(expected.productionCode), bestByCode: literal(expected.bestByCode), otherCode: literal(expected.otherCode) },
      requiredFields,
      sourceIdentity: sourceIdentity.trim(),
      sourceVersion: sourceVersion.trim(),
      sourceDescription: sourceDescription.trim(),
    });
  };

  const sendReview = async (eventId: number, data: QcLabelReferenceReviewInput, originRunId: string) => {
    setReviewAttempt({ eventId, data });
    try {
      const response = await reviewMutation.mutateAsync({ eventId, data });
      if (live(originRunId)) {
        const decision = (response.event.payload as Record<string, unknown>).decision === "approved" ? "approved" : "withdrawn";
        setReviewAck(`Reference ${decision}. Reason recorded.`);
        setReviewAttempt(null);
        setReviewReason("");
      }
      await refreshRun(originRunId);
    } catch {
      // preserved
    }
  };
  const submitReview = (r: QcDateCodeReference, decision: QcLabelReferenceReviewInput["decision"]) => {
    const reason = reviewReason.trim();
    if (!reason || !canManageQc || reviewMutation.isPending) return;
    const same = reviewAttempt && reviewAttempt.eventId === r.configurationEventId && reviewAttempt.data.decision === decision && reviewAttempt.data.reason === reason;
    setReviewAck("");
    void sendReview(r.configurationEventId, same ? reviewAttempt.data : { operationId: uuid(), decision, reason }, r.runId);
  };

  const unknownFields = DATE_CODE_FIELDS.filter(({ key }) => readability[key] !== "readable");

  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border/80 bg-card p-[min(1rem,4vw)] shadow-sm sm:p-5" data-testid="qc-date-code-verification">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold">Printed date code record</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            Copy the production code, best-by code, and any other approved code exactly as printed. Text is compared literally after trimming outer spaces; it is never read as a calendar date.
          </p>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
          Evidence only · not a hold or release
        </span>
      </header>

      {referenceQuery.isError && (
        <div className={errorBox} role="alert" data-testid="error-date-code-references">
          <span>Approved date code references could not be loaded. You can still record an observation; it will be saved as not evaluated unless the server applies a reference.</span>
          <button type="button" className={quietButtonClass} onClick={() => void referenceQuery.refetch()} data-testid="button-retry-date-code-references">
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block min-w-0">
          <span className={labelClass}>Batch/pack context (required)</span>
          <input
            className={monoInput} value={batchContext} maxLength={200} disabled={!canRecordQc || checkPending}
            placeholder="e.g. Pallet 3, cases 41-60" data-testid="input-date-code-batch-context"
            onChange={(e) => { setBatchContext(e.target.value); setReferenceEventId(""); touchCheck(); }}
          />
        </label>
        <label className="block min-w-0">
          <span className={labelClass}>Packaging context</span>
          <select className={inputClass} value={context} disabled={!canRecordQc || checkPending} data-testid="select-date-code-context"
            onChange={(e) => { setContext(e.target.value as Ctx); setReferenceEventId(""); touchCheck(); }}>
            {DATE_CODE_CONTEXTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={labelClass}>Approved reference for this run, batch/pack, and context</span>
          <select className={inputClass} value={referenceEventId} data-testid="select-date-code-reference"
            disabled={!canRecordQc || checkPending || referenceQuery.isLoading || !batchValid}
            onChange={(e) => { setReferenceEventId(e.target.value); touchCheck(); }}>
            <option value="">{referenceQuery.isLoading ? "Loading references" : "None - observation only"}</option>
            {approved.map((r) => (
              <option key={r.configurationEventId} value={String(r.configurationEventId)}>
                {r.sourceIdentity} · source {r.sourceVersion} · v{r.version}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={labelClass}>Linked label check (optional, this run only)</span>
          <select className={inputClass} value={labelCheckEventId} data-testid="select-date-code-label-check"
            disabled={!canRecordQc || checkPending || sameRunLabelChecks.length === 0}
            onChange={(e) => { setLabelCheckEventId(e.target.value); touchCheck(); }}>
            <option value="">{sameRunLabelChecks.length ? "Not linked" : "No label checks on this run"}</option>
            {sameRunLabelChecks.map((e) => (
              <option key={e.id} value={String(e.id)}>Label check #{e.id} · {new Date(e.createdAt).toLocaleString()}</option>
            ))}
          </select>
        </label>
      </div>

      {selectedRef ? (
        <div className="rounded-lg border border-emerald-700/20 bg-emerald-50/70 p-[min(.75rem,3vw)] dark:border-emerald-900/50 dark:bg-emerald-950/20" data-testid="panel-date-code-selected-reference">
          <p className="text-xs font-semibold">Approved reference · config v{selectedRef.version} · {selectedRef.sourceIdentity} (source version {selectedRef.sourceVersion})</p>
          <dl className="mt-2 grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-3">
            {DATE_CODE_FIELDS.map(({ key, label }) => (
              <div key={key} className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase text-muted-foreground">{label} · {selectedRef.requiredFields.includes(key) ? "required" : "not required"}</dt>
                <dd className="break-words font-mono font-medium">{selectedRef.expected[key] || "Not configured"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 break-words text-[11px] text-muted-foreground">{selectedRef.sourceDescription}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">The server decides the outcome when you save. Nothing is pre-judged here.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-[min(.75rem,3vw)] text-xs leading-5" data-testid="panel-date-code-observation-only">
          <p className="font-semibold">Observation only · will be recorded as not evaluated</p>
          <p className="text-muted-foreground">
            {!productKnown
              ? "This run has no canonical product identity, so no reference can apply."
              : !batchValid
                ? "Enter the batch/pack context to look for an approved reference."
                : approved.length
                  ? "Approved references exist for this batch/pack and context; select one to have the server compare against it."
                  : "No approved reference exists for this product, run, batch/pack, and context. No real date policy is configured; this record proves only what was observed."}
          </p>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        {DATE_CODE_FIELDS.map(({ key, label }) => (
          <div key={key} className="min-w-0 rounded-lg border border-border/70 p-[min(.75rem,3vw)]">
            <label className="block min-w-0">
              <span className={labelClass}>Observed {label.toLowerCase()}</span>
              <input
                className={monoInput} value={observed[key]} maxLength={MAX_CODE} disabled={!canRecordQc || checkPending}
                placeholder="Exact printed text" autoComplete="off" spellCheck={false} data-testid={`input-date-code-observed-${key}`}
                onChange={(e) => { const v = e.target.value; setObserved((c) => ({ ...c, [key]: v })); touchCheck(); }}
              />
            </label>
            <fieldset className="mt-2" disabled={!canRecordQc || checkPending}>
              <legend className="sr-only">{label} readability</legend>
              <div className="flex flex-wrap gap-1">
                {READABILITY.map((r) => {
                  const active = readability[key] === r.value;
                  return (
                    <button key={r.value} type="button" aria-pressed={active} data-testid={`button-date-code-readability-${key}-${r.value}`}
                      onClick={() => { setReadability((c) => ({ ...c, [key]: r.value as Readability })); touchCheck(); }}
                      className={`min-h-10 rounded-md border px-3 py-2 text-[11px] font-semibold disabled:opacity-50 ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {readability[key] === "readable" && !observed[key].trim() && (
              <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-200">Blank but marked readable. Mark it missing if nothing is printed.</p>
            )}
          </div>
        ))}
      </div>
      {unknownFields.length > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid="text-date-code-unknowns">
          Recorded as unknown: {unknownFields.map(({ key, label }) => `${label} (${readability[key]})`).join(", ")}.
        </p>
      )}

      <label className="block min-w-0">
        <span className={labelClass}>Note (optional)</span>
        <textarea className={`${inputClass} py-2`} rows={2} maxLength={1000} value={note} disabled={!canRecordQc || checkPending}
          data-testid="input-date-code-note" onChange={(e) => { setNote(e.target.value); touchCheck(); }} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={submitCheck} disabled={!canSubmitCheck} data-testid="button-save-date-code-check">
          {checkPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {checkPending ? "Waiting for server" : "Record date code observation"}
        </button>
        {!canRecordQc && <span className="text-xs text-muted-foreground">QC recording permission is required.</span>}
        {canRecordQc && !batchValid && <span className="text-xs text-muted-foreground">Batch/pack context is required.</span>}
      </div>
      {checkMutation.error && !checkPending && (
        <ErrorRetry error={checkMutation.error} onRetry={retryCheck} pending={checkPending} testId="error-date-code-check" />
      )}
      {checkAck && <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200" role="status" data-testid="status-date-code-check">{checkAck}</p>}
      {lastSaved && <QcDateCodeComparison event={lastSaved} />}

      {canManageQc && (
        <div className="space-y-4 border-t border-border/70 pt-4" data-testid="qc-date-code-reference-manager">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">Manager date code references</h3>
              <p className="mt-1 text-xs text-muted-foreground">Exact expected text from an identified source, scoped to this run and one batch/pack context. Saving creates a draft version; approval is a separate decision.</p>
            </div>
            <button type="button" className={quietButtonClass} onClick={() => void referenceQuery.refetch()} disabled={referenceQuery.isFetching} data-testid="button-reload-date-code-references">
              <RotateCcw className={`h-3.5 w-3.5 ${referenceQuery.isFetching ? "animate-spin" : ""}`} /> Reload
            </button>
          </div>

          <label className="block min-w-0">
            <span className={labelClass}>Review reason (required to approve or withdraw)</span>
            <input className={inputClass} value={reviewReason} maxLength={500} disabled={reviewMutation.isPending} data-testid="input-date-code-review-reason"
              onChange={(e) => { setReviewReason(e.target.value); setReviewAck(""); }} />
          </label>
          {reviewMutation.error && !reviewMutation.isPending && reviewAttempt && (
            <ErrorRetry error={reviewMutation.error} pending={reviewMutation.isPending} testId="error-date-code-review"
              onRetry={() => { const a = reviewAttempt; const r = references.find((x) => x.configurationEventId === a.eventId); void sendReview(a.eventId, a.data, r?.runId ?? runId); }} />
          )}
          {reviewAck && <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200" role="status">{reviewAck}</p>}

          {referenceQuery.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : references.length ? (
            <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
              {references.map((r) => (
                <article key={r.configurationEventId} className="min-w-0 rounded-lg border border-border/70 p-[min(.75rem,3vw)]" data-testid={`card-date-code-reference-${r.configurationEventId}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-xs font-bold">{r.sourceIdentity} · source {r.sourceVersion} · v{r.version}</p>
                      <p className="break-words text-[11px] text-muted-foreground">
                        {contextLabel(r.context)} · <span className="font-mono">{r.batchContext}</span> · run {r.runId === runId ? "(this run)" : r.runId}
                      </p>
                    </div>
                    <ResultTag value={r.state} />
                  </div>
                  <dl className="mt-2 grid min-w-0 grid-cols-1 gap-1 text-[11px]">
                    {DATE_CODE_FIELDS.map(({ key, label }) => (
                      <div key={key} className="flex min-w-0 gap-2">
                        <dt className="shrink-0 text-muted-foreground">{label}{r.requiredFields.includes(key) ? " *" : ""}:</dt>
                        <dd className="min-w-0 break-words font-mono">{r.expected[key] || "Not configured"}</dd>
                      </div>
                    ))}
                  </dl>
                  {r.reviewedAt && <p className="mt-1 text-[10px] text-muted-foreground">Last reviewed by {r.reviewedBy ?? "unknown"} at {new Date(r.reviewedAt).toLocaleString()}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={quietButtonClass} onClick={() => editRef(r)} disabled={refMutation.isPending} data-testid={`button-date-code-new-version-${r.configurationEventId}`}>New version</button>
                    {r.state !== "approved" && (
                      <button type="button" className={quietButtonClass} onClick={() => submitReview(r, "approved")} disabled={reviewMutation.isPending || !reviewReason.trim()} data-testid={`button-date-code-approve-${r.configurationEventId}`}>Approve</button>
                    )}
                    {r.state !== "withdrawn" && (
                      <button type="button" className={quietButtonClass} onClick={() => submitReview(r, "withdrawn")} disabled={reviewMutation.isPending || !reviewReason.trim()} data-testid={`button-date-code-withdraw-${r.configurationEventId}`}>Withdraw</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : !referenceQuery.isError ? (
            <p className="rounded-lg border border-dashed border-border p-[min(.75rem,3vw)] text-xs text-muted-foreground">No date code references exist. Every observation is recorded as not evaluated until one is saved and approved.</p>
          ) : null}

          <div className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-border/70 p-[min(.75rem,3vw)] md:grid-cols-2" data-testid="form-date-code-reference">
            <p className="text-xs font-bold md:col-span-2">{editing ? `New version of ${editing.sourceIdentity} (from v${editing.version})` : "New reference"} · applies to this run only</p>
            <label className="block min-w-0">
              <span className={labelClass}>Batch/pack context (required)</span>
              <input className={monoInput} value={refBatch} maxLength={200} disabled={refMutation.isPending} data-testid="input-date-code-ref-batch"
                onChange={(e) => { const v = e.target.value; touchRef(() => setRefBatch(v)); }} />
            </label>
            <label className="block min-w-0">
              <span className={labelClass}>Packaging context</span>
              <select className={inputClass} value={refContext} disabled={refMutation.isPending} data-testid="select-date-code-ref-context"
                onChange={(e) => { const v = e.target.value as Ctx; touchRef(() => setRefContext(v)); }}>
                {DATE_CODE_CONTEXTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            {DATE_CODE_FIELDS.map(({ key, label }) => (
              <div key={key} className="min-w-0">
                <label className="block min-w-0">
                  <span className={labelClass}>Expected {label.toLowerCase()}</span>
                  <input className={monoInput} value={expected[key]} maxLength={MAX_CODE} disabled={refMutation.isPending} spellCheck={false}
                    placeholder="Exact text from source" data-testid={`input-date-code-ref-expected-${key}`}
                    onChange={(e) => { const v = e.target.value; touchRef(() => setExpected((c) => ({ ...c, [key]: v }))); }} />
                </label>
                <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={requiredFields.includes(key)} disabled={refMutation.isPending}
                    data-testid={`checkbox-date-code-ref-required-${key}`}
                    onChange={(e) => { const on = e.target.checked; touchRef(() => setRequiredFields((c) => on ? [...c, key] : c.filter((f) => f !== key))); }} />
                  Required field
                </label>
              </div>
            ))}
            <label className="block min-w-0">
              <span className={labelClass}>Source identity (required)</span>
              <input className={inputClass} value={sourceIdentity} maxLength={200} disabled={refMutation.isPending} data-testid="input-date-code-ref-source-identity"
                onChange={(e) => { const v = e.target.value; touchRef(() => setSourceIdentity(v)); }} />
            </label>
            <label className="block min-w-0">
              <span className={labelClass}>Source version (required)</span>
              <input className={inputClass} value={sourceVersion} maxLength={100} disabled={refMutation.isPending} data-testid="input-date-code-ref-source-version"
                onChange={(e) => { const v = e.target.value; touchRef(() => setSourceVersion(v)); }} />
            </label>
            <label className="block min-w-0 md:col-span-2">
              <span className={labelClass}>Source description (required)</span>
              <textarea className={`${inputClass} py-2`} rows={2} maxLength={500} value={sourceDescription} disabled={refMutation.isPending} data-testid="input-date-code-ref-source-description"
                onChange={(e) => { const v = e.target.value; touchRef(() => setSourceDescription(v)); }} />
            </label>
            {!requiredHaveValues && <p className="text-[11px] text-amber-800 dark:text-amber-200 md:col-span-2">Every required field needs expected text.</p>}
            {requiredFields.length === 0 && <p className="text-[11px] text-amber-800 dark:text-amber-200 md:col-span-2">Choose at least one required field.</p>}
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <button type="button" className={buttonClass} onClick={submitRef} disabled={!refValid || refMutation.isPending} data-testid="button-save-date-code-reference">
                {refMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editing ? "Save new draft version" : "Save draft reference"}
              </button>
              {(editing || refBatch) && <button type="button" className={quietButtonClass} onClick={resetRefForm} disabled={refMutation.isPending} data-testid="button-cancel-date-code-reference">Clear</button>}
            </div>
            {refMutation.error && !refMutation.isPending && submittedRef.current && (
              <div className="md:col-span-2">
                <ErrorRetry error={refMutation.error} pending={refMutation.isPending} testId="error-date-code-reference"
                  onRetry={() => { if (submittedRef.current) void sendRef(submittedRef.current); }} />
              </div>
            )}
            {refAck && <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 md:col-span-2" role="status">{refAck}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
