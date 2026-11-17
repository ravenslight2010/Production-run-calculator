import { isDeepStrictEqual } from "node:util";

export type ImportQcSummary = {
  entities: Array<{ entity: string; before: number; after: number; created: number; updated: number; deleted: number }>;
  changes: Array<{ entity: string; row: string; action: string; fields: string[]; before: Record<string, string | number | boolean | null>; after: Record<string, string | number | boolean | null> }>;
  omittedChanges: number;
};
const ENTITIES = ["mixes", "cheeseRecipes", "doughRecipes", "sauceRecipes", "brandProfiles", "freezerPullItems", "specImportAliases"] as const;
const TEXT = new Set(["name", "brand", "flavor", "ingredient", "key"]);
const OMIT = new Set(["id", "scope", "createdAt", "updatedAt", "updatedAtMs", "notes"]);
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
}
function key(row: Record<string, unknown>): string {
  return String(row.id ?? row.key ?? `${row.kind}\0${row.externalName}\0${row.context ?? ""}`);
}
function values(row: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  if (!row) return {};
  const result: Record<string, string | number | boolean | null> = {};
  const visit = (object: Record<string, unknown>, prefix = "", depth = 0) => {
    for (const [field, value] of Object.entries(object).sort(([a], [b]) => a.localeCompare(b))) {
      if (OMIT.has(field) || Object.keys(result).length >= 24) continue;
      const path = `${prefix}${field}`;
      if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" || value === null) result[path] = value;
      else if (TEXT.has(field) && typeof value === "string") result[path] = value.slice(0, 120);
      else if (Array.isArray(value)) {
        result[`${path}Count`] = value.length;
        if (depth < 3) value.slice(0, 12).forEach((child, index) => {
          if (child && typeof child === "object" && !Array.isArray(child)) visit(child as Record<string, unknown>, `${path}[${index}].`, depth + 1);
        });
      } else if (depth < 3 && value && typeof value === "object") visit(value as Record<string, unknown>, `${path}.`, depth + 1);
    }
  };
  visit(row);
  return result;
}
/** Retains only bounded normalized change evidence, never source material or notes. */
export function buildImportQcSummary(before: Record<string, unknown>, after: Record<string, unknown>): ImportQcSummary {
  const summary: ImportQcSummary = { entities: [], changes: [], omittedChanges: 0 };
  for (const entity of ENTITIES) {
    if (!(entity in before) && !(entity in after)) continue;
    const left = new Map(rows(before[entity]).map((row) => [key(row), row]));
    const right = new Map(rows(after[entity]).map((row) => [key(row), row]));
    const counts = { entity, before: left.size, after: right.size, created: 0, updated: 0, deleted: 0 };
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id), b = right.get(id);
      const fields = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
        .filter((field) => (field === "notes" || !OMIT.has(field)) && !isDeepStrictEqual(a?.[field], b?.[field])).sort();
      if (a && b && !fields.length) continue;
      const action = !a ? "created" : !b ? "deleted" : "updated";
      counts[action]++;
      if (summary.changes.length >= 30) { summary.omittedChanges++; continue; }
      summary.changes.push({
        entity, row: String(b?.name ?? a?.name ?? b?.key ?? a?.key ?? id).slice(0, 120),
        action, fields: fields.slice(0, 40), before: values(a), after: values(b),
      });
    }
    summary.entities.push(counts);
  }
  return summary;
}
