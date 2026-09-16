import { useEffect, useMemo, useState } from "react";
import type { FormValues, HistoryDay, RunMeta } from "../types";
import { useMe } from "../useRole";
import {
  APPLICATOR_EVIDENCE_EVENT,
  loadApplicatorBatchEvidenceForActiveScope,
  pendingApplicatorBatchFinalizations,
  queueApplicatorBatchFinalization,
  reconcileApplicatorBatchEvidence,
  unresolvedApplicatorEvidenceConflicts,
  applicatorEvidenceHydrationErrorMessage,
  type ApplicatorBatchEvidence,
} from "../completedHistorySync";

const SLOT_FIELDS = ["app1Type", "app2Type", "app3Type", "app4Type"] as const;

export default function ApplicatorEvidenceReview(props: {
  day: HistoryDay;
  run: RunMeta;
  values: FormValues;
}) {
  const { isManager } = useMe();
  const [records, setRecords] = useState<ApplicatorBatchEvidence[]>(() => loadApplicatorBatchEvidenceForActiveScope());
  const [pending, setPending] = useState(() => pendingApplicatorBatchFinalizations());
  const [conflicts, setConflicts] = useState(() => unresolvedApplicatorEvidenceConflicts());
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [hydrationError, setHydrationError] = useState(applicatorEvidenceHydrationErrorMessage());

  useEffect(() => {
    if (!isManager || typeof window === "undefined") return;
    const refresh = () => {
      setRecords(loadApplicatorBatchEvidenceForActiveScope());
      setPending(pendingApplicatorBatchFinalizations());
      setConflicts(unresolvedApplicatorEvidenceConflicts());
      setHydrationError(applicatorEvidenceHydrationErrorMessage());
    };
    refresh();
    window.addEventListener(APPLICATOR_EVIDENCE_EVENT, refresh);
    return () => window.removeEventListener(APPLICATOR_EVIDENCE_EVENT, refresh);
  }, [isManager]);

  const rows = useMemo(() => {
    const applicable = SLOT_FIELDS.map((field, index) => ({
      slot: (index + 1) as 1 | 2 | 3 | 4,
      applicable: String(props.values[field] ?? "").trim().length > 0,
    })).filter((row) => row.applicable);
    const reconciled = reconcileApplicatorBatchEvidence(records)
      .filter((row) => row.date === props.day.date && row.runId === props.run.id);
    return applicable.map(({ slot }) => ({
      slot,
      total: reconciled.find((row) => row.slot === slot),
      pending: pending.find((item) => item.date === props.day.date && item.runId === props.run.id && item.slot === slot),
      conflict: conflicts.find((item) => item.finalization.date === props.day.date
        && item.finalization.runId === props.run.id && item.finalization.slot === slot),
    }));
  }, [conflicts, pending, props.day.date, props.run.id, props.values, records]);

  if (!isManager || !props.run.endedAt || rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Applicator physical totals
      </div>
      {hydrationError && (
        <p className="text-[10px] text-amber-700" role="status">
          Historical evidence needs refresh: {hydrationError}
        </p>
      )}
      {rows.map(({ slot, total, pending: queued, conflict }) => {
        const current = total?.latestConfirmedTotal ?? total?.latestObservedTotal;
        const value = inputs[slot] ?? (current === undefined ? "" : String(current));
        const correction = total?.latestConfirmedOperationId !== undefined;
        return (
          <div key={slot} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="w-12 font-medium">Slot {slot}</span>
            <span className="text-muted-foreground">
              Auto: {total?.latestObservedTotal ?? "—"}
            </span>
            <span className="text-muted-foreground">
              Confirmed: {total?.latestConfirmedTotal ?? "—"}
            </span>
            <input
              aria-label={`Applicator slot ${slot} physical total`}
              type="number" min={0} max={1_000_000} step={1}
              value={value}
              onChange={(event) => setInputs((prior) => ({ ...prior, [slot]: event.target.value }))}
              className="w-16 h-7 rounded border border-border bg-background px-1.5 text-right tabular-nums"
            />
            <button
              type="button"
              disabled={queued !== undefined || !/^\d+$/.test(value)}
              onClick={() => {
                const finalTotal = Number(value);
                const operationId = `app-final:${props.day.date}:${props.run.id}:${slot}:${crypto.randomUUID()}`;
                queueApplicatorBatchFinalization({
                  operationId, date: props.day.date, runId: props.run.id, slot, finalTotal,
                  ...(correction && total?.latestConfirmedOperationId
                    ? { correctionOf: total.latestConfirmedOperationId } : {}),
                });
              }}
              className="h-7 rounded bg-primary px-2 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {queued ? "Queued…" : correction ? "Correct" : "Confirm"}
            </button>
            {conflict && <span className="basis-full text-[10px] text-amber-700">{conflict.error}</span>}
          </div>
        );
      })}
    </div>
  );
}