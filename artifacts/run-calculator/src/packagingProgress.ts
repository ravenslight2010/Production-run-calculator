import type { FormValues, PackagingProgress } from "./types";

const PACKAGING_PROGRESS_KEY = "run-calc-packaging-progress";

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function normalizePackagingProgress(value: unknown): PackagingProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const skidsCompleted = finiteNonNegative(raw.skidsCompleted);
  const casesOnCurrentSkid = finiteNonNegative(raw.casesOnCurrentSkid);
  const correctionGeneration = finiteNonNegative(raw.correctionGeneration);
  const updatedAt = finiteNonNegative(raw.updatedAt);
  const manualOverrideUntil = finiteNonNegative(raw.manualOverrideUntil);
  const nextCaseDueAt = raw.nextCaseDueAt === undefined
    ? undefined
    : finiteNonNegative(raw.nextCaseDueAt);
  if (
    skidsCompleted === null ||
    casesOnCurrentSkid === null ||
    correctionGeneration === null ||
    updatedAt === null ||
    manualOverrideUntil === null ||
    (raw.nextCaseDueAt !== undefined && nextCaseDueAt === null)
  ) {
    return null;
  }
  return {
    skidsCompleted: Math.floor(skidsCompleted),
    casesOnCurrentSkid: Math.round(casesOnCurrentSkid),
    correctionGeneration,
    updatedAt,
    manualOverrideUntil,
    ...(nextCaseDueAt !== undefined && nextCaseDueAt !== null ? { nextCaseDueAt } : {}),
  };
}

export function comparePackagingProgress(
  candidate: PackagingProgress,
  current: PackagingProgress,
): number {
  if (candidate.correctionGeneration !== current.correctionGeneration) {
    return candidate.correctionGeneration > current.correctionGeneration ? 1 : -1;
  }
  if (candidate.updatedAt !== current.updatedAt) {
    return candidate.updatedAt > current.updatedAt ? 1 : -1;
  }
  return 0;
}

export function loadPackagingProgress(): Record<string, PackagingProgress> {
  try {
    const raw = localStorage.getItem(PACKAGING_PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, PackagingProgress> = {};
    for (const [runId, value] of Object.entries(parsed)) {
      const normalized = normalizePackagingProgress(value);
      if (normalized) out[runId] = normalized;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePackagingProgress(map: Record<string, PackagingProgress>): void {
  try {
    localStorage.setItem(PACKAGING_PROGRESS_KEY, JSON.stringify(map));
  } catch {}
}

function nextTimestamp(now: number, previous: number | undefined): number {
  return Math.max(now, (previous ?? 0) + 1);
}

export function recordManualPackagingProgress(args: {
  runId: string;
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  manualOverrideUntil: number;
  nextCaseDueAt?: number;
  now?: number;
}): PackagingProgress {
  const map = loadPackagingProgress();
  const previous = map[args.runId];
  const now = args.now ?? Date.now();
  const progress: PackagingProgress = {
    skidsCompleted: Math.max(0, Math.floor(Number(args.skidsCompleted) || 0)),
    casesOnCurrentSkid: Math.max(0, Math.round(Number(args.casesOnCurrentSkid) || 0)),
    correctionGeneration: nextTimestamp(now, previous?.correctionGeneration),
    updatedAt: nextTimestamp(now, previous?.updatedAt),
    manualOverrideUntil: Math.max(now, args.manualOverrideUntil),
    ...(args.nextCaseDueAt !== undefined
      ? { nextCaseDueAt: Math.max(0, args.nextCaseDueAt) }
      : {}),
  };
  map[args.runId] = progress;
  savePackagingProgress(map);
  return progress;
}

export function recordAutomaticPackagingProgress(args: {
  runId: string;
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  now?: number;
}): PackagingProgress | null {
  const map = loadPackagingProgress();
  const previous = map[args.runId];
  const now = args.now ?? Date.now();
  if (previous && now < previous.manualOverrideUntil) return null;
  const progress: PackagingProgress = {
    skidsCompleted: Math.max(0, Math.floor(Number(args.skidsCompleted) || 0)),
    casesOnCurrentSkid: Math.max(0, Math.round(Number(args.casesOnCurrentSkid) || 0)),
    correctionGeneration: previous?.correctionGeneration ?? 0,
    updatedAt: nextTimestamp(now, previous?.updatedAt),
    manualOverrideUntil: previous?.manualOverrideUntil ?? 0,
    ...(previous?.nextCaseDueAt !== undefined ? { nextCaseDueAt: previous.nextCaseDueAt } : {}),
  };
  map[args.runId] = progress;
  savePackagingProgress(map);
  return progress;
}

export type PackagingProgressReconcileResult = {
  merged: Record<string, PackagingProgress>;
  acceptedRemoteIds: Set<string>;
  rejectedRemoteIds: Set<string>;
};

export function reconcilePackagingProgress(
  local: Record<string, PackagingProgress>,
  remote: Record<string, PackagingProgress> | undefined,
): PackagingProgressReconcileResult {
  const merged = { ...local };
  const acceptedRemoteIds = new Set<string>();
  const rejectedRemoteIds = new Set<string>();
  if (!remote) return { merged, acceptedRemoteIds, rejectedRemoteIds };
  for (const [runId, raw] of Object.entries(remote)) {
    const candidate = normalizePackagingProgress(raw);
    if (!candidate) continue;
    const current = merged[runId];
    if (!current || comparePackagingProgress(candidate, current) > 0) {
      merged[runId] = candidate;
      acceptedRemoteIds.add(runId);
    } else if (comparePackagingProgress(candidate, current) < 0) {
      rejectedRemoteIds.add(runId);
    }
  }
  return { merged, acceptedRemoteIds, rejectedRemoteIds };
}

export function overlayPackagingProgress(
  values: FormValues,
  progress: PackagingProgress | undefined,
): FormValues {
  if (!progress) return values;
  return {
    ...values,
    skidsCompleted: progress.skidsCompleted,
    casesOnCurrentSkid: progress.casesOnCurrentSkid,
  };
}