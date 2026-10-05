import type { ParsedProfile } from "./index";

/**
 * Manager-approved advisory thresholds, not validity or conversion rules.
 * Each field is checked independently; equality is allowed. Batch weights,
 * dough weights, and stick counts are deliberately outside this review.
 */
export const SPEC_IMPORT_PER_PIZZA_ADVISORY_LIMITS = Object.freeze({
  sauce: 16,
  applicator: 16,
  pepperoni: 16,
});

/** Derive fresh review messages without changing or annotating parsed values. */
export function reviewSpecImportPerPizzaAmounts(
  profile: ParsedProfile,
): string[] {
  const warnings: string[] = [];
  const check = (label: string, value: number | undefined, limit: number) => {
    if (value !== undefined && Number.isFinite(value) && value > limit) {
      warnings.push(
        `${label}: ${value} oz per pizza exceeds the ${limit} oz per pizza advisory limit. Verify the source amount and unit before Apply; the value is unchanged.`,
      );
    }
  };
  check("Sauce", profile.sauceOzPerPizza, SPEC_IMPORT_PER_PIZZA_ADVISORY_LIMITS.sauce);
  (profile.applicators ?? []).forEach((entry, index) => {
    check(
      `Applicator ${entry.slot ?? index + 1}${entry.type ? ` (${entry.type})` : ""}`,
      entry.ozPerPizza,
      SPEC_IMPORT_PER_PIZZA_ADVISORY_LIMITS.applicator,
    );
  });
  (profile.pepperonis ?? []).forEach((entry, index) => {
    check(
      `Pepperoni entry ${index + 1}${entry.type ? ` (${entry.type})` : ""}`,
      entry.ozPerPizza,
      SPEC_IMPORT_PER_PIZZA_ADVISORY_LIMITS.pepperoni,
    );
  });
  return warnings;
}