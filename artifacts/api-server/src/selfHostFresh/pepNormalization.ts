// Live sync normalization retained from the production helper, without importing
// its historical repair module/catalog. Equivalence is covered by regression tests.
const NATURAL_PEP_CANONICAL = "Pepperoni Stick - NATURAL";
const isBareNatural = (value: unknown) =>
  typeof value === "string" && /^natural(\s*\(.*\))?$/i.test(value.trim());
const pepFields = ["pep1Type", "pep2Type", "pep1TypeB", "pep2TypeB"] as const;
export function healNaturalPepInValues(
  values: Record<string, unknown>,
): boolean {
  let changed = false;
  for (const key of pepFields)
    if (isBareNatural(values[key])) {
      values[key] = NATURAL_PEP_CANONICAL;
      changed = true;
    }
  return changed;
}
export function healNaturalPepList(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  let changed = false;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list)
    if (typeof item === "string") {
      const next = isBareNatural(item) ? NATURAL_PEP_CANONICAL : item;
      changed ||= next !== item;
      if (seen.has(next.toLowerCase())) changed = true;
      else {
        seen.add(next.toLowerCase());
        out.push(next);
      }
    }
  return changed ? out : null;
}
