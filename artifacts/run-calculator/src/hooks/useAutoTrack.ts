import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { type FormValues } from "../types";

type RunStatus = "pending" | "running" | "paused" | "ended";

interface AutoTrackCalc {
  ppm: number;
  perTray: number;
  perBatch: number;
  traysNeeded: number;
  batchesNeeded: number;
  /**
   * True once the press has made everything the run needs — cased product
   * plus live freezer contents ≥ casesNeeded. Count-based (real packaging
   * count + freezer model), NOT an elapsed-time estimate: this is what stops
   * the dough counters, because from this moment the dough crew is working on
   * the NEXT run's dough.
   */
  pressDone: boolean;
}

/**
 * Suggested dough staging for a run — the same numbers the "Suggest" button
 * applies to the Trays on Line / Batches Ready steppers. Derived from the
 * CURRENT deficit (traysNeeded/batchesNeeded), capped to the stepper maxes
 * (74 trays / 3 batches) and to a sane staging quantity (40 trays). Kept at
 * verbatim parity with mobile RunContext's suggestedDoughStaging.
 */
export function suggestedDoughStaging(
  traysNeeded: number,
  batchesNeeded: number,
): { trays: number | null; batches: number | null } {
  return {
    trays: traysNeeded > 0
      ? Math.min(74, Math.max(1, Math.round(Math.min(40, traysNeeded))))
      : null,
    batches: batchesNeeded > 0
      ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, batchesNeeded))))
      : null,
  };
}

interface AutoTrackValues {
  casesPerSkid: number;
  pizzasPerCase: number;
  casesNeeded: number;
  freezerTime: number;
  traysOnLine: number;
  batchesReady: number;
}

interface AutoTrackParams {
  runId: string;
  runStatus: RunStatus;
  nowTime: Date;
  elapsedBatchSec: number;
  calc: AutoTrackCalc;
  v: AutoTrackValues;
  form: UseFormReturn<FormValues>;
  /**
   * Measured machine times in seconds (0 = not measured → fall back to
   * line-speed-derived estimates, i.e. the pre-existing behavior).
   *  • spinSec: total mixer time (low + high stage) — overrides how often the
   *    mixer finishes a new batch (+1 production tick).
   *  • hopperSec: how long the hopper takes to turn one batch into balls —
   *    "batches ready" can never drain faster than the hopper converts, so the
   *    effective drain period is the SLOWER of hopper time and line demand.
   */
  machine?: { spinSec: number; hopperSec: number };
  /**
   * Hard-disable all auto-track WRITES (cast/wall display screens). A passive
   * display must never decrement trays/batches or seed staging — its writes
   * get pushed through live sync with fresh stamps and clobber the operator's
   * manual edits on every other device.
   */
  disabled?: boolean;
}

interface AutoTrackResult {
  autoTrackProgress: boolean;
  setAutoTrackProgress: React.Dispatch<React.SetStateAction<boolean>>;
  autoTrackSuggestion: {
    skids: number;
    casesOnSkid: number;
    expectedCases: number;
    expectedCasesRaw: number;
    trays: number | null;
    batches: number | null;
  } | null;
  autoSuppressUntilRef: React.MutableRefObject<number>;
  /** Force every counter's next tick to fire immediately (e.g. "Resume now"). */
  fireAutoTrackNow: () => void;
  /**
   * Wall-clock ms timestamps of each counter's next tick — read-only refs for
   * countdown displays (0 = not yet armed). The UI derives "next tick in m:ss"
   * from these; they are bookkeeping owned by the hook.
   */
  tickDueRefs: {
    case: React.MutableRefObject<number>;
    tray: React.MutableRefObject<number>;
    trayProd: React.MutableRefObject<number>;
    batch: React.MutableRefObject<number>;
    batchProd: React.MutableRefObject<number>;
  };
}

// Each counter ticks at its own natural production pace, clamped to a sane
// range: never faster than once per 2s (the app clock ticks per second) and
// never slower than once per hour (a stalled/garbage rate must not freeze the
// counter forever).
function clampPeriodMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 60 * 60 * 1000;
  return Math.min(60 * 60 * 1000, Math.max(2000, ms));
}

