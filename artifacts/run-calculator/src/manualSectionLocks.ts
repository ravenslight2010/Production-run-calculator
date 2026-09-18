import { MANUAL_SECTION_FIELDS, type ManualSection } from "@workspace/sync-contract";
import { useSyncExternalStore } from "react";

export type ManualSectionLock = {
  runId: string;
  section: ManualSection;
  owner: string;
  expiresAt: number;
  peer?: boolean;
};
export type ControlLockState = {
  locked: boolean;
  disabled: boolean;
  message?: string;
};
export const MANUAL_SECTION_CONTROLS = {
  packaging: ["calculator-skids", "calculator-cases", "packaging-skids", "packaging-cases", "floor-skid-done", "floor-cases", "dough-quick-check-skids", "dough-quick-check-cases"],
  dough: ["dough-trays", "dough-batches", "dough-crust-trays", "dough-crust-batches"],
  sauce: ["sauce-batches"],
  app1: ["applicator-1-batches"],
  app2: ["applicator-2-batches"],
  app3: ["applicator-3-batches"],
  app4: ["applicator-4-batches"],
} as const;
export const USED_MANUAL_SECTION_CONTROL_IDS = Object.values(MANUAL_SECTION_CONTROLS).flat();
export function sectionForManualControl(controlId: string): ManualSection | undefined {
  return (Object.entries(MANUAL_SECTION_CONTROLS).find(([, controls]) => controls.includes(controlId as never))?.[0] as ManualSection | undefined);
}
export function restoreManualSectionValues(section: ManualSection, canonical: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(MANUAL_SECTION_FIELDS[section].map((field) => [field, canonical[field]]));
}

const locks = new Map<string, ManualSectionLock>();
const conflicts = new Map<string, string>();
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const conflictTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const keyOf = (runId: string, section: ManualSection) => `${runId}:${section}`;

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeManualSectionLocks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getManualSectionLock(runId: string, section: ManualSection, now = Date.now()): ManualSectionLock | undefined {
  const key = keyOf(runId, section);
  const lock = locks.get(key);
  if (lock && lock.expiresAt <= now) {
    locks.delete(key);
    notify();
    return undefined;
  }
  return lock;
}

export function claimManualSectionLock(
  runId: string,
  section: ManualSection,
  owner: string,
  ttlMs = 30_000,
  peer = false,
): boolean {
  const existing = getManualSectionLock(runId, section);
  if (existing && existing.owner !== owner) return false;
  locks.set(keyOf(runId, section), { runId, section, owner, peer, expiresAt: Date.now() + ttlMs });
  const key = keyOf(runId, section);
  const priorTimer = expiryTimers.get(key);
  if (priorTimer) clearTimeout(priorTimer);
  expiryTimers.set(key, setTimeout(() => {
    expiryTimers.delete(key);
    if (locks.get(key)?.expiresAt && (locks.get(key)!.expiresAt <= Date.now())) {
      locks.delete(key);
      notify();
    }
  }, ttlMs + 1));
  notify();
  return true;
}

export function releaseManualSectionLock(runId: string, section: ManualSection, owner?: string): void {
  const key = keyOf(runId, section);
  const existing = locks.get(key);
  if (!existing || (owner && existing.owner !== owner)) return;
  locks.delete(key);
  const timer = expiryTimers.get(key);
  if (timer) clearTimeout(timer);
  expiryTimers.delete(key);
  notify();
}

export function clearManualSectionLocks(): void {
  locks.clear();
  for (const timer of expiryTimers.values()) clearTimeout(timer);
  expiryTimers.clear();
  conflicts.clear();
  for (const timer of conflictTimers.values()) clearTimeout(timer);
  conflictTimers.clear();
  notify();
}

export function setManualSectionConflict(runId: string, section: ManualSection, message = "Another device saved this section first. Your values were updated to the saved counts."): void {
  const key = keyOf(runId, section);
  conflicts.set(key, message);
  const prior = conflictTimers.get(key);
  if (prior) clearTimeout(prior);
  conflictTimers.set(key, setTimeout(() => {
    conflicts.delete(key);
    conflictTimers.delete(key);
    notify();
  }, 30_000));
  notify();
}

export function getManualSectionConflict(runId: string, section: ManualSection): string | undefined {
  return conflicts.get(keyOf(runId, section));
}

export function getControlLockState(runId: string, section: ManualSection, now = Date.now()): ControlLockState {
  const lock = getManualSectionLock(runId, section, now);
  const conflict = getManualSectionConflict(runId, section);
  return {
    locked: !!lock,
    disabled: !!lock,
    ...(conflict ? { message: conflict } : lock?.peer ? { message: "This section is being updated on another device." } : {}),
  };
}

export function useManualSectionLock(runId: string | undefined, section: ManualSection): ManualSectionLock | undefined {
  return useSyncExternalStore(
    subscribeManualSectionLocks,
    () => runId && getControlLockState(runId, section).locked ? getManualSectionLock(runId, section) : undefined,
    () => undefined,
  );
}

export function useControlLockState(runId: string | undefined, section: ManualSection): ControlLockState {
  return useSyncExternalStore(
    subscribeManualSectionLocks,
    () => runId ? getControlLockState(runId, section) : { locked: false, disabled: false },
    () => ({ locked: false, disabled: false }),
  );
}
export function useManualControlLock(runId: string | undefined, controlId: string): ManualSectionLock | undefined {
  const section = sectionForManualControl(controlId);
  return useManualSectionLock(runId, section ?? "packaging");
}
export function useManualControlConflict(runId: string | undefined, controlId: string): string | undefined {
  const section = sectionForManualControl(controlId);
  return useManualSectionConflict(runId, section ?? "packaging");
}

export function useManualSectionConflict(runId: string | undefined, section: ManualSection): string | undefined {
  return useSyncExternalStore(
    subscribeManualSectionLocks,
    () => runId ? getControlLockState(runId, section).message : undefined,
    () => undefined,
  );
}