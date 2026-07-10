import { useEffect, useRef, useState } from "react";
import { type FormValues, type RunMeta } from "../types";
import { fmtClock, runLabel } from "../utils";

type RunStatus = "pending" | "running" | "paused" | "ended";

interface NotifCalc {
  adjustedTimeSec: number;
  timePerBatchSec: number;
  /** Pizzas-per-minute line speed. <= 0 means there is no valid timing basis. */
  ppm: number;
  /** Cases already cased on the floor (skids done + current skid). */
  casesCompleted: number;
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
}

interface NotifResult {
  showBatchDue: boolean;
  setShowBatchDue: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Fire a notification safely. Android Chrome (and other mobile browsers)
 * forbid the `new Notification()` constructor — it throws "Illegal
 * constructor" and must go through the service worker instead. Prefer
 * `ServiceWorkerRegistration.showNotification()`, fall back to the
 * constructor, and never let either path throw into the calling effect.
 */
function showAppNotification(title: string, options: NotificationOptions): void {
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
}: NotifParams): NotifResult {
  const notifiedRunRef = useRef<string | null>(null);
  // Per-run latch (Set, not a single id): switching to run B and back to a
  // nearly-done run A must NOT re-fire A's switchover alert.
  const switchoverNotifRef = useRef<Set<string>>(new Set());
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

  // ── 15-minute end-of-run notification ─────────────────────────────────────
  useEffect(() => {
    if (!currentRun?.startedAt || currentRun?.endedAt) return;
    const runId = currentRun.id;
    if (notifiedRunRef.current === runId) return;
    if (calc.adjustedTimeSec > 0 && calc.adjustedTimeSec <= 900) {
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

  // ── Warehouse switchover alert (2 skids before switchover) ────────────────
  // Warehouse needs the NEXT run staged 2 skids before the line switches over.
  // "2 skids" counts everything still to come off the line — cases the press
  // hasn't made yet PLUS product already in the freezer tunnel / on the line
  // (casesNeeded − casesCompleted). Runs smaller than 2 skids total trip the
  // threshold immediately at start, and the message tells warehouse to stage
  // 2+ runs ahead instead. Fires once per run.
  useEffect(() => {
    if (runStatus !== "running" || !currentRun?.startedAt || currentRun?.endedAt) return;
    // No valid timing basis → the remaining count is not meaningful yet.
    if (calc.ppm <= 0) return;
    const cps = Number(v.casesPerSkid) || 0;
    const needed = Number(v.casesNeeded) || 0;
    if (cps <= 0 || needed <= 0) return;
    // Everything still to come off the line, INCLUDING freezer/on-line product.
    const casesToCome = Math.max(0, needed - calc.casesCompleted);
    if (casesToCome <= 0 || casesToCome > 2 * cps) return;
    const runId = currentRun.id;
    if (switchoverNotifRef.current.has(runId)) return;
    if (!("Notification" in window)) return;
    const fire = () => {
      switchoverNotifRef.current.add(runId);
      navigator.vibrate?.([200, 100, 200]);
      const shortRun = needed < 2 * cps;
      const nextTxt = nextRunLabels.length > 0
        ? ` Next up: ${nextRunLabels.slice(0, shortRun ? 3 : 1).join(", ")}.`
        : "";
      showAppNotification("🚚 Warehouse: switchover coming", {
        body: shortRun
          ? `${runLabel(currentRun)} is under 2 skids total — stage the next 2+ runs now.${nextTxt}`
          : `${runLabel(currentRun)} — about 2 skids left (incl. freezer). Stage the next run.${nextTxt}`,
        icon: "/icons/icon-192.png",
        tag: `switchover-${runId}`,
      });
    };
    if (Notification.permission === "granted") {
      fire();
    } else if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => { if (p === "granted") fire(); });
    }
  }, [
    runStatus,
    currentRun?.id,
    currentRun?.startedAt,
    currentRun?.endedAt,
    calc.ppm,
    calc.casesCompleted,
    v.casesNeeded,
    v.casesPerSkid,
    nextRunLabels,
  ]);

  // ── Batch cycle alert ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isCrust) { setShowBatchDue(false); return; } // crust runs mix no dough — no batch alerts; clear any stale banner
    if (runStatus !== "running" || !currentRun?.startedAt || calc.timePerBatchSec <= 0) return;
    const elapsed = (nowTime.getTime() - currentRun.startedAt) / 1000;
    const batchNum = Math.floor(elapsed / calc.timePerBatchSec);
    if (batchNum < 1) return;
    const key = `${currentRun.id}-${batchNum}`;
    if (batchNotifRef.current === key) return;
    batchNotifRef.current = key;
    navigator.vibrate?.([100, 50, 100]);
    setShowBatchDue(true);
    if (batchDismissRef.current) clearTimeout(batchDismissRef.current);
    batchDismissRef.current = setTimeout(() => setShowBatchDue(false), 10000);
    if (Notification.permission === "granted") {
      showAppNotification("🍕 Start next dough batch", {
        body: `${runLabel(currentRun)} — batch ${batchNum + 1} is due now.`,
        icon: "/icons/icon-192.png",
        tag: `batch-${currentRun.id}-${batchNum}`,
      });
    } else if (Notification.permission === "default") {
      Notification.requestPermission();
    }
    return () => { if (batchDismissRef.current) clearTimeout(batchDismissRef.current); };
  }, [runStatus, currentRun?.id, currentRun?.startedAt, calc.timePerBatchSec, nowTime, isCrust]);

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
    runCompleteNotifRef.current = runId;
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
    const remainMs = Math.max(0, currentRun.endedAt + freezerMs - nowTime.getTime());
    if (remainMs > 0) { freezerDrainingRef.current.add(runId); return; }
    // Only fire if we actually watched this run's freezer drain down — not when
    // selecting/scrolling to an already-drained completed run.
    if (!freezerDrainingRef.current.has(runId)) return;
    if (freezerDoneNotifRef.current.has(runId)) return;
    freezerDoneNotifRef.current.add(runId);
    navigator.vibrate?.([200, 100, 200]);
    if (Notification.permission === "granted") {
      showAppNotification("❄️ Freezer empty", {
        body: `${runLabel(currentRun)} — freezer is clear, ready for next run.`,
        icon: "/icons/icon-192.png",
        tag: `freezer-done-${runId}`,
      });
    }
  }, [runStatus, currentRun?.id, currentRun?.endedAt, v.freezerTime, nowTime]);

  return { showBatchDue, setShowBatchDue };
}
