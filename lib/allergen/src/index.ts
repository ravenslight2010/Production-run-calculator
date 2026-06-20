// Shared allergen model for the run calculator (web + mobile parity).
//
// A run's line is tagged with at most one allergen. The factory runs allergen
// products at the END of the day so the line can be thoroughly cleaned before a
// non-allergen ("none") product is run again. This module is pure so both apps
// derive identical colors, labels, and food-safety warnings from it.

export type Allergen = "none" | "egg" | "soy";

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
  { value: "egg", label: "Egg", color: "#eab308", textColor: "#1c1917", isAllergen: true },
  { value: "soy", label: "Soy", color: "#dc2626", textColor: "#ffffff", isAllergen: true },
];

// Coerce any persisted/synced value (legacy state, remote payload, blank) onto
// the small enum. Anything unrecognized fails safe to "none".
export function normalizeAllergen(v: unknown): Allergen {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "egg") return "egg";
  if (s === "soy") return "soy";
  return "none";
}

export function allergenMeta(a: Allergen): AllergenMeta {
  return ALLERGENS.find((m) => m.value === normalizeAllergen(a)) ?? ALLERGENS[0];
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
