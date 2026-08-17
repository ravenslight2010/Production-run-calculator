import { useEffect, useRef, useState } from "react";
import { type FormValues, type RunMeta } from "../types";
import { fmtClock, runLabel } from "../utils";
import { isNotifEnabled, type NotificationPrefs } from "../notificationPrefs";

type RunStatus = "pending" | "running" | "paused" | "ended";

interface NotifCalc {
  adjustedTimeSec: number;
  timePerBatchSec: number;
  /** Pizzas-per-minute line speed. <= 0 means there is no valid timing basis. */
  ppm: number;
  /** Cases already cased on the floor (skids done + current skid). */
  casesCompleted: number;
  /**
   * In-tunnel model count: cases the press has already made that are still
   * traveling through the tunnel/freezer (pressed, not yet packaged).
   */
  casesInFreezer: number;
  /**
   * Cases still to be PRESSED — cased product plus live freezer contents count
   * as done. This is the warehouse staging basis: frontline stages at 2 skids
   * left, packaging at 1 skid left.
   */
  pressCasesLeft: number;
  /**
   * True when the press has made all cases needed for this run (cased + in
   * freezer ≥ casesNeeded). Once true, the dough crew switches to the next run
   * so no further dough batch-due alerts should fire for the current run.
   */
  pressDone: boolean;
}

interface NotifValues {
  freezerTime: FormValues["freezerTime"];
  casesNeeded: FormValues["casesNeeded"];
  casesPerSkid: FormValues["casesPerSkid"];
}

interface NotifParams {
  runStatus: RunStatus;
  nowTime: Date;
  currentRun: RunMeta | undefined;
  calc: NotifCalc;
  v: NotifValues;
  /** Crust runs open pre-made cases — no dough is mixed, so suppress batch alerts. */
  isCrust: boolean;
  /** Labels of upcoming (not yet started) runs, in order — for the warehouse switchover alert. */
  nextRunLabels: string[];
  /**
   * The user's per-alert preferences (from /me). A missing key means the
   * alert is ON; only an explicit false suppresses it. Each effect still runs
   * its latch bookkeeping while suppressed so flipping an alert back on
   * mid-run doesn't retroactively fire alerts for already-passed milestones.
   */
  prefs: NotificationPrefs | undefined;
}

interface NotifResult {
  showBatchDue: boolean;
  setShowBatchDue: React.Dispatch<React.SetStateAction<boolean>>;
  /** True while the "behind pace" in-app banner should be shown. */
  showPaceAlert: boolean;
  setShowPaceAlert: React.Dispatch<React.SetStateAction<boolean>>;
  /** Human-readable pace alert message (rate / shortfall / time left). */
  paceAlertMsg: string;
}

/** Exported return type — shared with __mocks__/useNotifications.ts for compile-time drift detection. */
export type UseNotificationsReturn = NotifResult;

// ── Pace alert thresholds ──────────────────────────────────────────────────
/** Fire the alert when the projected shortfall meets or exceeds this many cases. */
const PACE_SHORTFALL_MIN_CASES = 10;
/** Only alert when this many minutes or fewer remain in the run. */
const PACE_TIME_REMAINING_MAX_MIN = 30;

/**
 * Fire a notification safely. Android Chrome (and other mobile browsers)
 * forbid the `new Notification()` constructor — it throws "Illegal
 * constructor" and must go through the service worker instead. Prefer
 * `ServiceWorkerRegistration.showNotification()`, fall back to the
 * constructor, and never let either path throw into the calling effect.
 *
 * Exported so sauce-tab and other production tab components can fire
 * push notifications outside of the centralised useNotifications hook.
 */
export function showAppNotification(title: string, options: NotificationOptions): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  void (async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.showNotification) {
        await reg.showNotification(title, options);
        return;
      }
    } catch {
      /* fall through to the constructor */
    }
    try {
      new Notification(title, options);
    } catch {
      /* notifications unsupported in this context — ignore */
    }
  })();
}

/**
 * Fires browser Notifications and haptic vibrations at key run milestones:
 *  - 15 minutes remaining before end of run
 *  - Each dough-batch cycle boundary
 *  - Run time complete
 *  - Freezer drain complete (post-run)
 */
