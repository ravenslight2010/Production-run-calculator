import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, LoaderCircle, Plus, RotateCcw } from "lucide-react";
import {
  getGetQcHistoryQueryKey,
  getGetQcLabelReferencesQueryKey,
  getGetQcRunQueryKey,
  useGetQcLabelReferences,
  useRecordQcLabelCheck,
  useReviewQcLabelReference,
  useSaveQcLabelReference,
  type QcEvent,
  type QcLabelField,
  type QcLabelReference,
  type QcLabelReferenceInput,
  type QcLabelCheckInput,
} from "@workspace/api-client-react";

const LABEL_FIELDS: Array<{ key: QcLabelField; label: string; maxLength: number }> = [
  { key: "productName", label: "Product name", maxLength: 200 },
  { key: "lotText", label: "Lot text", maxLength: 200 },
  { key: "dateText", label: "Date text", maxLength: 100 },
];

const contexts = [
  { value: "shipper-case", label: "Shipper case" },
  { value: "carton-label", label: "Carton label" },
] as const;

const labelClass = "mb-1.5 block text-xs font-semibold text-muted-foreground";
const inputClass = "min-h-10 w-full min-w-0 appearance-none rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50";
const quietButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50";

function uuid() {
  return crypto.randomUUID();
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "The server did not confirm this change. Retry without changing the submitted values.";
}

function TextField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = `qc-label-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className={labelClass}>{label}{required ? " (required)" : ""}</span>
      <input
        id={id}
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  rows = 2,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const id = `qc-label-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className={labelClass}>{label}</span>
      <textarea
        id={id}
        className={`${inputClass} py-2`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
      />
    </label>
  );
}