/**
 * Tracks expected progress automatically while running. Each counter updates
 * at its own natural production cadence instead of a fixed wall-clock interval:
 *
 *  • cases (and therefore skids): every time-to-run-one-case
 *    (pizzasPerCase / ppm). The skid counter is derived from the same total, so
 *    it rolls the moment the case count completes a skid.
 *  • trays: every time-to-consume-one-tray (perTray / ppm).
 *  • batches: every quarter-batch duration (perBatch / ppm / 4) — the integer
 *    count still drops once per full batch, via the fractional remainder carry.
 *
 * Skids/cases: applied INCREMENTALLY — each tick adds the production since the
 * last tick on top of the current (possibly manually-entered) value. This means
 * a manual correction by the operator becomes the new baseline and auto-track
 * continues forward from it instead of overwriting it with its own absolute
 * estimate. On the first tick after a (re)start/switch the absolute count is
 * seeded only when there is no existing progress, so reloads and run switches
 * never double-count saved progress.
 *
 * Trays/batches: incremental decrement per tick — subtracts consumption for the
 * actual duration since that counter's last tick (capped to 2 periods).
 */
export function useAutoTrack({
  runId,
  runStatus,
  nowTime,
  elapsedBatchSec,
  calc,
  v,
  form,
  machine,
  disabled = false,
}: AutoTrackParams): AutoTrackResult {
  const [autoTrackProgress, setAutoTrackProgress] = useState(true);
  const autoSuppressUntilRef = useRef<number>(0);
  // Per-counter "next tick due at" wall-clock timestamps (ms). 0 = fire on the
  // next tick (fresh baseline / forced resume).
  const caseNextDueMsRef = useRef<number>(0);
  const trayNextDueMsRef = useRef<number>(0);
  const batchNextDueMsRef = useRef<number>(0);
  // Production ("count up") tick schedules — the press/mixer keep MAKING dough
  // while the run still has a deficit, so the counters move up as well as down.
  // 0 = not scheduled yet (first encounter arms the schedule without writing).
  const trayProdNextDueMsRef = useRef<number>(0);
  const batchProdNextDueMsRef = useRef<number>(0);
  // Wall-clock ms of each consumption counter's last tick — drives the
  // incremental decrement (consumption for the actual elapsed duration).
  const trayLastMsRef = useRef<number>(0);
  const batchLastMsRef = useRef<number>(0);
  // expectedCases value at the last case tick — the baseline the incremental
  // skids/cases delta is measured from. -1 = "not baselined yet" (first tick
  // after a mount/reset).
  const lastExpectedCasesRef = useRef<number>(-1);
  // Fractional tray consumption carried between ticks so sub-unit depletion
  // per tick accumulates instead of being lost to Math.floor (which would
  // freeze a slow-depleting counter at its start value). Batches don't need a
  // carry: they are written as 2-decimal fractions so every quarter-batch tick
  // is visible on the counter.
  const traysRemainderRef = useRef<number>(0);
  // One-shot per run: when the operator never entered staged dough (counter is
  // 0 at that counter's first tick), seed it with the suggested staging so the
  // countdown has something to count down from. Without this the crew that
  // never types their dough counts sees trays/batches sit at 0 the whole run.
  const traySeededRef = useRef<boolean>(false);
  const batchSeededRef = useRef<boolean>(false);

  const autoTrackSuggestion = useMemo(() => {
    const ok =
      (runStatus === "running" || runStatus === "paused") &&
      calc.ppm > 0 &&
      v.casesPerSkid > 0 &&
      v.pizzasPerCase > 0;
    if (!ok) return null;

    const maxSkids = Math.floor(v.casesNeeded / v.casesPerSkid);
    const elapsedMin = elapsedBatchSec / 60;
    const elapsedMinAfterTunnel = Math.max(0, elapsedMin - Number(v.freezerTime));
    // Clamp to the run's total need so skids/cases freeze at their final state
    // once production is complete instead of cycling past it (modulo wrap).
    const expectedCasesRaw = Math.floor((elapsedMinAfterTunnel * calc.ppm) / v.pizzasPerCase);
    const expectedCases = v.casesNeeded > 0 ? Math.min(v.casesNeeded, expectedCasesRaw) : expectedCasesRaw;

    return {
      skids: Math.min(maxSkids, Math.floor(expectedCases / v.casesPerSkid)),
      casesOnSkid: Math.min(v.casesPerSkid, expectedCases % v.casesPerSkid),
      expectedCases,
      // Unclamped time-based total — drives the INCREMENTAL delta below so that a
      // downward manual correction (e.g. after the estimate ran ahead and hit the
      // casesNeeded clamp) can still climb again. The clamp lives only on what is
      // displayed/written, not on the delta source.
      expectedCasesRaw,
      // Tray/batch suggestions are handled incrementally in the write effect;
      // returning null here means the UI falls back to the calc-based suggestion.
      trays: null,
      batches: null,
    };
  }, [
    runStatus,
    calc.ppm,
    calc.perTray,
    calc.perBatch,
    v.casesPerSkid,
    v.pizzasPerCase,
    v.casesNeeded,
    v.freezerTime,
    elapsedBatchSec,
  ]);

  const resetBookkeeping = useCallback(() => {
    caseNextDueMsRef.current = 0;
    trayNextDueMsRef.current = 0;
    batchNextDueMsRef.current = 0;
    trayProdNextDueMsRef.current = 0;
    batchProdNextDueMsRef.current = 0;
    trayLastMsRef.current = 0;
    batchLastMsRef.current = 0;
    lastExpectedCasesRef.current = -1;
    traysRemainderRef.current = 0;
    traySeededRef.current = false;
    batchSeededRef.current = false;
  }, []);

  // Cancel the wait until every counter's next tick (used by "Resume now" and
  // the Auto toggle). Unlike resetBookkeeping this keeps the expectedCases
  // baseline and last-tick timestamps, so resuming never causes a catch-up jump
  // over a manual edit.
  const fireAutoTrackNow = useCallback(() => {
    caseNextDueMsRef.current = 0;
    trayNextDueMsRef.current = 0;
    batchNextDueMsRef.current = 0;
    trayProdNextDueMsRef.current = 0;
    batchProdNextDueMsRef.current = 0;
  }, []);

  // Baseline resets are declared BEFORE the tick-write effect below on purpose:
  // React runs effects in declaration order, so on mount (and on runId/toggle
  // changes) the refs are reset FIRST and the write effect then fires exactly once
  // with clean baselines. With the old order (write first, resets after), the
  // mount pass wrote, the resets then wiped the bookkeeping (losing the
  // fractional tray/batch remainder carry) and re-armed the SAME tick to fire
  // again on the next second — double-decrementing trays and freezing
  // slow-depleting batches whose per-tick consumption is < 1 unit.

  // Reset bookkeeping when the run stops so the next run starts fresh.
  useEffect(() => {
    if (runStatus === "pending" || runStatus === "ended") {
      resetBookkeeping();
    }
  }, [runStatus, resetBookkeeping]);

  // Re-baseline when the active run changes (switching runs / first mount) so the
  // incremental delta is never computed against another run's numbers, and a run
  // we switch or reload into is not double-counted.
  useEffect(() => {
    resetBookkeeping();
  }, [runId, resetBookkeeping]);

  // Re-baseline when auto-track is toggled on so the first tick after re-enabling
  // continues from the current value instead of adding all the production that
  // accumulated while it was off.
  useEffect(() => {
    resetBookkeeping();
  }, [autoTrackProgress, resetBookkeeping]);

  // Apply expected values whenever a counter's own production-paced tick is due.
  useEffect(() => {
    if (disabled || !autoTrackProgress || runStatus !== "running" || !autoTrackSuggestion) return;

    const nowMs = nowTime.getTime();
    // While the manual-edit suppression window is open, keep baselines current
    // but do not write — the operator is taking over. Bookkeeping still
    // advances so the window expiring never causes a catch-up jump that wipes
    // the operator's manual edit.
    const suppressed = Date.now() < autoSuppressUntilRef.current;

    // ── Cases (and skids, derived from the same total): tick once per case. ──
    if (calc.ppm > 0 && v.pizzasPerCase > 0 && nowMs >= caseNextDueMsRef.current) {
      const casePeriodMs = clampPeriodMs((v.pizzasPerCase / calc.ppm) * 60000);
      const prevExpected = lastExpectedCasesRef.current;
      // Baseline the incremental delta off the UNCLAMPED total so the count keeps
      // advancing even after the time-based estimate saturates at casesNeeded (e.g.
      // the estimate ran ahead, the operator corrected the count down, then hit
      // "Resume now"). Using the clamped value here would pin the delta at 0 and
      // the count would never climb again.
      const expectedRaw = autoTrackSuggestion.expectedCasesRaw;
      const expectedCases = autoTrackSuggestion.expectedCases;
      caseNextDueMsRef.current = nowMs + casePeriodMs;
      lastExpectedCasesRef.current = expectedRaw;

      if (!suppressed) {
        const cps = v.casesPerSkid;
        const curTotal =
          (Number(form.getValues("skidsCompleted")) || 0) * cps +
          (Number(form.getValues("casesOnCurrentSkid")) || 0);
        if (prevExpected < 0) {
          // First tick after a (re)start/switch: seed the absolute count only when
          // there is no progress yet. If progress already exists (reload / switching
          // into a run that's already going / a prior manual entry), just baseline so
          // we don't double-count.
          if (curTotal === 0 && expectedCases > 0) {
            const seedTotal = v.casesNeeded > 0 ? Math.min(v.casesNeeded, expectedCases) : expectedCases;
            form.setValue("skidsCompleted", Math.floor(seedTotal / cps), { shouldDirty: true });
            form.setValue("casesOnCurrentSkid", seedTotal % cps, { shouldDirty: true });
          }
        } else {
          // Add the production since the last tick on top of the current value, so a
          // manual correction is preserved and tracking continues forward from it.
          const deltaCases = Math.max(0, expectedRaw - prevExpected);
          if (deltaCases > 0) {
            const target = curTotal + deltaCases;
            // Never pull a value down below what the operator already has on the floor.
            const newTotal = v.casesNeeded > 0 ? Math.min(target, Math.max(curTotal, v.casesNeeded)) : target;
            if (newTotal !== curTotal) {
              form.setValue("skidsCompleted", Math.floor(newTotal / cps), { shouldDirty: true });
              form.setValue("casesOnCurrentSkid", newTotal % cps, { shouldDirty: true });
            }
          }
        }
      }
    }

    // Trays / batches: incremental decrement, each at its own cadence.
    // Works after page reloads and naturally handles mid-run replenishments.
    // Stop once the press has made everything the run needs — COUNT-based
    // (cased product + live freezer contents ≥ casesNeeded, via calc.pressDone),
    // not an elapsed-time estimate. When the line runs slower or faster than
    // the configured speed, the real counts are what decide when dough stops
    // moving for this run; from that moment the dough crew is on the NEXT run.
    const doughFeedComplete = calc.pressDone;

    // ── Trays: count up while dough is still being pressed, down as the line
    // eats it. Production (+1 tray per tray-period, offset half a period from
    // consumption so the two visibly alternate) continues while the run still
    // has a dough DEFICIT (calc.traysNeeded > 0 — i.e. staged dough does not
    // yet cover everything left to run). Once the deficit is closed the press
    // is done and the counter only counts down; whatever is left at the end
    // carries over to the next run. ──
    if (calc.perTray > 0 && calc.ppm > 0) {
      const trayPeriodMs = clampPeriodMs((calc.perTray / calc.ppm) * 60000);
      let delta = 0;
      let traySeededThisTick = false;

      // Production tick.
      if (trayProdNextDueMsRef.current === 0) {
        // First encounter: arm the schedule half a period out of phase with
        // consumption; no write.
        trayProdNextDueMsRef.current = nowMs + trayPeriodMs / 2;
      } else if (nowMs >= trayProdNextDueMsRef.current) {
        trayProdNextDueMsRef.current = nowMs + trayPeriodMs;
        if (!suppressed && !doughFeedComplete && calc.traysNeeded > 0) {
          delta += 1;
        }
      }

      // Consumption tick.
      if (nowMs >= trayNextDueMsRef.current) {
        const prevMs = trayLastMsRef.current;
        // Consumption for the actual duration since this counter's last tick
        // (capped to 2 periods to avoid huge jumps); assume one full period on
        // the first tick.
        const durationMin = prevMs > 0
          ? Math.min((trayPeriodMs * 2) / 60000, (nowMs - prevMs) / 60000)
          : trayPeriodMs / 60000;
        trayNextDueMsRef.current = nowMs + trayPeriodMs;
        trayLastMsRef.current = nowMs;
        if (!suppressed && !doughFeedComplete) {
          // First tray tick of a run where the operator never entered staged
          // dough (counter still 0): seed the suggested staging (the same number
          // the "Suggest" button applies) so the counter has real stock to track
          // — otherwise a crew that never types their dough counts sees trays
          // sit at 0 the whole run. One-shot per run; a counter with a value
          // (manual or seeded) just tracks normally below.
          if (!traySeededRef.current) {
            traySeededRef.current = true;
            const seed = suggestedDoughStaging(calc.traysNeeded, calc.batchesNeeded).trays;
            if (v.traysOnLine === 0 && seed !== null) {
              form.setValue("traysOnLine", seed, { shouldDirty: true });
              traySeededThisTick = true;
            }
          }
          if (!traySeededThisTick) {
            const traysExact = (durationMin * calc.ppm) / calc.perTray + traysRemainderRef.current;
            const traysConsumed = Math.floor(traysExact);
            traysRemainderRef.current = traysExact - traysConsumed;
            delta -= traysConsumed;
          }
        }
      }

      if (!traySeededThisTick && delta !== 0) {
        // Production never pushes past the stepper max (74) — but must never
        // clamp an already-higher value DOWN either.
        let next = v.traysOnLine + delta;
        if (delta > 0) next = Math.min(next, Math.max(v.traysOnLine, 74));
        next = Math.max(0, next);
        if (next !== v.traysOnLine) {
          form.setValue("traysOnLine", next, { shouldDirty: true });
        }
      }
    }

    // ── Batches: +1 when the mixer finishes a batch (one per full batch-time,
    // while the run still has a batch deficit), down once per full batch
    // consumed (quarter-batch ticks with fractional remainder carry). ──
    if (calc.perBatch > 0 && calc.ppm > 0) {
      // Line demand: how often the LINE eats a whole batch's worth of balls.
      const lineBatchMs = (calc.perBatch / calc.ppm) * 60000;
      // Drain can never be faster than the hopper converts a batch into balls
      // (when measured) — effective drain period = slower of hopper and line.
      const hopperMs = machine && machine.hopperSec > 0 ? machine.hopperSec * 1000 : 0;
      const effDrainMs = Math.max(hopperMs, lineBatchMs);
      const batchPeriodMs = clampPeriodMs(effDrainMs / 4);
      // Mixer finishes a new batch every measured spin time (low + high stage)
      // when it's been measured; otherwise fall back to line-demand pacing.
      const spinMs = machine && machine.spinSec > 0 ? machine.spinSec * 1000 : 0;
      const fullBatchMs = clampPeriodMs(spinMs > 0 ? spinMs : lineBatchMs);
      let delta = 0;
      let batchSeededThisTick = false;

      // Production tick: the first mixed batch lands one full batch-time in.
      if (batchProdNextDueMsRef.current === 0) {
        batchProdNextDueMsRef.current = nowMs + fullBatchMs;
      } else if (nowMs >= batchProdNextDueMsRef.current) {
        batchProdNextDueMsRef.current = nowMs + fullBatchMs;
        if (!suppressed && !doughFeedComplete && calc.batchesNeeded > 0) {
          delta += 1;
        }
      }

      // Consumption tick.
      if (nowMs >= batchNextDueMsRef.current) {
        const prevMs = batchLastMsRef.current;
        const durationMin = prevMs > 0
          ? Math.min((batchPeriodMs * 2) / 60000, (nowMs - prevMs) / 60000)
          : batchPeriodMs / 60000;
        batchNextDueMsRef.current = nowMs + batchPeriodMs;
        batchLastMsRef.current = nowMs;
        if (!suppressed && !doughFeedComplete) {
          // Same one-shot seed as trays: an untouched 0 counter gets the
          // suggested staging on its first tick so it has stock to track.
          if (!batchSeededRef.current) {
            batchSeededRef.current = true;
            const seed = suggestedDoughStaging(calc.traysNeeded, calc.batchesNeeded).batches;
            if (v.batchesReady === 0 && seed !== null) {
              form.setValue("batchesReady", seed, { shouldDirty: true });
              batchSeededThisTick = true;
            }
          }
          if (!batchSeededThisTick) {
            // Fractional consumption, written directly (2 decimals) so the
            // operator SEES the counter fluctuate every quarter-batch tick
            // instead of thinking it's frozen until a whole batch drops.
            // Rate = 1 batch per effective-drain period (line demand, slowed
            // by the hopper when a hopper time has been measured).
            delta -= (durationMin * 60000) / effDrainMs;
          }
        }
      }

      if (!batchSeededThisTick && delta !== 0) {
        // Production never pushes past the stepper max (3) — but must never
        // clamp an already-higher value DOWN either. Rounded to 2 decimals so
        // the fractional drain shows cleanly (e.g. 1.75, 1.5).
        let next = v.batchesReady + delta;
        if (delta > 0) next = Math.min(next, Math.max(v.batchesReady, 3));
        next = Math.max(0, Math.round(next * 100) / 100);
        if (next !== v.batchesReady) {
          form.setValue("batchesReady", next, { shouldDirty: true });
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTime]);

  return {
    autoTrackProgress,
    setAutoTrackProgress,
    autoTrackSuggestion,
    autoSuppressUntilRef,
    fireAutoTrackNow,
    tickDueRefs: {
      case: caseNextDueMsRef,
      tray: trayNextDueMsRef,
      trayProd: trayProdNextDueMsRef,
      batch: batchNextDueMsRef,
      batchProd: batchProdNextDueMsRef,
    },
  };
}