export function useNotifications({
  runStatus,
  nowTime,
  currentRun,
  calc,
  v,
  isCrust,
  nextRunLabels,
  prefs,
}: NotifParams): NotifResult {
  // Read preferences through a ref so toggling a switch never re-runs the
  // milestone effects (which could otherwise re-evaluate old thresholds);
  // each effect checks the CURRENT preference at the moment it would fire.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const notifiedRunRef = useRef<string | null>(null);
  // Runs whose countdown has been observed ABOVE the 15-minute threshold.
  // A short run (press time < 15 min) starts already below 900s — without this
  // crossing latch the "15 minutes left" alert fires the instant Start is hit.
  const sawAbove15Ref = useRef<Set<string>>(new Set());
  // Per-run latches (Sets, not single ids): switching to run B and back to a
  // nearly-done run A must NOT re-fire A's staging alerts. Frontline (2 skids
  // left at the press) and packaging (1 skid left) latch independently.
  const frontlineNotifRef = useRef<Set<string>>(new Set());
  const packagingNotifRef = useRef<Set<string>>(new Set());
  const batchNotifRef = useRef<string>("");
  const runCompleteNotifRef = useRef<string>("");
  // Tracks the run id that has ever shown positive remaining time. A run started
  // before line speed or cases-needed are configured has adjustedTimeSec === 0
  // from the very first tick; without this latch the "time's up" alert would
  // fire the instant the run starts. We only allow the complete alert after the
  // timer genuinely counted down from a positive value.
  const runWasTimedRef = useRef<string>("");
  // Runs we've actually watched drain (remainMs > 0 observed at least once). Only
  // these may later fire the "freezer empty" alert. Without this, selecting or
  // scrolling to an already-long-ended run — whose freezer drained ages ago, so
  // remainMs is already 0 — fired the alert immediately on every completed run.
  const freezerDrainingRef = useRef<Set<string>>(new Set());
  const freezerDoneNotifRef = useRef<Set<string>>(new Set());
  const batchDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showBatchDue, setShowBatchDue] = useState(false);

  // ── Pace alert state ───────────────────────────────────────────────────────
  // Per-run arm latch: the run is "armed" once we've observed it while on-pace
  // (shortfall below threshold OR time remaining above threshold). This matches
  // the notification-view-refire pattern: a run that started already behind
  // pace (or was navigated to after the fact) is never armed, so it never fires.
  const paceArmedRef = useRef<Set<string>>(new Set());
  // Per-run fired latch: fires exactly once per run.
  const paceFiredRef = useRef<Set<string>>(new Set());
  const [showPaceAlert, setShowPaceAlert] = useState(false);
  const [paceAlertMsg, setPaceAlertMsg] = useState("");

  // ── Batch cycle: per-tick memoization ─────────────────────────────────────
  // The batch effect runs every second (nowTime in deps). Track the last
  // computed batchNum so ticks within the same batch window return immediately
  // without string construction or ref lookups — most ticks do almost no work.
  const prevBatchNumRef = useRef(-1);
  // Reset prev batch num when the run or crust flag changes so a new run
  // starts fresh and doesn't skip its first batch boundary.
  const prevBatchRunIdRef = useRef<string | undefined>(undefined);
  if (prevBatchRunIdRef.current !== currentRun?.id) {
    prevBatchRunIdRef.current = currentRun?.id;
    prevBatchNumRef.current = -1;
  }

  // ── 15-minute end-of-run notification ─────────────────────────────────────
  useEffect(() => {
    if (!currentRun?.startedAt || currentRun?.endedAt) return;
    const runId = currentRun.id;
    if (notifiedRunRef.current === runId) return;
    // Only alert when the countdown genuinely CROSSES 15 minutes from above.
    // Runs shorter than 15 minutes never see >900s, so they get no (instantly
    // stale) "15 minutes left" pop at Start.
    if (calc.adjustedTimeSec > 900) {
      sawAbove15Ref.current.add(runId);
      return;
    }
    if (!sawAbove15Ref.current.has(runId)) return;
    if (calc.adjustedTimeSec > 0 && calc.adjustedTimeSec <= 900) {
      // Turned off by this user: still latch the run so re-enabling the
      // alert mid-run doesn't fire a stale "15 minutes left" later.
      if (!isNotifEnabled(prefsRef.current, "fifteenMin")) {
        notifiedRunRef.current = runId;
        return;
      }
      if ("Notification" in window) {
        const fire = () => {
          notifiedRunRef.current = runId;
          // The press finishes in ~15 min, but product keeps exiting the
          // freezer tunnel for the full freezer time after that — tell the
          // crew when the line is actually clear, not just when the press stops.
          const freezerMin = Number(v.freezerTime) || 0;
          const freezerNote = freezerMin > 0
            ? ` Freezer keeps emptying until ~${fmtClock(Date.now() + (calc.adjustedTimeSec + freezerMin * 60) * 1000)}.`
            : "";
          showAppNotification("⏰ 15 minutes left", {
            body: `${runLabel(currentRun)} — wrap up and prepare for end of run.${freezerNote}`,
            icon: "/icons/icon-192.png",
            tag: `run-end-${runId}`,
          });
        };
        if (Notification.permission === "granted") {
          fire();
        } else if (Notification.permission === "default") {
          Notification.requestPermission().then((p) => { if (p === "granted") fire(); });
        }
      }
    }
  }, [currentRun?.id, currentRun?.startedAt, currentRun?.endedAt, calc.adjustedTimeSec, v.freezerTime]);

  // ── Warehouse staging alerts (press basis: packing + freezer count done) ──
  // Warehouse stages the NEXT run in two steps ahead of the switchover:
  //  • FRONTLINE at 2 skids left at the press
  //  • PACKAGING at 1 skid left at the press
  // "Left at the press" = casesNeeded − cased − live freezer contents
  // (pressCasesLeft) — the freezer's product is already made, so it counts as
  // done. Runs smaller than 2 skids total trip the frontline threshold
  // immediately at start, and the message tells warehouse to stage 2+ runs
  // ahead instead. Each stage fires once per run.
  useEffect(() => {
    if (runStatus !== "running" || !currentRun?.startedAt || currentRun?.endedAt) return;
    // No valid timing basis → the remaining count is not meaningful yet.
    if (calc.ppm <= 0) return;
    const cps = Number(v.casesPerSkid) || 0;
    const needed = Number(v.casesNeeded) || 0;
    if (cps <= 0 || needed <= 0) return;
    const pressLeft = calc.pressCasesLeft;
    if (pressLeft <= 0) return;
    if (!("Notification" in window)) return;
    const runId = currentRun.id;
    const shortRun = needed < 2 * cps;
    const nextTxt = nextRunLabels.length > 0
      ? ` Next up: ${nextRunLabels.slice(0, shortRun ? 3 : 1).join(", ")}.`
      : "";
    const fireStage = (stage: "frontline" | "packaging") => {
      const latch = stage === "frontline" ? frontlineNotifRef : packagingNotifRef;
      latch.current.add(runId);
      navigator.vibrate?.([200, 100, 200]);
      if (stage === "frontline") {
        showAppNotification("🚚 Warehouse: stage FRONTLINE for next run", {
          body: shortRun
            ? `${runLabel(currentRun)} is under 2 skids total — stage the next 2+ runs now.${nextTxt}`
            : `${runLabel(currentRun)} — 2 skids left at the press (freezer counted done). Stage frontline.${nextTxt}`,
          icon: "/icons/icon-192.png",
          tag: `switchover-frontline-${runId}`,
        });
      } else {
        showAppNotification("🚚 Warehouse: stage PACKAGING for next run", {
          body: `${runLabel(currentRun)} — 1 skid left at the press (freezer counted done). Stage packaging.${nextTxt}`,
          icon: "/icons/icon-192.png",
          tag: `switchover-packaging-${runId}`,
        });
      }
    };
    const dueStages: Array<"frontline" | "packaging"> = [];
    if (pressLeft <= 2 * cps && !frontlineNotifRef.current.has(runId)) dueStages.push("frontline");
    if (pressLeft <= cps && !packagingNotifRef.current.has(runId)) dueStages.push("packaging");
    if (dueStages.length === 0) return;
    // Turned off by this user: latch the due stages silently so re-enabling
    // mid-run doesn't retroactively fire an already-passed staging alert.
    if (!isNotifEnabled(prefsRef.current, "warehouseStaging")) {
      dueStages.forEach((stage) => {
        (stage === "frontline" ? frontlineNotifRef : packagingNotifRef).current.add(runId);
      });
      return;
    }
    const fireAll = () => dueStages.forEach(fireStage);
    if (Notification.permission === "granted") {
      fireAll();
    } else if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => { if (p === "granted") fireAll(); });
    }
  }, [
    runStatus,
    currentRun?.id,
    currentRun?.startedAt,
    currentRun?.endedAt,
    calc.ppm,
    calc.pressCasesLeft,
    v.casesNeeded,
    v.casesPerSkid,
    nextRunLabels,
  ]);

  // ── Batch cycle alert ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isCrust) { setShowBatchDue(false); return; } // crust runs mix no dough — no batch alerts; clear any stale banner
    // Suppress (and clear) once the press has made everything the run needs —
    // from this point the dough crew is on the NEXT run, not this one.
    if (calc.pressDone) { setShowBatchDue(false); return; }
    if (runStatus !== "running" || !currentRun?.startedAt || calc.timePerBatchSec <= 0) return;
    const elapsed = (nowTime.getTime() - currentRun.startedAt) / 1000;
    const batchNum = Math.floor(elapsed / calc.timePerBatchSec);
    if (batchNum < 1) return;
    // Early exit: same batch window as the previous tick — nothing to evaluate.
    // This saves string construction and ref lookups on the vast majority of
    // 1-second ticks where the batch boundary hasn't changed.
    if (batchNum === prevBatchNumRef.current) return;
    prevBatchNumRef.current = batchNum;
    const key = `${currentRun.id}-${batchNum}`;
    if (batchNotifRef.current === key) return;
    batchNotifRef.current = key;
    // Turned off by this user: the cycle key above is already latched, so
    // re-enabling mid-run only alerts on the NEXT batch boundary.
    if (!isNotifEnabled(prefsRef.current, "batchDue")) return;
    navigator.vibrate?.([100, 50, 100]);
    setShowBatchDue(true);
    if (batchDismissRef.current) clearTimeout(batchDismissRef.current);
    batchDismissRef.current = setTimeout(() => setShowBatchDue(false), 10000);
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        showAppNotification("🍕 Start next dough batch", {
          body: `${runLabel(currentRun)} — batch ${batchNum + 1} is due now.`,
          icon: "/icons/icon-192.png",
          tag: `batch-${currentRun.id}-${batchNum}`,
        });
      } else if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
    return () => { if (batchDismissRef.current) clearTimeout(batchDismissRef.current); };
  }, [runStatus, currentRun?.id, currentRun?.startedAt, calc.timePerBatchSec, nowTime, isCrust, calc.pressDone]);

  // ── Run time complete alert ────────────────────────────────────────────────
  useEffect(() => {
    if (runStatus !== "running" || !currentRun?.startedAt) return;
    // No valid timing basis (ppm <= 0) → adjustedTimeSec is a fallback, not a
    // real countdown, so it can't represent completion. Matches mobile, where
    // minutesRemaining is null whenever ppm <= 0.
    if (calc.ppm <= 0) return;
    const runId = currentRun.id;
    // Remember that this run had real remaining time at some point.
    if (calc.adjustedTimeSec > 0) { runWasTimedRef.current = runId; return; }
    // Never had positive time (line speed / cases-needed unset) → not a real
    // countdown completion, so don't fire "time's up" right at run start.
    if (runWasTimedRef.current !== runId) return;
    if (runCompleteNotifRef.current === runId) return;
    // Safety floor: a run can't legitimately complete within its first minute.
    // Stale carried-over progress fields or a transient calc mismatch right at
    // Start must never produce an instant "time's up".
    if (Date.now() - currentRun.startedAt < 60_000) return;
    runCompleteNotifRef.current = runId;
    // Turned off by this user: the run id above is already latched, so
    // re-enabling later never fires a stale "time's up".
    if (!isNotifEnabled(prefsRef.current, "runComplete")) return;
    navigator.vibrate?.([300, 100, 300, 100, 300]);
    if (Notification.permission === "granted") {
      showAppNotification("✅ Run time complete", {
        body: `${runLabel(currentRun)} — time's up, end the run.`,
        icon: "/icons/icon-192.png",
        tag: `run-complete-${runId}`,
      });
    }
  }, [runStatus, currentRun?.id, currentRun?.startedAt, calc.adjustedTimeSec, calc.ppm]);

  // ── Freezer drain complete alert ───────────────────────────────────────────
  useEffect(() => {
    if (runStatus !== "ended" || !currentRun?.endedAt) return;
    const freezerMs = Number(v.freezerTime) * 60000;
    if (freezerMs <= 0) return;
    const runId = currentRun.id;
    // Short-circuit: if this run's freezer is already done and latched, skip
    // the remainMs computation on every subsequent nowTime tick.
    if (freezerDoneNotifRef.current.has(runId)) return;
    const remainMs = Math.max(0, currentRun.endedAt + freezerMs - nowTime.getTime());
    if (remainMs > 0) { freezerDrainingRef.current.add(runId); return; }
    // Only fire if we actually watched this run's freezer drain down — not when
    // selecting/scrolling to an already-drained completed run.
    if (!freezerDrainingRef.current.has(runId)) return;
    freezerDoneNotifRef.current.add(runId);
    // Turned off by this user: the run is already latched above, so
    // re-enabling later never fires a stale "freezer empty".
    if (!isNotifEnabled(prefsRef.current, "freezerEmpty")) return;
    navigator.vibrate?.([200, 100, 200]);
    if (Notification.permission === "granted") {
      showAppNotification("❄️ Freezer empty", {
        body: `${runLabel(currentRun)} — freezer is clear, ready for next run.`,
        icon: "/icons/icon-192.png",
        tag: `freezer-done-${runId}`,
      });
    }
  }, [runStatus, currentRun?.id, currentRun?.endedAt, v.freezerTime, nowTime]);

  // ── Behind-pace alert ─────────────────────────────────────────────────────
  // Fires once per run when actual throughput is too slow to finish on time.
  // Uses the armed-while-pending latch: the run is armed while pace is OK, then
  // fires once when the shortfall condition is first met. A run that was already
  // behind before our first tick (e.g. navigation to an old run) is never armed
  // and therefore never fires.
  useEffect(() => {
    if (runStatus !== "running" || !currentRun?.startedAt || currentRun?.endedAt) return;
    if (calc.ppm <= 0) return;
    const casesNeeded = Number(v.casesNeeded);
    if (casesNeeded <= 0) return;

    const runId = currentRun.id;
    // Short-circuit: already fired for this run.
    if (paceFiredRef.current.has(runId)) return;

    // Compute net elapsed production time (excluding non-pause stoppages).
    const nowMs = nowTime.getTime();
    const downtimeMs = (currentRun.stoppages ?? [])
      .filter(s => s.endedAt && s.type !== "pause")
      .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
    const elapsedMin = Math.max(0, nowMs - currentRun.startedAt - downtimeMs) / 60000;

    // Don't evaluate pace until elapsed >= freezerTime (the tunnel window).
    if (elapsedMin < Number(v.freezerTime)) {
      paceArmedRef.current.add(runId);
      return;
    }

    const timeRemainingMin = calc.adjustedTimeSec / 60;
    // Press output = cased cases + cases still in the tunnel. Using cased-only
    // output here would make the line look ~half as fast as it really is and
    // fire false alarms: e.g. 35 min at 40 PPM / 12 per case / 18-min tunnel
    // shows 54 cased + ~60 in tunnel. Cased-only rate = 54/35×60 ≈ 93/hr →
    // false shortfall; press-output rate = 114/35×60 ≈ 195/hr → on pace, and
    // the projected finish lands within PACE_SHORTFALL_MIN_CASES of
    // casesNeeded, so no alert fires.
    const pressOutput = calc.casesCompleted + calc.casesInFreezer;
    // Actual throughput rate in cases per hour (press output basis).
    const actualRateCasesPerHr = elapsedMin > 0 ? (pressOutput / elapsedMin) * 60 : 0;
    // Projected total at current rate.
    const projectedFinish = pressOutput + (actualRateCasesPerHr * timeRemainingMin) / 60;
    const shortfall = Math.ceil(casesNeeded - projectedFinish);

    const conditionMet =
      shortfall >= PACE_SHORTFALL_MIN_CASES &&
      timeRemainingMin > 0 &&
      timeRemainingMin <= PACE_TIME_REMAINING_MAX_MIN;

    if (!conditionMet) {
      // Pace is still fine — arm the run so the alert can fire later if it falls behind.
      paceArmedRef.current.add(runId);
      return;
    }

    // Only fire if we previously saw this run while it was on-pace.
    if (!paceArmedRef.current.has(runId)) return;
    paceFiredRef.current.add(runId);

    // Silent latch when the user has turned this alert off — future re-enable
    // won't retroactively fire for a milestone that's already passed.
    if (!isNotifEnabled(prefsRef.current, "slowPace")) return;

    const rateRounded = Math.round(actualRateCasesPerHr);
    const remainMin = Math.round(timeRemainingMin);
    const msg = `At current pace (~${rateRounded}/hr), you'll finish ~${shortfall} cases short. ${remainMin} min remaining.`;
    setPaceAlertMsg(msg);
    setShowPaceAlert(true);
    navigator.vibrate?.([200, 100, 200]);
    showAppNotification("⚠️ Behind pace", {
      body: msg,
      icon: "/icons/icon-192.png",
      tag: `slow-pace-${runId}`,
    });
  }, [
    runStatus,
    currentRun?.id,
    currentRun?.startedAt,
    currentRun?.endedAt,
    currentRun?.stoppages,
    calc.ppm,
    calc.casesCompleted,
    calc.casesInFreezer,
    calc.adjustedTimeSec,
    v.casesNeeded,
    nowTime,
  ]);

  // Clear the pace banner when switching runs.
  useEffect(() => {
    setShowPaceAlert(false);
    setPaceAlertMsg("");
  }, [currentRun?.id]);

  return { showBatchDue, setShowBatchDue, showPaceAlert, setShowPaceAlert, paceAlertMsg };
}
