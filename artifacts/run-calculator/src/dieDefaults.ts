// Die-size line-setting defaults.
//
// Picking a die on the run form (or in the setup profile editor) pre-fills the
// line-setting fields staff otherwise re-type on every run. Defaults are
// BLANK-FILL ONLY: a field is filled only while it still holds its untouched
// default value (see DEFAULT_VALUES in types.ts), so numbers a user already
// changed are never overwritten. The map is hard-coded for now (no manager UI).

export interface DieLineDefaults {
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  freezerTime: number;
  casesPerLayer: number; // "Extra Case Buffer" in the UI
}

const SEVEN: DieLineDefaults = {
  crustsPerCycle: 6,
  cycleSpeed: 8,
  speedAdjustment: 0.85,
  freezerTime: 22,
  casesPerLayer: 6,
};
const TWELVE: DieLineDefaults = {
  crustsPerCycle: 5,
  cycleSpeed: 8,
  speedAdjustment: 1,
  freezerTime: 15,
  casesPerLayer: 6,
};
const ELEVEN_OR_ARGUS: DieLineDefaults = {
  crustsPerCycle: 5,
  cycleSpeed: 8,
  speedAdjustment: 1,
  freezerTime: 16,
  casesPerLayer: 6,
};

// Untouched form defaults — the values a fresh run starts with (DEFAULT_VALUES
// in types.ts). A field still holding one of these is considered "blank" and
// safe to fill. speedAdjustment's untouched value is 1.0 (not 0).
const UNTOUCHED: DieLineDefaults = {
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  freezerTime: 0,
  casesPerLayer: 0,
};

/**
 * Resolve the line-setting defaults for a die name, tolerating the naming
 * variants in use (`7"`, `7in`, `7 inch`, `12" Dies`, `Argus Dies`, ...).
 * Returns null for unknown/blank dies.
 */
export function dieLineDefaultsFor(dieName: string): DieLineDefaults | null {
  const t = (dieName ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/argus/.test(t)) return ELEVEN_OR_ARGUS;
  const m = t.match(/(\d{1,2})\s*(?:"|”|in\b|inch)?/);
  if (!m) return null;
  const size = Number(m[1]);
  if (size === 7) return SEVEN;
  if (size === 12) return TWELVE;
  if (size === 11) return ELEVEN_OR_ARGUS;
  return null;
}

/**
 * Given the selected die and the current form values, return ONLY the fields
 * that should be filled: those whose current value still equals the untouched
 * default. Anything the user already changed is left alone. Returns an empty
 * object when the die is unknown or nothing needs filling.
 */
export function resolveDieLineDefaults(
  dieName: string,
  current: Partial<Record<keyof DieLineDefaults, unknown>>,
): Partial<DieLineDefaults> {
  const defaults = dieLineDefaultsFor(dieName);
  if (!defaults) return {};
  const out: Partial<DieLineDefaults> = {};
  for (const key of Object.keys(defaults) as (keyof DieLineDefaults)[]) {
    const cur = Number(current[key] ?? UNTOUCHED[key]);
    const untouched = !Number.isFinite(cur) || cur === UNTOUCHED[key];
    if (untouched && defaults[key] !== cur) out[key] = defaults[key];
  }
  return out;
}
