// Pure, platform-agnostic logic for "moving" scheduled runs between dates.
//
// Both the web and mobile apps let a user re-date scheduled production:
//   - move a WHOLE day's runs to another date, or
//   - move a SINGLE run to another date.
//
// The storage shapes differ wildly between platforms (mobile keeps a local
// `Record<date, ScheduledRun[]>`; web keeps per-date server day-states with a
// parallel `runValues` map), so the *only* thing that must stay identical is the
// merge decision: append moved entries to the target (never auto-collapse by
// brand+flavor), regenerate any id that would collide on the target, preserve
// every field, and let the caller drop a source day that became empty. Keeping
// that decision here makes web+mobile parity enforceable.

export interface IdMapping {
  // The entry's original id on the source day.
  from: string;
  // The id it has on the target day (differs from `from` only when it had to be
  // regenerated to avoid colliding with an existing target id).
  to: string;
}

export interface MoveEntriesResult<T> {
  // Source entries that remain after the move (the moved ones removed).
  source: T[];
  // Target entries after the moved ones were appended.
  target: T[];
  // Old→new id mapping for every moved entry, so a caller can relocate a
  // parallel values map (e.g. web `runValues`) in lockstep.
  idMap: IdMapping[];
}

// Move entries out of `sourceEntries` into `targetEntries`.
//
// `ids` selects which entries move: pass `"all"` for a whole-day move, or an
// explicit list of ids for a single/partial move. Order is preserved: surviving
// source order is kept, and moved entries are appended to the target in their
// original source order.
//
// `genId` is injected (platforms generate ids differently) and is only called
// when a moved entry's id already exists on the target.
export function moveEntries<T extends { id: string }>(
  sourceEntries: readonly T[],
  targetEntries: readonly T[],
  ids: readonly string[] | "all",
  genId: () => string,
): MoveEntriesResult<T> {
  const moveSet: Set<string> | null =
    ids === "all" ? null : new Set(ids);

  const moving: T[] = [];
  const source: T[] = [];
  for (const entry of sourceEntries) {
    if (moveSet === null || moveSet.has(entry.id)) moving.push(entry);
    else source.push(entry);
  }

  // Track ids already present on the target (plus ids we assign as we go) so two
  // moved entries can't be handed the same regenerated id either.
  const usedIds = new Set<string>(targetEntries.map((e) => e.id));
  const target: T[] = [...targetEntries];
  const idMap: IdMapping[] = [];

  for (const entry of moving) {
    let nextId = entry.id;
    if (usedIds.has(nextId)) {
      do {
        nextId = genId();
      } while (usedIds.has(nextId));
    }
    usedIds.add(nextId);
    idMap.push({ from: entry.id, to: nextId });
    target.push(nextId === entry.id ? entry : { ...entry, id: nextId });
  }

  return { source, target, idMap };
}

export interface RelocateValuesResult<V> {
  source: Record<string, V>;
  target: Record<string, V>;
}

// Relocate a parallel id-keyed values map (e.g. web `runValues`) to match an
// `idMap` produced by `moveEntries`. The moved keys are removed from the source
// map and written into the target map under their (possibly regenerated) ids.
// Entries with no value in the source map are simply skipped.
export function relocateValues<V>(
  sourceValues: Readonly<Record<string, V>>,
  targetValues: Readonly<Record<string, V>>,
  idMap: readonly IdMapping[],
): RelocateValuesResult<V> {
  const source: Record<string, V> = { ...sourceValues };
  const target: Record<string, V> = { ...targetValues };
  for (const { from, to } of idMap) {
    if (Object.prototype.hasOwnProperty.call(source, from)) {
      const value = source[from];
      delete source[from];
      target[to] = value;
    }
  }
  return { source, target };
}

const DATE_SCOPED_SCHEDULE_FIELDS = [
  "dayState",
  "runValues",
  "runValuesUpdatedAt",
  "packagingProgress",
  "autoTrackCoordination",
  "autoTrackServerState",
  "doughTimerControls",
] as const;

/**
 * Exchange only the date/run-owned portion of two canonical sync documents.
 * Factory-wide lists and other document metadata remain attached to their
 * original date rows.
 */
export function swapDateScopedScheduleState<T extends Record<string, unknown>>(
  left: T,
  right: T,
  leftDate: string,
  rightDate: string,
): { left: T; right: T } {
  const nextLeft: Record<string, unknown> = { ...left };
  const nextRight: Record<string, unknown> = { ...right };

  for (const field of DATE_SCOPED_SCHEDULE_FIELDS) {
    const leftHas = Object.prototype.hasOwnProperty.call(left, field);
    const rightHas = Object.prototype.hasOwnProperty.call(right, field);
    if (rightHas) nextLeft[field] = right[field];
    else delete nextLeft[field];
    if (leftHas) nextRight[field] = left[field];
    else delete nextRight[field];
  }

  for (const [document, date] of [[nextLeft, leftDate], [nextRight, rightDate]] as const) {
    const dayState = document.dayState;
    if (dayState && typeof dayState === "object" && !Array.isArray(dayState)) {
      document.dayState = { ...(dayState as Record<string, unknown>), date };
    }
  }

  return { left: nextLeft as T, right: nextRight as T };
}

/** Owner-approved eligibility rule for a whole-day swap that includes today. */
export function isTodayScheduleSwapAllowed(
  runs: readonly unknown[],
  nowMs: number,
  timeZone: string,
): boolean {
  const hasStartedRun = runs.some((run) =>
    !!run
    && typeof run === "object"
    && !Array.isArray(run)
    && (
      (run as Record<string, unknown>).startedAt != null
      || (run as Record<string, unknown>).endedAt != null
    ),
  );
  if (!hasStartedRun) return true;

  try {
    const hour = Number(new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs)).find((part) => part.type === "hour")?.value);
    return Number.isInteger(hour) && hour < 7;
  } catch {
    return false;
  }
}
