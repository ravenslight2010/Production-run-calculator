import { useEffect } from "react";

const configuredIdleMs = Number(import.meta.env.VITE_UPDATE_RELOAD_IDLE_MS);
export const UPDATE_RELOAD_IDLE_MS =
  Number.isFinite(configuredIdleMs) && configuredIdleMs > 0
    ? configuredIdleMs
    : 60_000;

export type UpdateReloadSafetyInputs = {
  hasActiveRun: boolean;
  hasUnsavedForm: boolean;
  hasBlockingDialog: boolean;
  hasBlockingOperation: boolean;
};

export function isAutomaticUpdateReloadSafe({
  hasActiveRun,
  hasUnsavedForm,
  hasBlockingDialog,
  hasBlockingOperation,
}: UpdateReloadSafetyInputs): boolean {
  return !hasActiveRun
    && !hasUnsavedForm
    && !hasBlockingDialog
    && !hasBlockingOperation;
}

export function hasAutomaticUpdateReloadBlockingSurface(
  surfaces: Readonly<Record<string, unknown>>,
): boolean {
  return Object.values(surfaces).some(Boolean);
}

let reportedAutomaticUpdateReloadSafety = false;
let currentAutomaticUpdateReloadSafety = false;
const automaticUpdateReloadBlockers = new Set<string>();
const automaticUpdateReloadSafetySubscribers = new Set<() => void>();

function publishAutomaticUpdateReloadSafety(): void {
  const next =
    reportedAutomaticUpdateReloadSafety
    && automaticUpdateReloadBlockers.size === 0;
  if (next === currentAutomaticUpdateReloadSafety) return;
  currentAutomaticUpdateReloadSafety = next;
  automaticUpdateReloadSafetySubscribers.forEach((notify) => notify());
}

export function reportAutomaticUpdateReloadSafety(safe: boolean): void {
  reportedAutomaticUpdateReloadSafety = safe;
  publishAutomaticUpdateReloadSafety();
}

export function reportAutomaticUpdateReloadBlocker(
  blockerId: string,
  blocked: boolean,
): void {
  if (blocked) automaticUpdateReloadBlockers.add(blockerId);
  else automaticUpdateReloadBlockers.delete(blockerId);
  publishAutomaticUpdateReloadSafety();
}

export function useAutomaticUpdateReloadBlocker(
  blockerId: string,
  blocked: boolean,
): void {
  useEffect(() => {
    reportAutomaticUpdateReloadBlocker(blockerId, blocked);
    return () => reportAutomaticUpdateReloadBlocker(blockerId, false);
  }, [blocked, blockerId]);
}

export function subscribeAutomaticUpdateReloadSafety(
  notify: () => void,
): () => void {
  automaticUpdateReloadSafetySubscribers.add(notify);
  return () => automaticUpdateReloadSafetySubscribers.delete(notify);
}

export function getAutomaticUpdateReloadSafety(): boolean {
  return currentAutomaticUpdateReloadSafety;
}

type IdleTrackingTarget = Pick<Window, "addEventListener" | "removeEventListener">;

export const UPDATE_RELOAD_ACTIVITY_EVENTS = [
  "touchstart",
  "mousedown",
  "keydown",
] as const;

export function startUpdateReloadIdleTracking(
  onIdleChange: (idle: boolean) => void,
  idleMs = UPDATE_RELOAD_IDLE_MS,
  target: IdleTrackingTarget = window,
): () => void {
  let stopped = false;
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const setIdle = (next: boolean) => {
    if (stopped || next === idle) return;
    idle = next;
    onIdleChange(next);
  };
  const onActivity = () => {
    if (timer !== undefined) clearTimeout(timer);
    setIdle(false);
    timer = setTimeout(() => {
      timer = undefined;
      setIdle(true);
    }, idleMs);
  };

  UPDATE_RELOAD_ACTIVITY_EVENTS.forEach((event) =>
    target.addEventListener(event, onActivity, { passive: true }),
  );
  onActivity();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    UPDATE_RELOAD_ACTIVITY_EVENTS.forEach((event) =>
      target.removeEventListener(event, onActivity),
    );
  };
}