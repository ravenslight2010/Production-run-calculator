import { useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { type RunState, type RunCalc, runLabel } from "@/context/RunContext";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let permissionRequested = false;
async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "granted") return true;
  if (permissionRequested) return false;
  permissionRequested = true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === "granted";
}

async function fireNotification(title: string, body: string) {
  const granted = await ensurePermission();
  if (!granted) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

interface NotifParams {
  run: RunState;
  runIndex: number;
  calc: RunCalc;
  nowMs: number;
}

interface NotifResult {
  showBatchDue: boolean;
  setShowBatchDue: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Fires local notifications + haptics at key run milestones:
 *  - 15 minutes remaining before end of run
 *  - Each dough-batch cycle boundary
 *  - Run time complete
 *  - Freezer drain complete (post-run)
 *
 * Note: Local notifications only. Works while the app is foregrounded under
 * Expo Go; standalone builds also deliver in background.
 */
export function useNotifications({
  run,
  runIndex,
  calc,
  nowMs,
}: NotifParams): NotifResult {
  const notifiedRunRef = useRef<string | null>(null);
  const batchNotifRef = useRef<string>("");
  const runCompleteNotifRef = useRef<string>("");
  // Tracks the run id that has ever shown positive remaining time. A run started
  // before line speed or cases-needed are configured has minutesRemaining === 0
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

  const label = runLabel(run, runIndex);
  const isRunning = run.isRunning;
  const startedAt = run.startedAt;
  const endedAt = run.endedAt;
  const remainSec = (calc.minutesRemaining ?? 0) * 60;

  // ── 15-minute end-of-run notification ──────────────────────────────────────
  useEffect(() => {
    if (!startedAt || endedAt) return;
    if (notifiedRunRef.current === run.id) return;
    if (remainSec > 0 && remainSec <= 900) {
      notifiedRunRef.current = run.id;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      fireNotification(
        "⏰ 15 minutes left",
        `${label} — wrap up and prepare for end of run.`,
      );
    }
  }, [run.id, startedAt, endedAt, remainSec, label]);

  // ── Batch cycle alert ───────────────────────────────────────────────────────
  useEffect(() => {
    // Crust runs open pre-made cases — no dough is mixed, so no batch alerts.
    // Also clear any banner that was raised before switching into crust mode.
    if (run.progress.subTab === "crusts") { setShowBatchDue(false); return; }
    // Suppress (and clear) once the press has made everything the run needs —
    // from this point the dough crew is on the NEXT run, not this one.
    if (calc.pressDone) { setShowBatchDue(false); return; }
    if (!isRunning || !startedAt || calc.timePerBatchSec <= 0) return;
    const elapsed = (nowMs - startedAt) / 1000;
    const batchNum = Math.floor(elapsed / calc.timePerBatchSec);
    if (batchNum < 1) return;
    const key = `${run.id}-${batchNum}`;
    if (batchNotifRef.current === key) return;
    batchNotifRef.current = key;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowBatchDue(true);
    if (batchDismissRef.current) clearTimeout(batchDismissRef.current);
    batchDismissRef.current = setTimeout(() => setShowBatchDue(false), 10000);
    fireNotification(
      "🍕 Start next dough batch",
      `${label} — batch ${batchNum + 1} is due now.`,
    );
  }, [isRunning, run.id, startedAt, calc.timePerBatchSec, nowMs, label, run.progress.subTab, calc.pressDone]);

  // Clear any pending banner-dismiss timer only on unmount.
  useEffect(() => {
    return () => {
      if (batchDismissRef.current) clearTimeout(batchDismissRef.current);
    };
  }, []);

  // ── Run time complete alert ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning || !startedAt) return;
    if (calc.minutesRemaining === null) return;
    // Remember that this run had real remaining time at some point.
    if (calc.minutesRemaining > 0) { runWasTimedRef.current = run.id; return; }
    // Never had positive time (line speed / cases-needed unset) → not a real
    // countdown completion, so don't fire "time's up" right at run start.
    if (runWasTimedRef.current !== run.id) return;
    if (runCompleteNotifRef.current === run.id) return;
    runCompleteNotifRef.current = run.id;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    fireNotification("✅ Run time complete", `${label} — time's up, end the run.`);
  }, [isRunning, run.id, startedAt, calc.minutesRemaining, label]);

  // ── Freezer drain complete alert ─────────────────────────────────────────────
  useEffect(() => {
    if (!endedAt) return;
    const freezerMs = Number(run.settings.freezerTime) * 60000;
    if (freezerMs <= 0) return;
    const remainMs = Math.max(0, endedAt + freezerMs - nowMs);
    if (remainMs > 0) { freezerDrainingRef.current.add(run.id); return; }
    // Only fire if we actually watched this run's freezer drain down — not when
    // selecting/scrolling to an already-drained completed run.
    if (!freezerDrainingRef.current.has(run.id)) return;
    if (freezerDoneNotifRef.current.has(run.id)) return;
    freezerDoneNotifRef.current.add(run.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    fireNotification(
      "❄️ Freezer empty",
      `${label} — freezer is clear, ready for next run.`,
    );
  }, [run.id, endedAt, run.settings.freezerTime, nowMs, label]);

  return { showBatchDue, setShowBatchDue };
}
