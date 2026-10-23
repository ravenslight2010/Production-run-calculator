/** Memory-only master directories and retained conflict metadata. */
export const OPERATIONAL_DIRECTORY_KEYS = [
  "run-calc-brands", "run-calc-brand-flavors", "run-calc-ingredient-types",
  "run-calc-pep-types", "run-calc-die-types", "run-calc-cheese-ingredients",
  "run-calc-dough-ingredients", "run-calc-frontline-ingredients", "run-calc-mix-ingredients",
  "run-calc-dough-recipe-names", "run-calc-dough-recipe-presets",
  "run-calc-frontline-recipe-names", "run-calc-frontline-recipe-presets",
  "run-calc-cheese-recipe-names", "run-calc-cheese-recipe-presets", "run-calc-mix-recipe-names",
  // Conflict metadata is intentionally still durable on devices.
  "run-calc-merged-away", "run-calc-deleted-items", "run-calc-deleted-stamps", "run-calc-undeleted-stamps",
] as const;

/** Non-secret operational settings needed by staff stoppage, packaging and schedule UI. */
export const OPERATIONAL_FACTORY_SETTING_KEYS = [
  "run-calc-stop-reasons", "run-calc-circles", "run-calc-shippers",
  "run-calc-skid-stacking", "run-calc-grip-sheets",
  "run-calc-shift-start-time", "run-calc-production-start-time",
] as const;

/** Explicit authenticated read allowlist; never broadens write capabilities. */
export const OPERATIONAL_FACTORY_READ_KEYS = [
  ...OPERATIONAL_DIRECTORY_KEYS, ...OPERATIONAL_FACTORY_SETTING_KEYS,
] as const;
