// Die-size line-setting defaults.
//
// Picking a die on the run form (or in the setup profile editor) pre-fills the
// line-setting fields staff otherwise re-type on every run. Defaults are
// BLANK-FILL ONLY: a field is filled only while it still holds its untouched
// default value (see DEFAULT_VALUES in types.ts), so numbers a user already
// changed are never overwritten. Managers can override the values per die
// under Manage Lists → Die Defaults (server master-data); dies with no stored
// override fall back to the built-in hard-coded map below.

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

/** Manager overrides keyed by case-folded die name (see dieLineDefaultsServer). */
export type DieLineDefaultsOverrides = Record<string, DieLineDefaults>;

/** Canonical override-map key for a die name. */
export function dieDefaultsKey(dieName: string): string {
  return (dieName ?? "").trim().toLowerCase();
}

/**
 * Resolve the line-setting defaults for a die name. A manager-stored override
 * (matched by exact die name, case-insensitive) wins; otherwise falls back to
 * the built-in map, tolerating the naming variants in use (`7"`, `7in`,
 * `7 inch`, `12" Dies`, `Argus Dies`, ...). Returns null for unknown/blank dies.
 */
export function dieLineDefaultsFor(
  dieName: string,
  overrides?: DieLineDefaultsOverrides,
): DieLineDefaults | null {
  const t = dieDefaultsKey(dieName);
  if (!t) return null;
  const stored = overrides?.[t];
  if (stored) return stored;
  if (/argus/.test(t)) return ELEVEN_OR_ARGUS;
  const m = t.match(/(\d{1,2})\s*(?:"|”|in\b|inch)?/);
  if (!m) return null;
  const size = Number(m[1]);
  if (size === 7) return SEVEN;
  if (size === 12) return TWELVE;
  if (size === 11) return ELEVEN_OR_ARGUS;
  return null;
}

// ─── Crust-mode defaults ────────────────────────────────────────────────────
// Selecting the "Crust" line type (purchased crusts, no dough mixing) has its
// own known line settings. Same blank-fill-only semantics as die defaults.
// crustsPerCase / crustsPerStack intentionally NOT included (still unknown —
// left at 0 until the factory settles on numbers).

export interface CrustLineDefaults {
  approxLineSpeed: number;
  speedAdjustment: number;
  freezerTime: number;
  casesPerLayer: number; // "Extra Case Buffer" in the UI
}

export const CRUST_LINE_DEFAULTS: CrustLineDefaults = {
  approxLineSpeed: 40,
  speedAdjustment: 1,
  freezerTime: 9.2,
  casesPerLayer: 2,
};

const CRUST_UNTOUCHED: CrustLineDefaults = {
  approxLineSpeed: 0,
  speedAdjustment: 1.0,
  freezerTime: 0,
  casesPerLayer: 0,
};

/**
 * Given the current form values, return ONLY the crust-mode fields that should
 * be filled: those whose current value still equals the untouched default.
 * Anything the user already changed is left alone.
 */
export function resolveCrustLineDefaults(
  current: Partial<Record<keyof CrustLineDefaults, unknown>>,
): Partial<CrustLineDefaults> {
  const out: Partial<CrustLineDefaults> = {};
  for (const key of Object.keys(CRUST_LINE_DEFAULTS) as (keyof CrustLineDefaults)[]) {
    const cur = Number(current[key] ?? CRUST_UNTOUCHED[key]);
    const untouched = !Number.isFinite(cur) || cur === CRUST_UNTOUCHED[key];
    if (untouched && CRUST_LINE_DEFAULTS[key] !== cur) out[key] = CRUST_LINE_DEFAULTS[key];
  }
  return out;
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
  overrides?: DieLineDefaultsOverrides,
): Partial<DieLineDefaults> {
  const defaults = dieLineDefaultsFor(dieName, overrides);
  if (!defaults) return {};
  const out: Partial<DieLineDefaults> = {};
  for (const key of Object.keys(defaults) as (keyof DieLineDefaults)[]) {
    const cur = Number(current[key] ?? UNTOUCHED[key]);
    const untouched = !Number.isFinite(cur) || cur === UNTOUCHED[key];
    if (untouched && defaults[key] !== cur) out[key] = defaults[key];
  }
  return out;
}

/**
 * Switch-aware variant used when the user EXPLICITLY picks a die (run form /
 * setup profile editor die selector). In addition to untouched-blank fields,
 * a field is also replaceable when its current value matches that field's
 * auto-fill from ANY known die (built-in map or a manager override) — i.e. it
 * was almost certainly auto-filled by a previous die selection, not typed by
 * the user. Values that don't match any die's defaults are still never
 * overwritten. Import/autofill paths (no explicit prior die pick) must keep
 * using resolveDieLineDefaults.
 */
export function resolveDieLineDefaultsOnSwitch(
  dieName: string,
  current: Partial<Record<keyof DieLineDefaults, unknown>>,
  overrides?: DieLineDefaultsOverrides,
): Partial<DieLineDefaults> {
  const defaults = dieLineDefaultsFor(dieName, overrides);
  if (!defaults) return {};
  const knownSets: DieLineDefaults[] = [
    SEVEN,
    TWELVE,
    ELEVEN_OR_ARGUS,
    ...Object.values(overrides ?? {}),
  ];
  const out: Partial<DieLineDefaults> = {};
  for (const key of Object.keys(defaults) as (keyof DieLineDefaults)[]) {
    const cur = Number(current[key] ?? UNTOUCHED[key]);
    const replaceable =
      !Number.isFinite(cur) ||
      cur === UNTOUCHED[key] ||
      knownSets.some(s => s[key] === cur);
    if (replaceable && defaults[key] !== cur) out[key] = defaults[key];
  }
  return out;
}