function StatusTag({ value }: { value: string }) {
  const style = value === "pass"
    ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200"
    : value === "fail"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200"
      : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${style}`}>{value}</span>;
}

function textOrRedacted(value: unknown) {
  if (typeof value !== "string") return "—";
  return value === "[redacted]" ? "Redacted" : value || "—";
}

export function QcLabelComparison({ event }: { event: QcEvent }) {
  const payload = event.payload as Record<string, unknown>;
  const results = payload.fieldResults && typeof payload.fieldResults === "object"
    ? payload.fieldResults as Record<string, unknown>
    : {};
  const outcome = typeof payload.outcome === "string" ? payload.outcome : "not-evaluated";
  const reason = typeof payload.referenceUnavailableReason === "string"
    ? payload.referenceUnavailableReason
    : "";
  const snapshot = payload.referenceSnapshot && typeof payload.referenceSnapshot === "object"
    ? payload.referenceSnapshot as Record<string, unknown>
    : null;

  return (
    <section className="rounded-lg border border-border/70 bg-background p-3" data-testid={`qc-label-result-${event.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold">Observed label text · {payload.context === "carton-label" ? "Carton label" : "Shipper case"}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {snapshot?.state === "approved" && typeof snapshot.sourceIdentity === "string"
              ? `Approved reference: ${textOrRedacted(snapshot.sourceIdentity)} · version ${String(snapshot.version)}`
              : "Observation only"}
          </p>
        </div>
        <StatusTag value={outcome} />
      </div>
      {reason && <p className="mt-2 text-xs text-amber-900 dark:text-amber-200">{reason}</p>}
      <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-3">
        {LABEL_FIELDS.map(({ key, label }) => {
          const item = results[key] && typeof results[key] === "object"
            ? results[key] as Record<string, unknown>
            : {};
          return (
            <div key={key} className="min-w-0 rounded-md border border-border/60 p-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-words text-xs">
                <span className="font-semibold">Observed:</span> {textOrRedacted(item.observed)}
              </dd>
              <dd className="mt-1 break-words text-xs">
                <span className="font-semibold">Expected:</span> {textOrRedacted(item.expected)}
              </dd>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                <StatusTag value={typeof item.state === "string" ? item.state : "not-evaluated"} />
                {typeof item.reason === "string" && item.reason && (
                  <span className="min-w-0 break-words text-[10px] text-muted-foreground">{item.reason}</span>
                )}
              </div>
            </div>
          );
        })}
      </dl>
      {typeof payload.note === "string" && payload.note && (
        <p className="mt-2 break-words text-xs text-muted-foreground">
          <span className="font-semibold">Note:</span> {textOrRedacted(payload.note)}
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Advisory text comparison only. This record does not create a packaging hold or shipping clearance.
      </p>
    </section>
  );
}

export default function QcLabelVerification({
  runId,
  profileKey,
  canRecordQc,
  canManageQc,
}: {
  runId: string;
  profileKey: string;
  canRecordQc: boolean;
  canManageQc: boolean;
}) {
  const queryClient = useQueryClient();
  const currentRunId = useRef(runId);
  currentRunId.current = runId;
  const referenceQuery = useGetQcLabelReferences({
    query: {
      enabled: canRecordQc || canManageQc,
      queryKey: getGetQcLabelReferencesQueryKey(),
    },
  });
  const [context, setContext] = useState<QcLabelCheckInput["context"]>("shipper-case");
  const [referenceId, setReferenceId] = useState("");
  const [observed, setObserved] = useState({ productName: "", lotText: "", dateText: "" });
  const [note, setNote] = useState("");
  const [checkOperationId, setCheckOperationId] = useState(uuid);
  const [lastSaved, setLastSaved] = useState<QcEvent | null>(null);
  const [checkAcknowledgement, setCheckAcknowledgement] = useState("");

  const [editingReference, setEditingReference] = useState<QcLabelReference | null>(null);
  const [referenceContext, setReferenceContext] = useState<QcLabelReferenceInput["context"]>("shipper-case");
  const [productKey, setProductKey] = useState("");
  const [expected, setExpected] = useState({ productName: "", lotText: "", dateText: "" });
  const [requiredFields, setRequiredFields] = useState<QcLabelField[]>(["productName", "lotText", "dateText"]);
  const [sourceIdentity, setSourceIdentity] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [referenceOperationId, setReferenceOperationId] = useState(uuid);
  const [referenceAcknowledgement, setReferenceAcknowledgement] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewAttempt, setReviewAttempt] = useState<{
    eventId: number;
    decision: "approved" | "withdrawn";
    reason: string;
    operationId: string;
  } | null>(null);
  const [reviewAcknowledgement, setReviewAcknowledgement] = useState("");

  const refreshSavedEvidence = async (savedRunId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetQcRunQueryKey(savedRunId) }),
      queryClient.invalidateQueries({ queryKey: getGetQcHistoryQueryKey() }),
    ]);
  };
  const refreshReferences = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetQcLabelReferencesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetQcHistoryQueryKey() }),
    ]);
  };

  const checkMutation = useRecordQcLabelCheck({
    mutation: {
      onSuccess: async (response) => {
        const savedRunId = response.event.runId;
        if (savedRunId === currentRunId.current) {
          setLastSaved(response.event);
          setCheckAcknowledgement("Label observation saved. Its result is advisory and does not imply a hold or clearance.");
          setObserved({ productName: "", lotText: "", dateText: "" });
          setNote("");
          setReferenceId("");
          setCheckOperationId(uuid());
        }
        if (savedRunId) await refreshSavedEvidence(savedRunId);
      },
    },
  });
  const referenceMutation = useSaveQcLabelReference({
    mutation: {
      onSuccess: async (response) => {
        const payload = response.event.payload as Record<string, unknown>;
        setReferenceAcknowledgement(`Version ${String(payload.version ?? "")} saved as a draft. It cannot be used until explicitly approved.`);
        setReferenceOperationId(uuid());
        await refreshReferences();
      },
    },
  });
  const reviewMutation = useReviewQcLabelReference({
    mutation: {
      onSuccess: async (response) => {
        const decision = response.event.payload.decision === "approved" ? "approved" : "withdrawn";
        setReviewAcknowledgement(`Reference ${decision}.`);
        setReviewAttempt(null);
        await refreshReferences();
      },
    },
  });

  useEffect(() => {
    setContext("shipper-case");
    setReferenceId("");
    setObserved({ productName: "", lotText: "", dateText: "" });
    setNote("");
    setLastSaved(null);
    setCheckAcknowledgement("");
    setCheckOperationId(uuid());
  }, [runId]);

  const references = referenceQuery.data?.items ?? [];
  const runProductKey = profileKey.normalize("NFC").trim().toLocaleLowerCase("en-US");
  const productIdentityKnown = Boolean(runProductKey && runProductKey.split("__").length === 2
    && !runProductKey.startsWith("__") && !runProductKey.endsWith("__"));
  const approvedReferences = useMemo(
    () => references.filter((reference) => reference.state === "approved"
      && reference.context === context
      && productIdentityKnown
      && reference.productKey.normalize("NFC").trim().toLocaleLowerCase("en-US") === runProductKey),
    [context, references, productIdentityKnown, runProductKey],
  );
  const selectedReference = approvedReferences.find((reference) => reference.referenceId === referenceId);
  const hasObservedText = Object.values(observed).some((value) => value.trim().length > 0);
  const checkInput: QcLabelCheckInput = {
    operationId: checkOperationId,
    runId,
    context,
    ...(referenceId ? { referenceId } : {}),
    observed,
    ...(note.trim() ? { note: note.trim() } : {}),
  };

  const updateObserved = (field: keyof typeof observed, value: string) => {
    setObserved((current) => ({ ...current, [field]: value }));
    setCheckOperationId(uuid());
    setCheckAcknowledgement("");
  };
  const updateReferenceForm = (update: () => void) => {
    update();
    setReferenceOperationId(uuid());
    setReferenceAcknowledgement("");
  };

  const submitCheck = () => {
    if (!hasObservedText || !runId || !canRecordQc) return;
    checkMutation.mutate({ data: checkInput });
  };

  const resetReferenceForm = () => {
    setEditingReference(null);
    setReferenceContext("shipper-case");
    setProductKey("");
    setExpected({ productName: "", lotText: "", dateText: "" });
    setRequiredFields(["productName", "lotText", "dateText"]);
    setSourceIdentity("");
    setSourceDescription("");
    setReferenceOperationId(uuid());
    setReferenceAcknowledgement("");
  };
  const editReference = (reference: QcLabelReference) => {
    setEditingReference(reference);
    setReferenceContext(reference.context);
    setProductKey(reference.productKey);
    setExpected({
      productName: reference.expected.productName ?? "",
      lotText: reference.expected.lotText ?? "",
      dateText: reference.expected.dateText ?? "",
    });
    setRequiredFields(reference.requiredFields);
    setSourceIdentity(reference.sourceIdentity);
    setSourceDescription(reference.sourceDescription);
    setReferenceOperationId(uuid());
    setReferenceAcknowledgement("");
  };
  const submitReference = () => {
    if (!canManageQc || !productKey.trim() || !sourceIdentity.trim() || !sourceDescription.trim() || !requiredFields.length) return;
    const data: QcLabelReferenceInput = {
      operationId: referenceOperationId,
      ...(editingReference ? { referenceId: editingReference.referenceId } : {}),
      context: referenceContext,
      productKey: productKey.trim(),
      expected,
      requiredFields,
      sourceIdentity: sourceIdentity.trim(),
      sourceDescription: sourceDescription.trim(),
    };
    referenceMutation.mutate({ data });
  };
  const submitReview = (reference: QcLabelReference, decision: "approved" | "withdrawn") => {
    const reason = reviewReason.trim();
    if (!reason || !canManageQc) return;
    const operationId = reviewAttempt
      && reviewAttempt.eventId === reference.configurationEventId
      && reviewAttempt.decision === decision
      && reviewAttempt.reason === reason
      ? reviewAttempt.operationId
      : uuid();
    setReviewAttempt({ eventId: reference.configurationEventId, decision, reason, operationId });
    reviewMutation.mutate({
      eventId: reference.configurationEventId,
      data: { operationId, decision, reason },
    });
  };

  return (
    <section className="space-y-4 rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5" data-testid="qc-label-verification">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold">Shipper label text check</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            Record observed product, lot, and printed date text for this run. Date text is compared literally; no date-code or shelf-life meaning is inferred.
          </p>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
          Advisory · no hold or shipping clearance
        </span>
      </header>

      {referenceQuery.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300/70 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
          <span>Approved label references could not be loaded. You can still save observations; the server determines whether a comparison is available.</span>
          <button type="button" className={quietButtonClass} onClick={() => void referenceQuery.refetch()}>
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <label className="block min-w-0">
          <span className={labelClass}>Packaging context</span>
          <select
            className={inputClass}
            value={context}
            onChange={(event) => {
              setContext(event.target.value as QcLabelCheckInput["context"]);
              setReferenceId("");
              setCheckOperationId(uuid());
            }}
            disabled={!canRecordQc || checkMutation.isPending}
          >
            {contexts.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={labelClass}>Approved reference</span>
          <select
            className={inputClass}
            value={referenceId}
            onChange={(event) => {
              setReferenceId(event.target.value);
              setCheckOperationId(uuid());
            }}
            disabled={!canRecordQc || referenceQuery.isLoading || checkMutation.isPending}
          >
            <option value="">None — observation only</option>
            {approvedReferences.map((reference) => (
              <option key={reference.referenceId} value={reference.referenceId}>
                {reference.productKey} · v{reference.version}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedReference ? (
        <div className="rounded-lg border border-emerald-700/20 bg-emerald-50/70 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <p className="text-xs font-semibold">Approved reference · version {selectedReference.version}</p>
          <dl className="mt-2 grid min-w-0 gap-2 text-xs sm:grid-cols-3">
            {LABEL_FIELDS.map(({ key, label }) => (
              <div key={key} className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {label}{selectedReference.requiredFields.includes(key) ? " · required" : " · optional"}
                </dt>
                <dd className="break-words font-medium">{selectedReference.expected[key] || "Not configured"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 break-words text-[11px] text-muted-foreground">
            Source: {selectedReference.sourceIdentity} — {selectedReference.sourceDescription}
            {selectedReference.reviewedAt ? ` · approved ${new Date(selectedReference.reviewedAt).toLocaleString()}` : ""}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5">
          <p className="font-semibold">Observation-only mode</p>
          <p className="text-muted-foreground">
            No approved reference is selected for this context. You can still save the observation; every comparison will be not evaluated. This is not an approved label claim, packaging hold, or shipping clearance.
          </p>
        </div>
      )}

      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        {LABEL_FIELDS.map(({ key, label, maxLength }) => (
          <TextField
            key={key}
            label={`Observed ${label.toLowerCase()}`}
            value={observed[key]}
            onChange={(value) => updateObserved(key, value)}
            maxLength={maxLength}
            placeholder={`Text visible on the label`}
            disabled={!canRecordQc || checkMutation.isPending}
          />
        ))}
      </div>
      <TextAreaField
        label="Note (optional)"
        value={note}
        onChange={(value) => {
          setNote(value);
          setCheckOperationId(uuid());
          setCheckAcknowledgement("");
        }}
        maxLength={1000}
          disabled={checkMutation.isPending || !canRecordQc}
        placeholder="Optional context for this observation"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={submitCheck}
          disabled={!canRecordQc || !runId || !hasObservedText || checkMutation.isPending}
        >
          {checkMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save observation
        </button>
        {!canRecordQc && <span className="text-xs text-muted-foreground">QC recording permission is required to save an observation.</span>}
      </div>
      {checkMutation.error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300/70 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
          <span className="flex min-w-0 items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{errorText(checkMutation.error)}</span>
          <button type="button" className={quietButtonClass} onClick={submitCheck} disabled={checkMutation.isPending}>Retry saved values</button>
        </div>
      )}
      {checkAcknowledgement && <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200" role="status">{checkAcknowledgement}</p>}
      {lastSaved && <QcLabelComparison event={lastSaved} />}

      {canManageQc && (
        <div className="space-y-4 border-t border-border/70 pt-4" data-testid="qc-label-reference-manager">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">Manager-approved text references</h3>
              <p className="mt-1 text-xs text-muted-foreground">Enter values only from an explicitly identified authoritative source. Saving a version does not approve it.</p>
            </div>
            {editingReference && (
              <button type="button" className={quietButtonClass} onClick={resetReferenceForm}>Cancel new version</button>
            )}
          </div>

          {referenceQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading current reference status…</p>
          ) : referenceQuery.data?.items.length ? (
            <div className="grid min-w-0 gap-2 lg:grid-cols-2">
              {references.map((reference) => (
                <article key={reference.referenceId} className="min-w-0 rounded-lg border border-border/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-xs font-bold">{reference.productKey} · v{reference.version}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {reference.context === "carton-label" ? "Carton label" : "Shipper case"} · {reference.state}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={quietButtonClass} onClick={() => editReference(reference)}>New version</button>
                      {reference.state === "approved" ? (
                        <button
                          type="button"
                          className={quietButtonClass}
                          onClick={() => submitReview(reference, "withdrawn")}
                          disabled={reviewMutation.isPending || !reviewReason.trim()}
                        >Withdraw</button>
                      ) : (
                        <button
                          type="button"
                          className={quietButtonClass}
                          onClick={() => submitReview(reference, "approved")}
                          disabled={reviewMutation.isPending || !reviewReason.trim()}
                        >Approve</button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 break-words text-[11px] text-muted-foreground">
                    Source: {reference.sourceIdentity} — {reference.sourceDescription}
                  </p>
                  {reference.reviewedAt && (
                    <p className="mt-1 break-words text-[10px] text-muted-foreground">
                      Last reviewed by {reference.reviewedBy ?? "unknown"} at {new Date(reference.reviewedAt).toLocaleString()}
                    </p>
                  )}
                  {reference.reviewReason && (
                    <p className="mt-1 break-words text-[10px] text-muted-foreground">Review reason: {reference.reviewReason}</p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No label references have been configured. Until a source is reviewed and approved, checks operate in observation-only mode.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            To review older versions or export their audit trail, clear the Run ID filter in QC evidence history below.
          </p>

          <div className="grid min-w-0 gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-2">
            <label className="block min-w-0">
              <span className={labelClass}>Packaging context</span>
              <select
                className={inputClass}
                value={referenceContext}
                onChange={(event) => updateReferenceForm(() => setReferenceContext(event.target.value as QcLabelReferenceInput["context"]))}
              >
                {contexts.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <TextField
              label="Manager-defined product key"
              value={productKey}
              onChange={(value) => updateReferenceForm(() => setProductKey(value))}
              maxLength={120}
              placeholder="Exact canonical brand__flavor key for the applicable run"
              required
            />
            <p className="break-words text-xs text-muted-foreground md:col-span-2">
              Current run product key: {productIdentityKnown ? runProductKey : "unavailable — observations remain not evaluated"}.
              Use this exact canonical brand__flavor key only when the approved source applies to this product.
            </p>
            {LABEL_FIELDS.map(({ key, label, maxLength }) => (
              <div key={key} className="min-w-0">
                <TextField
                  label={`Expected ${label.toLowerCase()}`}
                  value={expected[key]}
                  onChange={(value) => updateReferenceForm(() => setExpected((current) => ({ ...current, [key]: value })))}
                  maxLength={maxLength}
                  placeholder="Exact approved text, if present"
                />
                <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={requiredFields.includes(key)}
                    onChange={(event) => updateReferenceForm(() => setRequiredFields((current) => event.target.checked
                      ? [...current, key]
                      : current.filter((field) => field !== key)))}
                    className="h-4 w-4 accent-primary"
                  />
                  Required for overall pass
                </label>
              </div>
            ))}
            <TextField
              label="Source identity"
              value={sourceIdentity}
              onChange={(value) => updateReferenceForm(() => setSourceIdentity(value))}
              maxLength={200}
              placeholder="Document ID, controlled revision, or other source identity"
              required
            />
            <TextAreaField
              label="Source description"
              value={sourceDescription}
              onChange={(value) => updateReferenceForm(() => setSourceDescription(value))}
              maxLength={500}
              placeholder="Describe the approved source and relevant scope"
            />
            <div className="space-y-2 md:col-span-2">
              <button
                type="button"
                className={buttonClass}
                onClick={submitReference}
                disabled={!productKey.trim() || !sourceIdentity.trim() || !sourceDescription.trim() || !requiredFields.length || referenceMutation.isPending}
              >
                {referenceMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {editingReference ? "Save new draft version" : "Save new draft reference"}
              </button>
              {referenceMutation.error && (
                <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{errorText(referenceMutation.error)}</p>
              )}
              {referenceAcknowledgement && <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200" role="status">{referenceAcknowledgement}</p>}
            </div>
          </div>

          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextAreaField
              label="Approval or withdrawal reason"
              value={reviewReason}
              onChange={(value) => {
                setReviewReason(value);
                setReviewAttempt(null);
                setReviewAcknowledgement("");
              }}
              maxLength={500}
              placeholder="Record why this specific reference version was reviewed"
            />
            <div className="space-y-1">
              {reviewMutation.error && <p className="max-w-sm text-xs text-rose-700 dark:text-rose-300" role="alert">{errorText(reviewMutation.error)}</p>}
              {reviewAcknowledgement && <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200" role="status">{reviewAcknowledgement}</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
