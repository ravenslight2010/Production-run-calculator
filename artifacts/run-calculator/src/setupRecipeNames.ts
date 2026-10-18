export function normalizeSelectableName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function selectableNames(values: readonly unknown[]): string[] {
  return [...new Set(values.map(normalizeSelectableName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}