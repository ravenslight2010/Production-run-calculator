// Shared cycle-count reminder model for the run calculator (web + mobile parity).
//
// Inventory accuracy depends on counting each part of the warehouse on a regular
// cadence (a "cycle count"). Managers configure a schedule per section/area —
// how many days may elapse between counts — and the Warehouse tab shows a "Time
// to Count" card listing every section that is now due: never counted, or last
// counted longer ago than its cadence. Marking a section counted stamps its
// last-counted date and removes it from the list until the cadence elapses
// again.
//
// This module is PURE so both apps compute the same due list. The schedule
// config is stored factory-wide on the server (NOT in the per-day sync payload)
// and edited by managers only; marking a section counted is open to any
// signed-in user. This module only models the config and derives the due list
// from it + today's date, mirroring the freezer-pull / production-rules
// master-data pattern.

export const DEFAULT_CADENCE_DAYS = 7;

// Common warehouse sections offered as one-tap suggestions when a manager adds a
// cycle-count schedule. Purely a convenience list — managers can type any
// section name. Shared so web and mobile offer the same starting points.
export const DEFAULT_CYCLE_COUNT_SECTIONS = [
  "Freezer",
  "Cooler",
  "Dry Storage",
  "Cheese Cooler",
  "Pepperoni Cooler",
  "Packaging",
  "Receiving",
];

// A single manager-defined cycle-count schedule. Flat shape so it serializes
// cleanly to the API/DB and is easy to edit field-by-field in the UI.
export interface CycleCountSchedule {
  id: string;
  // Optional persistence scope (live vs sandbox); carried through opaquely.
  scope?: string;
  // The warehouse section/area to count (e.g. "Freezer", "Dry Storage",
  // "Pepperoni Cooler"). Matched/displayed verbatim.
  section: string;
  // How many days may elapse between counts before the section is due again.
  cadenceDays: number;
  // The date (YYYY-MM-DD) this section was last counted, or null if it never
  // has been. A null value always reads as due.
  lastCountedAt: string | null;
  // Disabled schedules are kept (so toggling is easy) but never produce a
  // reminder.
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function coerceInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

// Coerce a raw last-counted value into a clean YYYY-MM-DD string, or null. An
// ISO timestamp is trimmed to its date part so the due math stays calendar-day
// based (matching freezer-pull's date handling).
function coerceDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

// Coerce a raw API/DB record into a clean CycleCountSchedule, or null if it has
// no usable section name. cadenceDays defaults to 7 and is clamped to >= 1
// (a non-positive cadence would make a section perpetually due); enabled
// defaults to true; lastCountedAt defaults to null (never counted).
export function normalizeCycleCountSchedule(
  input: unknown,
): CycleCountSchedule | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const section = typeof raw.section === "string" ? raw.section.trim() : "";
  if (!section) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id : section.toLowerCase();
  const cadenceDays = Math.max(
    1,
    coerceInt(raw.cadenceDays, DEFAULT_CADENCE_DAYS),
  );
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false;
  const schedule: CycleCountSchedule = {
    id,
    section,
    cadenceDays,
    lastCountedAt: coerceDate(raw.lastCountedAt),
    enabled,
  };
  if (typeof raw.scope === "string" && raw.scope) schedule.scope = raw.scope;
  return schedule;
}

// Normalize a list, dropping malformed entries and collapsing duplicate section
// names (case-insensitive) onto the last-seen entry.
export function normalizeCycleCountSchedules(
  input: unknown,
): CycleCountSchedule[] {
  if (!Array.isArray(input)) return [];
  const bySection = new Map<string, CycleCountSchedule>();
  for (const raw of input) {
    const schedule = normalizeCycleCountSchedule(raw);
    if (!schedule) continue;
    bySection.set(schedule.section.toLowerCase(), schedule);
  }
  return Array.from(bySection.values());
}

// ---------------------------------------------------------------------------
// Due-list building
// ---------------------------------------------------------------------------

// Whole calendar days elapsed from `lastCountedAt` up to `today` (both
// YYYY-MM-DD). Parsed as UTC so the result is calendar-day based and free of
// timezone/DST drift. Returns NaN if either date is unparseable.
export function daysSince(lastCountedAt: string, today: string): number {
  const a = Date.parse(`${lastCountedAt}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

// A section that is currently due to be counted.
export interface CycleCountDue {
  id: string;
  section: string;
  cadenceDays: number;
  lastCountedAt: string | null;
  // Whole days since the last count, or null if never counted.
  daysSince: number | null;
  // How many days past the cadence this section is (0 when exactly due). 0 for
  // never-counted sections — use `daysSince === null` to detect those.
  overdueDays: number;
}

// Build the cycle-count due list: every enabled schedule that is now due —
// never counted (lastCountedAt null) OR last counted at least `cadenceDays`
// ago. Sorted most-urgent-first: never-counted sections first, then by how far
// past cadence they are (descending), then by section name.
export function buildCycleCountDueList(args: {
  schedules: CycleCountSchedule[];
  today: string;
}): CycleCountDue[] {
  const { schedules, today } = args;
  const due: CycleCountDue[] = [];
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    if (schedule.lastCountedAt === null) {
      due.push({
        id: schedule.id,
        section: schedule.section,
        cadenceDays: schedule.cadenceDays,
        lastCountedAt: null,
        daysSince: null,
        overdueDays: 0,
      });
      continue;
    }
    const since = daysSince(schedule.lastCountedAt, today);
    if (!Number.isFinite(since)) continue;
    if (since < schedule.cadenceDays) continue; // counted recently enough
    due.push({
      id: schedule.id,
      section: schedule.section,
      cadenceDays: schedule.cadenceDays,
      lastCountedAt: schedule.lastCountedAt,
      daysSince: since,
      overdueDays: Math.max(0, since - schedule.cadenceDays),
    });
  }

  return due.sort((a, b) => {
    const aNever = a.daysSince === null;
    const bNever = b.daysSince === null;
    if (aNever !== bNever) return aNever ? -1 : 1;
    if (!aNever && !bNever && b.overdueDays !== a.overdueDays) {
      return b.overdueDays - a.overdueDays;
    }
    return a.section.localeCompare(b.section);
  });
}
