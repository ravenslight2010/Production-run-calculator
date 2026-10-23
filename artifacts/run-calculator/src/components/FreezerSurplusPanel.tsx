import { useEffect, useRef, useState } from "react";
import { Snowflake } from "lucide-react";
import { todayStr } from "../utils";
import type { RunMeta } from "../types";
import {
  isMatchingSurplusProduct,
  summarizeSurplusForRun,
  type FreezerSurplusLedger,
} from "@workspace/freezer-pull";
import {
  fetchFreezerSurplusAdjustments,
  getFreezerSurplusRemainingMs,
  type FreezerSurplusConfirmation,
  type FreezerSurplusAdjustment,
  type FreezerSurplusAdjustmentInput,
} from "../freezerSurplus";
import { useMe } from "../useRole";

export function FreezerSurplusPanel({
  mode,
  ledger,
  loaded,
  busy,
  error,
  completedRun,
  confirmations = [],
  confirmationsLoaded = true,
  freezerTimeMin,
  nowMs,
  pendingRuns,
  getOriginalTarget,
  onConfirm,
  onAllocate,
  onAdjust,
}: {
  mode: "packaging" | "warehouse";
  ledger: FreezerSurplusLedger;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  completedRun?: RunMeta | null;
  confirmations?: FreezerSurplusConfirmation[];
  confirmationsLoaded?: boolean;
  freezerTimeMin?: number;
  nowMs?: number;
  pendingRuns?: RunMeta[];
  getOriginalTarget: (run: RunMeta) => number;
  onConfirm: (
    run: RunMeta,
    cases: number,
    date?: string,
  ) => Promise<FreezerSurplusConfirmation | void>;
  onAllocate: (run: RunMeta, allocations: Array<{ lotId: string; cases: number }>) => Promise<void>;
  onAdjust?: (
    lotId: string,
    input: FreezerSurplusAdjustmentInput,
  ) => Promise<FreezerSurplusAdjustment>;
}) {
  const { hasCapability } = useMe();
  const canManageInventory = hasCapability("manage-inventory");
  const [confirmationDrafts, setConfirmationDrafts] = useState<
    Record<string, { cases: string; productionDate: string }>
  >({});
  const [confirmationState, setConfirmationState] = useState<
    Record<string, { message?: string; error?: string }>
  >({});
  const [locallyConfirmedRunIds, setLocallyConfirmedRunIds] = useState<string[]>([]);
  const pendingConfirmation = useRef(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, Record<string, number>>>({});
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<FreezerSurplusAdjustment[]>([]);
  const [adjustmentsError, setAdjustmentsError] = useState<string | null>(null);
  const [adjustmentType, setAdjustmentType] =
    useState<FreezerSurplusAdjustment["eventType"]>("damage");
  const [adjustmentLotId, setAdjustmentLotId] = useState("");
  const [adjustmentCases, setAdjustmentCases] = useState("1");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentRunId, setAdjustmentRunId] = useState("");
  const [correctsEventId, setCorrectsEventId] = useState("");
  const pendingEvent = useRef<{ fingerprint: string; eventId: string } | null>(null);
  const runs = pendingRuns ?? [];

  useEffect(() => {
    if (mode !== "warehouse" || !canManageInventory) return;
    let active = true;
    void fetchFreezerSurplusAdjustments()
      .then((events) => {
        if (active) {
          setAdjustments(events);
          setAdjustmentsError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setAdjustmentsError(
            cause instanceof Error ? cause.message : "Couldn't load finished-case adjustment history.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [canManageInventory, mode]);

  useEffect(() => {
    if (ledger.lots.length > 0 && !ledger.lots.some((lot) => lot.id === adjustmentLotId)) {
      setAdjustmentLotId(ledger.lots[0].id);
    }
  }, [adjustmentLotId, ledger.lots]);

  function updateConfirmationDraft(
    runId: string,
    patch: Partial<{ cases: string; productionDate: string }>,
  ) {
    setConfirmationDrafts((current) => ({
      ...current,
      [runId]: {
        cases: current[runId]?.cases ?? "",
        productionDate: current[runId]?.productionDate ?? todayStr(),
        ...patch,
      },
    }));
    setConfirmationState((current) => ({ ...current, [runId]: {} }));
  }

  async function confirmOutcome(run: RunMeta, rawCases: string, date: string) {
    if (!canManageInventory) return;
    const count = Number(rawCases);
    if (rawCases.trim() === "" || !Number.isSafeInteger(count) || count < 0 || count > 1_000_000) {
      setConfirmationState((current) => ({
        ...current,
        [run.id]: { error: "Enter a whole number from 0 to 1,000,000 cases." },
      }));
      return;
    }
    if (count > 0 && !date) {
      setConfirmationState((current) => ({
        ...current,
        [run.id]: { error: "Choose the production date for this freezer lot." },
      }));
      return;
    }
    if (pendingConfirmation.current) return;
    pendingConfirmation.current = true;
    setConfirmationState((current) => ({ ...current, [run.id]: {} }));
    try {
      const confirmation = await onConfirm(run, count, count > 0 ? date : undefined);
      if (!confirmation || confirmation.runId !== run.id || confirmation.cases !== count) {
        throw new Error("The server response did not match this run. Refresh the page before retrying.");
      }
      setLocallyConfirmedRunIds((current) =>
        current.includes(run.id) ? current : [...current, run.id],
      );
      setConfirmationState((current) => ({
        ...current,
        [run.id]: {
          message: count === 0
            ? "No extra cases recorded for this completed run."
            : `Added ${count} cases as a new freezer lot dated ${date}.`,
        },
      }));
    } catch (cause) {
      setConfirmationState((current) => ({
        ...current,
        [run.id]: {
          error: cause instanceof Error
            ? cause.message
            : "Couldn't save this run's surplus outcome. Check your connection and try again.",
        },
      }));
    } finally {
      pendingConfirmation.current = false;
    }
  }

  async function saveSelection(run: RunMeta) {
    if (!canManageInventory) return;
    const byLot = selections[run.id] ?? {};
    const allocations = Object.entries(byLot)
      .filter(([, count]) => count > 0)
      .map(([lotId, count]) => ({ lotId, cases: count }));
    try {
      await onAllocate(run, allocations);
      setSelectedRunId(null);
      setLocalMessage(
        allocations.length > 0
          ? `Applied ${allocations.reduce((sum, item) => sum + item.cases, 0)} carried-in cases to ${run.brand}${run.flavor ? ` — ${run.flavor}` : ""}.`
          : "Pull released. The run keeps its full original target.",
      );
    } catch {
      // The parent exposes the server's actionable error.
    }
  }

  async function saveAdjustment() {
    if (!canManageInventory || !onAdjust) return;
    const lot = ledger.lots.find((candidate) => candidate.id === adjustmentLotId);
    const count = Number(adjustmentCases);
    const reason = adjustmentReason.trim();
    if (!lot || !Number.isSafeInteger(count) || count <= 0 || count > 1_000_000 || !reason) {
      setAdjustmentsError("Choose a freezer lot, enter a positive whole-case count, and provide a reason.");
      return;
    }
    const input: Omit<FreezerSurplusAdjustmentInput, "eventId"> = {
      eventType: adjustmentType,
      cases: count,
      reason,
      ...(adjustmentType === "return" ? { runId: adjustmentRunId } : {}),
      ...(adjustmentType === "correction" ? { correctsEventId } : {}),
    };
    if (
      (adjustmentType === "return" && !adjustmentRunId) ||
      (adjustmentType === "correction" && !correctsEventId)
    ) {
      setAdjustmentsError(
        adjustmentType === "return"
          ? "Choose the run that returned these cases."
          : "Choose the earlier damage or return event being corrected.",
      );
      return;
    }
    const fingerprint = JSON.stringify({ lotId: lot.id, ...input });
    const eventId =
      pendingEvent.current?.fingerprint === fingerprint
        ? pendingEvent.current.eventId
        : crypto.randomUUID();
    pendingEvent.current = { fingerprint, eventId };
    setAdjustmentsError(null);
    try {
      const event = await onAdjust(lot.id, { ...input, eventId });
      setAdjustments((current) => [
        event,
        ...current.filter((existing) => existing.eventId !== event.eventId),
      ].slice(0, 500));
      pendingEvent.current = null;
      setAdjustmentCases("1");
      setAdjustmentReason("");
      setAdjustmentsError(null);
    } catch (cause) {
      setAdjustmentsError(
        cause instanceof Error ? cause.message : "Couldn't record this finished-case adjustment.",
      );
    }
  }

  if (mode === "packaging") {
    if (!completedRun?.brand && !completedRun?.flavor) return null;
    const remainingMs = getFreezerSurplusRemainingMs({
      endedAt: completedRun.endedAt,
      freezerTimeMin: freezerTimeMin ?? 0,
      nowMs: nowMs ?? 0,
    });
    if (!confirmationsLoaded || (
      locallyConfirmedRunIds.includes(completedRun.id) ||
      confirmations.some((confirmation) => confirmation.runId === completedRun.id) ||
      remainingMs <= 0
    )) return null;
    const draft = confirmationDrafts[completedRun.id] ?? {
      cases: "",
      productionDate: todayStr(),
    };
    const runConfirmationState = confirmationState[completedRun.id];
    return (
      <section
        className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4"
        data-testid="freezer-surplus-confirm"
        data-run-id={completedRun.id}
      >
        <div className="flex items-start gap-3">
          <Snowflake className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">Confirm finished-case freezer surplus</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Record excess cases from the completed run as a separate dated lot. This does not change any future run until Warehouse explicitly pulls it.
            </p>
            <p className="mt-2 text-sm font-semibold">
              {completedRun.brand}{completedRun.flavor ? ` — ${completedRun.flavor}` : ""}
            </p>
            {canManageInventory ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_10rem_auto]">
              <label className="text-xs font-semibold text-muted-foreground">
                Excess cases
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  inputMode="numeric"
                  value={draft.cases}
                  onChange={(event) =>
                    updateConfirmationDraft(completedRun.id, { cases: event.target.value })
                  }
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  aria-label="Excess finished cases"
                />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">
                Production date
                <input
                  type="date"
                  value={draft.productionDate}
                  onChange={(event) =>
                    updateConfirmationDraft(completedRun.id, { productionDate: event.target.value })
                  }
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  aria-label="Freezer lot production date"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  void confirmOutcome(completedRun, draft.cases, draft.productionDate)
                }
                disabled={busy}
                className="self-end rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Saving…" : "Confirm surplus"}
              </button>
              <button
                type="button"
                onClick={() => void confirmOutcome(completedRun, "0", draft.productionDate)}
                disabled={busy}
                className="rounded-md border border-primary/40 px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
              >
                No extra cases
              </button>
            </div>
            ) : (
              <div
                className="mt-3 rounded-md border border-border/60 bg-background/50 px-3 py-2"
                data-testid="freezer-surplus-record-read-only"
              >
                <p className="text-xs font-semibold text-foreground">Read-only</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Recording freezer surplus requires inventory management access.
                </p>
              </div>
            )}
            {runConfirmationState?.message && (
              <p className="mt-2 text-xs font-medium text-primary" role="status">
                {runConfirmationState.message}
              </p>
            )}
            {(runConfirmationState?.error || error) && (
              <p className="mt-2 text-xs font-semibold text-destructive" role="alert">
                {runConfirmationState?.error || error}
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  const lots = ledger.lots.filter((lot) => lot.remainingCases > 0);
  return (
    <section className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4" data-testid="freezer-surplus-warehouse">
      <div className="flex items-start gap-3">
        <Snowflake className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">Dated freezer surplus</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select a dated lot and case count before the matching run starts. Unselected lots stay available; no selection means the full target is produced.
          </p>
          {error && <p className="mt-2 text-xs font-semibold text-destructive" role="alert">{error}</p>}
          {!loaded && <p className="mt-3 text-xs text-muted-foreground">Loading server-confirmed lots…</p>}
          {loaded && runs.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">No unstarted matching runs are waiting for a freezer pull.</p>
          )}
          <div className="mt-3 space-y-3">
            {runs.map((run) => {
              const summary = summarizeSurplusForRun({
                runId: run.id,
                brand: run.brand,
                flavor: run.flavor,
                originalTarget: getOriginalTarget(run),
                lots: ledger.lots,
                allocations: ledger.allocations,
              });
              const productLots = lots.filter((lot) => isMatchingSurplusProduct(lot, run));
              const current = selections[run.id] ?? Object.fromEntries(
                summary.selected.map((allocation) => [allocation.lotId, allocation.cases]),
              );
              const isEditing = selectedRunId === run.id;
              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-border/50 bg-background/60 p-3"
                  data-testid={`freezer-surplus-run-${run.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{run.brand}{run.flavor ? ` — ${run.flavor}` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        Original target <strong className="text-foreground">{summary.originalTarget}</strong>
                        {" · "}Carried in <strong className="text-sky-300">{summary.carriedInCases}</strong>
                        {" · "}Still to produce <strong className="text-foreground">{summary.productionCases}</strong>
                      </p>
                    </div>
                     {canManageInventory && (
                       <button
                         type="button"
                         onClick={() => setSelectedRunId(isEditing ? null : run.id)}
                         className="rounded-md border border-sky-500/40 px-2.5 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/10"
                       >
                         {isEditing ? "Close pull" : summary.carriedInCases > 0 ? "Revise pull" : "Choose pull"}
                       </button>
                     )}
                  </div>
                   {isEditing && canManageInventory && (
                    <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                      {productLots.length === 0 ? (
                        <p className="text-xs italic text-muted-foreground">No available dated lot matches this brand and flavor.</p>
                      ) : productLots.map((lot) => (
                        <label key={lot.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span>
                            {lot.productionDate} · {lot.remainingCases} available
                          </span>
                          <input
                            type="number"
                            min="0"
                            max={lot.remainingCases + (current[lot.id] ?? 0)}
                            step="1"
                            value={current[lot.id] ?? 0}
                            onChange={(event) => {
                              const next = Math.max(0, Math.floor(Number(event.target.value) || 0));
                              setSelections((prev) => ({
                                ...prev,
                                [run.id]: { ...(prev[run.id] ?? current), [lot.id]: next },
                              }));
                            }}
                            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm"
                            aria-label={`Cases from freezer lot dated ${lot.productionDate}`}
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        onClick={() => void saveSelection(run)}
                        disabled={busy}
                        className="mt-2 rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Confirm pull"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {canManageInventory && onAdjust && (
            <section
              className="mt-4 rounded-lg border border-amber-500/30 bg-background/70 p-3"
              data-testid="finished-case-adjustments"
            >
              <h3 className="text-sm font-semibold">Correct finished-case stock</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Record damage, a return from an allocated run, or a correction to an earlier event. Each save is attributed to your manager account and kept in the adjustment history.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold text-muted-foreground">
                  Event
                  <select
                    aria-label="Finished-case adjustment type"
                    value={adjustmentType}
                    onChange={(event) => {
                      setAdjustmentType(event.target.value as FreezerSurplusAdjustment["eventType"]);
                      pendingEvent.current = null;
                      setAdjustmentsError(null);
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value="damage">Damage</option>
                    <option value="return">Return from a run</option>
                    <option value="correction">Correct an earlier event</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-muted-foreground">
                  Dated freezer lot
                  <select
                    aria-label="Finished-case adjustment lot"
                    value={adjustmentLotId}
                    onChange={(event) => {
                      setAdjustmentLotId(event.target.value);
                      setAdjustmentRunId("");
                      setCorrectsEventId("");
                      pendingEvent.current = null;
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value="">Choose a lot</option>
                    {ledger.lots.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.productionDate} · {lot.brand}{lot.flavor ? ` — ${lot.flavor}` : ""} · {lot.remainingCases} available
                      </option>
                    ))}
                  </select>
                </label>
                {adjustmentType === "return" && (
                  <label className="text-xs font-semibold text-muted-foreground">
                    Allocated run
                    <select
                      aria-label="Finished-case return run"
                      value={adjustmentRunId}
                      onChange={(event) => {
                        setAdjustmentRunId(event.target.value);
                        pendingEvent.current = null;
                      }}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                    >
                      <option value="">Choose a run</option>
                      {ledger.allocations
                        .filter((allocation) => allocation.lotId === adjustmentLotId)
                        .map((allocation) => (
                          <option key={allocation.runId} value={allocation.runId}>
                            {allocation.runDate} · {allocation.brand}{allocation.flavor ? ` — ${allocation.flavor}` : ""} · {allocation.cases} allocated
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {adjustmentType === "correction" && (
                  <label className="text-xs font-semibold text-muted-foreground">
                    Earlier event
                    <select
                      aria-label="Finished-case event to correct"
                      value={correctsEventId}
                      onChange={(event) => {
                        setCorrectsEventId(event.target.value);
                        pendingEvent.current = null;
                      }}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                    >
                      <option value="">Choose an earlier event</option>
                      {adjustments
                        .filter((event) => event.lotId === adjustmentLotId && event.eventType !== "correction")
                        .map((event) => {
                          const alreadyCorrected = adjustments
                            .filter(
                              (candidate) =>
                                candidate.eventType === "correction" &&
                                candidate.correctsEventId === event.eventId,
                            )
                            .reduce((sum, candidate) => sum + candidate.cases, 0);
                          const correctable = event.cases - alreadyCorrected;
                          return correctable > 0 ? (
                            <option key={event.eventId} value={event.eventId}>
                              {event.eventType} · {event.cases} cases · {event.reason} ({correctable} correctable)
                            </option>
                          ) : null;
                        })}
                    </select>
                  </label>
                )}
                <label className="text-xs font-semibold text-muted-foreground">
                  Cases
                  <input
                    type="number"
                    min="1"
                    max="1000000"
                    step="1"
                    inputMode="numeric"
                    aria-label="Finished-case adjustment cases"
                    value={adjustmentCases}
                    onChange={(event) => {
                      setAdjustmentCases(event.target.value);
                      pendingEvent.current = null;
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs font-semibold text-muted-foreground sm:col-span-2">
                  Reason
                  <input
                    type="text"
                    maxLength={300}
                    aria-label="Finished-case adjustment reason"
                    value={adjustmentReason}
                    onChange={(event) => {
                      setAdjustmentReason(event.target.value);
                      pendingEvent.current = null;
                    }}
                    placeholder="Explain why stock is changing"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void saveAdjustment()}
                disabled={busy || ledger.lots.length === 0}
                className="mt-3 rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Record adjustment"}
              </button>
              {adjustmentsError && <p className="mt-2 text-xs font-semibold text-destructive" role="alert">{adjustmentsError}</p>}
              <div className="mt-4 border-t border-border/50 pt-3">
                <h4 className="text-xs font-semibold">Recent adjustment history</h4>
                {adjustments.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No finished-case adjustments have been recorded.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {adjustments.slice(0, 20).map((event) => (
                      <li key={event.eventId} className="rounded-md bg-muted/40 px-2.5 py-2 text-xs">
                        <p className="font-semibold">
                          {event.eventType} · {event.cases} {event.cases === 1 ? "case" : "cases"}
                        </p>
                        <p className="text-muted-foreground">
                          {event.reason} · {event.actorId} · {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
           {!canManageInventory && loaded && runs.length > 0 && (
              <div
                className="mt-3 rounded-md border border-border/60 bg-background/50 px-3 py-2"
                data-testid="freezer-surplus-pull-read-only"
              >
                <p className="text-xs font-semibold text-foreground">Read-only</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Choosing or changing freezer pulls requires inventory management access.
                </p>
              </div>
           )}
          {localMessage && <p className="mt-2 text-xs font-medium text-sky-300" role="status">{localMessage}</p>}
        </div>
      </div>
    </section>
  );
}
