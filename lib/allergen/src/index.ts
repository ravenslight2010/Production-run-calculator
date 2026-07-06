// Shared allergen model for the run calculator (web + mobile parity).
//
// A run's line is tagged with at most one allergen. The factory runs allergen
// products at the END of the day so the line can be thoroughly cleaned before a
// non-allergen ("none") product is run again. This module is pure so both apps
// derive identical colors, labels, and food-safety warnings from it.

// Allergen designations are free-form: `none` plus the built-ins egg/soy, plus
// any additional allergen a spec sheet may name (e.g. "milk", "wheat"). Values
// are lower-cased, whitespace-collapsed tokens; `none` means no allergen. Kept
// as a plain string (not a closed union) so imported/custom allergens flow
// through the app — persisted, synced, displayed, and sequence-checked — instead
// of being silently discarded.
export type Allergen = string;

export const DEFAULT_ALLERGEN: Allergen = "none";

export interface AllergenMeta {
  value: Allergen;
  label: string;
  /** Badge/swatch background color. `none` is a neutral gray. */
  color: string;
  /** Foreground color that stays legible on top of `color`. */
  textColor: string;
  /** Whether this designation is an actual allergen (egg/soy) vs. none. */
  isAllergen: boolean;
}

// Order matters: this is the order options are shown in the picker.
export const ALLERGENS: readonly AllergenMeta[] = [
  { value: "none", label: "None", color: "#94a3b8", textColor: "#0f172a", isAllergen: false },
  { value: "egg", label: "Egg Allergen", color: "#eab308", textColor: "#1c1917", isAllergen: true },
  { value: "soy", label: "Soy Allergen", color: "#db2777", textColor: "#ffffff", isAllergen: true },
];

// "No allergen" spellings that must collapse to the neutral `none`.
const NONE_ALIASES = new Set(["", "none", "no", "na", "n/a", "no allergen"]);

// Verbose spellings of a built-in allergen (e.g. "Egg Allergen" typed into a
// profile or written by an import) collapse onto the canonical egg/soy tokens,
// so they render as the single built-in chip instead of a duplicate custom one.
const BUILTIN_ALIASES: Record<string, Allergen> = {
  "egg allergen": "egg",
  "egg allergens": "egg",
  "soy allergen": "soy",
  "soy allergens": "soy",
};

// Coerce any persisted/synced/parsed value onto a clean allergen token. Blank,
// non-string, or an explicit "no allergen" spelling become `none`; a verbose
// built-in spelling collapses onto its canonical token; anything else is
// preserved (lower-cased, whitespace-collapsed) so a NEW allergen named on a
// spec sheet (e.g. "milk") survives instead of being discarded.
export function normalizeAllergen(v: unknown): Allergen {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "";
  if (NONE_ALIASES.has(s)) return "none";
  return BUILTIN_ALIASES[s] ?? s;
}

// A small palette of distinct, dark swatch colors for custom allergens (beyond
// the built-in egg/soy). Picked deterministically per value so the same allergen
// always renders the same color across web + mobile.
const CUSTOM_ALLERGEN_COLORS = [
  "#7c3aed", "#0891b2", "#c026d3", "#ea580c",
  "#16a34a", "#db2777", "#0d9488", "#4f46e5",
];

function hashAllergen(v: string): number {
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0;
  return h;
}

function customAllergenColor(v: string): string {
  return CUSTOM_ALLERGEN_COLORS[hashAllergen(v) % CUSTOM_ALLERGEN_COLORS.length];
}

// Legible foreground (near-black or white) for text drawn on top of `hex`.
function contrastText(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1c1917" : "#ffffff";
}

function titleCaseAllergen(v: string): string {
  return v.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function allergenMeta(a: Allergen): AllergenMeta {
  const v = normalizeAllergen(a);
  const builtin = ALLERGENS.find((m) => m.value === v);
  if (builtin) return builtin;
  // Custom (imported) allergen: derive stable, legible presentation metadata.
  const color = customAllergenColor(v);
  return {
    value: v,
    label: titleCaseAllergen(v),
    color,
    textColor: contrastText(color),
    isAllergen: true,
  };
}

export function allergenLabel(a: Allergen): string {
  return allergenMeta(a).label;
}

export function isAllergen(a: Allergen): boolean {
  return allergenMeta(a).isAllergen;
}

export type AllergenWarningKind = "clean" | "clean-not-advisable";

export interface AllergenTransitionWarning {
  kind: AllergenWarningKind;
  message: string;
}

// Food-safety verdict for running `next` immediately after `prev` on the line.
// Returns null when the transition is safe (no cleaning needed):
//   - allergen -> a DIFFERENT allergen: clean the line (cross-contamination).
//   - allergen -> none: clean AND not advisable (a non-allergen product should
//     never follow an allergen; allergen runs belong at the end of the day).
//   - none -> anything, or same -> same: safe.
export function allergenTransitionWarning(
  prev: Allergen,
  next: Allergen,
): AllergenTransitionWarning | null {
  const p = normalizeAllergen(prev);
  const n = normalizeAllergen(next);
  if (p === n) return null;
  // Going from a clean/non-allergen line into anything is the recommended order.
  if (!isAllergen(p)) return null;
  if (n === "none") {
    return {
      kind: "clean-not-advisable",
      message:
        `Running a non-allergen product after ${allergenLabel(p)} is not advisable — ` +
        `thoroughly clean the line first. Allergen runs should be scheduled at the end of the day.`,
    };
  }
  return {
    kind: "clean",
    message:
      `Switching from ${allergenLabel(p)} to ${allergenLabel(n)} — ` +
      `thoroughly clean the line to avoid allergen cross-contamination.`,
  };
}

export interface AllergenSequenceItem {
  id: string;
  /** Human label for messaging, e.g. "Run 2 · Margherita". */
  label: string;
  allergen: Allergen;
}

export interface AllergenSequenceWarning extends AllergenTransitionWarning {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
}

// Warnings for each consecutive transition across the day's run sequence, in
// run order. Empty when every transition is safe.
export function allergenSequenceWarnings(
  runs: AllergenSequenceItem[],
): AllergenSequenceWarning[] {
  const out: AllergenSequenceWarning[] = [];
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1];
    const next = runs[i];
    const w = allergenTransitionWarning(prev.allergen, next.allergen);
    if (w) {
      out.push({
        ...w,
        fromId: prev.id,
        toId: next.id,
        fromLabel: prev.label,
        toLabel: next.label,
      });
    }
  }
  return out;
}

// Build the allergen picker option list: the built-in allergens (none, egg, soy)
// followed by any additional custom allergens present in `extra` — e.g. values
// imported from spec sheets or already assigned to other runs/profiles — de-
// duplicated and sorted. Keeping custom values in the option list means an
// imported allergen stays selectable (and re-selectable) instead of vanishing
// once a run is switched away from it.
export function allergenOptions(extra: Iterable<Allergen> = []): AllergenMeta[] {
  const seen = new Set(ALLERGENS.map((m) => m.value));
  const customs: string[] = [];
  for (const e of extra) {
    const v = normalizeAllergen(e);
    if (v === "none" || seen.has(v)) continue;
    seen.add(v);
    customs.push(v);
  }
  customs.sort((a, b) => a.localeCompare(b));
  return [...ALLERGENS, ...customs.map((v) => allergenMeta(v))];
}
